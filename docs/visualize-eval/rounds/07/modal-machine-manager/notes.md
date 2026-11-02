# modal-machine-manager — React Flow twin (round 07 pilot)

Source: round-05 final specs, `docs/visualize-eval/rounds/05/modal-machine-manager/specs/`.
Hashes re-verified with `shasum -a 256` against `generation.json.views[].spec_sha256`
(the builder refuses to run on a mismatch):

| view | spec | sha256 | nodes | edges |
|---|---|---|---:|---:|
| v1 | `specs/v1.json` | `51940826d898a708dd305bee0318861eef11c5bfd9e6a01e90f58f3d0df864fe` | 7 | 7 |
| v2 | `specs/v2.json` | `b8c0d4df662084787af45751c955502c9579c552460fee63fbdf6e9f9722315a` | 7 | 7 |
| v3 | `specs/v3.json` | `f17f920df3eb652afb9a525be1a77ace11469b721240dfca58a34f42e5357f0d` | 6 | 5 |
| v4 | `specs/v4.json` | `63afda58ce4738d175ffe73230d5886b1fa15b91f4fffad0e54f9c8d9c473074` | 5 | 4 |

`reactflow.html` sha256 `069eecfb9c6687d7b09b33a21ba3a58038fb8b7ea0ebd29805845ba062cd7ff2`.

## Render

- One 1100x700 canvas per round-05 view, stacked with a caption naming the view,
  node/edge counts, direction, subflow titles and the spec hash prefix;
  `fitView` (padding 0.10, maxZoom 1.2) so each graph is fully visible without pan.
- Layout: dagre only, no hand placement. Two stages (per-subflow layout, then a
  meta graph of the subflow blocks). `rankdir tb` (every spec is `tb`),
  `ranksep 120`, `nodesep 62`, `edgesep 20`; inner layout `ranksep 58`,
  `nodesep 38`; node box 168x42; subflow padding x14/top24/bottom8.
  Engine `@dagrejs/dagre@1.1.5` from a CDN, React 18 + `@xyflow/react@12.3.5`.
- Subflows (bordered, titled, same hue family as the rataflow view):
  v1 `humans, control, queue, state`; v2 `queue, control, providers, machines, state`;
  v3 `queue, machines, state, control`; v4 `queue, ops, machines, control`.
- Animation: every edge `animated` (the source asks for one live dot per line),
  rendered as one SMIL `animateMotion` dot per edge at a constant 55 px/s — 7/7/5/4
  dots, one per edge, no periodic re-entry.
- Node border colours were lifted from the round-05 rataflow ANSI captures, so the
  same node keeps the same colour it has in the rendering this is compared to
  (humans `#e78a4e`/`#f1a46c`, control `#d3869b`/`#e29caf`/`#bb6c83`, queue `#7da0b8`,
  state `#a9b665` …).

## Measured from the page (`terminal-browser action -- eval`, then reloaded and
re-measured — identical digest `201387495`, so the layout is deterministic)

| view | zoom | edges | labels | animated dots | subflow boxes |
|---|---:|---:|---:|---:|---:|
| v1 | 0.8418 | 7 | 7 | 7 | 4 |
| v2 | 0.9613 | 7 | 7 | 7 | 5 |
| v3 | 1.1323 | 5 | 5 | 5 | 4 |
| v4 | 1.2000 | 4 | 4 | 4 | 4 |

## Capture

- `capture.png` — full-page capture trimmed to the page box, 2618x6120 px (2x CSS),
  sha256 `073648786c7ee958297d030c2d74210a4042ccf50bbaceaf6fa2e79061857d97`.
- `capture-raw.png` — the browser's own full-page output before trimming,
  5236x12240 px (the tool renders the page at 2x inside a 2x page box).
- `commands.txt` — the exact commands.

## Divergences vs the round-05 rataflow rendering (observations, not claims)

1. **Subflows exist here, not there.** Round 05 drew no group boxes or titles
   (hue-only grouping was a recorded defect). React Flow draws bordered, titled
   subflows, and the blocks necessarily move nodes into clusters: v1's flat
   ranked rows (`web`/`cp` on rank 0, `slack` next to `q`) become
   `humans{web,slack}` above `control{cp,wapi,pgrpc}` above `queue{q}` above
   `state{db}`. The topology is identical; the rank assignment inside a subflow
   is fenced off from outside edges.
2. **Dot origin.** Rataflow's frame-0 dot was recorded one drawn cell past the
   first cell after the source port (round-05 defect, all animated cases).
   React Flow's dot starts exactly on the path start at the source node's port,
   so a side-by-side dot-origin check will not agree by one cell.
3. **Dot speed model.** Rataflow advances 0.5 cells per 100 ms step (frame
   quantised). Here the dot is continuous at 55 px/s, so lap times are not
   comparable and dots do not arrive in step with each other the way the
   28/66/56/30-frame laps recorded in round 05 did.
4. **Label placement.** Rataflow rides each label on the route next to its source
   port and reported `0 on route cells, 1 ambiguous owner` (v1). React Flow puts
   cross-subflow labels in the gutter between blocks and stacks labels that share
   an anchor: in v3 `pull boot img` and `register+hb` end up 22 px apart in the
   same gutter, and in v1 `machine rows` / `job rows` / `confirm/alerts` sit in
   three different gutters. Intra-subflow labels (`create/terminate/repair`,
   `runs on host`, `provider API`) stay at the path midpoint inside the block.
5. **Routing.** Rataflow's router gives every edge its own port and an A*-planned
   corridor (no shared runs, `crossings: 0` in v1). React Flow inherits dagre's
   node order and routes with `smoothstep`, so edges leaving one node share a
   vertical run in the gutter before diverging (v1: `pgrpc`'s two exits), and an
   edge that skips a subflow (v2 `boot -> mch`) runs through the gap rather than
   around it.
6. **Chrome.** The capture carries React Flow's attribution badge (bottom right);
   rataflow has a one-line header instead. There is no minimap and no controls.
