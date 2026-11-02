# Blind observation — server-nic-layout, stage A

Coordinate convention: 1-based [column,row,width,height] in the 83×51 saved pane text. Label rectangles cover visible label text, not their boxes. Counts refer to graph items, not viewer chrome. This is an observation, not a verdict against unseen expectations.

## Integrity and evidence

`shasum -a 256` on the final specs matches their respective evidence manifests:

- v1 `7800b7c83e22fc8e662f598018cdf94ad614198a7a4f7cb6d179b702e8237817`
- v2 `d6add6253d241e425076a76b6620f85ad44d701916457dd16d3ba73284a8985b`
- v3 `e4773830999c05113dbbb6e035cf9e120666e67535ccfc0b40d570c3533a285f`
- v4 `376630ba7e72fcea89504499e8b1e3ad732aa7b839a6eb368bc1e286fb175a7f`

Manifests identify the same binary hash `ea24593b0f80c1617573eef4766f2bacaaf4315a8133a65d5331e9daec1c1f30`, selected-state captures, five frames at 100ms intervals and confirmed pane closure. All evidence formats needed for these observations were readable. The supplied pinned 77×47 files contain three frames apiece, not five; the 83×51 frame captures contain five.

## Labels, borders, routes

All listed node borders have four intact rounded corners and four sides, with one continuous foreground RGB per perimeter in the ANSI capture. Node rectangles below include their borders. Edge labels are associated with routes by proximity and tracing; all nine are readable and I find no owner that requires guessing, although v2's `in /29 pool` is horizontally offset from its dashed vertical run and sits above its horizontal dashed run. Check reports 0 ambiguous owners for each view.

### v1

Nodes:
- `7 of 8 ports dark` [34,9,17,1], box [33,8,19,4], RGB (216,166,87).
- `server1 R7725 bare metal` [30,25,24,1], box [29,24,26,4], RGB (228,184,111).
- `eno16595np0 25 GbE` [33,43,18,1], box [32,42,20,4], RGB (200,147,68).

Region title `srv1` [31,7,4,1]. Extent [28,7,28,40]. All three members are within its sides. Its horizontal top and bottom and vertical sides are present, but each of the four corner cells is a plain horizontal `─`, not a corner glyph; the boundary is therefore visually cornerless. Region line RGB (140,108,57).

- `7 of 8 ports dark` → `server1 R7725 bare metal`: downward dashed route, `no cable?` [36,17,9,1]; bends at [34,22] and [30,22], downward arrowhead [30,23]. Traceable.
- `server1 R7725 bare metal` → `eno16595np0 25 GbE`: downward solid route, `only uplink` [32,34,11,1]; bends [30,40], [33,40], arrowhead [33,41]. Traceable.

### v2

Nodes:
- `103.19.91.58 s1 NIC` [12,16,19,1], box [11,15,21,4], RGB (216,166,87).
- `103.19.91.59 R7725` [36,16,18,1], box [35,15,20,4], RGB (231,138,78).
- `.60-.62 free?` [59,16,13,1], box [58,15,15,4], RGB (169,182,101).
- `103.19.91.57 Arista, no v6` [29,36,26,1], box [28,35,28,4], RGB (125,174,163).

Region titles, left to right: `srv1` [13,14,4,1], `srv2` [37,14,4,1], `address pool` [60,14,12,1]. Each encloses its respective one node; title rows have distinct ANSI foreground RGB (140,108,57), (150,90,51), (110,118,66). Every region's four corner cells are plain `─`, with vertical sides, so all three boxes are cornerless. Each bottom side is overwritten by its outgoing route at [12,19], [36,19], [59,19], respectively; these are route/border intersections, not bridges between graph routes. Region order is stable left to right in both saved viewport sizes.

- s1 NIC → Arista: solid downward and right route, `0.1 ms no NAT` [14,32,13,1], bends [12,33], [29,33], arrowhead [29,34]. Traceable.
- `103.19.91.59 R7725` in region `srv2` → Arista: solid downward and left route, `same /29` [38,25,8,1], bends [36,32], [31,32], arrowhead [31,34]. Traceable. The node label itself does not literally spell `server2`; the visible association is the `srv2` region title.
- `.60-.62 free?` → Arista: dashed downward and left route, `in /29 pool` [41,32,11,1], bends [59,33], [33,33], arrowhead [33,34]. Traceable.

### v3

Nodes:
- `103.19.91.57 AS132717 Bengaluru` [27,19,31,1], box [26,18,33,4], RGB (125,174,163).
- `Airtel 14.143.x` [35,32,15,1], box [34,31,17,4], RGB (147,194,183).

Region `DC edge` [28,17,7,1], bounds [25,17,35,19], contains both nodes. Four region corners are plain `─`, not corner glyphs; sides are present. Region line RGB (81,113,106). No member is displaced outside the region in this shipped multi-rank view. Both parallel routes span the same visibly separated ranks; the dashed route declares `minlen: 2` and its target top is row 31 after source bottom row 21.

