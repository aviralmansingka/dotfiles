# pipeline — round 10 generation report (viz-ds10-1)

Single live view of the job pipeline, rendered by the frozen round-10 binary
`/tmp/visualize-eval/round-10/bin/rataflow-view`
(sha256 `db70722b92777467544b8ac0c9f03c52d48706e21f604e47da084cb0dfb92df8`) from the
round-10 candidate skill `docs/visualize-eval/rounds/10/SKILL.md`
(sha256 `9c1256791069e27207db2e5138527e45587e7096955f5ed4f86c79d46f77e56d`).
All validator checks pass (`validation-v1.txt`).

## Step 0 — family first

```
family: flow-chains
evidence: six nodes and six relations (E = N) form one shallow pipeline — CLI ->
          API gateway -> {Auth, Job queue -> Worker pool} -> Postgres — and the
          task asks for "slow, sparse motion for traffic", the chain family's
          animated signature.
```

Tie-breakers, in the skill's order:

1. **Density** — `E = N = 6`. No anti-parallel pair, no double-arrowhead redundant
   target, no bus between weakly-connected worlds, so not a mesh, fabric or plane.
2. **Depth/identifier content** — deepest path is 5 ranks, and every node is a plain
   component name (no addresses, ports, AS numbers, qualifiers), so not an
   identity-probe map.
3. **Motion** — one dot per relation on a one-relation-per-node chain, no phase-ordered
   wide fan: chain, not a lifecycle machine.

Secondary recipe: none needed. `api` forks and Postgres merges, so the view also keeps
the mesh habit of co-viewing the converging links as **two distinct target-aligned
Postgres ports** (read at `(40,40)`, write at `(42,40)`), but the applied recipe is the
chain's.

## Meaning ledger (nothing dropped for layout)

| fact | kind | fate | where |
|---|---|---|---|
| `cli` = CLI | role | drawn | box cols 40-44 rows 9-12 |
| `api` = **API gateway** | role | drawn | box cols 36-48 rows 17-20, qualifier kept verbatim |
| `auth` = Auth | role | drawn | box cols 32-37 rows 25-28 |
| `queue` = Job queue | role | drawn | box cols 40-50 rows 25-28 |
| `worker` = Worker pool | role | drawn | box cols 36-48 rows 33-36 |
| `db` = Postgres | role | drawn | box cols 36-45 rows 41-44 |
| `cli -> api`, unlabeled, do not invent a protocol | relation | drawn unlabeled | `(42,13)->(42,16)` |
| `api -> auth`: **verify** | relation + verb | drawn | `verify@34,21`, head `(34,24)` |
| `api -> queue`: **enqueue** | relation + verb | drawn | `enqueue@44,21`, head `(46,24)` |
| `queue -> worker`, unlabeled | relation | drawn unlabeled | `(46,29)->(44,32)` |
| `worker -> db`: **write** | relation + verb | drawn | `write@46,37`, head `(42,40)` |
| `auth -> db`: **read** | relation + verb | drawn | `read@37,29`, head `(40,40)` |
| show the separate read/write paths | requirement | drawn | two distinct arrowheads on Postgres, own verb each |
| show the authentication/queue paths | requirement | drawn | fan ports `(41,21)/(43,21)` into Auth and Job queue |
| slow, sparse motion for traffic | motion | drawn | `flow:true`, 0.5 cells/100 ms, one dot per route |
| no dots in the background (line 5) | constraint | satisfied | `dots: 0 violations`, dots only on routes |
| one plain background for every box (line 5) | style | drawn | uniform bg `rgb(40,40,40)`, complete borders |
| gruvbox scheme (line 5) | style | drawn | theme gruvbox, hues in `group_hues_ansi` |
| semantic tiers, related shades | constraint | drawn | 5 tags; jobs' two nodes one family, two shades |
| plain background (fixed constraint) | constraint | drawn | uniform `rgb(40,40,40)` |
| even-split pane (line 48) | harness request | dropped, reason | pane geometry, not a graph fact; the harness splits 0.5 itself |

## Relationship audit

| id | from → to | verb | label owner | view |
|---|---|---|---|---|
| e1 | cli → api | (none stated) | — deliberately unlabeled | v1 |
| e2 | api → auth | verify | e2 | v1 |
| e3 | api → queue | enqueue | e3 | v1 |
| e4 | queue → worker | (none stated) | — deliberately unlabeled | v1 |
| e5 | worker → db | write | e5 | v1 |
| e6 | auth → db | read | e6 | v1 |

Coverage: one view, all six nodes, all six relations, all four verbs, no cross-view
relations. The auth read never shares a route or a port with the worker write.

## Levers, each with its source fact

- **group tags** `client, gateway, auth, jobs, data` — the six named components and the
  fixed constraint "semantic tiers, related color shades". Colours read from the ANSI
  frame: CLI `rgb(115,161,206)`, API gateway `rgb(138,115,206)`, Auth `rgb(206,115,138)`,
  Job queue `rgb(183,206,115)`, Worker pool `rgb(203,219,153)`, Postgres
  `rgb(206,115,206)` — five distinct families, one shared family in two shades for the
  jobs tier.
