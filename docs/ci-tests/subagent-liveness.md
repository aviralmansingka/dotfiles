# Subagent liveness — CI test suite

## Purpose

This suite guards the subagent-liveness hardening: the extension must
never wait forever for a subagent that died. Two live incidents drove it:
a bare-shell pane where pi never started (the #294 rule needs to see pi
first), and a live but wedged pi with no deadline. Both waited forever.

## Overview

The suite tests herdr.ts, tmux.ts, and index.ts in `interactive-subagents`,
plus `no-mistakes-pane/bridge.ts`. Every wait now has a bound. Both
surfaces share one contract: herdr.ts reads `pane process-info`; tmux.ts
reads the pane process tree with `pane_pid` plus `ps`.

- Hard deadline. `pollForExit` stops at `PI_SUBAGENT_MAX_WAIT_MS` (default
  30 min). It tries one final harvest. Then it returns reason `timeout`.
- No-sighting grace. Pi never shows in the pane processes, and no sentinel
  appears. After `PI_SUBAGENT_STARTUP_GRACE_MS` (default 60 s) the watcher
  returns reason `no-agent`.
- Read-failure threshold. The process read fails N times in a row (default
  3). The watcher then probes the pane. A gone pane gives reason `killed`.
  An alive pane keeps the wait. The deadline still bounds it.
- Watchdog. index.ts records each active watcher with its deadline. One
  sweep aborts each watcher past its deadline. The watcher then returns its
  `timeout` result once. No steer fires twice. A child process next to pi
  never counts as gone.

Every death path funnels through one completion path in index.ts: harvest
the session file, close the pane or tab, then send one `subagent_result`
steer that carries `details.status`. The orchestrator runs as a subagent,
so this watcher covers it; a timeout or a no-agent close kills its whole
tab with the attach pane. In bridge.ts, `waitTabReady` and
`discoverSessionFile` read `NM_TAB_READY_TIMEOUT_MS` and
`NM_SESSION_DISCOVER_TIMEOUT_MS`.

## What the suite covers

- Bounds resolution: defaults stay unchanged; env knobs override both surfaces.
- Herdr matrix: no-agent at grace expiry; agent-gone with the #294 tick
  staging; a child next to pi stays alive; deadline harvest; a gone pane
  after read failures gives killed; an alive pane keeps polling.
- tmux twin: the same core matrix through fake `tmux` and `ps` bins, plus
  the pure liveness state machine.
- index.ts end to end: the real `subagent` tool runs against a staged herdr
  bin. Each death path drives the real harvest, the clean tab close, and
  one steer with the correct `details.status`. The timeout steer keeps the
  partial session text. The watchdog sweep turns a wedged poll into a
  timeout, never a wrong `cancelled`; a past-deadline entry aborts, a
  future one does not.
- Bridge: both waits reject at small env deadlines; a blocked tab rejects at once.

## How to run

Run `node pi/.pi/agent/extensions/subagent-liveness.test.mjs`. Set
`JITI_PATH` and `NODE_PATH` first (see `docs/ci-tests/README.md`). Fake
`herdr`, `tmux`, and `ps` bins go on PATH before import; no network, no live
multiplexer; staged responses come from env vars and state files.

## Runtime and SLA

2.5 s — inside the 5 s per-file SLA. Eight consecutive runs stayed green
(2.44–2.51 s); no sleep goes over the code's own poll cadence.

## Coverage result

All 25 scenarios pass (herdr/tmux polls, 4 e2e steers, watchdog, bridge).

## Known gaps

- The 60 s grace can fire `no-agent` while pi starts slower than 60 s; raise
  `PI_SUBAGENT_STARTUP_GRACE_MS` on a slow host.
- If `ps` is missing, tmux liveness reads fail; the deadline still bounds the
  wait, but tmux cannot tell `agent-gone` from `timeout`.
- A pane whose process read always fails and stays alive ends as
  `timeout`, not `no-agent`: the grace rule needs one clean read.
- Live panes, real herdr servers, and real wedged pi processes stay in
  tier 2. CI never runs them.
