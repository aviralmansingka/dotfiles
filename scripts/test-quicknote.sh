#!/usr/bin/env bash
# Paths: go/quicknote/** scripts/test-quicknote.sh scripts/install-quicknote rex/.config/rex/notes.lua
set -euo pipefail
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
command -v go >/dev/null || { echo 'FAIL: Go 1.26+ is required for the quicknote tests' >&2; exit 1; }
build_dir=$(mktemp -d)
trap 'rm -rf "$build_dir"' EXIT
cd "$repo_root/go/quicknote"
go test ./...
go vet ./...
go build -o "$build_dir/quicknote" ./cmd/quicknote

# The binary is the contract an agent calls: check the note it writes.
vault="$build_dir/vault"
"$build_dir/quicknote" --vault "$vault" --json "Writer's block is caused by reader's block" \
  | grep -q '"created":true'
note="$vault/0_inbox/fleeting/writers-block-is-caused-by-readers-block.md"
grep -q '^tags: \[fleeting\]$' "$note"
grep -q '^> \[!FLEETING\] Writer.s block is caused by reader.s block$' "$note"
"$build_dir/quicknote" --vault "$vault" --json "Writer's block is caused by reader's block" \
  | grep -q '"duplicate":true'
"$build_dir/quicknote" --vault "$vault" --body "added later" --json "Writer's block is caused by reader's block" \
  | grep -q '"appended":true'
grep -q '^> added later$' "$note"

# The capture records when the thought arrived, which is what the processing
# queue ages and orders by.
grep -q '^captured: ' "$note"

# The processing pass draws the queue; its promote path is covered by go test.
"$build_dir/quicknote" review --vault "$vault" --render --width 80 --height 18 | grep -q 'REVIEW'

# The Rex chords must stay wired to the binary they launch.
grep -q 'rex.bind("cmd+shift+n", "capture_note")' "$repo_root/rex/.config/rex/notes.lua"
grep -q 'rex.bind("cmd+shift+p", "process_notes")' "$repo_root/rex/.config/rex/notes.lua"
grep -q 'open_layer(ctx, CARD_W, CARD_H, { "quicknote", "ui" })' "$repo_root/rex/.config/rex/notes.lua"
grep -q 'open_layer(ctx, REVIEW_W, REVIEW_H, { "quicknote", "review" })' "$repo_root/rex/.config/rex/notes.lua"
grep -q 'require("notes")' "$repo_root/rex/.config/rex/init.lua"

echo "quicknote tests passed"
