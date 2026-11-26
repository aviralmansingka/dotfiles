# Recorded sample

Recorded 2026-11-26T00:34:52+05:30 on this host.
Rows: 11 (app=5, rex=4, ws=2).

## What is real

- NSWorkspace agent: Finder, Ghostty, Rex Beta activated for real
- AeroSpace hook: the shim ran through /bin/bash -c, as `exec-and-forget` does. `focus` ran with AEROSPACE_WINDOW_ID=8749 from the live AeroSpace server, then two `workspace` rows for 1->2 and back
- rex bridge: replayed the real capture rex-events.jsonl

## Files

- `events/` — the collector's daily JSONL, one line per span row.
- `spans.tsv` — the same rows read back from sqlite.
- `input/rex-capture.jsonl` — the raw `rex events --json` lines replayed.
