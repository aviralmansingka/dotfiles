# Proposal 06 — Mermaid-style layout for rataflow-view (round 05)

Driver: the user reverted round 04 ("most of the results are worse than the
previous round") and asked for a layout fix that borrows from how Mermaid
lays out diagrams. Source analysis: the OmniViewer walkthrough of the
dagre/Sugiyama pipeline Mermaid uses ("How Mermaid diagrams are drawn"),
plus the Layout Maker's Guide's label and bend-cost rules.

## Why Mermaid diagrams read well

Mermaid's layout is a five-pass heuristic pipeline over a plain directed
graph — no hand placement anywhere:

1. **Break cycles.** DFS from source nodes reverses only true back edges
   and remembers them, so the drawn arrowheads match what the author wrote.
2. **Rank.** Longest-path ranking puts every node in a row; a balancing
   step then shortens edges where it can. `minlen` is doubled so every
   edge spans at least two ranks, leaving a free middle rank.
3. **Order.** Nodes are reordered *within* each rank by barycenter sweeps
   (neighbour-average position, up then down, keep the best seen,
   ≤4 sweeps without improvement). This is the crossing minimizer —
   crossings are prevented by ordering, not repaired by routing.
4. **Coordinates.** Brandes–Köpf alignment: every node takes the median
   of four alignment runs; long-edge segments and subgraph borders win
   conflicts so buses run straight and group boxes stay rectangles.
5. **Route.** Orthogonal routing with ports (fan-out merges into one
   stem, splits in the gap), one track per turn, pair-wise crossing
   avoidance between turns, and bend penalties steeper than crossing
   penalties — "a path nobody can follow is worse than a tidy diagram
   with intersections."

Two structural tricks carry most of the quality:

- **Labels are virtual nodes.** A labelled edge becomes
  `start → label → end`; the label's dummy node is sized to the label
  text and ordered like any node. Labels get their own space by
  construction — they cannot end up ambiguous.
- **Subgraphs are blocks.** Border dummies chain each subgraph's sides
  and its members sort as one block with a stable sibling order — groups
  keep their identity and shape across the whole diagram.

## Mapping onto our round-04 failures

| Round-04 failure | Mermaid technique adopted | Round-05 change |
|---|---|---|
| Crossings in 6/8 cases; A* detours as the only tool | Pass-3 barycenter ordering | Order nodes within ranks by neighbour barycenter before any routing; A* only for crossings ordering cannot remove |
| Ambiguous label owners (5 cases) | Labels-as-virtual-nodes | Each labelled edge reserves a label-width slot between its ranks; ownership is structural, not post-hoc |
| Group hue/shape instability across views (datacenter, gb300) | Subgraph border dummies | Groups become bordered blocks with stable sibling order; one hue per group enforced per case |
| Long-edge spaghetti, forced detours judged avoidable | minlen + segment priority | Long edges route straight through their dummies; bends cost more than crossings |
| Generators hand-place `layers` (error-prone) | "Nothing in the source says where anything goes" | `layers` becomes optional everywhere; default layout is automatic ranking |
| Trunk two-junction split (fixed in r04, kept) | Bus via shared port stem | Keep the round-04 single split-point trunk |

## What carries forward from the revert

- Motion semantics per the user's standing directive: `flow: true` =
  constant shared speed (0.5 cells/100 ms); `timing: "same-arrival"` +
  `duration_ms` = opt-in synchronized arrival. Re-implemented cleanly on
  the round-03 base — the round-04 dot-render off-by-one (frame-0 dots
  one cell past the first drawn cell) is not carried.
- Harness evidence recipe (process, not renderer): frames capture for
  every view including static ones, cycle length scaled to the longest
  route, raw command/status records for attempts and probes, cleanup
  records verbatim, manifest covering every shipped spec.

## Dropped with the revert

- Round-04 route-economy heuristics and detour thresholds (superseded
  by ordering + segment priority).
- Round-04 ambiguous-owner reporting (superseded by label slots).
- Round-04 origin/arrival dot code as shipped (contained the off-by-one).
- Round-04's dots-as-flair push into static cases (imported animation
  failures — scope question open, see below).

## Flair scope (decided by the user, 2026-11-02)

Dots appear ONLY where the source animated them: pipeline, network,
machine-manager. homelab, server, datacenter, runtime, gb300 stay fully
static — this is what kept round 03's static cases clean.

## Round-05 execution plan

1. Renderer worker implements the pipeline above on the round-03 frozen
   source plus carried items; all guarantees (ports, reserved stems,
   bridge-only crossings, dot rules) keep their round-03 tests.
2. Proposal-06 SKILL.md rewrite: generators write edges and groups,
   never coordinates; the layout engine owns placement.
3. Freeze round-05 baseline (binary, source, skill, rubric rev 5 +
   judge-split pins), fresh generators, fresh Sol judges, aggregate,
   human review.
