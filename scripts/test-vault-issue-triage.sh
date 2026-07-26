#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TRIAGE="$ROOT/.agents/skills/agent-issue-triage/triage.py"
VAULT="${1:?usage: $0 VAULT}"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

snapshot_files() {
  python3 - "$@" <<'PY'
import hashlib
import sys
from pathlib import Path

for root_name in sys.argv[1:]:
    root = Path(root_name)
    if not root.exists():
        continue
    for path in sorted(root.rglob("*.md")):
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        print(f"{digest}  {path}")
PY
}

make_fixture() {
  local fixture="$1"
  mkdir -p \
    "$fixture/1_projects/neovim/issues/effort" \
    "$fixture/1_projects/neovim/themes/editor/features/alpha/issues" \
    "$fixture/1_projects/pi-agent/issues"

  cat >"$fixture/1_projects/neovim/themes/editor/features/alpha/issues/first-a.md" <<'MD'
---
status: pending-work
feature: ignored-because-path-owns-it
order: 1
priority: a
---
# Ordered First A
MD
  cat >"$fixture/1_projects/neovim/themes/editor/features/alpha/issues/first-z.md" <<'MD'
---
status: pending-work
order: 1
priority: z
---
# Ordered First Z
MD
  cat >"$fixture/1_projects/neovim/themes/editor/features/alpha/issues/second.md" <<'MD'
---
status: proposed
order: 2
---
# Ordered Second
MD
  cat >"$fixture/1_projects/neovim/themes/editor/features/alpha/issues/unordered.md" <<'MD'
---
status: open
---
# Unordered
MD
  cat >"$fixture/1_projects/neovim/issues/assigned.md" <<'MD'
---
status: open
feature: beta
---
# Project Assigned

## Triage

- **User-facing outcome:** A visible result
- **Smallest next action:** Run the focused check
- **Disposition:** keep
MD
  cat >"$fixture/1_projects/neovim/issues/unassigned.md" <<'MD'
---
status: proposed
epic: wrong-project
---
# Project Unassigned
MD
  cat >"$fixture/1_projects/neovim/issues/done.md" <<'MD'
---
status: done
---
# Must Not Appear
MD
  cat >"$fixture/1_projects/neovim/issues/missing-status.md" <<'MD'
---
epic: neovim
---
# Missing Status
MD
  cat >"$fixture/1_projects/neovim/issues/bad-order.md" <<'MD'
---
status: open
order: first
---
# Bad Order
MD
  cat >"$fixture/1_projects/neovim/issues/malformed.md" <<'MD'
---
status: open
# Missing closing delimiter
MD
  cat >"$fixture/1_projects/neovim/issues/effort/map.md" <<'MD'
---
status: open
---
# Nested Wayfinder File Must Not Appear
MD
  cat >"$fixture/1_projects/pi-agent/issues/open.md" <<'MD'
---
status: in-progress
epic: pi-agent
---
# Pi Open
MD
}

validate_blocks() {
  python3 - "$1" "${2:-allow-empty}" <<'PY'
import sys
from pathlib import Path

lines = Path(sys.argv[1]).read_text().splitlines()
required = (
    "- Path:",
    "- Project:",
    "- Feature:",
    "- Current status:",
    "- User-facing outcome:",
    "- Smallest next action:",
    "- Disposition:",
)
blocks = 0
for index, line in enumerate(lines):
    if not line.startswith("#### "):
        continue
    blocks += 1
    following = lines[index + 1 : index + 9]
    for prefix in required:
        if not any(item.startswith(prefix) for item in following):
            raise SystemExit(f"issue block {line!r} lacks {prefix}")
if sys.argv[2] == "require-issues" and not blocks:
    raise SystemExit("dry triage displayed no open issues")
PY
}

