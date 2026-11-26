# tasktrace — CI test suite

## Purpose

This suite guards `tasktrace/`: the collector that turns app focus, AeroSpace
hooks and rex blocks into span rows, the stitcher that groups them into task
traces, and the waterfall that draws one week of them. It also guards the
wiring that keeps `tasktrace` and `tasktrace-hook` on the PATH, and the one
`on-focus-changed` line in `aerospace/.aerospace.toml`.

## Overview

`tasktrace` listens on a unix socket, writes one row per attention event to
`spans.sqlite3` and a daily JSONL, and reads them back with three verbs:
`spans` (the raw rows), `traces` (tasks and their runs), and `waterfall` (one
box per task, one bar per dwell, over a one-week window by default). It needs
no server, no daemon and no web page for the waterfall: the command opens the
sqlite file and prints.

The package behavior lives in `tasktrace/tests/` (pytest). This entry is the
CI hook for the same paths, so a change under `tasktrace/**` runs it.

## What the suite covers

- **The pytest suite**, run the way `pyproject.toml` declares it:
  `uv run --project tasktrace pytest -q`. 172 cases: the schema, the store,
  the collector socket, the CLI end to end, the probes with stubbed
  subprocesses, the title grammar and the stitch rules, the waterfall (boxes,
  dwells, span events, wall time, longest span, window), the packaging, and
  the recorded sample.
- **The macOS-only compile is a platform skip.** `test_the_agent_builds_on_macos`
  is the one test that really runs `clang` against AppKit, and it is marked
  `skipif(sys.platform != "darwin")`. The entry runs that test alone and
  asserts that a non-macOS runner reports `1 skipped` with the reason
  `AppKit needs macOS`. A silent pass fails the check.
- **Module wiring.** The child process imports `schema`, `store`, `stitch`,
  `waterfall`, `cli` and `probe` from source, and both console scripts
  (`tasktrace`, `tasktrace-hook`) name callables that exist.
- **The window contract.** `waterfall.DEFAULT_DAYS` is 7, the default window
  spans 604800 s, `days=1` and an explicit `since`/`until` both narrow it, and
  `--all` drops it.
- **The view over the real recording.** The committed capture at
  `tasktrace/tests/fixtures/waterfall-events.jsonl` is loaded into a throwaway
  sqlite store through the real schema and store code, and the waterfall is
  rendered through the real CLI entry point. The text must carry the boxes,
  the `◆ notify` and `◆ agent_done` span events, and the summary; the `--json`
  form must agree with the text on the task count. This check is stdlib only,
  so it runs even when `uv` is absent.
- **Packaging and the domain doc.** `pyproject.toml` uses the `uv_build`
  backend with the two console scripts, and this file keeps its `/simple`
  section headings.

## How to run

```sh
python3 scripts/test-tasktrace.py          # this entry (needs uv for the suite)
uv run --project tasktrace pytest -q       # the package suite alone
STRICT=1 python3 scripts/test-tasktrace.py # a missing tool fails instead of skipping
```

One test file, one verb:

```sh
uv run --project tasktrace pytest -q tasktrace/tests/test_waterfall.py
uv run --project tasktrace tasktrace --home ~/.local/state/tasktrace waterfall
```

## Runtime and SLA

The entry takes about 10 s: about 9 s for the pytest suite and under 1 s for
the five stdlib checks. It writes nothing outside `/tmp` (every store and
socket lives under a temporary directory) and it never touches `$HOME`.

## Coverage result

172 pytest cases and 6 entry checks pass on macOS with python 3.9 and uv. On
the Ubuntu runner the suite runs the same way and the one macOS test reports
`1 skipped`. The check that loads the real recording does not need macOS: it
reads a committed JSONL file, not a live probe.

## Known gaps

- No live probe runs in CI. `lsappinfo`, `ioreg` and `aerospace` are stubbed
  in the probe tests, and the recorded capture is the only evidence that the
  live path produces rows.
- `scripts/record_waterfall.py` re-records that capture and needs macOS,
  AeroSpace and the named apps. It is a recorder, not a test, and nothing in CI
  runs it.
- The waterfall draws text, not a terminal-width layout: a very long app name
  is clipped at 28 cells and a narrow terminal wraps the box.
- `notify` and `agent_done` have no live emitter yet. The recording writes them
  with `tasktrace send`, so their rows are real collector rows but not yet real
  pi rows.
