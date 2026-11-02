# pipeline — round 02 generation report

Worker `viz-ds02-pipeline`, model
`fireworks/accounts/fireworks/routers/deepseek-flash-latest`.
Generation only: no judge, reviewer, or subagent was spawned, and nothing is
claimed as green or independently approved.

## Frozen inputs actually used

| input | value |
|---|---|
| candidate skill | `docs/visualize-eval/rounds/02/SKILL.md`, sha256 `7d1ff098d3ff460046e794c29925482ffd0ccb8c6fa493bc390758d976b75d70` |
| renderer | `/tmp/visualize-eval/round-02/bin/rataflow-view`, sha256 `ee085c0f3a82e9b7d516cde7532f394864b3490c99691cd7ac5b2d36d640e8ea` (absolute path in every command) |
| source | `docs/visualize-eval/cases/pipeline/source.md` — the only case file read |
| target | 77 columns × 47 rows at natural 100% zoom |

## Result

One view, one spec attempt, no blocker.

| view | spec | extent | labels | groups | dots | viewport | validator |
|---|---|---|---|---|---|---|---|
| v1 | `v1.json` (sha256 `ac2d00ec…32df2ec`) | 36×40 cells | 4/4 placed, 0 on route cells, 0 skipped | client(1) service(2) async work(2) state(1) | 6 single-dot routes, 0 periodic, 0 violations | `77x47 @100%`, pane `w7E:p6Y`, 79×49 rect → 77×47 app | all 24 checks pass |

`--check` printed zero warnings on the first draft, so no rewrite was spent.

The graph is one honest cover of the source: `cli → api` splits into the auth
branch (`verify`) and the queue branch (`enqueue`), and both paths converge on
Postgres as a distinct `read` (auth) and `write` (worker pool).

```
  CLI → API gateway ─┬─ enqueue → Job queue → Worker pool ─┐
                     │                             write   ├→ Postgres
                     └─ verify  → Auth ─────────── read ───┘
```

## Meaning ledger

| fact | kind | fate |
|---|---|---|
| CLI, API gateway, Auth, Job queue, Worker pool, Postgres | nodes | drawn, one tier group each |
| `cli → api` | relation, protocol unstated | drawn, unlabeled |
| `api → auth`: verify | relation + verb | drawn, labeled `verify` |
| `api → queue`: enqueue | relation + verb | drawn, labeled `enqueue` |
| `queue → worker` | relation, protocol unstated | drawn, unlabeled |
| `worker → db`: write | relation + verb | drawn, labeled `write` |
| `auth → db`: read | relation + verb | drawn, labeled `read` |
| auth read ≠ worker write | semantic constraint | drawn as two corridors, labels, and separate arrowheads |
| auth path and queue path split after the gateway | topology | drawn as the api split |
| slow, sparse traffic | presentation | `dots: 1` + `flow: 0.5` on all six routes (measured 1 cell per 200 ms) |
| plain background, no border dots | presentation | uniform `#282828` canvas and box fill; dots only on routes |
| semantic tiers, related shades | presentation | 4 families, two of them with two related shades |
| gruvbox scheme | presentation | `theme: gruvbox` |
| even split, not narrowed | capture constraint | harness half split, 79×49 rect → 77×47 |
| relations are historical evidence | qualifier | recorded; no relation promoted or demoted, no link marked dashed (the brief marks none unconfirmed) |
| wire protocol for `cli → api`, `queue → worker` | qualifier | **dropped** — unknown in the source; inventing one is forbidden |

## Relationship audit

| id | from → to | verb / tech | label owner | view |
|---|---|---|---|---|
| e1 | cli → api | unlabeled (protocol unknown, not invented) | — | v1 |
| e2 | api → auth | verify | e2 | v1 |
| e3 | api → queue | enqueue | e3 | v1 |
| e4 | queue → worker | unlabeled (protocol unknown, not invented) | — | v1 |
| e5 | worker → db | write | e5 | v1 |
| e6 | auth → db | read | e6 | v1 |

Four labels, four distinct edges, four distinct strings: no label is shared.

## Coverage map

| view | carries |
|---|---|
| v1 | all 6 nodes, all 6 audited edges, all 4 source verbs, the tier colors, and both database arrivals |

A single view carries every relationship, so no split view was needed and none
was invented.

## Capability use

- `group` — used: `client`, `service`, `async work`, `state`. Border colors:
  CLI `216;166;87`; API gateway `125;174;163` and Auth `147;194;183` (aqua pair);
  Job queue `211;134;155` and Worker pool `226;156;175` (pink pair);
  Postgres `169;182;101`.
- `dots: 1` — used on all six routes; the five timestamped frames hold exactly
  6 dots each.
- `flow: 0.5` — slow traffic, 5 cells/s.
- `--select-all` — all six nodes turn bold with the accent border in
  `v1-selected.ansi`; all six are plain in `v1-ansi.ansi`.
- `trunks` — **not applicable**: the source has no shared bus, and the skill
  forbids drawing independent lines as one trunk.
- `style: "dashed"` — **not applicable**: the brief marks no link unconfirmed.
  Marking a confirmed relation dashed would over-qualify it.

## Motion evidence (5 frames @ 200 ms)

| frame | dots | rows:cols |
|---|---|---|
| 0 @0ms | 6 | 13:37, 21:37, 21:39, 29:24, 29:50, 37:24 |
| 1 @200ms | 6 | 14:37, 22:36, 22:40, 30:24, 30:50, 38:25 |
| 2 @400ms | 6 | 13:37, 22:35, 22:41, 29:24, 31:50, 38:26 |
| 3 @600ms | 6 | 14:37, 22:34, 22:42, 30:24, 32:50, 38:27 |
| 4 @800ms | 6 | 13:37, 22:33, 22:43, 29:24, 33:50, 38:28 |

Each route keeps exactly one dot, each moves source → target, one cell per
sample.

## Known defects

1. `write` and `read` share one vertical band above the bottom join. Each sits
   above its own corridor's run (worker run x=24..37, auth run x=39..49),
   `--check` reports 0 labels on route cells, and the two arrivals use separate
   arrowheads.
2. `e1` and `e4` carry no text at all — the source records them as unlabeled and
   supplies no protocol.

## Cleanup

| pane | purpose | result |
|---|---|---|
| `w7E:p6S` | first half-split size probe | confirmed closed |
| `w7E:p6T` | second half-split measurement probe (79×49) | confirmed closed |
| `w7E:p6Y` | harness capture pane | confirmed closed (`manifest.json`) |

Every pane was opened in my own Herdr tab `w7E:t1M`, no-focus half split. The
captain's tab was never used, and no hand-rolled pane read was performed —
captures came only from `scripts/viz-evidence.sh`.

## Artifacts

```
docs/visualize-eval/rounds/02/pipeline/
  v1.json                     final spec
  attempts.json               1 view, 1 attempt
  generation.json             full machine record (ledger, audit, coverage, validator output)
  generation.md               this report
  evidence/v1/
    bin.sha256  check.txt  manifest.json  validator.txt
    v1-text.txt  v1-ansi.ansi  v1-selected.ansi
    v1-frames.txt  v1-frames.ansi
```
