# Body of `openbao-unseal`, rendered by pkgs.writeShellApplication from
# nix/services/openbao.nix — which supplies the shebang, `set -euo pipefail`, and
# a PATH built from the runtimeInputs (`bao`, `curl`, `jq`, coreutils).
#
# Unseals the local server from the sops-deployed init escrow, so a lab reboot
# ends with a serving node and no human at a terminal. The custody decision
# behind this is recorded in docs/secrets.md, "Unattended unseal": unattended
# custody is approved, and the shares never reach argv or an environment
# variable.
#
# Two properties the shape of this script exists for:
#
#   - no share in argv: every request body goes to `curl --data-binary @-` on
#     stdin. `bao operator unseal` cannot be used at all — it reads the key with
#     `password.Read(os.Stdin)`, which needs a tty and refuses a pipe, and its
#     only other input form is the key as an argument.
#   - no share in a process environment: the escrow file is read once into a
#     mode-600 `mktemp` file, and the requests are driven by `read` from that
#     file. Nothing exports a share.
#
# Idempotent on purpose: a node that is already unsealed is a no-op, so
# re-running the unit after `bao operator seal` (or by hand) is always safe. A
# re-sealed node is restored with `systemctl --user restart
# openbao-unseal.service`.
#
# Exit codes: 0 unsealed or deliberately skipped, 1 a real failure.
umask 077

init_file="${OPENBAO_INIT_FILE:-}"
addr="${BAO_ADDR:-http://127.0.0.1:8200}"
wait_seconds="${OPENBAO_UNSEAL_WAIT:-90}"

export BAO_ADDR="$addr"

if [ -z "$init_file" ] || [ ! -r "$init_file" ]; then
  echo "openbao-unseal: OPENBAO_INIT_FILE is unset or unreadable; the key openbao-init.json is missing from sops" >&2
  exit 1
fi

# Wait for the listener *and* for the core to be initialised, rather than racing
# it: on boot this unit starts beside openbao.service, which binds the socket
# before the unseal path is ready. /v1/sys/health answers 503 while sealed (a
# success here) and 501 until the node is initialised, so the loop reads the body
# instead of trusting an HTTP code.
deadline=$(($(date +%s) + wait_seconds))
until curl -sS --max-time 2 "$addr/v1/sys/health" 2>/dev/null | jq -e '.initialized == true' >/dev/null 2>&1; do
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "openbao-unseal: no initialised listener at $addr after ${wait_seconds}s" >&2
    exit 1
  fi
  sleep 1
done

# The idempotent guard. `bao status` exits 2 while sealed, which is why the value
# is read (and the code swallowed) instead of being trusted as a status.
case "$(bao status -field=sealed 2>/dev/null || true)" in
  false)
    echo "openbao-unseal: already unsealed; nothing to do"
    exit 0
    ;;
  true) ;;
  *)
    echo "openbao-unseal: $addr answered, but with no usable seal state" >&2
    exit 1
    ;;
esac

# The threshold comes from the escrow, not from a constant here: a rotated init
# output changes the number and this script must follow it.
keys="$(mktemp "${XDG_RUNTIME_DIR:-/tmp}/openbao-unseal.XXXXXXXX")"
trap 'rm -f -- "$keys"' EXIT
chmod 600 -- "$keys"

jq -c '.unseal_keys_b64[0:(.unseal_threshold // 3)][] as $k | {key: $k}' "$init_file" >"$keys"

if [ ! -s "$keys" ]; then
  echo "openbao-unseal: $init_file holds no unseal_keys_b64; the escrow is not an init output" >&2
  exit 1
fi

# One request per line, each body on stdin. A `while read` loop, not `head -1`:
# head over-reads the pipe and would swallow the shares it does not print.
while IFS= read -r body; do
  response="$(printf '%s' "$body" | curl -sS --max-time 10 --data-binary @- \
    -H 'Content-Type: application/json' "$addr/v1/sys/unseal")"
  if [ -z "$response" ]; then
    # Not retried: submitting the same share twice could count twice. The final
    # `bao status` below is the authority on whether the unseal worked.
    echo "openbao-unseal: empty response from $addr/v1/sys/unseal" >&2
    continue
  fi
  printf '%s' "$response" |
    jq -r 'if .errors then "openbao-unseal: " + (.errors | join("; "))
           else "openbao-unseal: progress \(.progress // 0)/\(.t // 0) sealed \(.sealed)" end'
done <"$keys"

case "$(bao status -field=sealed 2>/dev/null || true)" in
  false) echo "openbao-unseal: unsealed $addr" ;;
  *)
    echo "openbao-unseal: still sealed after the shares were submitted" >&2
    exit 1
    ;;
esac
