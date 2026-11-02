# Network — independent blind observation, stage A

Coordinates below are **1-based [column,row,width,height]**, relative to the actual 77×47 pinned frame, including the viewer header as row 1. The generator's narrative coordinates are zero-based/offset differently; the coordinates here are measured directly from the frame. No expectations or rubric consulted. Reviewer model: `openai/gpt-6.1-terra:high`.

## Inputs and fit

- `v1.json` SHA-256 `321eed73e17298b4d738e89f5c49c412e20c3e15e3b4922c717eab069351575a`; `v2.json` SHA-256 `779f9d1345394061563eac2525ae879cf8d3e6f53e8a3ec163c19d77109d03fc`. Both match their evidence manifests and final attempt records.
- Both pinned captures report `viewport: 77x47 zoom: 1.00 natural`, 21 frames at 100 ms intervals. Pane screenshots say `83x51 @100%`; checks say `viewport: unknown zoom: 1.00 natural`. Manifests record null pane rectangle/columns and confirmed pane closure. Check extents: v1 76×6, v2 28×31. All graph content visible at both captured sizes, no overflow banner, clipped graph item or pan/zoom required. V1 is a very wide, thin strip with substantial blank space. Neither spec declares minlen or rank pins; no `pins-conflict:` line appears. No sibling regions to compare.

## Labels and ownership

Graph labels only; the viewer header and zoom-control legends are interface chrome. Each entry is verbatim and is a single line.

| View | Label | Rectangle | Visible owner |
|---|---|---|---|
| v1 | network | [9,22,7,1] | region title |
| v1 | WAN | [8,24,3,1] | node |
| v1 | Firewall | [21,24,8,1] | node |
| v1 | Core switch | [40,24,11,1] | node |
| v1 | Web tier | [62,24,8,1] | node |
| v1 | 1 GbE | [13,23,5,1] | WAN → Firewall |
| v1 | 10 GbE | [31,23,6,1] | Firewall → Core switch |
| v1 | 10 GbE | [53,23,6,1] | Core switch → Web tier |
| v2 | tiers | [33,9,5,1] | region title |
| v2 | Core switch | [27,11,11,1] | node |
| v2 | Web tier | [43,11,8,1] | node |
| v2 | Redis | [32,25,5,1] | node |
| v2 | DB tier | [36,36,7,1] | node |
| v2 | 25 GbE | [29,18,6,1] | Core switch → Redis, although its text sits nearer the region wall than the line's vertical run |
| v2 | session | [36,21,7,1] | Web tier → Redis |
| v2 | queries | [36,28,7,1] | Web tier → DB tier |
| v2 | fill | [34,30,4,1] | Redis → DB tier |

No label owner is unresolved on tracing the lines; checks independently report 0 ambiguous, 0 skipped, and 0 on route cells in each view. The v2 two web paths are closely adjacent at the bridge and take care to trace; 25 GbE sits some distance to the right of its vertical route. Region titles are visible.

## Arrows and intersections

- V1: WAN → Firewall, Firewall → Core switch, Core switch → Web tier: all left-to-right, straight, complete, traceable; heads `▶` at [19,24], [38,24], [60,24] respectively. No junction, branch, crossing, touching bend, or detour. The third route passes through the network region boundary at [52,24], replacing that wall cell.
- V2: Core switch → Redis, Web tier → Redis, Web tier → DB tier, Redis → DB tier: all directed downward with visible `▼` heads at [32,23], [34,23], [38,34], [36,34] respectively. Each can be followed from its own port to its own head. The core path descends at col 27, turns right at row 22 and down at col 32; the web/session path leaves at col 45 and turns left on row 22 then down at col 34. The web/queries path leaves at col 43 and descends to row 33, turning left into DB; the Redis/fill path leaves at col 32 and turns right on row 33. These are long bent detours to separate ports, not loops.
- Exactly one bridge glyph `⌒` at [43,22] where the two web routes cross; it denotes crossing rather than junction. No touching bends or actual junction/branch glyphs. The two ports leaving Web tier can visually suggest a branch but have separate starts; the two pairs entering Redis and DB have separate heads. Region wall is replaced by the core route at [30,22]. Checks report v1 `crossings: 0 bridges, 0 touching bends`; v2 `crossings: 1 bridges, 0 touching bends`, matching the visible glyphs.

## Boxes, colors, regions, selections

