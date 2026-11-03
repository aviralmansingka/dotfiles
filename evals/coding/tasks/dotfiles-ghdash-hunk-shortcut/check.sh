#!/usr/bin/env bash
# Behaviour-only check for the gh-dash Hunk shortcut.
#
# Reads the H binding out of the gh-dash config, substitutes the template
# placeholders, and runs the command with stub `gh` and `hunk` binaries on
# PATH. Any command that ends up feeding the PR diff into hunk passes; the
# exact command text is not pinned. The `ghd` shell entry point is required
# because the brief asks for it.
set -uo pipefail
root=$(git rev-parse --show-toplevel) || exit 1
cd "$root" || exit 1

fail() { echo "CHECK FAIL: $*"; exit 1; }

cfg=gh-dash/.config/gh-dash/config.yml
[ -f "$cfg" ] || fail "$cfg does not exist"

grep -Eq '(alias +ghd=|^ghd *\(\)|function +ghd)' zsh/.zshrc \
  || fail "no ghd alias or function in zsh/.zshrc"

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin"

# The command may be multi-line, so keep it in a file instead of a variable.
ruby -ryaml -e '
  c = YAML.safe_load(File.read(ARGV.fetch(0)))
  prs = c.fetch("keybindings").fetch("prs")
  h = prs.find { |b| b["key"] == "H" } or abort("no H binding")
  abort("the existing O binding was removed") unless prs.any? { |b| b["key"] == "O" }
  File.write(ARGV.fetch(1), h.fetch("command"))
' "$cfg" "$tmp/hcmd" || fail "no usable H binding in $cfg"
hunk_cmd=$(cat "$tmp/hcmd")

cat > "$tmp/bin/gh" <<'EOF'
#!/bin/sh
# Stub: any `gh pr diff ...` prints a marker diff.
echo "diff --git a/demo b/demo"
echo "+the pr diff reached hunk"
EOF

cat > "$tmp/bin/hunk" <<'EOF'
#!/bin/sh
# Stub: record stdin, or any readable file argument.
if [ -t 0 ]; then :; else cat > "$HUNK_OUT"; fi
for arg in "$@"; do
  if [ -f "$arg" ] && [ ! -s "$HUNK_OUT" ]; then cp "$arg" "$HUNK_OUT"; fi
done
EOF
chmod +x "$tmp/bin/gh" "$tmp/bin/hunk"

run=${hunk_cmd//"{{.RepoName}}"/acme/widgets}
run=${run//"{{.PrNumber}}"/42}
run=${run//"{{.RepoPath}}"/$root}

HUNK_OUT="$tmp/out" PATH="$tmp/bin:$root/gh-dash/.local/bin:$root/scripts:$PATH" \
  bash -c "$run" >"$tmp/run.log" 2>&1 || {
    echo "--- command output"; cat "$tmp/run.log"; fail "the H binding command failed: $hunk_cmd"; }

[ -s "$tmp/out" ] || fail "hunk received no input from the H binding: $hunk_cmd"
grep -q 'the pr diff reached hunk' "$tmp/out" \
  || fail "hunk did not receive the PR diff: $hunk_cmd"

echo "CHECK PASS: ghd opens gh dash; H pipes the PR diff into hunk ($hunk_cmd)"