- Bengaluru → Airtel: solid downward/right, `1.8 ms` [28,30,6,1], bends [27,29], [35,29], arrowhead [35,30]. Traceable.
- Bengaluru → Airtel: dashed downward/right, `L2? no hop` [30,26,10,1], bends [29,27], [37,27], arrowhead [37,30]. Traceable. `L2?` is explicitly uncertain and the corresponding line is dashed.

### v4

Nodes:
- `Airtel 14.143.x` [35,11,15,1], box [34,10,17,4], RGB (125,160,184).
- `AirtelBB 14.141.x` [34,24,17,1], box [33,23,19,4], RGB (151,184,206).
- `Cloudflare 1.1.1.1 AS13335` [29,41,26,1], box [28,40,28,4], RGB (98,132,156).

Region `external hops` [30,9,13,1], bounds [27,9,30,36], contains all three nodes. Four region corners are plain `─`, not corner glyphs; sides are present. Region line RGB (81,104,120). No member is displaced outside this shipped multi-rank region.

- Airtel → AirtelBB: solid downward/left, `7.1 ms` [37,17,6,1], bends [35,21], [34,21], arrowhead [34,22]. Traceable.
- AirtelBB → Cloudflare: solid downward/left, `8.3-8.6 ms` [36,32,10,1], bends [34,38], [29,38], arrowhead [29,39]. Traceable.

## Crossings, fit, motion and coverage

Each check says `crossings: 0 bridges, 0 touching bends`; no inter-edge crossings, bridge glyphs, touching bends, junctions or apparent branches observed. The three v2 region-bottom route intersections described above are visible; they are not counted as edge/edge crossings. The visible bends listed above are route turns, and none requires guessing. Routes have noticeable long vertical approaches, especially v1/v2/v4, and horizontal offsets; no loops are visible.

Every check says `viewport: unknown zoom: 1.00 natural`; captured frame command output says `viewport: 83x51 zoom: 1.00 natural`, and all four pinned captures say `viewport: 77x47 zoom: 1.00 natural`. Extents from checks: v1 39×40, v2 64×25, v3 46×19, v4 41×36. The graph content is visible at both sizes without clipping or a need to pan/zoom; the cornerless regions are a rendering issue, not clipping. The pane manifests record pane_rows 51, pane_cols null and viewport_line null but viewport_token `83x51 @100%`.

All checks report 0 flows and 0 dot violations. Across five 83×51 frames and three pinned frames for each view, no flow-dot glyphs are visible (checked ●, •, ∙, ⦿ and visually inspected the diagrams). No animated routes exist in these captures, so origin, spacing, direction, corner/bridge/arrowhead occupancy and simultaneous arrival are not applicable. Header separators `·` are viewer chrome, not flow dots.

Selected ANSI captures show every one of the 12 node occurrences in selection color RGB (216,166,87), simultaneously via `--select-all`: coverage 12/12. This does not show separate individually selected frames, only every node's selected border in the shared selected capture.

The hue-probe captures show b/c/d (and b/c/d/e/f in probe2) outside their small region outlines, whose titles are absent, in contrast to a inside its box. The shipped v1/v3/v4 multi-rank regions contain their displayed members, and all shipped region outlines are cornerless as noted. The probes are not counted as shipped nodes or edges.

Family evidence available verbatim in the supplied check captures (no separate line explicitly named family found in the allowed captures/specs):

`groups: srv1(3)`
`groups: srv1(1) srv2(1) address pool(1)`
`groups: DC edge(2)`
`groups: external hops(3)`

No `pins-conflict:` line appears in the final check captures. No independent generator family-evidence statement was found in the permitted captures and specs; none is inferred.

## Blind scorecard

| View | Nodes | Edges | Node labels | Edge labels | Region titles | Edge crossings | Uncertain owners | Clipped graph items | Selected occurrences | Dot violations |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| v1 | 3 | 2 | 3 | 2 | 1 | 0 | 0 | 0 | 3/3 | 0 |
| v2 | 4 | 3 | 4 | 3 | 3 | 0 | 0 | 0 | 4/4 | 0 |
| v3 | 2 | 2 | 2 | 2 | 1 | 0 | 0 | 0 | 2/2 | 0 |
| v4 | 3 | 2 | 3 | 2 | 1 | 0 | 0 | 0 | 3/3 | 0 |
| Total | 12 | 9 | 12 | 9 | 6 | 0 | 0 | 0 | 12/12 | 0 |

Total visible graph labels: 27 including six region titles; 21 excluding titles. Six declared region occurrences are titled, contain their nodes and have cornerless outlines. No unsupported evidence format was encountered; individual selection frames and an explicitly named family-evidence line are absent from the permitted material.
