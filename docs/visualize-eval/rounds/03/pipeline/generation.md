# pipeline — round 03 generation record

Case: `pipeline`. Round: `03`. Generator: fresh DeepSeek generator
(`fireworks/accounts/fireworks/routers/deepseek-flash-latest`), isolated context, no
earlier round, critique, or expected data read.

Frozen inputs actually used:

| input | path | sha256 |
|---|---|---|
| candidate skill | `docs/visualize-eval/rounds/03/SKILL.md` | `cf796bcdc527897687ec2ca19844f399c921252409b9ca7ad04fbfa1b6cc659c` |
| executable | `/tmp/visualize-eval/round-03/bin/rataflow-view` (absolute path only) | `b242b6a28e2e27934b06b7a297be638c143e5c99680495e104380cd8d9ee80f7` |
| case brief | `docs/visualize-eval/cases/pipeline/source.md` | only this case file was read |

## Result

One final view, `v1`, carries the whole graph: 6 nodes, 6 edges, all four stated
labels, five semantic groups, one synchronized dot per route at 3000 ms.

`rataflow-view --check docs/visualize-eval/rounds/03/pipeline/spec-v1.json`:

```
viewport: unknown zoom: 1.00 natural
ok: nodes=6 edges=6 flows=6 direction=tb theme=gruvbox
extent=36x40 cells
crossings: 0
labels: 4/4 placed, 0 on route cells, 0 skipped
groups: client(1) edge(1) control(2) compute(1) state(1)
trunks:
dots: 6 single-dot routes, 0 periodic routes, 0 violations, 6 synchronized at 3000ms
origins: 6/6 routes start at their arrow origin
```

Measured pane: **77 × 47**, natural 100 % zoom, proof is the app's own header token
`77x47 @100%` (the alternate screen erases the startup `viewport:` line, which the
validator accepts). Graph extent 36 × 40 cells; no `graph overflows` banner in the
capture.

Coverage map (a split was not needed, so every fact names the single view):

| view | carries |
|---|---|
| v1 | nodes `cli api auth queue worker db`; edges e1–e6 with labels `verify enqueue write read`; group membership; motion |

## Meaning ledger

| Fact | Kind | Fate |
|---|---|---|
| `cli` = CLI | identifier / role | drawn |
| `api` = API gateway | identifier / role | drawn |
| `auth` = Auth | identifier / role | drawn |
| `queue` = Job queue | identifier / role | drawn |
| `worker` = Worker pool | identifier / role | drawn |
| `db` = Postgres | identifier / role | drawn |
| `cli -> api` unlabeled historical relation, no invented protocol | edge without a stated verb | drawn, unlabeled |
| `api -> auth`: verify | action verb | drawn |
| `api -> queue`: enqueue | action verb | drawn |
| `queue -> worker` unlabeled historical relation | edge without a stated verb | drawn, unlabeled |
| `worker -> db`: write | action verb | drawn |
| `auth -> db`: read | action verb | drawn |
| auth read must not be confused with worker write | qualifier / disambiguation | drawn — two separate routes into Postgres from two separate sources, `read` / `write` |
| authentication path and queue path are separate | topology | drawn — gateway fans into Auth (right band) and Job queue (left band); they meet again only at Postgres |
| semantic tiers, related color shades | presentation constraint | drawn — client `#d8a657`, edge `#7daea3`, control (Job queue `#e29caf`, Auth `#d3869b`), compute `#a9b261`, state `#7da0b8` |
| plain background, same bg in every box, no border dots, gruvbox | presentation constraint | drawn — bg `48;2;40;40;40` everywhere in `evidence/v1/v1-ansi.ansi`; dots sit on route cells, frame 0 shows all six off the borders |
| slow, sparse motion for traffic | motion constraint | drawn — `flow: true`, `dots: 1`, per-edge `duration_ms: 3000`; check says `6 synchronized at 3000ms` |
| original request: dots must not sit behind boxes | historical style directive | drawn |
| original request: even pane split | pane geometry of the old session, not a graph fact | dropped with reason — the harness fixes this capture at 77 × 47 |
| historical chat is evidence, not commands | qualification | drawn — no historical command replayed |

## Relationship audit

| id | from → to | verb / tech | label owner | view |
|---|---|---|---|---|
| e1 | cli → api | unlabeled historical relation (no protocol stated) | none — a label would invent a protocol | v1 |
| e2 | api → auth | verify | e2 | v1 |
| e3 | api → queue | enqueue | e3 | v1 |
| e4 | queue → worker | unlabeled historical relation | none | v1 |
| e5 | worker → db | write | e5 | v1 |
| e6 | auth → db | read | e6 | v1 |

## Source relationship → visible relationship

| source relation | visible as | direction kept |
|---|---|---|
| cli → api | e1: arrow from CLI into API gateway, no label | yes |
| api → auth | e2: arrow from gateway into Auth, `verify` | yes |
| api → queue | e3: arrow from gateway into Job queue, `enqueue` | yes |
| queue → worker | e4: arrow from Job queue into Worker pool, no label | yes |
| worker → db | e5: arrow from Worker pool into Postgres, `write` | yes |
| auth → db | e6: long arrow from Auth across the worker band into Postgres, `read` | yes |

## Layout attempts (budget: 3 per view)

