# pipeline — round 13 generation (viz-ds13-1)

Brief: **quick reference, side-by-side** (`rounds/13/briefs/pipeline.md`, annex `TRIAGE-pipeline`).
Frozen inputs: skill `rounds/13/SKILL.md` (proposal 12, sha `65d826f0…`), renderer
`/tmp/visualize-eval/round-13/bin/rataflow-view` (sha `1f28d87d…`), rubric rev 11, target 77x47 @100%.

## Step 0 — triage

Asked (provoke then answer, annex is the only live user):

| id | question | answer | source |
|---|---|---|---|
| TRIAGE-pipeline-1 | one pane beside the chat, or a canvas? | "One, beside my chat … it should fit without me dragging anything." | annex answer 1 |
| TRIAGE-pipeline-2 | does the source's traffic request still apply? | "Yes, slow and sparse … direction, not speed." | annex answer 2 |
| TRIAGE-pipeline-3 | the two database paths: one label or two? | "Two. The auth read and the worker write are different paths." | annex answer 3 |
| scope / reader's job / speed semantics | which components, what is the reader doing, is speed a measurement? | six named components; glancing while running jobs; speed is not a measurement | brief framing |
| unlabeled hops | may `cli->api` and `queue->worker` carry a protocol? | no — source.md says unlabeled, do not invent | own judgment |

Converged once shape, reader's job, motion and label ownership were fixed by the source + annex;
grouping, orientation and dot-hue binding are the skill's judgment, not user decisions, so no
further question was asked.

**family: flow-chains** — `E ≈ N`: six components, six relations, one shallow chain
`cli -> api -> {auth, queue} -> worker -> db`, source asks for slow sparse traffic, no bus, no
3-edge fan around a core, no identifier/qualifier content. Secondary habit borrowed from
lifecycle-machines: every live transition carries exactly one dot (all six are live).

## Shape — ladder rung 1, one view

Six nodes / six relations is one concept, and the final spec measures **31x46** cells, inside
77x47: the pinned dump of the shipped spec at exactly `COLUMNS=77 LINES=47` prints no
`canvas WxH` extent. Canvas (rung 2) rejected: no separable clusters, one concept, and the brief
names the canvas here as the negative case. Nothing dropped (rung 3 not needed).

## Spec — `specs/spec.json` (sha `050a0524…c902`)

`direction: tb`, `theme: gruvbox`, 6 nodes, 6 edges, 4 groups (`client`, `services`, `workers`,
`store`), no trunks, no `layers`, no `minlen`, no `label_slot`.

```
                      CLI
                       ● ↓
                  API gateway
            verify ↙ ●    ● ↘ enqueue
             Auth              Job queue
              ● read            ● ↓
                       Worker pool
                          ● write
                    ▼     ▼
                     Postgres
```

* labels: `verify` (e2), `enqueue` (e3), `write` (e5), `read` (e6); `cli->api` (e1) and
  `queue->worker` (e4) stay **unlabeled** — the source calls them unlabeled.
* the two database paths converge as two separate routes with two arrowheads; `read` and
  `write` never share a label.

## Check summary (shipped spec)

```
extent=31x46 cells
crossings: 0 bridges, 0 touching bends
near-misses: 0 cell(s) inside the 2-cell margin of a node the route does not serve (0 on trunk buses)
passes-near-unrelated-node: 0
labels: 4/4 placed, 0 leader-ticked, 0 on route, 0 skipped, 0 ambiguous owners
groups: client(1) services(2) workers(2) store(1)
dots: 6 single-dot routes, 0 periodic routes, 0 violations, 6 constant at 0.5c/step, 0 same-arrival at 2000ms
dot hues: 6 by source, 0 by destination, 1 shared-hue pair(s) (source-only 1, destination-only 1)
origins: 6/6 routes start at their arrow origin
```

## Motion

Constant engine default (0.5 cells per 100 ms step), one dot on each of the six routes, no rate
overrides, no same-arrival. Longest route 19 cells → 38 frames required, 40 captured.

Frame audit on `evidence/v1/v1-77x47-frames.txt`: **PASS** — 6 routes tracked, 6 dots in every
frame, rates `0.500..0.500`, spread 0.0, 25 equal-distance 10-frame windows, no stall beyond the
render's own resting frame.

## Hue record

| group | members | observed RGB (border) | family |
|---|---|---|---|
| client | cli | 115,161,206 | blue |
| services | api | 206,115,138 | red/pink |
| services | auth | 219,153,170 | light red/pink (related shade) |
| workers | queue | 115,206,115 | green |
| workers | worker | 153,219,153 | light green (related shade) |
| store | db | 206,161,115 | orange (top border, `v1-ansi.ansi` row 43) |

Every dot is bound to its **source** node's hue, and each observed dot RGB equals its source
border RGB in the same frame. The check's tie (source leaves 1 shared pair, destination leaves 1)
was left at the default: destination binding would share Postgres' hue across `read` and `write`,
which is the blur the reader forbids. The one shared pair is the two gateway routes (e2/e3).

## Attempts (budget 3, all recorded)

| # | spec | direction | measured | verdict |
|---|---|---|---|---|
| a1 | `attempts/a1-lr.json` | lr | extent 89x9; pinned dump `canvas 78x9` + drag badge, db clipped | rejected: five ranks need 89 of 77 columns |
| a2 | `specs/spec.json` (= `attempts/a2-tb.json`) | tb | extent 31x46; pinned 77x47 dump has no canvas extent | **shipped** |
| a3 | `attempts/a3-tb-slots.json` | tb + label_slot | extent 31x36 | rejected: frame audit FAIL — the api→auth hop shrank to 2–3 cells and its dot reads 0.000 cells/frame |

## Evidence

* `evidence/v1/` — bundle (check, pane text/ANSI, `--select-all` ANSI, 40 pane frames, 40 pinned
  77x47 frames, manifest; pane closed `confirmed_closed`, id `w7E:pZX`)
* `validation-v1.txt` — `viz-validate.py … --require-select --require-frames --require-records
  --attempts attempts.json --frame-audit` → **37 PASS, all checks passed, exit 0**
* `frame-audit-v1.txt` / `frame-audit-v1.json` — animation audit, PASS
* `attempts-log.jsonl` + `recorded/` — one record per probe/draft/re-check, raw stdout+stderr
* `attempts/` — every probe spec plus its capture (`a1-lr-77x47-frames.txt`,
  `a2-tb-77x47-frames.txt`, `a2-tb-pane-text.txt`, `a3-tb-slots-77x47-frames.txt`)

## Defects / notes

1. The live half pane in this worker tab measured **68x44** — two rows shorter than the 46-row
   drawing — so that pane shows the drag-to-pan badge and Postgres' label row sits outside the
   slice. The **77x47 target** fit is proven by the pinned dump of the same spec (no canvas
   extent). Recorded as a defect against the 68x44 pane, not against the graded viewport.
2. Two extent readings disagree: `--check` 31x46 vs the app header `canvas 21x46` at 68x44. Both
   recorded; the fit claim rests only on the pinned dump printing no extent at all.
3. One shared dot hue (e2/e3). It is the source's minimum and deliberate.
4. `manifest.pane_cols` is null (viz-evidence could not parse the pane rect); size comes from the
   app's own header token, which the contract sanctions.
5. No blockers. No judges, no commits, no engine/skill/rubric edits.
