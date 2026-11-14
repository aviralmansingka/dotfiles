# quicknote

Offline tests for the fleeting-note CLI and its Rex chord. Entry:
`scripts/test-quicknote.sh` (`# Paths: go/quicknote/** …`), so the suite joins
`scripts-tests` only when this component changes.

## What it covers

- `go test ./...` in `go/quicknote`: slug rules, the note body, and the write path.
  - Slug: possessive and punctuation removal, padding, empty input falling back to
    `untitled-thought`, and the 60-character cap cutting on a word boundary.
  - Body: frontmatter carries `tags: [fleeting]`, the title sits in a
    `> [!FLEETING]` callout, and each detail line is quoted. A title-only note has
    one quote line.
  - Write: one note per thought under `0_inbox/fleeting/<slug>.md`; the same title
    reports the existing note and writes nothing; new detail is appended once; two
    thoughts that share a slug get a `-2` file; `--dry-run` writes nothing; an
    empty title is refused.
- `go vet ./...` and a real `go build`, so a broken `main` fails before the binary
  runs.
- The built binary is exercised end to end on a temporary vault: `created`,
  `duplicate`, and `appended` JSON results, plus the file contents.
- The Rex wiring is asserted by text: `require("notes")` in `init.lua`, the
  `capture_note` action launching `quicknote ui` at the card's size, and the
  `cmd+shift+n` bind.
- `TestCardFootprint` renders the card at the size `rex/notes.lua` cuts the
  floating layer to and fails if the card grows past it, which is how the Lua and
  Go constants stay in step.

## Rules

- No live Rex session, no terminal, no `~/vault`: every run uses `mktemp -d`.
- No network beyond the Go module cache.
- Runtime is a few seconds warm; the first run pays module download for the
  charm dependencies of `ui.go`.

## Gaps

- The bubbletea model is not driven headlessly here. Cursor focus and the Tab swap
  were checked by hand; a test would need `tea.NewProgram` with a fake input.
- Nothing checks how the card looks. Design changes are judged in a pane.
- The layer's cell arithmetic is not asserted: Rex rounds a layer's rect outwards
  to whole cells, and the action carries a measured slack for it (two columns, one
  row). A Rex release that rounds differently would show as a card edge cut short.
