# interactive-subagents + nvim-open — CI test suite

## Purpose

This suite guards the subagent and editor lifecycle: the
`interactive-subagents/` extension, `nvim-open.ts`, `nvim-open.sh`, and
their tests. Fake herdr, tmux, and nvim binaries go on PATH before import;
an injectable exec seam drives the launch races. No test touches a live
multiplexer.

## What the suite covers

- Readiness gate: idle turns ready; blocked, `__SUBAGENT_DONE_n__` exit,
  timeout, and abort stop the wait; a failed startup gets no prompt.
- Initial prompt: encode/build round-trips; bad payloads and missing skills throw.
- Surface launch: `withNewSurface` closes the pane on every failure, not on
  success; a failed workspace lookup fails before tab creation; a pane-less
  `tab create` answer closes the tab the response named before failing, so
  no empty tab leaks (C31).
- Name registry: null prototype (`__proto__` safe); corrupt file reads empty; `-2`/`-3` chain; reservations hold and release.
- Exit polling: `.exit` sidecar, sentinel file, screen sentinel, killed pane (130), abort paths — on both surfaces.
- Liveness fallback: the pi process seen once, then gone, means completed; a startup shell never counts.
- Surface dispatch: `HERDR_ENV=1`+`HERDR_PANE_ID` → herdr; `TMUX` → tmux;
  neither → a hint naming both; tmux calls map to the four pane commands.
- Session core: fork and lineage-only seeds; ids resolve exact then prefix; last assistant message with error fallback.
- Agent profiles: bundled resolve, project overrides win; every frontmatter key
  parses; unknown agent → null; zero stale tool references; a profile naming a
  nonexistent tool fails LOUDLY at spawn — a clear error naming the tool and
  the profile, before any surface is created, never a silent `--tools`
  pass-through (C30).
- Launch race (#294): concurrent openEditor calls in one tab produce one
  split; the loser routes to the registry pane with no scan; a cross-process
  winner closes the duplicate; provenance outcomes hit the log.
- Lock mechanics: same-tab callers serialize; different tabs never block; a throwing section releases; queues clean up.
- Registry staleness: a dead pane deletes its entry and the scan runs; an attached pane is reused with zero lists.
- nvim_open: sidebar attach (live, dead socket, toggled off, failures), `:e`
  to an existing editor (send and focus failures, zero-file focus), one split
  with a sanitized socket; a scan error falls back to tmux.
- Tab close: clean auto-exit closes the whole tab on both surfaces, with the
  kill fallbacks; interactive, killed, or failed runs do not; subagent
  shutdown closes created panes, captain shutdown keeps them.
- agent-gone end-to-end: the real tool execute spawns under a fake herdr;
  the liveness fallback fires; the session harvest produces the summary;
  the result arrives as a `subagent_result` steer with stats.
- Orphaned-subagent adoption (the 2026-10-12 deadline-close incident): the
  registry carries a durable `running` mark + pane id; session_start
  adoption finalizes a dead orphan (pane gone → harvest + result steer, no
  close; pane alive but agent gone → steer + whole-tab close; never-ran →
  no-agent verdict + close), adopts a live orphan under a fresh watcher and
  delivers its result at the real sentinel, and is a no-op without a surface
  or session file; `subagent_message` steers a live orphan (no resume tab)
  and resumes a dead one (fresh tab, registry rewritten for the new pane).
- nvim-open.sh: the same lifecycle; no herdr or a scan error means tmux; the
  settle re-scan prevents a duplicate split; the per-tab flock serializes
  concurrent runs; missing flock still works; the key sanitizes ':'.

## How to run

    npm install --prefix /tmp/sub-jiti jiti@2 typebox@1.3.27
    export JITI_PATH=/tmp/sub-jiti/node_modules/jiti/lib/jiti.cjs NODE_PATH=/tmp/sub-jiti/node_modules
    node pi/.pi/agent/extensions/interactive-subagents.test.mjs
    node pi/.pi/agent/extensions/nvim-open.test.mjs

For coverage, install c8 (`npm install --prefix /tmp/sub-cov c8`), then from
`pi/.pi/agent/extensions` run c8 with `--reporter=text` and
`--include='interactive-subagents/pi-extension/subagents/**'`
`--include='nvim-open.ts'` over both test files in one shell command.

## Runtime and SLA

The subagents file completes in about 2.2 s; the nvim-open file in about
2.6 s. Keep each file under 5 s. Four waits are fixed by design: the
readiness timeout (250 ms), the mid-poll abort (30 ms), the .sh settle
re-scan (0.3 s), and the watcher's 1 s poll interval in the agent-gone run.
Add no new wall-clock wait.

## Coverage result

c8 reports: nvim-open.ts 99%, herdr.ts 96%, session.ts 94%, index.ts 62%,
tmux.ts 88%, status.ts 64%, agent-definitions.mjs, initial-prompt.ts, and
no-mistakes.ts 100% statements. The activity.ts widget stays near 28%. Some
modules load twice (native and jiti); c8 merges the copies.

## Known gaps

- The nvim-open.sh fail-fast test skips on hosts whose fallback dirs
  (`/home/linuxbrew`, `/opt/homebrew`) provide an editor.
- c8 line numbers for jiti-loaded files are approximate; behavior tests are
  the source of truth.
