# Body of `openbao-agents`, rendered by pkgs.writeShellApplication from
# nix/services/openbao.nix — which supplies the shebang, `set -euo pipefail`,
# and a PATH built from the runtimeInputs (`bao`, `sops`, `jq`, `curl`,
# python3, coreutils).
#
# One operator entry point for the KV mount and the per-agent AppRole
# identities. The documents it loads are owned by the flake: one
# `~/.config/openbao/policies/agent-<agent>.hcl` per entry in the `agents` list
# in nix/services/openbao.nix. A policy is therefore reviewed in git and then
# loaded exactly as reviewed — this script never carries a policy inline.
#
#   openbao-agents provision        # kv-v2 at secret/, approle, policies, roles
#   openbao-agents seed             # push the agent secrets from sops into KV
#   openbao-agents prove NAME       # login as NAME: own 200, others 403, TTL, policy
#   openbao-agents rotate NAME      # a fresh secret_id for one role
#   openbao-agents revoke NAME      # delete the role; every secret_id for it dies
#   openbao-agents status           # mounts, approle roles and their TTLs
#
# Two properties the shape of this script exists for:
#
#   - No secret value is ever an argument or a terminal line. The root token is
#     read from the sops-deployed init escrow into BAO_TOKEN for the length of
#     one command (the same convention as openbao-snapshot.sh); the agent
#     secrets reach `seed` only through `sops exec-file`, which hands the child a
#     fifo and never a value, and each KV body reaches `bao kv put` as `@file`. `provision`/`rotate` print credentials on stdout for the caller
#     to capture into sops — redirect them, never read them off a screen.
#   - Every entry point is idempotent. `provision` converges; `seed` overwrites
#     with a new KV version; `prove` is read-only.
#
# Exit codes: 0 on success, 1 on a real failure (including a `prove` whose
# expectations did not hold).
#
# `set -euo pipefail` repeats what writeShellApplication prepends deliberately:
# the same file also runs as a plain copied script when the profile cannot be
# switched (see docs/secrets.md, "The KV mount and the AppRoles").
set -euo pipefail

umask 077

addr="${BAO_ADDR:-http://127.0.0.1:8200}"
policy_dir="${OPENBAO_POLICY_DIR:-$HOME/.config/openbao/policies}"
init_file="${OPENBAO_INIT_FILE:-$HOME/.config/sops-nix/secrets/openbao-init.json}"
sops_file="${OPENBAO_SOPS_FILE:-$HOME/dotfiles/secrets/homelab.yaml}"
approle_key="${OPENBAO_APPROLE_KEY:-openbao-approle.json}"

# The identity's lifetime, as three numbers that only make sense together:
# a 15 minute token (a leaked token is a nuisance, not a standing key), a 1 hour
# hard cap (renewal cannot extend past it), and a 24 hour secret_id TTL that
# forces the operator to rotate the bundle in sops every day. All three are
# overridable so a runbook can rehearse a shorter cycle without editing code.
token_ttl="${OPENBAO_TOKEN_TTL:-15m}"
token_max_ttl="${OPENBAO_TOKEN_MAX_TTL:-1h}"
secret_id_ttl="${OPENBAO_SECRET_ID_TTL:-24h}"

self="$0"

export BAO_ADDR="$addr"

die() {
  echo "openbao-agents: $*" >&2
  exit 1
}

note() {
  echo "openbao-agents: $*" >&2
}

# Every agent is defined by its policy file, which the flake renders. One
# source of truth: adding an agent to the `agents` list in openbao.nix adds the
# policy file here, and this list follows.
agents() {
  local f b
  for f in "$policy_dir"/agent-*.hcl; do
    [ -e "$f" ] || continue
    b="${f##*/}"
    b="${b#agent-}"
    printf '%s\n' "${b%.hcl}"
  done
}

have_agent() {
  local list
  list="$(agents)"
  [ -n "$list" ] || return 1
  case $'\n'"$list"$'\n' in
    *$'\n'"$1"$'\n'*) return 0 ;;
    *) return 1 ;;
  esac
}

require_agent() {
  have_agent "$1" ||
    die "$1 is not an agent in $policy_dir (known: $(agents | tr '\n' ' '))"
}

