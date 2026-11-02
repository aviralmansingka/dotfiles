# datacenter-redundancy — React Flow twin (round 07 pilot)

Source: round-05 final specs,
`docs/visualize-eval/rounds/05/datacenter-redundancy/specs/`. Hashes re-verified with
`shasum -a 256` against `generation.json.views[].spec_sha256` (the builder refuses to
run on a mismatch):

| view | spec | sha256 | nodes | edges |
|---|---|---|---:|---:|
| v1 | `specs/v1-wan-mux-core.json` | `3adbbf099facfc60bc6ed88c5def5acef81c71d3cb589e476ddbf053ee341a58` | 8 | 8 |
| v2 | `specs/v2-fw-border-spine.json` | `89e36227a0ac6e618fc1ca99bac7883df1972f299ffa80cfbf158c81918c7970` | 8 | 12 |
| v3 | `specs/v3-fabric-leaves-racks.json` | `fcc12c64f14b41645f5fba4fbe960cb0693c8e756441d9bfd70de63172ffde2b` | 6 | 8 |

`reactflow.html` sha256 `9a58e48140284ba750a9092ef99bcc4af9ce0638db422fed080a87fa0fc0f6e2`.

## Render

- One 1100x700 canvas per round-05 view, stacked with a caption; `fitView`
  (padding 0.10, maxZoom 1.2).
- Layout: dagre only. `rankdir lr` — the round-05 spec declares `lr` for all three
  views (tb was refused by the frozen router for the 2x2 braids); `ranksep 120`,
  `nodesep 62`, `edgesep 20`; inner layout `ranksep 58`, `nodesep 38`; node box
  168x42; subflow padding x14/top24/bottom8; engine `@dagrejs/dagre@1.1.5`.
- Subflows: v1 `wan, mux, core`; v2 `core, firewall, border-leaf, spine`;
  v3 `spine, rack-leaf, rack`.
- Animation: **none**. No edge is `animated` and the page renders no dot element in
  this case (`0 animateMotion` in every view) — the source forbids flowing dots
  (source line 134) and the round-05 spec applied `dots: 0` to every edge.
- Styling carried over from the spec: `style: "dashed"` on the four `standby?`
  links in v2 becomes a dashed stroke; labels are the spec strings
  (`x-connect`, `active`, `standby?`, `ECMP`, `dual` absent in these views — v1 has
  4 `x-connect` labels on 8 edges, v2 has 12 labels, v3 has 8).
- Node border colours lifted from the round-05 ANSI captures: wan pink family
  `#d3869b/#e29caf/#bb6c83/#eeb4c4`, mux blue `#7da0b8/#97b8ce`, core green
  `#a9b665/#bdc97c`, border-leaf yellow `#d8a657/#e4b86f`, firewall and spine both
  teal `#7daea3/#93c2b7`, rack pink.

## Measured from the page (re-measured after a reload: identical digest `831223310`)

| view | zoom | edges | labels | animated dots | subflow boxes |
|---|---:|---:|---:|---:|---:|
| v1 | 1.2000 | 8 | 4 | 0 | 3 |
| v2 | 0.8741 | 12 | 12 | 0 | 4 |
| v3 | 1.2000 | 8 | 8 | 0 | 3 |

## Capture

- `capture.png` — full-page capture trimmed to the page box, 2442x4634 px (2x CSS),
  sha256 `4bc41e8ba7c925a614aa4b132064c3652a3e67625ee050b2e152f35495133a23`.
- `capture-raw.png` — the browser's own full-page output, 4884x9268 px.
- `commands.txt` — the exact commands.

## Divergences vs the round-05 rataflow rendering (observations, not claims)

1. **No dots, both sides.** Confirmed by counting `animateMotion` (0) and by the
   five identical rataflow frames per view. This is the one category where the two
   renderings cannot diverge.
2. **Subflows are drawn here.** Rataflow grouped by hue only in round 05 (tier
   membership readable from colour, no boxes, no titles). React Flow draws four
   bordered, titled blocks in v2, which is what forces the tier columns; the
   block order is `core → firewall → border-leaf → spine`, the same order as the
   spec's rank progression.
3. **Label ownership is weaker than rataflow's.** Rataflow v2 reported
   `labels: 4/4 ...`/`0 ambiguous owners` per view with the router placing each
   label on its own edge. Here 12 labels resolve to 6 gutter anchors and are
   stacked in pairs (`active`/`standby?` under Core 1, `active`/`standby?` under
   Core 2, two `active` in the firewall gutter, two `standby?` in the next), so a
   reader cannot tell from the screenshot which of the two stacked labels belongs
   to which of the two edges leaving the node. v1 and v3 place one label per edge
   and read cleanly.
4. **Crossings.** Rataflow v2 reported `1 bridges, 1 touching bends` per braid
   tier (its structural minimum). React Flow routes with `smoothstep` through the
   gutters; edges leaving the same node share a vertical run and the dashed
   `standby?` links cross the solid `active` links inside the gutter, so the
   crossing count is visibly higher than one per tier. I did not compute a
   crossing number — this is an eyeball statement from `capture.png`.
5. **Hue collision preserved, not fixed.** In v2 `firewall` and `spine` share the
   same teal family and in v3 `spine` and `rack-leaf` do. That collision is in the
   rataflow output; the React Flow twin reproduces the extracted colours rather
   than inventing distinct hues, so the two renderings agree and both make those
   two tiers hard to tell apart by colour alone.
6. **No vertical elevation either.** The source asks for the spine tier to be
   drawn above the leaf tier; rataflow's `lr` direction could not express it
   (recorded round-05 defect D1) and React Flow's dagre `lr` cannot either. Same
   limitation, same reason.
