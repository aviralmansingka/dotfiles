# CI test-surface plan — dotfiles

Derived from the full history: all 261 PRs (mined in 27 batches), ~167 MB of session
transcripts across 88 session directories (5 miners), and a static test-wiring audit.
The runtime execution audit was skipped; timing evidence below comes from recorded
PR/session runs.

Goal: a suite that is offline, deterministic, glob-discovered, and completes in a few
minutes or less, guarding the surfaces that actually broke.

## Verdict on runtime

The wired suite already fits the budget. Extension tests run ~6–17 s per PR (#256-era
runs; ses-C measured the suites at ~6 s); scripts tests take seconds each; the whole
CI ran ~1–1.5 min with parallel jobs (#257). **The gap is coverage and wiring, not
speed.** Everything below stays in that budget except the explicitly gated Tier 2.

## Suite architecture rules (the CI-behavior guarantees)

These are meta-guards. Each one is proven by a real failure.

- **A1. Glob discovery — never hand-list test files.** `python.test.mjs` has never
  been wired since #256 (audit: `git log -S` on ci.yml is empty); #227's test was
  claimed wired but never landed; #279 merged CI-red; `edit-relative-paths.test.mjs`
  exists unlisted; `no-mistakes-pane.test.mjs` rotted (fails locally, absent from CI).
  Enumerate `pi/.pi/agent/extensions/**/*.test.mjs` + `scripts/test-*` via
  `git ls-files`, with an explicit exclusion list for Tier 2.
- **A2. Inventory parity meta-test.** Every test file ↔ a CI step, and every CI step
  ↔ an existing file. Same parity check between `ci.yml` and `scripts/nm-test.sh` /
  `nm-lint.sh` (#293 mirror-don't-fork rule).
- **A3. Extension-loader smoke.** Every `.ts` under `pi/.pi/agent/extensions/` must
  import via jiti and export a valid default factory. Non-factory library files
  (`focus-buffer.ts`, `question-overlay.ts`) killed *every* pi session machine-wide,
  twice; #230 broke main and the no-mistakes review agent. Per-extension unit tests
  cannot see this class.
- **A4. Close the syntax-gate gaps.** No parse check exists for 85 `.mjs`/`.ts` files
  (`image-drop.ts`, `mobile-mode.ts`, `rounded-bar-footer.ts` are live in
  settings.json but ungated); extensionless node/python scripts fall through every
  lint loop; no `zsh -n` despite CI installing zsh. Add a jiti-load sweep (doubles as
  A3) and `zsh -n`.
- **A5. One jiti-resolution mechanism.** `JITI_PATH` + `NODE_PATH` with pinned
  `jiti@2` + `typebox@1.3.27` (jiti does not resolve peer deps alone). Ban hardcoded
  `/opt/homebrew/...` and nvm-version paths — 10–13 of 24 suites failed instantly
  off-Mac (ses-C, ses-E, ses-D).
- **A6. Per-suite timeouts.** Hangs masquerade as slowness: a shared-UI-lock hang
  (no-mistakes-gate era) and an inherited `HERDR_ENV=1` test that started a real
  listening bridge server both hung suites silently. Timeouts convert hangs to red.
- **A7. Behavior over source-grep; hermetic fakes.** No assertions on source text
  (#208 review ban; #286 restated). Install fake `herdr`/`tmux`/`axi` binaries on
  PATH *before* importing dispatchers; pin `HERDR_ENV`/`HERDR_PANE_ID`; save/restore
  env in `finally`. A test run under real tmux once split a real pane.
- **A8. Skip-not-hang locally, fail-on-missing-tool in CI.** Different contexts,
  different policy (#293 `run_test` pattern).
- **A9. Quarantine known-failing tests.** "Fails identically on baseline" was
  normalized across sessions (typebox resolution red on pristine main) and masks
  regressions in the most-edited files. Fails-on-baseline ⇒ quarantine list, not
  ignore.
- **A10. Offline invariant for the fast lane.** Live/network/PTY steps live in
  Tier 2 with a documented exclusion table (#257 started one; keep it honest).
- **A11. Deletion lockstep.** Removing a component removes its tests, CI lines, and
  verifier references in the same PR; A2's parity check enforces it mechanically
  (#279 stale import, orphan verifiers below).

## Tier 1 — fast-lane test surfaces to maintain

### Meta / loader (new — highest leverage per effort)

| # | Surface | Key assertions | Evidence |
|---|---------|----------------|----------|
| M1 | Extension loader smoke (A3) | every extensions `.ts` jiti-imports + default factory; no dangling symlink targets | #230 ×2 machine-wide breakages |
| M2 | Test-inventory parity (A1/A2) | discovered files == executed files, both directions | #227, #256, #279, unwired strays |
| M3 | Syntax gates (A4) | jiti-load sweep, `zsh -n`, extensionless scripts | 85 ungated files |

### pi extensions — rendering core: `tool-call-renderer-public.ts`

The hottest file in the repo (12+ PRs; multiple shipped bugs with a green suite).
Extend the existing `tool-call-renderer-public.test.mjs` (split it — it funnels every
renderer PR):

| # | Surface | Key assertions | Evidence |
|---|---------|----------------|----------|
| R1 | `commandRows` heredoc/quote state machine | single/double/unquoted heredoc tags, quote-state after close, operators, continuations; language detection keeps python highlighted | #242 one-char regex bug; `786c2d3` dimmed ALL python heredocs with tests green; heredoc-hotfix 4≠1 leaves; #236 |
| R2 | Intent-title pipeline | comment lift beats backfill; backfill only live+complete+not-restored, one request per toolCallId; persisted + reseeded on restore; mcpScript `//` lift skips `@options` | #258 shipped #261 title-row bug; #267; #273 |
| R3 | Ownership/delegation matrix | `NEVER_DELEGATE` wins vs built-ins; delegation rules per family | #235 resolver outranked by built-ins; #236 regression |
| R4 | Truncation & fold contracts | `truncateToVisualLines` never `[]` for blank input; 30+30 fold past 60; ls `details.entryLimitReached`/`truncation.*`, no invented fields | #235 swallowed rows; #239 |
| R5 | Theme sync + caches | `initTheme` re-sync on name change; caches keyed source+args+theme, invalidated | #235/#248 silent flat colors |
| R6 | Details-contract degradation fixtures | error-without-`isError` renders as error; partial updates; unknown IDs omitted; `launched:false` = success; zero-results ≠ failure | #251, #247, minimized-leaves, p5 invented findings |
| R7 | Shortcut orthogonality + muted states | Ctrl+Q never reveals hidden command via Ctrl+O; hidden default; muted title, dimmed counts, failure rows stay error-colored | #260–#264 |
| R8 | Narrow-viewport width sweep | render every custom component at width 20–80; no line exceeds width | `usage.ts` hard-exited pi twice (65>50; pad shadow) |

### no-mistakes line: `no-mistakes-gate`, `no-mistakes-pane`, bridge, orchestrate

| # | Surface | Key assertions | Evidence |
|---|---------|----------------|----------|
| N1 | Gate paging + decision panel | options actually rendered (parse-only passed the invisible-options bug); auto-advance, wrap-home, revisit focus, Ctrl-A guard, Fix-enabled guard; decision payloads drive exact `axi respond` | #270, #276, #269 |
| N2 | `parseNoMistakesGate` | tolerant of every findings-table column variant | #269 |
| N3 | keep-open slot composition | `Symbol.for("pi-subagents/keep-open-count")` symmetrical across `no-mistakes-pane.ts` + `tuicr.ts` under any load order | #286 (one-sided fix still clobbered) |
| N4 | `herdrJsonSync` stdio + every `execFileSync` site | stdio `["pipe","pipe","pipe"]`, null-on-failure; child stderr never reaches TTY | #291 agent_not_found splatter |
| N5 | Spawn-success detection | resolved-but-error never acked "delegated"; registry written only on success | #286 phantom owner, infinite wait |
| N6 | Attach/run targeting | resolves the run for THIS branch/cwd, never any-active-session; empty-diff fails fast | #289 pr:287→PR-288 session; 3 session-era bugs |
| N7 | Capture helpers | `buildBackgroundScript`/`buildAttachScript`/`extractMarkedOutput`: END markers, exit codes, echo-corruption, timeout | #177, #186 — the house pattern |
| N8 | Clean tab close | `closeTabPaneCleanly` ordering; never surfaces agent-killed notifications | #285, #294 |
| N9 | `STEP_AGENT_EXTENSIONS` curation | exact closed set; forbidden extensions excluded; missing-file skip; `builtin:` passthrough | #281 (covered — keep) |
| N10 | nm runner parity | `nm-test.sh`/`nm-lint.sh` enumerate the same targets as ci.yml | #293 (this branch) |

### interactive-subagents + nvim-open lifecycle

| # | Surface | Key assertions | Evidence |
|---|---------|----------------|----------|
| S1 | Readiness gate + initial prompt | `waitForAgentReady` (idle/blocked/`__SUBAGENT_DONE_n__`/timeout/abort); encode/decode + invalid payload rejection; no orphans on abort | #216 |
| S2 | Surface launch | `withNewSurface` closes root pane on every post-creation failure (initial + resume); `__proto__`-safe name registry; `workspaceForPane` live resolution | #208/#209 |
| S3 | Editor-pane race suite (PR #294) | two concurrent `openEditor` → exactly one split; registry-first; duplicate close + route; shutdown closes subagent-owned pane exactly once | #294 (covered — keep) |
| S4 | Uncovered #294 seams | lock mechanics cross-tab + error release; registry staleness/invalidation; `routeToExistingEditor` zero-file/failure branches; tmux `closeTabForPane`; agent-gone → harvest/steer end-to-end; `nvim-open.sh` flock + settle re-scan | #294 gaps |
| S5 | Liveness pure fns | `updateAgentLiveness` state machine; `isPiForegroundProcess` | #294 |
| S6 | Surface env matrix | `HERDR_ENV`+`HERDR_PANE_ID` → herdr; `TMUX` → tmux; else unavailable; fake binaries before import | #191/#193 |
| S7 | Agent profile loading | `tools:` allowlists parse; profile naming a nonexistent tool fails loudly; zero stale references on removal | #243 safe_bash removal |

### user-input / quiz / explain family (keep, extend)

| # | Surface | Key assertions | Evidence |
|---|---------|----------------|----------|
| U1 | Option wiring at all 4 consumer sites | digit selects submit (single) vs toggle (multi); j/k incl. Kitty protocol; editor passthrough | #171/#217 |
| U2 | Input-mode cycling | Answer↔Steering cycling (note mode was removed pre-#266); follow-up ends the quiz visibly; steering editor keeps text on Enter; quiz stays open in steering | #176, corrected by dom-user-input |
| U3 | Explain key-routing state machine | bare `h` only when `!hasComposed` + verdict; `H` (Shift+H — the window manager owns Alt) opens the journal at every phase; legacy + Kitty encodings; failures warn, never throw | #249, #266, corrected by dom-user-input |
| U4 | Prompt-frame invariants | ≥1 padded content row; merged frames; hints present per mode | #222 |
| U5 | Context files | normalization; `openContextFiles` failure notifies, never throws | #172 |

### run-command (keep)

| # | Surface | Key assertions | Evidence |
|---|---------|----------------|----------|
| C1 | Capture wrapper | marker exclusion, trap/statusFile exit recovery, multi-shell matrix | #183/#185 |
| C2 | Lua/Vim RPC escaping round trip | every Lua payload survives JS→JSON→Vim (raw newlines) | #185 E5108 |
| C3 | nvim discovery + float lifecycle | `--listen` forms, `NVIM_LISTEN_ADDRESS`, null→split fallback; close+wipe | #183 |
| C4 | Large-paste expansion | both manual submission paths expand; visible editor keeps marker | #211 |
| C5 | `y` copy-and-focus | copies AND focuses output; Tab path preserved | #202 |

### python.ts (WIRE the dead test, then extend)

| # | Surface | Key assertions | Evidence |
|---|---------|----------------|----------|
| P1 | Execution contract | stdout/stderr separate, 256 KiB cap + `truncated`, timeout bounds, SIGTERM→grace→SIGKILL, `PythonDetails` shape | #256 |
| P2 | `tool_call` guard | must-block heredoc variants + `python -c`; must-pass scripts/`-m`/pip/chained/piped; reason names the python tool | #262 |

### md-log / lesson / focus-buffer (keep)

| # | Surface | Key assertions | Evidence |
|---|---------|----------------|----------|
| L1 | Journal resolution | `journalPathFor` per-event (resume/new/fork journal separately; `PI_LESSON_JOURNAL` override) | #231 |
| L2 | Entry formatters | `escapeLabel` (italics bug), `demoteHeadings`, verdicts, stamps, labeled fields, append-only order | #234 |
| L3 | `openJournalInEditor` guards | missing/not-yet-written; `{ok, launched}` contract; single split | #232/#240 |

### mermaid (keep units in CI; corpus stays Tier 2)

| # | Surface | Key assertions | Evidence |
|---|---------|----------------|----------|
| E1 | v2 emit/gate pipeline | per-type emit; structure-diff not false-matched; quote-in-label rejected; LR→TD re-emit; `SUPPORTED_DIAGRAM_TYPES` guard | #283 (v1 #277/#280: passing units, 67% real failure — corpus is the e2e net) |

### tuicr (keep, extend)

| # | Surface | Key assertions | Evidence |
|---|---------|----------------|----------|
| T1 | Reply-loop prevention | `newComments` author filter + reply-key exclusion | #246 |
| T2 | Command grammar + target resolution | explicit slug/pr → error, never any-active-session; duplicate-reviewer refusal per target | #279, #289 |

### scripts / config / daemon surfaces

| # | Surface | Key assertions | Evidence |
|---|---------|----------------|----------|
| X1 | pi-settings-sync + pi-extensions-drift-check (in CI — keep) | never write through live symlink; folded-dir refusal; drift classes | #254 |
| X2 | Telegram mention gating (NEW — zero coverage today) | `should_handle`/`message_mentions_bot`/`is_reply_to_bot`/`strip_bot_menteion` + env keys; mock `getMe` | #126 multi-bot reply-loop risk |
| X3 | Telegram temp-file lifecycle + `scan_session` | unlink only after `ask` returns (success + exception); bridge-header strip | #149 gaps |
| X4 | Env-example ↔ daemon key parity | every env key read appears in `pi-telegram.env.example` | #146/#148/#149 drift class |
| X5 | Supervisor loops with fake clock | ticker restarts after injected exception; deferred flush when throttled | #152 tick_once blind spot |
| X6 | `check-report.test.mjs` + `test-pi-stt.py` (unwired, offline) | wire via A1 glob | audit-wiring |
| X7 | SKILL.md frontmatter YAML loop | every skill parses; name+description present | #203 skill silently invisible |
| X8 | install.sh ↔ stow consistency | every stow line has a repo dir and vice versa; no stale rm -f of uninstalled binaries; gh-dash binding `C` present / `H` absent post-#284 | #197/#201, #117 residue, #284 |
| X9 | Workflow structural lint | actionlint; no `paths` filter on trigger of a workflow owning a required check; gate on `needs.*.result`; teardown `if: always()` semantics | #175 (the fast-gate PR), #14/#16 |
| X10 | Terraform offline checks | `fmt -check`, `validate`, no hardcoded `profile =`, OIDC trust scoping | #6/#7/#8 |
| X11 | nvim headless smoke (NEW job; `verify-nvim` offline subset already exists — wire it) | keymaps registered (octo `<leader>O*` silent drop), augroups exist (Lazy `init` clobber), cwd_picker pure fns + highlight groups (#139/#140 both pure regressions), `agent_send` allow-list incl. `blocked`, `markdown_ansi` SGR parser, indent stance, mermaid fence walk | #37, #138–#140, #220, #99, #188, #181/#182 |
| X12 | markdownlint fixture check | AV001 wraps at ≤80 visible columns, links untouched | #238 |
| X13 | Config consumer-shape lint | gh-dash scope/template fields; herdr config.toml key allow-list (vendored); `.claude` settings no stale refs | #199, #156–#158, #8/#9 |
| X14 | Attachment-leases verifiers (offline candidates) | phase contracts on repo fixtures | audit-wiring |

## Tier 2 — gated or manual (never in the fast lane)

- `mermaid.corpus.mjs` (needs real mmdflux + grok-mermaid) — pre-merge local gate,
  the institutionalized answer to "unit tests can't catch wrong architecture" (#277
  v1: passing units, 8.5 min/call, 67% failure).
- `verify-nvim` live routes, `test-osc52.sh`, `test-pi-hidden-thinking-render.py`
  (PTY/pyte), `test-sidekick-view-focus.lua` if it needs live tmux.
- Live verifiers: `verify-no-mistakes-installation/live`, `verify-pi-image-drop`,
  `verify-pi-no-mistakes-activity`, `verify-pi-transcript-links` (pins installed pi).
- Terraform `plan` (creds + network), path-gated as today.
- Pinned-version freshness (no-mistakes VERSION/SHA vs upstream) — scheduled,
  non-blocking.
- Real pane-split races, nvim RPC socket behavior, real `herdr tab close` with
  sibling panes, macOS flock-missing fallback — provenance-log observation only.
- Optional pty boot smoke (one tool-call progress render) — the #277/#280
  `onUpdate`-partial-result crash class only reproduces in a real terminal.

## Bad tests / hygiene actions

1. **Wire `python.test.mjs`** (dead since #256) — fixed automatically by A1 glob.
2. **`usage.test.mjs` replicates the width formula** instead of importing `usage.ts`
   — rewrite to exercise the real function (#190 anti-pattern: test passes while the
   implementation regresses).
3. **Delete orphans:** `scripts/fixtures/pi-work-step-ui-provider.ts`,
   `fixtures/pi-work-step-ui-t22-v02/**`, `goldens/pi-work-step-ui-t22-v02/**`
   (consumer deleted in #235); `scripts/verifiers/pi-transcript-links-v01/v02`
   (rev-parse the deleted `transcript-scroll.ts`).
4. **Fragile harnesses to harden:** `shouldCloseSubagentTab` is tested by
   string-splitting `index.ts` + `jiti.evalModule` (breaks on marker rename) —
   extract a pure module or make `index.ts` jiti-loadable; shutdown scenarios depend
   on module-level registry state leaking between scenarios (order-dependent);
   `subagents_list` source-slicing harness; `verify-nvim`'s own duplicated
   `truncateTitle` broke on an ellipsis change.
5. **Consolidate duplicated heredoc classification** — `python.ts` guard regex and
   the renderer's heredoc scanner parse the same syntax independently (drift risk);
   one pure module, both consumers.
6. **`install.sh` stale Atlas-era `rm -f` lines** — remove (#117 residue).
7. **Keep ANSI escape bytes out of committed diffs** — `.ansi` evidence files break
   `gh pr diff` for any tooling that shells to gh (#11-era lesson).
8. **Quarantine list for known-failing** (A9) instead of normalized pre-existing red.

## Runtime budget (target: a few minutes)

| Job | Contents | Estimate |
|-----|----------|----------|
| lint | bash -n, py_compile, zsh -n, lua loadfile, jiti-load sweep (M3) | ~30–60 s |
| extensions | ~30 glob-discovered `.test.mjs` (each <1–2 s after jiti boot) | ~30–60 s |
| scripts-tests | existing 8 + X2–X6 additions (stow/zsh/ruby apt steps dominate) | ~1–2 min |
| nvim-smoke (new) | headless boot + verify-nvim offline subset (X11) | ~30–60 s |

Parallel jobs ⇒ end-to-end wall clock comfortably under ~3–5 min, matching the
observed ~1–1.5 min of the current workflow plus the new smoke job.