# The root token, from the escrow that already exists for the unseal unit. It
# is read by jq straight into the environment — never printed, never an
# argument. The escrow is 0400 and the same login user can already read it
# (docs/secrets.md, "The residual risk this decision accepts"), so this grants
# nothing new.
root_token() {
  [ -r "$init_file" ] ||
    die "no init escrow at $init_file; the root token lives there (docs/secrets.md, Runbook 5)"
  BAO_TOKEN="$(jq -r '.root_token // empty' -- "$init_file")"
  [ -n "$BAO_TOKEN" ] || die "$init_file holds no root_token"
  export BAO_TOKEN
}

tmpdir=""
cleanup() {
  if [ -n "$tmpdir" ]; then rm -rf -- "$tmpdir"; fi
}
trap cleanup EXIT

scratch() {
  if [ -z "$tmpdir" ]; then
    tmpdir="$(mktemp -d "${XDG_RUNTIME_DIR:-/tmp}/openbao-agents.XXXXXXXX")"
    chmod 700 -- "$tmpdir"
  fi
}

# A plain HTTP status for the acceptance evidence: `bao` reports the code inside
# an error message, and the acceptance criterion is the code itself. The
# response body lands in $tmpdir/http.json, which is 0600 inside a 0700
# directory and removed with it.
http() { # method, path, header-file (or ""), body-file (or ""); prints the status
  local method="$1" path="$2" hdr="${3:-}" body="${4:-}"
  local -a args=(-sS --max-time 20 -X "$method" -o "$tmpdir/http.json" -w '%{http_code}')
  if [ -n "$hdr" ]; then args+=(-H @"$hdr"); fi
  if [ -n "$body" ]; then args+=(-H 'Content-Type: application/json' --data-binary @"$body"); fi
  curl "${args[@]}" "$addr/v1/$path"
}

cmd_provision() {
  local agent bundle
  scratch
  root_token

  bao secrets list -format=json >"$tmpdir/mounts.json" ||
    die "cannot list mounts; is the node unsealed? (docs/secrets.md, Runbook 5)"

  if jq -e 'has("secret/")' "$tmpdir/mounts.json" >/dev/null; then
    local type version
    type="$(jq -r '.["secret/"].type' "$tmpdir/mounts.json")"
    version="$(jq -r '.["secret/"].options.version // "1"' "$tmpdir/mounts.json")"
    # A `secret/` that is something else is not upgraded in place: replacing a
    # live mount destroys its data. Stop and let a human decide.
    if [ "$type" != "kv" ] || [ "$version" != "2" ]; then
      die "secret/ is mounted as $type v$version, not kv v2; refusing to replace a live mount"
    fi
    note "kv-v2 already mounted at secret/"
  else
    bao secrets enable -path=secret \
      -description="agent secrets: one KV v2 entry per agent" kv-v2 >/dev/null
    note "enabled kv-v2 at secret/"
  fi

  bao auth list -format=json >"$tmpdir/auth.json" || die "cannot list auth methods"
  if jq -e 'has("approle/")' "$tmpdir/auth.json" >/dev/null; then
    note "approle already enabled"
  else
    bao auth enable approle >/dev/null
    note "enabled approle"
  fi

  bundle="$tmpdir/bundle.json"
  printf '{}' >"$bundle"

  while IFS= read -r agent; do
    bao policy write "$agent" "$policy_dir/agent-$agent.hcl" >/dev/null
    note "loaded policy $agent from $policy_dir/agent-$agent.hcl"

    # `token_policies` names one policy and `token_no_default_policy` keeps
    # OpenBao from adding its `default` policy: that policy grants a token
    # nothing on secret/ but does grant self-management, and this identity
    # needs neither. What the token can reach is exactly what the policy names.
    bao write "auth/approle/role/$agent" \
      token_policies="$agent" \
      token_no_default_policy=true \
      token_ttl="$token_ttl" \
      token_max_ttl="$token_max_ttl" \
      secret_id_ttl="$secret_id_ttl" \
      secret_id_num_uses=0 \
      bind_secret_id=true \
      token_num_uses=0 >/dev/null
    note "role $agent: token_ttl=$token_ttl token_max_ttl=$token_max_ttl secret_id_ttl=$secret_id_ttl"

    bao read -format=json "auth/approle/role/$agent/role-id" >"$tmpdir/role-$agent.json"
    bao write -f -format=json "auth/approle/role/$agent/secret-id" >"$tmpdir/secret-$agent.json"

    # Two response documents, merged by jq: the credentials never pass through
    # this shell's argument list.
    jq -s --arg a "$agent" \
      '{($a): {
          role_id: .[0].data.role_id,
          secret_id: .[1].data.secret_id,
          secret_id_accessor: .[1].data.secret_id_accessor,
          secret_id_ttl: .[1].data.secret_id_ttl
        }}' \
      "$tmpdir/role-$agent.json" "$tmpdir/secret-$agent.json" >"$tmpdir/frag.json"
    jq -s '.[0] * .[1]' "$bundle" "$tmpdir/frag.json" >"$tmpdir/merged.json"
    mv -- "$tmpdir/merged.json" "$bundle"
    rm -f -- "$tmpdir/role-$agent.json" "$tmpdir/secret-$agent.json" "$tmpdir/frag.json"
  done < <(agents | sort)

  note "credential bundle written to stdout: redirect it into sops, never onto a terminal"
  cat -- "$bundle"
}

