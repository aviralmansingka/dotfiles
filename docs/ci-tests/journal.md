# journal (md-log / lesson / focus-buffer) — CI test doc

## Purpose

This suite guards the lesson-journal domain — `md-log.ts`, `lesson.ts`,
and `focus-buffer.ts` under `pi/.pi/agent/extensions/`.

## What the suite covers

- **L1 — journal resolution (#231).** `resolveJournalPath` reads the
  session file at every event. A session switch (`/resume`, `/new`,
  `/fork`) starts a new journal. Later lessons, quizzes, and probes never
  reach the old journal or the old probe log. `PI_LESSON_JOURNAL` wins.
- **L1 — probe routing.** Probe-stage checks land in a separate probe log,
  whatever the journal's name. A probe never appends the journal itself.
- **L2 — entry formatters (#234).** `escapeLabel` escapes `*`, `_`, and
  `` ` `` in option labels. `demoteHeadings` moves body headings one level
  down, caps at `######`, and never makes a seventh hash. Entry stamps
  carry the date. Entries append in conversation order, with `---` rules
  between them.
- **L3 — editor guards (#232/#233/#240).** `openJournalInEditor` and
  `openProbesInEditor` return a graceful result when no journal exists or
  the file is not written yet. The result keeps the `{ok, launched}`
  contract. A written journal reaches the existing editor pane, and no
  split opens. A missing editor pane launches exactly one split, also
  under #294's serialized launch path: a pane this process already used
  is trusted without a scan, and every launch decision leaves a line in
  the provenance log. The tests redirect that log to a temp file. The
  suite registers `/lessons`, `/probes`, and `ctrl+h`, and each handler
  notifies `info` or `warning`.
- **Views.** `presentLesson` shows the node buffer first; `openNodeView`
  rebuilds a lost node buffer and shows the overview before the first lesson.
- **Buffer naming and sockets.** `nodeSlug` collapses separators and case,
  so one node keeps one buffer. `editorSocketPath` reads `--listen` from
  `/proc/<pid>/cmdline` and falls back to `/run/user/<uid>` on Linux.
- **Off-switch.** `PI_DISABLE_FOCUS_BUFFER=1` returns before any herdr or
  nvim call. `isEditorMissing` classifies each failure.

## How to run

```sh
npm install --prefix /tmp/jr-jiti jiti@2 typebox@1.3.27
export JITI_PATH=/tmp/jr-jiti/node_modules/jiti/lib/jiti.cjs \
       NODE_PATH=/tmp/jr-jiti/node_modules
node pi/.pi/agent/extensions/md-log.test.mjs
node pi/.pi/agent/extensions/lesson.test.mjs
node pi/.pi/agent/extensions/focus-buffer.test.mjs
```

The tests install fake `herdr` and `nvim` shell binaries on `PATH` before
each editor call; a spawned listener carries `--listen` in its `/proc`
cmdline. They save and restore the environment in `finally` and never
grep source text.

## Runtime and SLA

| File | Typical runtime | Budget |
|------|-----------------|--------|
| `md-log.test.mjs` | ~1.8 s | < 5 s |
| `lesson.test.mjs` | ~0.2 s | < 5 s |
| `focus-buffer.test.mjs` | ~1.2 s | < 5 s |

The domain finishes in about 3 s, against a 30 s budget. The tests run
offline, and live-editor scenarios skip on a host without `/proc`.

## Coverage result

Combined `c8` coverage over the three source files (baseline: 77%, 89%,
and 54% statements):

- `md-log.ts` — 98% statements, 86% branches, 100% functions.
- `lesson.ts` — 100% statements, 85% branches, 100% functions.
- `focus-buffer.ts` — 97% statements, 85% branches, 100% functions.

## Known gaps

- `openNodeView` and `presentLesson` keep a "journal" fallback mode for a
  headless run with an openable editor. No test seam sets the 4 s retry
  poll, so the suite does not reach this mode.
- The macOS socket scan covers the found branch only.
