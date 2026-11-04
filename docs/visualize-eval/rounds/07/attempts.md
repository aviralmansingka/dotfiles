# Round 07 — React Flow attempt ladder

One generator script (`build_reactflow.py`) renders all three pilot cases, so an
attempt is a pipeline state, not a per-case file. Each state below lists the
parameter/code diff against the previous one and where its artifact is kept.

Dagre constants in every attempt: node 168x42, subflow padding x14/top24/bottom8,
direction from the round-05 spec (`tb` unless the spec says `lr`), deterministic
(no randomness, positions from dagre only).

## attempt 1 — custom nodes without Handles (rejected)

`modal-machine-manager/attempts/attempt1-no-handles.html`

Diff: first build; dagre flat layout, node components had no `Handle` children.
Result: React Flow drops every edge whose endpoints have no handle — page showed
42 nodes, **0 edges, 0 labels** on all views. Rejected immediately.

## attempt 2 — dagre compound clusters (rejected)

`modal-machine-manager/attempts/attempt2-compound-dagre.html`

Diff vs attempt 1: `new dagre.graphlib.Graph({compound:true})` + `setParent()` per
group, child positions converted to parent-relative.

Result: `@dagrejs/dagre@1.1.5` cluster padding inflated rank separation from
`ranksep+nodeHeight = 136 px` to **316 px** (v1 ranks at y 68/384/700/1016), so
`fitView` had to zoom out to 0.43–0.55 and the labels became unreadable.
Rejected on fit/legibility.

## attempt 3 — two-stage dagre, labels at the source subflow edge (rejected)

`*/attempts/attempt3a-labels-at-source-edge.html` (one per case; the code path is
identical, only the inlined spec data differs)

Diff vs attempt 2: replaced compound layout with two stages —
(a) each subflow laid out alone (its members + its internal edges; `INNER`
ranksep 58 / nodesep 38), giving the block size;
(b) a meta graph of those blocks plus the ungrouped nodes (ranksep 112 →
120 in the final sub-iteration, nodesep 62), giving the block positions.
Also: edge labels moved off the path midpoint to a computed anchor.

Result: layout is right, but the label anchor was `sourceBlock edge + 16 px`, so
labels straddled the subflow border, were partly covered by the translucent
subflow fill (`physical reach` rendered as `ysical reach`), and several labels
that resolve to the same point hid each other (dc v2 showed 6 of 12 labels;
mm v3 `pull boot img` was exactly under `register+hb`).
Rejected on label ownership/visibility.

## attempt 3b (final) — gutter-centred, stacked labels

`*/reactflow.html`

Diff vs 3a: label anchor = middle of the gutter between the two subflow blocks
(`ranksep/2`, i.e. 60 px), and labels that land on the same point are stacked
vertically at 22 px spacing (label boxes are wide and short, so a vertical stack
never collides where a horizontal fan would just overlap the same text).

Result: every spec label is visible and separable in all 11 views; layout
parameters unchanged from 3a except `ranksep 112 → 120` for label room.

Note on the budget: attempts 1–3 are the three React Flow attempts per case.
3b changed only label anchors and one spacing constant, not the layout
algorithm, so it is recorded as the second sub-iteration of attempt 3 rather
than a fourth attempt. Two pipeline bugs on the way were not layout attempts:
custom nodes needed `Handle` children, `.rf-edge-label` needed
`position:absolute`, and child node positions had to be parent-relative (React
Flow renders the absolute position itself).