# Runs under `sops exec-file`, which hands this subcommand the decrypted
# secrets file — as a fifo by default, so the plaintext is a pipe and not a file
# on any disk. Two reasons for exec-file rather than the more obvious
# `sops exec-env`, both measured on the lab on 2026-11-06:
#
#   - `sops exec-env` runs its command through a hard-coded `/bin/sh`. On macOS
#     that is bash, which keeps an environment name containing a dot; on Ubuntu
#     it is dash, which drops one. The agent keys are `pi-telegram.env` and
#     friends, so on the lab exec-env exports nothing and the payload came back
#     empty — a silent no-op, the worst failure shape.
#   - Even where it works, exec-env needs the value to be readable as an
#     environment variable. A path in argv is the narrower contract: the value
#     never becomes an identifier, an argument, or a journal line.
#
# `--output-type json` keeps the parsing in python's json module, so the script
# needs no YAML parser on the host.
cmd_emit() {
  [ "$#" -eq 1 ] || die "__emit takes the decrypted file path"
  python3 - "$1" <<'PY'
import json
import os
import sys


def fields(text):
    """KEY=value lines, the same shape systemd's EnvironmentFile accepts.

    Comments, blank lines, an `export ` prefix and one layer of surrounding
    quotes are handled; anything without `=` is skipped rather than guessed at.
    A multi-line value cannot be expressed here and would be truncated loudly by
    a consumer noticing a missing suffix — no such agent secret exists today.
    """
    out = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :]
        if "=" not in line:
            continue
        name, value = line.split("=", 1)
        name = name.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if name:
            out[name] = value
    return out


payload = {}
secrets = json.load(open(sys.argv[1]))
for agent in os.environ.get("OPENBAO_AGENT_LIST", "").split():
    raw = secrets.get(agent + ".env")
    if raw is None:
        print(
            f"openbao-agents: {agent}.env is not in the secrets file; nothing to seed for {agent}",
            file=sys.stderr,
        )
        continue
    values = fields(raw)
    if not values:
        print(
            f"openbao-agents: {agent}.env parsed to no fields; refusing to seed an empty entry",
            file=sys.stderr,
        )
        continue
    payload[agent] = values

json.dump(payload, sys.stdout, sort_keys=True)
PY
}

cmd_seed() {
  local agent body
  scratch
  root_token
  [ -r "$sops_file" ] || die "no secrets file at $sops_file"

  note "reading the agent secrets out of $sops_file through sops exec-file (a fifo); no value is an argument"
  OPENBAO_AGENT_LIST="$(agents)" sops exec-file --output-type json "$sops_file" \
    "'$self' __emit {}" >"$tmpdir/payload.json"
  jq -e 'type == "object" and length > 0' "$tmpdir/payload.json" >/dev/null ||
    die "the secrets file yielded no agent payload"

  while IFS= read -r agent; do
    body="$tmpdir/$agent.data.json"
    # `bao kv put path @file` reads a *flat* JSON object of fields, so the body is
    # the field map itself, not a KV v2 envelope: `{"data": {...}}` would store
    # one field literally named `data`. The file is 0600 in a 0700 directory and
    # removed as soon as the version is written.
    jq --arg a "$agent" '.[$a]' "$tmpdir/payload.json" >"$body"
    bao kv put "secret/$agent" "@$body" >/dev/null ||
      die "kv put failed for secret/$agent"
    note "wrote secret/$agent version $(bao kv metadata get -format=json "secret/$agent" | jq -r '.data.current_version') $(jq -r --arg a "$agent" '"with \(.[$a] | keys | length) field(s): \(.[$a] | keys | join(","))"' "$tmpdir/payload.json")"
    rm -f -- "$body"
  done < <(jq -r 'keys[]' "$tmpdir/payload.json")

  rm -f -- "$tmpdir/payload.json"
}

