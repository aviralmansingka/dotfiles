# Ledger — pi-durable 1.6.1 C4 view

Component: `@earendil-works/pi-durable@1.6.1`
Repo root: `/Users/aviral/dotfiles/research/pi-durable-2026-11-26/src/pi-durable`
Anchor: `package.json:1-12` — one manifest, 20 export subpaths, 7 pinned deps, `files: [dist, README, CHANGELOG]`.
Not a git checkout: the published tarball. `src/`, `test/`, `docs/spec.md` are absent.

## Elements

| id | label | role | class | evidence |
|---|---|---|---|---|
| h | Harness + scheduler | opens a Session, owns registry, scheduler, views, wake contract | member | dist/harness/harness.js:417 |
| s | Session · commit log | atomic commit, receipt, publication, watch mount | member | dist/session/session.js:90, 1110 |
| v | View · transcript | ConversationView assembly, window, transcript merge | member | dist/harness/view.js:114, 151-152 |
| st | Storage adapters | memory, indexeddb, jsonl, sqlite (node + DO), store bridge | member | dist/storage/sqlite/storage.js:55 |
| en | ExecutionEnv node | files, dirs, line readers, shell, watcher | member | dist/env/node.js:571, 608 |
| tl | Tools + images | read/write/edit/bash, photon pipeline | member | dist/tools/index.js:15; dist/images/node.js:11 |
| cm | Codemode · search | codemode tool, tool_search, classifier + image models | member | dist/codemode/codemode.js:78; dist/tool-search/tool-search.js:93 |
| ts | Conformance kit | storage (33), env (21), commit-writes suites | member | dist/testing/storage-conformance.js:1 |
| host | Host app | embeds, supplies storage/models/env, writes transport | actor | README.md:43, 583-595 |
| client | Client | renders view + ops; reached only through the host | actor | nodes/N05.md:117 |
| models | Providers | reached through host-supplied `Models` | external | dist/harness/generation.js:594 |
| store | Store | SQLite file, JSONL dir, IndexedDB, DO storage | store | dist/storage/sqlite/node.js:6 |
| os | OS | real filesystem, shell, process trees, worker threads | external | dist/env/node.js:4, 762 |
| chord | Chord | store, delta ops, Watch handle, SQLite helpers | external | package.json:167; dist/harness/view.js:1-3 |
| libs | libraries | pi-schema, pi-telemetry, QuickJS, Photon | external | package.json:169-173 |

Dropped elements, with reason: `TESTRUN` (no call site names a runner — relations r-open-6);
the three store targets `dsqlite`, `didb`, `djsonl` (folded into the single `store` box: one
medium, three files, no relation differs between them); `CLIENT` inside L1/L1b (folded into
`host`, because the package never reaches it — see X1).

## Relations

One row per drawn relation. IDs are the canvas edge ids, `l<level>:e<n>`.

| row | from → to | verb + transport | level | evidence |
|---|---|---|---|---|
| R1 | host → h | open / submit / signal / install extension, in-process | L0, L1 | harness.js:417, 391, 218; registry.js:34 |
| R2 | h → host | callbacks: env, models, settings, registry, timers, onWake, onReport, now | L0, L1 | harness.js:112-172, 322; scheduler.js:1660 |
| R3 | host → client | view + ops forwarded by the host's own `send` — no wire ships | L0 | README.md:593; nodes/N05.md:31 |
| R4 | h → models | stream one response; compaction summary; usage counters | L0, L1 | generation.js:594, 1074; compaction.js:133 |
| R5 | cm → models | classifier call; image model call | L0, L1 | dist/codemode/models.js:209, 222 |
| R6 | h → store / s → st | commit batches atomically, scan, read by id | L0, L2 | session.js:1601, 1630-1654 |
| R7 | st → store | append JSONL, truncate torn lines, list dir, DO/NODE sqlite open | L0, L1b | jsonl/storage.js:282, 680; sqlite/cloudflare.js:1 |
| R8 | st → chord | store bridge, table claims, id allocator, sqlite helpers | L0, L1b | store/storage.js:75; sqlite/migrations.js:1 |
| R9 | h → os / en → os | files, spawn, kill tree, watch, statfs | L0, L1b | env/node.js:4, 762, 239; node-watch.js:402, 477 |
| R10 | tl → en | read, write, edit, bash against the call's env | L2b | tools/bash.js:52; tools/read.js:65 |
| R11 | tl → qjs | run Photon wasm; start QuickJS script (via cm) | L0, L1b | images/index.js:2, node.js:56; codemode.js:264 |
| R12 | h → libs / h → sch | compile and validate tool, signal, doc schemas | L0 | signals.js:3; harness/tool.js:6 |
| R13 | h → libs / h → telem | per-phase spans; report and submission metrics | L0 | scheduler.js:2182; harness.js:320 |
| R14 | h → s | one commit per task/document/entry write | L2 | scheduler.js:2828; harness.js:116 |
| R15 | s → v | publish each stored commit to mounted views; end on close | L2 | session.js:1110; view.js:59, 63 |
| R16 | v → s | read entries and documents on the commit line to build a mount | L2 (folded into R15) | view.js:111, 164, 95 |
| R17 | h → v | hand a windowed view and transcript to the observer | L2 | harness.js:248 |
| R18 | h → tl | create one tool task per model call; dispatch `execute` | L2 | generation.js:344; tool.js:385, 1033 |
| R19 | tl → h | keyed nested tool call through the runtime API | L2 (folded into R18) | tool.js:558 |
| R20 | h → cm | install codemode and tool_search as registry extensions | L2 | registry.js:34; tool.js:385 |
| R21 | cm → h | nested call from a script; post-tools `addTools` control | L2 (folded into R20) | codemode.js:642; tool-search.js:87 |
| R22 | cm → s | persist script start data, journal and store in documents | L2 | codemode.js:216 |
| R23 | ts → st | storage conformance drives any adapter | L2b | testing/storage-conformance.js:59, 80 |
| R24 | ts → en | env conformance drives any ExecutionEnv | L2b | testing/env-conformance.js:52, 93 |
| R25 | v → chord | the watch handle and delta ops on publish | L0, L1 | view.js:1-3; README.md:622 |
| R26 | st → h | cached driver and guard layers in front of the adapter | L2 (folded into R6) | session.js:158; cached-storage.js:43 |
| R27 | tl → chord | bound and pace tool output in Chord buffers | L0, L1 (folded into R25) | harness/tool.js:4 |
| R28 | cm → chord | immutable slices of stored script text | L0 (folded into R25) | codemode.js:1 |
| R29 | h → chord | task phases run in Chord contexts (abort, telemetry) | L0 (folded into R25) | scheduler.js:1 |
| R30 | st → host | IndexedDB is a browser global inside the adapter | omitted C1 | indexeddb.js:235 |

Boundary decisions that mattered, with the losing claim recorded:

- Chord is outside. It supplies `Watch`, `Op`, `Context`, `JSON`, `SQLite`; the view is
  assembled in `dist/harness/view.js`. The earlier brief said Chord owns views; the code
  disagreed, so the brief lost (`nodes/N01.md` §4 agrees with the code).
- Stores are drawn outside the code container but the component owns their schemas and
  migrations (`migrations.js:8-114`, `indexeddb.js:231`). The boundary scout calls them
  members; placement follows C4 (data store outside the code box), membership survives.
- The host OS is outside; `NodeExecutionEnv` is inside. That splits "execution environment"
  across the line, which is the C4-correct read.
- `./testing` is inside: exported, shipped in `files`.
