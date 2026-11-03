# modal-machine-manager — round 14, view set `c4-l0`

Re-render of the C4 view with a new **L0 system-context diagram** and a wrapped
description on every diagram. Frozen build
`/tmp/visualize-eval/round-14/bin/rataflow-view` `fa76dde2c248af2c…` (section
descriptions wrap onto three 96-column rows); frozen skill
`docs/visualize-eval/proposals/13/SKILL.md` `086394bd1bb44230…`; facts only from
`docs/visualize-eval/cases/modal-machine-manager/source.md`.

## What the canvas holds

One canvas, `direction: lr`, 5 described diagrams, 36 nodes, 29 edges,
173x128 cells, 0 crossings, 0 near-misses, 0 ambiguous or skipped labels.

| diagram | box | inside the box | outside the box | edges |
|---|---|---|---|---|
| **L0 · System context** | one plain node `Machine manager` (no container, no focus) | — | cp, web+mmctl, machine-agent, providers, machines, S3, Slack | 7 coarse context arrows + the one atomic external relation `mch -> s3 pull boot image` |
| **L1 · The machine manager** | container `Machine manager` on pgrpc, wapi, reg, rec, ssh, boot | 6 boundary services, 5 pinned ranks | cp, web, prov, mch | 8 boundary relations |
| **L1b · The machine side** | container on q, wapi, pub | 3 manager surfaces, 4 pinned ranks | mch, agent, s3, slack | 4 fleet-side relations |
| **L2 · Inside — queue and dispatch** | container on pgrpc, wapi, q, reg, ssh, jan | the dispatch slice | — | 6 relations (animated) |
| **L2b · Inside — the state writes** | container on q, pgrpc, pub, rec, db | the Postgres writers | — | 4 relations (animated) |

Every one of the 23 source relations is drawn exactly once: 22 across
L1/L1b/L2/L2b, plus `mch -> s3` at L0 where it is an external-to-external fact.
The 6 other L0 arrows are coarse context summaries (provenance table in
`generation.json → coverage.context_arrows_not_counted`).

## The descriptions (the round's text change)

- **L0** — "System context: the machine manager is one box. The control plane and humans + mmctl call it; it drives the bare-metal providers, boots and audits the machines, which pull their boot image from S3, and it alerts in Slack. Nothing inside is shown yet, so L1 opens it."
- **L1** — "L0's box opened one level: its boundary services — private gRPC, webapi, provider registry, cluster reconcile, SSH + BMC ops and the boot server — sit in the Machine manager box, while the control plane, humans, providers and machines stay outside it."
- **L1b** — "The fleet end of the same system. Bare-metal machines run the machine-agent, which registers and heartbeats into public gRPC inside the manager's box; the River queue uploads diagnostics to S3 and webapi confirms actions in Slack, both outside. The fleet drives these outward relations."
- **L2** — "Inside the box, first slice: requests land on the River queue, which dispatches provision jobs to the provider registry, audit work to SSH + BMC ops and diagnostic events to the janitor; the janitor proposes actions back to webapi. L2b carries the state writes this slice leaves out."
- **L2b** — "Inside the box, second slice: the writes into the Postgres state store — job rows from the queue, machine rows from private gRPC, machine state from public gRPC heartbeats and cluster state from the reconcile loop. Same box, same manager; only the state edges are drawn here."

Each is 255–286 characters, i.e. three wrapped rows at 96 columns — measured, so
none clips. The build rejects hand-placed line breaks.

## Owner's review, applied

- **L0 exists** and its manager is a single ordinary box: no container, no double
  border. The point at that zoom is the surrounding world.
- **`focus` is used nowhere**; containers carry containment at L1/L1b/L2/L2b.
- **More text at the top**, as above.
- The liked L1, L1b, L2/L2b shapes are preserved (same containers, same pinned
  ranks, same relations), with one coverage move: `mch -> s3` now sits on L0, so
  L1 carries 8 edges instead of 9.

## Checks

`--check` on `specs/c4-l0-final.json`: `canvas: 5 diagrams`, 0 crossings,
`near-misses: 0`, `passes-near-unrelated-node: 0`, `labels: 29/29 placed, 0 on
route, 0 skipped, 0 ambiguous owners`, `dots: 10 single-dot, 0 violations`,
`origins: 10/10`.

`scripts/viz-validate.py … --require-select --require-frames --require-records
--attempts attempts.json --frame-audit` → **all checks passed** (`validator.txt`),
including `frame_audit_passes`: 10/10 dots steady, equal distance over 129
windows, rate 0.500 cells/frame.

## Known defects and blockers

1. **Container borders drift in this build (high).** The box is drawn offset from
   its members: +1 row with a one-line description, +2 rows with three lines,
   never exact. Measured in `probes/p11-l1-alone*`, `p12`, `p14`, `p15`: with one
   line the boot server occupies rows 9–12 and the container's top border is row
   10; with the shipped three lines it is row 12. The previous build `80d36c42`
   drew the same containers exactly, so this is a regression in the frozen build,
   not a spec error. Recorded as a blocker; the mechanism is still used as the
   skill specifies.
2. **Container member lookup is not the drawn cell position (high).** A box on the
   middle node of a three-node chain is drawn left of the whole chain (`p9`); a
   box on the first two declared nodes happens to hug them (`p10`).
3. **Centred-viewport drift (low).** When the dump viewport is larger than the
   canvas the canvas is centred and container borders drift by that offset (at
   `180x140` the L2 border lands on its description text). The exact-canvas-size
   dump is the honest capture.
4. **Palette overlap (low).** In the 68-column pane the palette corner covers the
   L1 block's `cp` node; a canvas larger than the pane cannot keep it clear.
5. **Pane frames truncated (low).** The in-pane `--frames 140` capture kept 22
   frames and no dots (the dots are below the pane's 44 rows), so the animation
   evidence is `canvas-lap-173x128-frames.txt` (140 frames, 10 dots each).

## Evidenced yield: L2 is two diagrams

Three pinned orderings of one nine-node L2 fail validation with
`no obstacle-safe route for jan -> wapi` (`v1`, `v2`, `l2-diagram-c3`), and the
engine-ranked one routes only with `passes-near-unrelated-node: 14` (`p4`). The
level therefore splits into **L2** (queue and dispatch) and **L2b** (the state
writes) — the two shapes the owner already liked — with all ten internal
relations drawn once.

## Files

- `specs/c4-l0-final.json` — the shipped canvas (`specs/c4-l0-v1..v5.json`,
  `l0-diagram-c2..c4`, `l2-diagram-c3` are the rejected candidates)
- `evidence/canvas/` — check, pane text/ANSI, `--select-all` frame, frames,
  the pinned 77x47 frames, the exact-canvas lap and still dumps, manifest
- `attempts.json`, `attempts-log.jsonl`, `recorded/`, `probes/` — every probe and
  rejected draft with raw stdout/stderr
- `generation.json` — triage, classification, ledger, audit, coverage map,
  routing/hue records, deviations, defects, blockers
- `validator.txt` — full validator output (all checks passed)