cmd_prove() {
  local agent="$1" other hdr status accessor fails=0
  require_agent "$agent"
  scratch
  root_token
  [ -r "$sops_file" ] || die "no secrets file at $sops_file"

  # The credentials come from sops, so `prove` is meaningful right after a
  # rotation: the bundle it logs in with is the one consumers are given.
  sops decrypt --extract "[\"$approle_key\"]" --output-type json "$sops_file" \
    >"$tmpdir/bundle.json" || die "no $approle_key in $sops_file"
  jq -e --arg a "$agent" '.[$a].role_id and .[$a].secret_id' "$tmpdir/bundle.json" >/dev/null ||
    die "$approle_key has no credentials for $agent"

  jq -c --arg a "$agent" '{role_id: .[$a].role_id, secret_id: .[$a].secret_id}' \
    "$tmpdir/bundle.json" >"$tmpdir/login-body.json"
  rm -f -- "$tmpdir/bundle.json"

  # The login body is on stdin, not in argv: a secret_id in argv would be
  # visible to every process on the host.
  status="$(http POST auth/approle/login "" "$tmpdir/login-body.json")"
  mv -- "$tmpdir/http.json" "$tmpdir/login.json"
  rm -f -- "$tmpdir/login-body.json"
  printf 'agent                         %s\n' "$agent"
  printf '  login auth/approle/login    %s\n' "$status"
  [ "$status" = "200" ] || die "approle login failed (is the secret_id older than $secret_id_ttl?)"

  hdr="$tmpdir/agent.hdr"
  { printf 'X-Vault-Token: '; jq -j '.auth.client_token' "$tmpdir/login.json"; printf '\n'; } >"$hdr"
  [ "$(wc -c <"$hdr")" -gt 16 ] || die "login returned no client token"

  status="$(http GET "secret/data/$agent" "$hdr")"
  printf '  read  %-24s %s  own path, fields: %s\n' "secret/data/$agent" "$status" \
    "$(jq -r '(.data.data // {}) | keys | join(",")' "$tmpdir/http.json" 2>/dev/null)"
  [ "$status" = "200" ] || fails=$((fails + 1))

  while IFS= read -r other; do
    [ "$other" = "$agent" ] && continue
    status="$(http GET "secret/data/$other" "$hdr")"
    printf '  read  %-24s %s  another agent\047s path\n' "secret/data/$other" "$status"
    [ "$status" = "403" ] || fails=$((fails + 1))
  done < <(agents | sort)

  # TTL and policy set, read by the root token through the login's accessor.
  # The accessor cannot authenticate, so it is safe in an argument.
  accessor="$(jq -r '.auth.accessor // empty' "$tmpdir/login.json")"
  bao write -format=json auth/token/lookup-accessor accessor="$accessor" \
    >"$tmpdir/lookup.json" || die "cannot look the token up by accessor"
  printf '  token                       ttl=%ss creation_ttl=%ss renewable=%s policies=%s\n' \
    "$(jq -r '.data.ttl' "$tmpdir/lookup.json")" \
    "$(jq -r '.data.creation_ttl' "$tmpdir/lookup.json")" \
    "$(jq -r '.data.renewable' "$tmpdir/lookup.json")" \
    "$(jq -r '.data.policies | join(",")' "$tmpdir/lookup.json")"
  # The endpoint `bao token lookup <token>` calls, with the token read from a
  # file (`token=@path`) so it stays out of every argument list. Printed for the
  # transcript: the acceptance criterion is about these two fields.
  jq -j '.auth.client_token' "$tmpdir/login.json" >"$tmpdir/tid"
  bao write -format=json auth/token/lookup "token=@$tmpdir/tid" >"$tmpdir/lookup-id.json"
  printf '  bao token lookup            %s\n' \
    "$(jq -c '.data | {policies, ttl, creation_ttl, renewable, num_uses, display_name}' "$tmpdir/lookup-id.json")"
  rm -f -- "$tmpdir/tid" "$tmpdir/lookup-id.json"

  if ! jq -e --arg a "$agent" \
    '.data.ttl <= 900 and .data.creation_ttl <= 900 and .data.policies == [$a]' \
    "$tmpdir/lookup.json" >/dev/null; then
    printf '  token                       FAIL: wanted ttl <= 900 and policies == [%s]\n' "$agent"
    fails=$((fails + 1))
  fi

  printf '  policy %-22s %s\n' "$agent" \
    "$(bao policy read "$agent" | sed -n 's/^path "\([^"]*\)".*/\1/p' | tr '\n' ' ')"
  rm -f -- "$tmpdir/login.json" "$tmpdir/lookup.json" "$hdr" "$tmpdir/http.json"

  if [ "$fails" -ne 0 ]; then
    die "$fails expectation(s) did not hold for $agent"
  fi
  note "all expectations held for $agent"
}

cmd_rotate() {
  local agent="$1"
  require_agent "$agent"
  scratch
  root_token

  bao read -format=json "auth/approle/role/$agent/role-id" >"$tmpdir/role.json"
  bao write -f -format=json "auth/approle/role/$agent/secret-id" >"$tmpdir/secret.json"
  jq -s '{role_id: .[0].data.role_id,
          secret_id: .[1].data.secret_id,
          secret_id_accessor: .[1].data.secret_id_accessor,
          secret_id_ttl: .[1].data.secret_id_ttl}' \
    "$tmpdir/role.json" "$tmpdir/secret.json"
  rm -f -- "$tmpdir/role.json" "$tmpdir/secret.json"
  note "new secret_id for $agent is on stdout; store it in sops and drop the old one"
}

cmd_revoke() {
  local agent="$1"
  require_agent "$agent"
  scratch
  root_token

  # Deleting the role is the revoke that does not need the credential back: every
  # secret_id minted for it stops authenticating immediately. Tokens already
  # issued keep working until they expire — 15 minutes, 1 hour at the outermost —
  # and are seen by nobody once the secret_id is gone.
  bao delete "auth/approle/role/$agent"
  note "deleted role $agent: its secret_ids no longer authenticate"
  note "tokens already issued expire within $token_ttl (hard cap $token_max_ttl); re-run provision to recreate the role"
}

cmd_status() {
  local agent entries roles
  scratch
  root_token

  printf 'mounts\n'
  bao secrets list -format=json |
    jq -r 'to_entries[] | "  \(.key)\t\(.value.type)\tv\(.value.options.version // "-")"'
  printf 'auth\n'
  bao auth list -format=json |
    jq -r 'to_entries[] | "  \(.key)\t\(.value.type)"'

  # A LIST response is a bare array on this build, an object with `keys` on the
  # others; both shapes are accepted rather than one assumed.
  printf 'kv entries\n'
  entries="$(bao list -format=json secret/metadata 2>/dev/null || true)"
  if [ -n "$entries" ] && printf '%s' "$entries" | jq -e 'length > 0' >/dev/null 2>&1; then
    printf '%s' "$entries" |
      jq -r '(if type == "array" then . else .keys end)[] | "  secret/data/\(.)"'
  else
    printf '  none\n'
  fi

  printf 'approle roles\n'
  roles="$(bao list -format=json auth/approle/role 2>/dev/null || true)"
  if [ -n "$roles" ] && printf '%s' "$roles" | jq -e 'length > 0' >/dev/null 2>&1; then
    while IFS= read -r agent; do
      bao read -format=json "auth/approle/role/$agent" |
        jq -r --arg a "$agent" \
          '  "\($a)\ttoken_ttl=\(.data.token_ttl)s token_max_ttl=\(.data.token_max_ttl)s secret_id_ttl=\(.data.secret_id_ttl)s policies=\(.data.token_policies | join(",")) token_no_default_policy=\(.data.token_no_default_policy)"'
    done < <(printf '%s' "$roles" | jq -r 'if type == "array" then .[] else .keys[] end')
  else
    printf '  none\n'
  fi
}

if [ "$#" -eq 0 ]; then
  echo "usage: openbao-agents {provision|seed|prove <agent>|rotate <agent>|revoke <agent>|status}" >&2
  exit 2
fi

command="$1"
shift

case "$command" in
  provision) cmd_provision ;;
  seed) cmd_seed ;;
  prove) [ "$#" -eq 1 ] || die "prove needs one agent name"; cmd_prove "$1" ;;
  rotate) [ "$#" -eq 1 ] || die "rotate needs one agent name"; cmd_rotate "$1" ;;
  revoke) [ "$#" -eq 1 ] || die "revoke needs one agent name"; cmd_revoke "$1" ;;
  status) cmd_status ;;
  # Internal: `sops exec-file` re-executes this script as __emit.
  __emit) cmd_emit "$@" ;;
  *)
    die "unknown command '$command' (provision|seed|prove|rotate|revoke|status)"
    ;;
esac
