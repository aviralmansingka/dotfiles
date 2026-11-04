# modal-machine-manager · round 14 · c4-containers

**Shape:** one canvas, four described diagrams, one reading direction (`lr`), container boxes instead of dotted
boundaries. **Family:** lifecycle-machines (the source's own three paths, one dot per live transition).

| input | value |
|---|---|
| skill | `docs/visualize-eval/proposals/13/SKILL.md` = `rounds/14/SKILL.md`, sha256 `086394bd1bb44230` — C4 section read as written (container boxes) |
| binary | `/tmp/visualize-eval/round-14/bin/rataflow-view`, sha256 `80d36c42dc5d7edc…` |
| facts | `docs/visualize-eval/cases/modal-machine-manager/source.md` only |
| output | `docs/visualize-eval/rounds/14/c4-containers/` |

## Diagram structure

| diagram | container "Machine manager" wraps | outside the box | nodes/edges |
|---|---|---|---|
| **L1** System context | private gRPC, webapi, provider registry, cluster reconcile, SSH + BMC ops, boot server (ranks 1–2, complete) | Modal control plane, humans + mmctl (left) · bare-metal providers, S3, bare-metal machines (right) | 11 / 9 |
| **L2** queue and dispatch | all six: private gRPC, webapi, River queue, provider registry, SSH + BMC ops, janitor | — | 6 / 6 |
| **L2b** writes into Postgres | all five: River queue, private gRPC, public gRPC, cluster reconcile, Postgres | — | 5 / 4 |
| **L1b** machine side | River queue, webapi, public gRPC (middle rank) | machines, machine-agent (left) · S3, Slack (right) | 7 / 4 |

Every one of the 23 source relations appears exactly once (coverage map in `generation.json`); all 17 components are
drawn, and every manager service sits inside a box in every diagram it appears in. The two semantic fixes are on
their own relations: `audit / verify reimage` on queue → SSH (L2), `boot.ipxe + S3 args` on the boot response (L1).

Motion: 10 dots, all on routes fully inside a container (L2 6, L2b 4). L1 and L1b stay static because every one of
their relations crosses the box border and the reader's rule is "no dot sitting on a border".

## Checks

| attempt | budget-free? | crossings | near-miss cells | labels | outcome |
|---|---|---|---|---|---|
| c1 (2 diagrams, 15-node L1) | no — 15/13 warning | 4 bridges, 1 touching | 14 | 23/23, 1 ambiguous | rejected |
| c2 (`layers` on the internals) | engine error | — | — | — | `no obstacle-safe route for jan -> wapi` |
| c2b (`label_slot`) | no | 9 bridges, 2 touching | 22 | 1 ambiguous | rejected |
| v2 (3 diagrams) | yes | 7 bridges, 3 touching | 28 | 23/23, 0 ambiguous | rejected |
| **v3 (4 diagrams, shipped)** | **yes** | **0 bridges, 0 touching** | **0** | **23/23, 0 ambiguous** | **shipped** |

Shipped check: 23 routes, `dots: 10 single-dot, 0 periodic, 0 violations, 10 constant at 0.5c/step`,
`origins: 10/10`, `dot hues: 5 by source, 5 by destination, 0 shared-hue pair(s)`,
`extent=171x91 cells (whole canvas)` (L1 171x23 at 0,5 · L2 145x13 at 0,33 · L2b 57x20 at 0,51 · L1b 128x15 at 0,76).

Validator (`--require-select --require-frames --require-records --attempts attempts.json --frame-audit`):
**42 PASS, 0 FAIL** — full output in `validator.txt`; frame audit `PASS`, 10/10 routes steady at 0.500 cells/frame,
equal distance over 29 ten-frame windows, spread 0.

## Defects and blockers

1. **Container geometry does not track the node transform** (high). The box is correct at pan 0 with no centring
   slack — L1 at the 77x47 target (box top row 9, topmost member row 10) — and wrong elsewhere: 2 rows low in the
   171x92 whole-canvas dump, 4 rows low and 25 columns left in the L2b-only probe, mostly clipped in the L1b probe,
   and displaced in the feature author's own demo. `rataflow/src/lib.rs::draw_enclosures` runs before the first
   `render_widget` and its comment still admits the mapping "does not yet track the library's node transform".
2. **No clearance is reserved for containers** (medium): `build_canvas` pads only for the legacy
   `enclosed`/`enclosure` fields, so a container flush with its diagram's left edge paints at x = -1 and loses its
   left border (L2, L2b). `enclosed: true` restores the pad but makes `--check` claim a `dotted box=…`, so it was
   rejected as a workaround.
3. **A crossing relation can eat a box-label character** (`Machine ▼anager`) when the route crosses the top edge
   inside the label run.
4. **`--check` reports nothing about containers** — no membership, no containment violation, no per-route dot-hue
   binding; containment is only verifiable from a capture (done per diagram, `evidence/probes/`).
5. **Budget overrun** (disclosed): five `--check` runs on distinct specs of the shipped line, because the 12-node
   readable-budget warning and a 28-cell routing regression each forced a re-split. Every run is in
   `attempts-log.jsonl` and listed in `attempts.json`.
6. At the 77x47 target a 171x91 canvas shows only the static L1 band, so the bundle carries a recorded supplementary
   whole-canvas 171x92 frames dump for the animation audit.

No judge was spawned, nothing was committed, and no engine/skill/rubric/case file was edited.