main() {
  test -f "$TRIAGE" || fail "missing triage helper: $TRIAGE"
  test -d "$VAULT/1_projects" || fail "not a vault with 1_projects: $VAULT"

  local tmp fixture_output fixture_repeat live_output before_hash after_hash before_status after_status
  tmp="$(mktemp -d)"
  trap 'rm -rf "${tmp:-}"' EXIT
  fixture="$tmp/vault"
  fixture_output="$tmp/fixture.out"
  fixture_repeat="$tmp/fixture-repeat.out"
  live_output="$tmp/live.out"
  before_hash="$tmp/live-before.sha256"
  after_hash="$tmp/live-after.sha256"
  before_status="$tmp/live-before.status"
  after_status="$tmp/live-after.status"

  make_fixture "$fixture"
  python3 "$TRIAGE" --vault "$fixture" --projects pi-agent,neovim >"$fixture_output"
  python3 "$TRIAGE" --vault "$fixture" --projects pi-agent,neovim >"$fixture_repeat"
  cmp -s "$fixture_output" "$fixture_repeat" || fail "fixture output is not deterministic"

  python3 - "$fixture_output" <<'PY'
import sys
from pathlib import Path

text = Path(sys.argv[1]).read_text()
expected_titles = [
    "Ordered First A",
    "Ordered First Z",
    "Ordered Second",
    "Unordered",
    "Project Assigned",
    "Project Unassigned",
    "Pi Open",
]
titles = [line[5:] for line in text.splitlines() if line.startswith("#### ")]
if titles != expected_titles:
    raise SystemExit(f"unexpected issue order: {titles!r}")
for message in (
    "missing frontmatter status",
    "missing closing frontmatter delimiter",
    "order must be an integer",
    "conflicts with path project 'neovim'",
):
    if message not in text:
        raise SystemExit(f"missing diagnostic: {message}")
for excluded in ("Must Not Appear", "Nested Wayfinder File Must Not Appear", "Bad Order", "Missing Status"):
    if excluded in titles:
        raise SystemExit(f"excluded candidate was displayed: {excluded}")
for value in (
    "- Feature: alpha",
    "- Feature: beta",
    "- Feature: Unassigned",
    "- User-facing outcome: A visible result",
    "- Smallest next action: Run the focused check",
    "- Disposition: keep",
    "- User-facing outcome: Unresolved",
    "- Disposition: Untriaged",
):
    if value not in text:
        raise SystemExit(f"missing rendered value: {value}")
if text.index("## Project: neovim") > text.index("## Project: pi-agent"):
    raise SystemExit("projects are not sorted deterministically")
PY
  validate_blocks "$fixture_output" require-issues

  snapshot_files "$VAULT/1_projects/neovim" "$VAULT/1_projects/pi-agent" >"$before_hash"
  if git -C "$VAULT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$VAULT" status --porcelain=v1 --untracked-files=all -- \
      1_projects/neovim 1_projects/pi-agent >"$before_status"
  else
    : >"$before_status"
  fi

  python3 "$TRIAGE" --vault "$VAULT" --projects neovim,pi-agent >"$live_output"
  validate_blocks "$live_output"
  grep -q '^# Issue dry triage (read-only)$' "$live_output" || fail "live output does not state read-only mode"
  grep -q '^## Project: neovim$' "$live_output" || fail "live output did not cover Neovim"
  grep -q '^## Project: pi-agent$' "$live_output" || fail "live output did not cover Pi Agent"

  snapshot_files "$VAULT/1_projects/neovim" "$VAULT/1_projects/pi-agent" >"$after_hash"
  if git -C "$VAULT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$VAULT" status --porcelain=v1 --untracked-files=all -- \
      1_projects/neovim 1_projects/pi-agent >"$after_status"
  else
    : >"$after_status"
  fi
  cmp -s "$before_hash" "$after_hash" || fail "live project Markdown changed during dry triage"
  cmp -s "$before_status" "$after_status" || fail "live project Git status changed during dry triage"

  echo "fixture discovery, diagnostics, ownership, ordering, and required fields passed"
  echo "live dry triage: $(grep -c '^#### ' "$live_output") open issues across Neovim and Pi Agent"
  echo "live vault Markdown SHA-256 manifest unchanged: $(shasum -a 256 "$after_hash" | awk '{print $1}')"
  echo "live vault project Git status unchanged"
  echo "vault issue triage V01 passed"
}

main "$@"
