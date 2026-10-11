# no-mistakes — CI test doc

## Purpose

This suite guards the no-mistakes domain: `no-mistakes-gate.ts`, `no-mistakes-pane.ts`, the
`no-mistakes-pane/` modules (`bridge`, `capture`, `herdr-report`, `orchestrate`, `status`), the
bridge suite `no-mistakes-bridge.test.mjs`, and the `pi/bin/nm-herdr-pi.mjs` shim.

## What the suite covers

- **N1 Gate panel.** The tests open the real panel and check rendered frames: paging, wrap-home,
  auto-advance, revisit focus. Ctrl-A never fires while the editor has focus. Fix stays disabled
  until the user marks a finding. Every decision payload drives the exact respond argv.
- **N2 Gate parser.** The parser accepts every findings-table column variant: columns from the
  header, quoted values with commas, wrong-count rows skipped, missing values defaulted.
- **N3 Keep-open slot.** Both `no-mistakes-pane.ts` and `tuicr.ts` publish through the shared
  `keep-open-slot.mjs` module: keyed per-owner entries in one null-prototype holder on
  globalThis, summed by a single reader under
  `Symbol.for("pi-subagents/keep-open-count")`. An owner that throws, or a non-function slot
  value, reads as 0 and never masks the other owners; repeated loads replace (never stack)
  their own entry; a foreign previous owner composes (3 → 4 → 3). Cross-load-order tests drive
  the real pane count and a real tuicr watcher in one process — both orders.
- **N4 Child stderr.** Every `execFileSync` site sets explicit stdio. A probe child drives a full
  pane cycle against stubs that splatter stderr. The probe's own stderr stays byte-clean.
- **N5 Spawn success.** A spawn result that resolves with an error is never acked "delegated".
  The registry entry is written only on success. A failed spawn drives the run directly.
- **N6 Attach targeting.** The attach wrapper resolves the branch-scoped run id first and never
  runs a bare `attach`. It retries while no run registers, and it stops at the done sentinel.
- **N7 Capture helpers.** Markers, exit codes, the ANSI noise guard, foreign tokens, and the done
  sentinel are pinned under bash.
- **N8 Clean tab close.** The tab's pi exits first. Release-agent runs before pane close. A pane
  that ignores keys still closes.
- **N9 Step-agent extensions.** The set is closed; forbidden extensions stay out; missing files
  are skipped; `builtin:` entries pass through.
- **Shim.** Without a bridge, argv and stdin pass to real pi unchanged. Pi's exit code becomes
  the shim's. SIGTERM reaches pi. A worktree without a bridge dir falls back after the wait.
- **Pane state.** Phase labels go through `pane report-metadata`. The CI phase drives one
  balanced `herdr:blocked` pair. The checks-passed monitor never sets red. Run end clears both.

## How to run

```sh
npm install --prefix /tmp/nm-jiti jiti@2 typebox@1.3.27
export JITI_PATH=/tmp/nm-jiti/node_modules/jiti/lib/jiti.cjs NODE_PATH=/tmp/nm-jiti/node_modules
cd pi/.pi/agent/extensions
node no-mistakes-gate.test.mjs   # pane and bridge suites run the same way
```

The suite installs fake `herdr`, `no-mistakes`, and `sleep` binaries on PATH before it imports
the modules. It never touches a live daemon. `NM_HOME` points at a temp dir, never `$HOME`.

## Runtime and SLA

- Gate suite about 1.2 s; pane suite about 3.2 s; bridge suite about 4.7 s; domain total about
  9.1 s. Budget: each file under 5 s, the domain under 30 s.
- No test sleeps more than 100 ms at a time; waits poll at 25 ms. The bridge suite sets
  `NM_BRIDGE_POLL_MS=25`; production keeps 250 ms.

## Coverage result

c8 over the three suites, includes limited to the domain files:

- Domain total: 93.5% statements, 79.5% branches (baseline 91.3% / 76.2%).
- `capture.ts` and `orchestrate.ts` 100%; `herdr-report.ts` 99.3% (baseline 83.9%); `gate.ts`
  92.7%; `pane.ts` 91.4%; `bridge.ts` 92.9%; `status.ts` 97.5%.

## Known gaps

- The inline fallback path has no test: Node gives no way to force a bash spawn failure.
- The `openTab` failure path in `bridge.ts` has no direct test; the clean-close suite covers the
  close path it shares.
- The TTY passthrough path of the shim needs a real terminal.
- c8 marks some nested panel closures as uncovered although the tests drive them. The marks come
  from jiti source-map merging, not dead code; the baseline shows the same marks.