- V1 node outlines WAN [7,23,5,4], Firewall [20,23,10,4], Core switch [39,23,13,4], Web tier [61,23,10,4] have all four sides and rounded corners. In the unselected ANSI, their respective borders use continuous RGB (211,134,155), (226,156,175), (187,108,131), (169,182,101); label text differs in color as expected. The `network` region has a visible titled horizontal top and bottom, and side walls, but uses line ends rather than corner glyphs and its right wall is interrupted by the outbound route. It encloses the three declared members and excludes Web tier. Region hue RGB (137,87,101).
- V2 Core switch [26,10,13,4], Web tier [42,10,10,4], Redis [31,24,7,4], DB tier [35,35,9,4] have four sides and rounded corners. In unselected ANSI the three service node borders are continuous RGB (125,174,163), (147,194,183), (99,151,141), respectively. Core has a continuous gold border RGB (216,166,87) in the captured ordinary frame, evidently selected there; its unselected appearance is not independently captured. Both ordinary and select-all captures show its entire border in one color.
- V2 `tiers` has the visible title on the top horizontal line [30,9]–[52,9], the bottom at row 39, right wall at col 52, and left wall at col 30 below the core box; it uses line ends, not complete corner glyphs. It contains Web tier, Redis and DB tier, but over-reaches across the ungrouped Core switch [26,10,13,4]: the rectangle covers its right part and the top of the left wall is obscured behind that node. The crossing core route also interrupts the left wall at [30,22]. Thus the titled region is not a clean exclusive enclosure. No hidden final region title and no one-member declared final groups.
- `--select-all` ANSI visibly renders all four v1 and all four v2 node outlines bold gold RGB (216,166,87), with all sides and corners individually present. Selected-state coverage **8/8 node occurrences** (six unique names); this is a simultaneous select-all capture, not eight separately selected screenshots. Group borders remain separately colored.

## Motion: 21 pinned frames

All seven specs declare `flow: true`, `dots: 1`, with no rate value. Checks report constant 0.5 cell/step and zero renderer dot violations. Each of the 21 pinned frames shows exactly three dots in v1 and four in v2, one per route; there is no multiple-dot spacing to measure. Position advances one cell every two 100 ms frames, with forward motion and periodic wrap; no background dot field.

Frame-0 origin measurement, with x/y in **1-based frame coordinates**:

| Route | Source border | First painted port stub | Frame-0 dot | Rule |
|---|---|---|---|---|
| WAN → Firewall | [11,24] | [12,24] | [13,24] | one cell after stub |
| Firewall → Core | [29,24] | [30,24] | [31,24] | one cell after stub |
| Core → Web | [51,24] | [52,24] | [53,24] | one cell after stub |
| Core → Redis | bottom row 13 | [27,14] | [27,15] | one cell after stub |
| Web → Redis | bottom row 13 | [45,14] | [45,15] | one cell after stub |
| Web → DB | bottom row 13 | [43,14] | [43,15] | one cell after stub |
| Redis → DB | bottom row 27 | [32,28] | [32,29] | one cell after stub |

The stipulated rule is **first drawn route cell after the border port**. The immediately adjacent painted stub is that first cell: under this rule **0/7** frame-0 dots start at origin, **7/7 are one cell late**. The generator's alternative excluding the stub yields 7/7; it is not the stipulated reading. The check reports origins 3/3 and 4/4 under its own convention, so that report does not establish the stipulated origin rule.

V1 frame 0 → 10 dots move [13,24]→[18,24], [31,24]→[36,24], [53,24]→[58,24]. The short first route wraps at frame 12; the other two wrap at frame 14. The dots do not occupy the arrowheads in these captures. V2 frame 0 → 10: [27,15]→[27,20], [45,15]→[45,20], [43,15]→[43,20], [32,29]→[34,33]. The fill dot wraps at frame 14; the other paths continue. Comparing dot positions to the same cells in other frames finds no dot on a visible corner glyph, bridge glyph or arrowhead in the 21 frames; renderer appears to skip bend/bridge/head glyphs rather than replace them. No frame shows all dots at their heads simultaneously; the check reports `0/0 same-arrival routes`, not positive proof of synchronized arrival. The capture is finite, so behavior beyond these 21 frames is not established.

## Generator family evidence, verbatim (recorded, not judged)

`family: service-meshes / evidence: the ingress fan out of the core is the source's front path (wan->fw->core->web) and the case's converging pair into Redis is drawn whole in v2; this view keeps the front path together for the recipe's 'declared core + stable fan order' rule.`

`family: service-meshes / evidence: this is the view where the converging pair lives — core->Redis (25 GbE) and web->Redis (session) both land on the Redis box from distinct ports with distinct labels, and core->Redis keeps bypassing the web tier exactly as the source states.`

## Blind scorecard

| Metric | v1 | v2 | Total |
|---|---:|---:|---:|
| Node occurrences | 4 | 4 | 8 (6 unique) |
| Edges | 3 | 4 | 7 |
| Graph labels including titles | 8 | 9 | 17 |
| Crossings / bridges | 0 | 1 | 1 |
| Touching bends | 0 | 0 | 0 |
| Uncertain label owners | 0 | 0 | 0 |
| Clipped graph items | 0 | 0 | 0 |
| Selected node occurrences | 4/4 | 4/4 | 8/8 |
| Dot count violations over 21 frames | 0 | 0 | 0 |
| Frame-0 origin violations, specified stub-inclusive rule | 3 | 4 | 7 |
| Dot on visible corner/bridge/head in capture | 0 | 0 | 0 |
| Region overreach defects | 0 | 1 | 1 |

Evidence limitations: no pane device rectangle or measured pane column count in manifests, although header supplies 83×51. Selection evidence is simultaneous rather than individual. No separate unselected v2 Core border capture established. No evidence unreadable; finite captures do not establish later motion.