- **direction `tb`** — five ranks do not fit the lr budget; measured lr extents 89×9 and
  79×10 versus the shipped 31×36.
- **`label_slot: true`** on e2/e3/e5/e6 — keeps the four source verbs beside their own
  run instead of spending rank-row height.
- **edge declaration order** (enqueue before verify) — label ownership. The engine
  places labels in edge order; the longer verb must claim its gutter first or the
  shorter verb's centre ties with the other route (see attempts).
- **no `layers`, no `minlen`, no `trunks`** — the source states no tiers, no corridor and
  no shared bus. Both were probed and left out (below).

## Family recipe, and its measured yield

The chain recipe asks for `lr` at five or more stages. That is impossible here:
`lr` needs **89 columns** without label slots and **79** with slots on every verb, both
over the 77-column target. Recorded as abandoned orientation shapes
(`v1-attempt1-lr`, `v1-attempt2-lr-label-slot`). The shipped `tb` view keeps the rest of
the recipe: every hop is one rank (except read, which must span the worker tier because
Auth is not a queue consumer), every hop's label sits in its own gutter row, and every
rank holds one node apart from the fork the source itself describes.

## Evidence

Bundle `evidence/v1/` (all hashes in `manifest.json`, verified by the validator):

- `check.txt` — `extent=31x36`, `crossings: 0 bridges, 0 touching bends`,
  `labels: 4/4 placed, 0 on route cells, 0 skipped, 0 ambiguous owners`,
  `dots: 6 single-dot routes, 0 periodic routes, 0 violations, 6 constant at 0.5c/step`,
  `origins: 6/6`, no warnings.
- `v1-text.txt` / `v1-ansi.ansi` — live half pane at the app's own measured
  **82×51 @100%**, natural zoom.
- `v1-selected.ansi` — every node selected, all four corners present in each box, palette
  corner bottom-left free of node borders.
- `v1-frames.txt` (19 timestamped frames) and `v1-pinned-77x47-frames.txt` (44 frames,
  `viewport: 77x47 zoom: 1.00 natural`, no overflow banner) — the pinned dump is the
  target-size fit proof and the full-lap motion proof.
- Motion: constant speed, 6 dots, one per route. Longest route = 15 cells, so a full lap
  needs `ceil(15/0.5) = 30` frames; the read dot leaves Auth's port at `(31,27)` in frame
  0 and is back on that origin at frame 30. Frame 0 vs frame 20: read `(31,27)->(32,37)`
  = 10 route cells, verify `(38,19)->(37,21)` = 10 route cells across one 7-cell lap,
  write `(41,35)->(41,36)` = 10 route cells. Table: `analysis/lockstep-check.txt`.
- Engine guarantees checked in the captures: mid-side attachment (`cli->api` straight
  down col 42, the middle of both boxes), symmetric fan (`(41,21)/(43,21)` about the
  api middle 42), target-aligned port order at Postgres, collision-free group hues,
  bridge-free routing.
- `analysis/v1-pane-coords.txt` — coordinates quoted above, extracted from the capture.

## Attempts (all recorded in `attempts-log.jsonl`)

| record label | spec | result |
|---|---|---|
| `v1-attempt1-lr` | lr, no slots | extent 89×9, overflow |
| `v1-attempt2-lr-label-slot` | lr, slots | extent 79×10, overflow by 2 |
| `v1-attempt3-tb-final` | tb, verify declared first | 31×36, **1 ambiguous owner** → rejected |
| `v1-enqueue-first-probe` | tb, enqueue declared first | 31×36, **0 ambiguous**, 0 bridges → **shipped** |
| `v1-attempt2-tb-fan-swapped` | tb, node declaration swapped | identical geometry, lever inert |
| `v1-attempt3-tb-layers-queue-left` | tb, `layers` pin queue left | "within-rank order automatic", identical geometry |
| `v1-minlen-channel-probe` | tb, `minlen: 2` on both fan hops | 31×41, still 1 ambiguous |
| `v1-fan-gap-no-slot-probe` | tb, no slots on fan hops | 31×42, still 1 ambiguous |

Eight distinct `--check` specs for the single view: two content candidates (one rejected
draft, one shipped) and six probes that never shipped, each listed in
`attempts.json.abandoned_shapes` rather than trimmed to look tidy.

## Defects and blockers

- **Pane size 82×51, not 77×47.** Fit at the target is proven by the pinned 77×47 dump of
  *this* view's final spec (no overflow banner, extent 31×36), per the pinned ruling. The
  measured size is recorded as 82×51 and never relabelled.
- **Pane `--frames` capture holds 19 of 44 frames.** The harness reads the pane ~1 s after
  launch while the printer is still emitting; no harness edit was made. The full 44-frame
  lap at the target size is preserved in the pinned dump.
- **Label ownership on the api fan is order-sensitive.** Fixed by declaration order
  (enqueue first) so the check reads 0 ambiguous owners; documented because a reviewer
  must be able to reproduce it.
- **Blockers: none.**
- Cleanup: owned panes `w7E:pRN` (harness, `manifest.json` `cleanup: confirmed_closed`)
  and `w7E:pRD` (my probe pane, `pane_not_found` after close). No failures.

No judge, reviewer or independent approval is claimed here; a separate terra judge runs
after this result.