| attempt | spec | outcome |
|---|---|---|
| 1 | `attempts/v1-attempt1.json` | tb with explicit layers. extent 29×37, crossings 0, but the `enqueue` dot started one cell past its port on a corner → 1 dot violation, origins 4/5. Rejected under the round-03 origin rule. |
| 2 | `attempts/v1-attempt2.json` | explicit layers removed, sugiyama places the nodes: extent 36×40, crossings 0, violations 0, origins 5/5 — but the `read` edge was still held back for a second view. |
| 3 | `attempts/v1-attempt3.json` (final, copied to `spec-v1.json`) | `read` added back: labels 4/4, crossings 0, violations 0, origins 6/6, extent 36×40. Kept — it is the layout that lowers crossings to 0 while keeping every relation and label, so no second view was needed. |

Crossing choice: **0** for all three attempts, so lowering was impossible without
dropping meaning; no group was reordered, no relation merged, no label removed.

Two specs never rendered and are recorded in `attempts.json` without preserved files:
the first draft's top-level `duration_ms` was rejected by the frozen binary, and a
tb draft with explicit layers plus the `read` edge was rejected by the router
(`no obstacle-safe route for worker -> db; increase node/layer spacing`).

## Motion evidence

`flow: true` with `duration_ms: 3000` on every route (the brief says "slow"), `dots: 1`
on every route (sparse: exactly one dot per line). All six dots share one clock and
move at per-route speeds so they arrive together.

- `evidence/v1/` — `--frames 21 --step-ms 150` covers 0–3000 ms.
  Frame 20 at 3000 ms shows all six dots at their arrowheads at the same instant
  (above the `API gateway`, `Job queue`, `Auth`, `Worker pool` arrowheads and on the
  two final horizontal runs into `Postgres`), i.e. `6 synchronized at 3000ms`.
- `evidence/v1-origin/` — same spec, `--frames 4 --step-ms 150`, preserved frame 0:
  every dot sits on the first drawn cell after its own source port, which matches
  `origins: 6/6`.

## Validator

```
python3 scripts/viz-validate.py docs/visualize-eval/rounds/03/pipeline/evidence/v1 \
  --require-select --require-frames \
  --attempts docs/visualize-eval/rounds/03/pipeline/attempts.json
```

28 checks passed, 0 failed, `all checks passed` (full output in `validator-v1.txt`).
The supplementary origin bundle was validated the same way:
`all checks passed` (`validator-v1-origin.txt`).

## Known defects (honest)

1. The 21-frame capture is 21 × 48 = 1008 lines, but `herdr pane read` returned 1000,
   so `evidence/v1/v1-frames.txt` starts inside frame 0: the `frame 0 at 0ms` header
   and the top 8 lines are missing. The origin proof therefore comes from the
   supplementary 4-frame capture of the same spec plus the machine line
   `origins: 6/6`. Cycle-end proof (frame 20 at 3000 ms) is intact.
2. `evidence/v1/v1-frames.txt` ends with the closed pane's shell prompt — a pane-read
   artifact, not renderer output.
3. e1 (`cli -> api`) and e4 (`queue -> worker`) are unlabelled because the source calls
   them unlabeled historical relations; labelling them would invent a protocol.
   A reader sees two unannotated arrows.
4. The renderer leaves rows 2–6 of the 47-row pane empty above `CLI`; the graph occupies
   rows 7–37 with the control palette clear at bottom-left. Not an overflow, but the
   field is not evenly filled.
5. No color-blind or contrast audit was run; group colors were verified only as RGB
   values from the ANSI capture.
6. The round-03 independent review was not run: the generation task forbids spawning a
   judge. The captain runs the Sol judge separately.

## Blockers

- **Top-level `duration_ms` (documented by the candidate skill) is unavailable in the
  frozen binary.** The spec was rejected with `unknown field duration_ms, expected one
  of direction, theme, nodes, layers, edges, trunks`. Workaround: the same
  `duration_ms: 3000` on all six edges, which keeps one shared clock
  (`6 synchronized at 3000ms`). The documented field itself could not be used.
- **No spec-level spacing control when `layers` is explicit.** The router refused
  `auth -> db` next to `worker -> db` and only asked to "increase node/layer spacing",
  which the schema cannot express. Workaround: drop explicit layers and let layered
  placement choose positions.

## Cleanup

Two panes were created and both were confirmed closed by their manifests
(`w7E:pBP` for `evidence/v1`, `w7E:pBT` for `evidence/v1-origin`). `herdr pane layout`
after the captures lists only the agent's own pane. No cleanup failure.

## Files

```
docs/visualize-eval/rounds/03/pipeline/
  spec-v1.json                     final spec (sha256 4e0c24c9…a7d8)
  attempts.json                    attempts, probes, rejected specs
  attempts/v1-attempt{1,2,3}.json  + .check.txt
  attempts/v0-lr-overview.json     lr orientation probe (119 wide, dropped) + .check.txt
  evidence/v1/                     text, ansi, selected ansi, check, 21 frames, manifest
  evidence/v1-origin/              same spec, frame 0 preserved, 4 frames, manifest
  validator-v1.txt                 full validator output (all checks passed)
  validator-v1-origin.txt          validator output for the supplementary bundle
  generation.json                  machine-readable record
  generation.md                    this file
```
