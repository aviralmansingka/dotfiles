# Body of `openbao-snapshot`, rendered by pkgs.writeShellApplication from
# nix/services/openbao.nix — which supplies the shebang, `set -euo pipefail`, and
# a PATH built from the runtimeInputs (`bao`, `age`, coreutils, grep, find).
#
# One raft snapshot, age-encrypted to the fleet admin before it is readable
# anywhere it would survive. The readable copy is a mode-600 file in a mktemp
# directory, removed by the trap on every exit path, so a crash mid-save leaves
# no plaintext behind.
#
# The recipients are the admin age key, and only the admin age key: a snapshot is
# the whole cluster's KV data, tokens included, so it must not be readable by a
# host identity that a compromise of that host would hand over. The address is
# passed by the unit from .sops.yaml (see the module), never written down here.
#
# Exit codes: 0 saved or deliberately skipped, 1 a real failure, 2 usage.
umask 077

recipient=""
keep="${OPENBAO_SNAPSHOT_KEEP:-14}"
snapshot_dir="${OPENBAO_SNAPSHOT_DIR:-$HOME/.local/state/openbao/snapshots}"
token_file="${BAO_TOKEN_FILE:-}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --recipient)
      recipient="${2:-}"
      shift 2
      ;;
    --keep)
      keep="${2:-}"
      shift 2
      ;;
    -h | --help)
      echo "usage: openbao-snapshot --recipient <age1...> [--keep N]"
      exit 0
      ;;
    *)
      echo "openbao-snapshot: unknown argument '$1'" >&2
      exit 2
      ;;
  esac
done

if [ -z "$recipient" ]; then
  echo "openbao-snapshot: --recipient is required (the admin age key from .sops.yaml)" >&2
  exit 2
fi
case "$keep" in
  '' | *[!0-9]*)
    echo "openbao-snapshot: --keep needs a number, got '$keep'" >&2
    exit 2
    ;;
esac

# A sealed or unreachable server has nothing to hand out, and that is not a
# failure: the timer keeps its schedule while the server sits sealed (S02's end
# state) and becomes useful the moment S03's unseal chain lands. `bao status`
# exits 2 while sealed, which is why the value is read rather than the code.
sealed="$(bao status -field=sealed 2>/dev/null || true)"
case "$sealed" in
  false) ;;
  true)
    echo "openbao-snapshot: the server is sealed; no snapshot is possible until it unseals" >&2
    exit 0
    ;;
  *)
    echo "openbao-snapshot: no OpenBao answered at ${BAO_ADDR:-the default address}; skipped" >&2
    exit 0
    ;;
esac

# The token comes from a file, never from argv. `bao` reads BAO_TOKEN, so the
# value is exported for exactly this process tree and the file stays 0400.
if [ -z "$token_file" ] || [ ! -r "$token_file" ]; then
  echo "openbao-snapshot: BAO_TOKEN_FILE is unset or unreadable; the token openbao-snapshot-token is missing from sops" >&2
  exit 1
fi
BAO_TOKEN="$(<"$token_file")"
export BAO_TOKEN

# Keep the periodic token alive: a periodic token dies one `period` after its
# last renewal, and this timer is the only thing that touches it. A failure here
# is not fatal — the snapshot below is the real work, and an expired token shows
# up as a failed save, never as a silently missing one.
bao token renew >/dev/null 2>&1 || true

mkdir -p -- "$snapshot_dir"
plain="$(mktemp -t openbao-snapshot.XXXXXXXX)"
trap 'rm -f -- "$plain"' EXIT

bao operator raft snapshot save "$plain"

# The timestamp sorts lexicographically in the same order as it sorts in time,
# which is what makes the prune below a plain array slice.
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$snapshot_dir/openbao-$stamp.snapshot.age"
age --encrypt --recipient "$recipient" --output "$out" "$plain"

if [ ! -s "$out" ] || [ "$(head -c 21 "$out")" != "age-encryption.org/v1" ]; then
  echo "openbao-snapshot: $out is not an age file; left in place for inspection" >&2
  exit 1
fi

shopt -s nullglob
snapshots=("$snapshot_dir"/*.snapshot.age)
count="${#snapshots[@]}"
if [ "$count" -gt "$keep" ]; then
  for old in "${snapshots[@]:0:$((count - keep))}"; do
    rm -f -- "$old"
    echo "openbao-snapshot: pruned $old"
  done
fi

echo "openbao-snapshot: wrote $out ($(wc -c <"$out") bytes, recipient $recipient)"
