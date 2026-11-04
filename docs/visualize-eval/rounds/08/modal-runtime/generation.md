# modal-runtime — round 08 generation record

Generator: pi subagent `viz-ds08-7`, model `accounts/fireworks/routers/deepseek-flash-latest`
(provider fireworks, reasoning high).
Candidate skill: `docs/visualize-eval/rounds/08/SKILL.md` —
sha256 `b1bdb4d3d38336cb7783db34da7f9f19edf80704a890de32285d9e582b4221eb`.
Renderer: `/tmp/visualize-eval/round-08/bin/rataflow-view` —
sha256 `ea24593b0f80c1617573eef4766f2bacaaf4315a8133a65d5331e9daec1c1f30`.
Static case: the source never animates a hop, so nothing is animated and no dot is drawn.

## Step 0 — family

```
family: service-meshes
evidence: one core (modal-runtime) fans to three neighbours and carries an
          anti-parallel RPC pair against one of them — worker -> runtime
          "task input + control RPCs" and runtime -> worker "events +
          management RPCs"; 8 nodes, 8 edges, no motion in the source.
```

Recipe applied: declare the core, give its fan one stable order (worker, engine, daemon — the
source's own listing order), and keep the two directions of the pair as two separate labelled
edges on separate ports, never one bidirectional arrow.

## Views and coverage

| view | layout | nodes | edges | extent | measured pane |
|---|---|---|---|---|---|
| v1-return-seams | lr | runtime, worker, daemon | e2, e8 | 56x9 | 83x51 @100% |
| v2-task-intake | lr | worker, runtime | e1 | 56x4 | 83x51 @100% |
| v3-dispatch-fan | tb | runtime, engine, backend, filesystem | e3, e4, e6 | 57x47 | 83x51 @100% |
| v4-data-plane | tb | backend, container, filesystem, blobnet | e5, e7 | 57x30 | 83x51 @100% |

Coverage map (all 8 nodes, all 8 relations):

| view | carries |
|---|---|
| v1-return-seams | e2 runtime -> worker (`events+mg RPC`), e8 runtime -> daemon (`HTTP over UDS`) |
| v2-task-intake | e1 worker -> runtime (`task+ctrl RPC`) |
| v3-dispatch-fan | e3 runtime -> engine (`task dispatch`), e4 engine -> backend (`starts/manages`), e6 engine -> filesystem (`mount/snapshot`) |
| v4-data-plane | e5 backend -> container (`runs user process`), e7 filesystem -> blobnet (`image+volume data`) |

Nodes repeated across views (runtime, worker, engine, backend, filesystem) are the seams between
the clusters; no relation is duplicated.

## Relationship audit

| id | from → to | verb / tech | label | label owner | view |
|---|---|---|---|---|---|
| e1 | worker → runtime | task input + control RPCs | `task+ctrl RPC` | e1 | v2 |
| e2 | runtime → worker | events + management RPCs | `events+mg RPC` | e2 | v1 |
| e3 | runtime → engine | dispatches tasks | `task dispatch` | e3 | v3 |
| e4 | engine → backend | starts / manages | `starts/manages` | e4 | v3 |
| e5 | backend → container | runs user process | `runs user process` | e5 | v4 |
| e6 | engine → filesystem | mounts / snapshots | `mount/snapshot` | e6 | v3 |
| e7 | filesystem → blobnet | image + volume data | `image+volume data` | e7 | v4 |
| e8 | runtime → daemon | filesystem HTTP over UDS | `HTTP over UDS` | e8 | v1 |

`HTTP over UDS` is never folded into a worker RPC label: it is its own hop, in its own view, with
its own protocol text, as the source's fixed constraint demands.

## Structural levers, and the source fact that justifies each

- **Regions (v3, v4).** `v3`: `orchestration` (Task engine), `compute` (Container backend),
  `storage` (Filesystem + volumes). `v4`: `compute` (Container backend + Task container),
  `storage` (Filesystem + volumes + Blobnet). Source concept groups — task orchestration,
  container compute, filesystem/blob storage — never rows or depth. Hues are name-derived and
  distinct inside each view (orchestration / compute / storage resolve to different families),
  stable across views.
- **Rank pins: none anywhere.** The source states no geometry (no uplink row, no spine, no
  side-by-side planes), so `layers` stays empty; ranking is the engine's longest-path plus
  barycenter order.
- **`minlen`: none in the final four specs.** It was probed (attempts-raw) to give the UDS hop its
  own corridor, but the resulting layouts kept an ambiguous label, so no final spec carries it.
- **Trunks: none.** The fan legs and the two data paths are independent relations, not one shared
  bus; drawing a trunk would fake a junction the source never describes.

## Evidence

Every view has a full bundle under `evidence/<view>/`: `check.txt`, plain text frame, ANSI frame,
`--select-all` ANSI frame, 3 timestamped frames, `bin.sha256`, `manifest.json` with the pane id,
the measured header token and `cleanup: confirmed_closed`.

Commands (one per view; `--frames 3` because the case is static):

```sh
scripts/viz-evidence.sh --spec docs/visualize-eval/rounds/08/modal-runtime/specs/<view>.json \
    --bin /tmp/visualize-eval/round-08/bin/rataflow-view \
    --out docs/visualize-eval/rounds/08/modal-runtime/evidence/<view> --label <label> --frames 3
scripts/viz-validate.py docs/visualize-eval/rounds/08/modal-runtime/evidence/<view> \
    --require-select --require-frames \
    --attempts docs/visualize-eval/rounds/08/modal-runtime/attempts.json
```

## `--check` lines (final specs, verbatim)

```
v1-return-seams   ok: nodes=3 edges=2 flows=0 direction=lr theme=gruvbox
                  extent=56x9 cells
                  crossings: 0 bridges, 0 touching bends
                  labels: 2/2 placed, 0 on route cells, 0 skipped, 0 ambiguous owners
                  groups:
v2-task-intake    extent=56x4 cells ; crossings: 0 bridges, 0 touching bends
                  labels: 1/1 placed, 0 on route cells, 0 skipped, 0 ambiguous owners
                  groups:
v3-dispatch-fan   extent=57x47 cells ; crossings: 0 bridges, 0 touching bends
                  labels: 3/3 placed, 0 on route cells, 0 skipped, 0 ambiguous owners
                  groups: orchestration(1) compute(1) storage(1)
v4-data-plane     extent=57x30 cells ; crossings: 0 bridges, 0 touching bends
                  labels: 2/2 placed, 0 on route cells, 0 skipped, 0 ambiguous owners
                  groups: compute(2) storage(2)
dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 constant at 0.5c/step,
      0 same-arrival at 2000ms   (all four views — the case is static)
origins: 0/0 ; arrivals: 0/0   (no route is animated, so there is no origin/arrival to prove)
trunks: (empty in all four views)
```

No warnings on any final spec; `0 ambiguous owners` everywhere.

## Validator

`validation.txt` — 128 PASS, 0 FAIL, “all checks passed” for all four bundles, run with
`--require-select --require-frames --attempts attempts.json`.

## Deliberate defections from the ideal split, with the measurement behind each

1. **The anti-parallel pair is split across v1 and v2** (round-07 ruled this acceptable). No
   measured candidate placed both 13-cell labels at once:
   `attempts-raw/v1b-check.txt` (extent 60x27, `events+mg RPC` skipped), `v1c-check.txt` (59x27,
   same skip), `v1-seam-pair-a-check.txt` (56x7, `task+ctrl RPC` skipped), `v1-runtime-seams-*-check.txt`
   (3/3 placed but 1 ambiguous owner, with and without `minlen`), `v1-seam-overview-{b,c}-check.txt`
   (hard error `no obstacle-safe route for worker -> runtime`). Both directions still exist, are
   labelled distinctly, and are drawn in the same case; they are not merged into one bidirectional
   arrow.
2. **v1 and v2 carry no group region.** Every candidate that boxed the pair inside a region lost a
   label to that border (same evidence as above), so regions appear in v3/v4 where they do not
   straddle a labelled channel.
3. **Two labels are shortened by one/two cells**: `task dispatch` (from “dispatches tasks”) and
   `mount/snapshot` (from “mounts / snapshots”). In tb a rank gap is sized to the longest label in
   it, and the 3-rank v3 measured 57x48 with the 14-cell `dispatch tasks`
   (`attempts-raw/v3-dispatch-fan-a-check.txt`) — one row over the pane.

## Blockers

- **Pane measured 83x51, not 77x47.** `viz-evidence.sh` splits a half pane of this session's tab;
  the app's own header says `83x51 @100%`, so that is what is recorded. Target-size fit is proven
  separately by pinned direct dumps at the target viewport:
  `COLUMNS=77 LINES=47 <bin> --frames 3 <spec>` → `pinned/<view>-77x47-frames.txt`, each printing
  `viewport: 77x47 zoom: 1.00 natural`, 3 timestamped frames, and no `graph overflows · drag to pan`
  banner.
- **Renderer sizing limit (not worked around, reported):** in `tb` a rank gap is as tall as the
  longest label crossing it, and in `lr` a rank gap is wider than the label slot (~27 cells for a
  13-cell label). A labelled chain of three or more stages therefore cannot fit 77x47 at natural
  zoom with 13–17 cell labels (measured: 5-node 57x53, 3-node 51/53, 3-node lr 86x4). A two-node
  `tb` pair cannot carry a 13-cell label at all because its extent is only as wide as one box
  (26x45, `0/2` labels). Both limits shaped the four-view split and are recorded rather than
  hidden by shortening or dropping facts.
- No renderer source was read for behaviour changes or edited; no binary was rebuilt.

## Cleanup

All four capture panes were closed by the harness and each `manifest.json` records
`"cleanup": "confirmed_closed"` with its pane id. No pane was left open and no close failed.

## Review

Not run by me: the candidate skill's Step 9 reviewer is started separately by the captain. Nothing
here is marked green.
