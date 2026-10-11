# interactive-subagents + nvim-open — CI test suite

## Purpose

This suite guards the subagent and editor lifecycle: the
`interactive-subagents/` extension, `nvim-open.ts`, `nvim-open.sh`, and
their tests. Fake binaries go on PATH before import; no test touches a
live multiplexer.

## What the suite covers

- Readiness gate: idle turns ready; blocked, `__SUBAGENT_DONE_n__` exit,
  timeout, and abort all stop the wait; a failed startup gets no prompt.
- Initial prompt: the encode/build pair round-trips; bad payloads and missing skills throw.
- Surface launch: `withNewSurface` closes the pane on every failure, not
  on success; a failed workspace lookup fails before tab creation, so no
  orphan leaks; left/up map to right/down.
- Name registry: null prototype, so `__proto__` cannot bypass it; a
  corrupt file reads empty; names deduplicate through the `-2`, `-3` chain.
- Exit polling: `.exit` sidecar, sentinel file, screen sentinel, killed pane (130), abort paths — on both surfaces.
- Surface dispatch: `HERDR_ENV=1` plus `HERDR_PANE_ID` selects herdr;
  `TMUX` selects tmux; neither leaves a hint that names both. Tmux pane
  operations map to `split-window`, `send-keys`, `capture-pane`, `kill-pane`.
- Session core: fork and lineage-only seeds; ids resolve exact then prefix; the last assistant message wins, with error fallback.
- Agent profiles: bundled profiles resolve and project overrides win;
  every frontmatter key parses; an unknown agent resolves to null; no
  profile names a removed tool (`safe_bash` stays gone).
- index.ts hooks: the module loads whole through stub aliases; the suite
  drives allowlists, ready-prompt payload, and sandbox parts.
- nvim_open: attach to a live sidebar daemon (dead socket ignored,
  toggled-off sidebar still takes the files), send `:e` to an existing
  editor, or launch one split with a sanitized socket name; a tri-state
  scan error falls back to tmux; failures report `ok: false`.
- nvim-open.sh: same lifecycle; no herdr or a scan error means tmux; fail-fast reports the missing editor.

## How to run

    npm install --prefix /tmp/sub-jiti jiti@2 typebox@1.3.27
    export JITI_PATH=/tmp/sub-jiti/node_modules/jiti/lib/jiti.cjs NODE_PATH=/tmp/sub-jiti/node_modules
    node pi/.pi/agent/extensions/interactive-subagents.test.mjs
    node pi/.pi/agent/extensions/nvim-open.test.mjs

For coverage, install c8 (`npm install --prefix /tmp/sub-cov c8`), then
from `pi/.pi/agent/extensions` run c8 with `--reporter=text` and
`--include='interactive-subagents/pi-extension/subagents/**'`
`--include='nvim-open.ts'` over both test files in one shell command.

## Runtime and SLA

The subagents file completes in about 0.7 s; the nvim-open file in
about 0.4 s. Keep each file under 5 s and the domain under 30 s. Only
two waits exceed 100 ms, by design: the readiness timeout (250 ms) and
the mid-poll abort (30 ms). Add no new wall-clock wait.

## Coverage result

c8 reports: nvim-open.ts 98%, herdr.ts 99%, session.ts 93%, surface.ts
90%, tmux.ts 91%, initial-prompt.ts and no-mistakes.ts 100% statements.
The index.ts, status.ts, and activity.ts widgets stay near 28%, 36%, 26%.
Some modules load twice (native and jiti); c8 merges the copies, so
agent-definitions.mjs reports low statements but 94% branches.

## Known gaps

- Open PR #294 owns these seams and ships its own tests; this suite covers
  them after #294 merges: `withTabLaunchLock`, `updateAgentLiveness`,
  `isPiForegroundProcess`, `shouldCloseSubagentTab`, `closeTabForPane`,
  `routeToExistingEditor`, the pane registry, the injectable exec seam,
  the nvim-open.sh flock and settle re-scan, the concurrent openEditor race.
- A profile that names a nonexistent tool does not fail loudly at this
  commit: the allowlist passes the name and no helper extension loads.
- The list-renderer and baseline-renderer tests still eval index.ts source
  by string markers; the whole-load path now exists here; migrate those
  blocks when #294 lands.
- `createSurface` leaks a tab when `tab create` answers without a pane
  id. The close call needs the pane id, so no fix exists at this commit.
- The nvim-open.sh fail-fast test skips on hosts whose fallback dirs
  (`/home/linuxbrew`, `/opt/homebrew`) provide an editor.
- c8 line numbers for jiti-loaded files are approximate; behavior tests
  prove `parseArgs` runs.
