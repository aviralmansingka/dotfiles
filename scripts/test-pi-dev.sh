#!/usr/bin/env bash
# Paths: scripts/pi-dev
# Static checks for scripts/pi-dev. Never starts a real pi session: the run
# path is covered by a fake `pi` binary on PATH that prints what it receives.
set -euo pipefail
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
pi_dev="$repo_root/scripts/pi-dev"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

pass=0
ok() { pass=$((pass + 1)); printf 'ok   %s\n' "$1"; }
die() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
check() {
  if [ "$1" = "$2" ]; then ok "$3"; else die "$3 (want [$2], got [$1])"; fi
}

# Hermetic: private HOME, private fake pi, private Git identity.
export HOME="$tmp/home"
export GIT_CONFIG_GLOBAL="$tmp/gitconfig"
export GIT_CONFIG_NOSYSTEM=1
mkdir -p "$HOME/.pi/agent" "$tmp/bin"
printf '{"secret":true}\n' >"$HOME/.pi/agent/auth.json"
cat >"$tmp/bin/pi" <<'EOF'
#!/usr/bin/env bash
printf 'PI_CODING_AGENT_DIR=%s\n' "${PI_CODING_AGENT_DIR:-}"
printf 'args=%s\n' "$*"
EOF
chmod +x "$tmp/bin/pi"
export PATH="$tmp/bin:$PATH"

repo="$tmp/repo"
mkdir -p "$repo/pi/.pi/agent/extensions"
printf '{}\n' >"$repo/pi/.pi/agent/settings.json"
git init -q -b main "$repo"
git -C "$repo" -c user.email=t@example.com -c user.name=t add -A
git -C "$repo" -c user.email=t@example.com -c user.name=t commit -qm base
agent=$(cd "$repo/pi/.pi/agent" && pwd -P)

# --print: exact command, with and without pi arguments.
check "$("$pi_dev" "$repo" --print)" "env PI_CODING_AGENT_DIR=$agent pi" "--print shows the env and pi"
check "$("$pi_dev" "$repo" --print -- -p 'hello world')" \
  "env PI_CODING_AGENT_DIR=$agent pi -p hello\\ world" "--print carries pi arguments"
(cd "$repo/pi" && "$pi_dev" --print) >/dev/null 2>&1 ||
  die "--print from a subdirectory of the worktree"
check "$(cd "$repo/pi" && "$pi_dev" --print)" "env PI_CODING_AGENT_DIR=$agent pi" "no path uses the Git root"
check "$("$pi_dev" --print "$repo")" "env PI_CODING_AGENT_DIR=$agent pi" "--print may come first"

# Auth link: created once, points at the user's file, never replaced.
[ -L "$agent/auth.json" ] || die "auth link missing"
ok "auth link created"
check "$(readlink "$agent/auth.json")" "$HOME/.pi/agent/auth.json" "auth link target"
"$pi_dev" "$repo" --print >/dev/null
check "$(readlink "$agent/auth.json")" "$HOME/.pi/agent/auth.json" "auth link is idempotent"
rm "$agent/auth.json"
printf 'own\n' >"$agent/auth.json"
"$pi_dev" "$repo" --print >/dev/null
check "$(cat "$agent/auth.json")" "own" "an existing auth file is left alone"
rm "$agent/auth.json"

# Git exclusion: one entry, added once, git status stays clean.
"$pi_dev" "$repo" --print >/dev/null
exclude=$(git -C "$repo" rev-parse --path-format=absolute --git-path info/exclude)
check "$(grep -cxF 'pi/.pi/agent/auth.json' "$exclude")" "1" "exclude entry written"
"$pi_dev" "$repo" --print >/dev/null
check "$(grep -cxF 'pi/.pi/agent/auth.json' "$exclude")" "1" "exclude entry is idempotent"
check "$(git -C "$repo" status --porcelain)" "" "git status stays clean"

# A linked worktree gets the same treatment, with no second exclude entry.
git -C "$repo" worktree add -q "$tmp/wt" -b feat >/dev/null
wt_agent=$(cd "$tmp/wt/pi/.pi/agent" && pwd -P)
check "$("$pi_dev" "$tmp/wt" --print)" "env PI_CODING_AGENT_DIR=$wt_agent pi" "linked worktree path resolves"
[ -L "$wt_agent/auth.json" ] || die "linked worktree auth link missing"
ok "linked worktree auth link"
check "$(grep -cxF 'pi/.pi/agent/auth.json' "$exclude")" "1" "linked worktree reuses the exclude entry"
check "$(git -C "$tmp/wt" status --porcelain)" "" "linked worktree status stays clean"

# The exec path: a fake pi proves the env var and arguments arrive unchanged.
check "$("$pi_dev" "$repo" -p 'probe this')" \
  "PI_CODING_AGENT_DIR=$agent
args=-p probe this" "exec passes env and arguments"
check "$(cd "$repo" && "$pi_dev" --print -- --skill x.md)" \
  "env PI_CODING_AGENT_DIR=$agent pi --skill x.md" "-- stops pi-dev option parsing"

# Missing pi config directory.
bare="$tmp/bare"
git init -q -b main "$bare"
if "$pi_dev" "$bare" --print >/dev/null 2>"$tmp/err"; then die "missing pi/.pi/agent must fail"; fi
bare_root=$(cd "$bare" && pwd -P)
check "$(cat "$tmp/err")" "pi-dev: no pi config directory at $bare_root/pi/.pi/agent" "missing config error line"

# Outside Git.
mkdir -p "$tmp/plain"
if "$pi_dev" "$tmp/plain" --print >/dev/null 2>"$tmp/err"; then die "non-Git path must fail"; fi
check "$(cat "$tmp/err")" "pi-dev: not a Git worktree: $tmp/plain" "non-Git error line"

echo "passed $pass checks"
