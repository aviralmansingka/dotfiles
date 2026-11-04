# Stage A — blind React Flow observation: datacenter-redundancy

Reviewer: independent Sol (`openai/gpt-6.1-sol`). Round 07. Stage A only.

## Scope and coordinate convention

Read only this case's `reactflow.html` and `capture.png`, plus the round-07 judge task. No rataflow bundle, round-05 verdict, undisclosed expectations, generator notes, or comparison material was read. Embedded spec references were not followed. PNG inspected as an image, including enlarged crops made solely from this capture.

Coordinates use the **whole capture scaled to 1054 × 2000**, origin top left. Convert to original PNG pixels (2442 × 4634) with x × 2442/1054 and y × 4634/2000. Approximate tolerance ±3 scaled pixels. `B(x1,y1;x2,y2)` is a rectangle; label positions are centers. These coordinates do not claim a browser viewport size or numerical fit zoom.

## v1 — ISP / MUX / core

Canvas B(21,71;971,676). Eight nodes, all readable, fully bordered rounded rectangles:

| Node | Bounds | Group |
|---|---|---|
| ISP A | B(82,236;255,278) | wan |
| ISP B | B(82,319;255,361) | wan |
| ISP C | B(82,402;255,444) | wan |
| ISP D | B(82,485;255,527) | wan |
| MUX 1 | B(410,319;583,361) | mux |
| MUX 2 | B(410,402;583,444) | mux |
| Core 1 | B(737,319;910,361) | core |
| Core 2 | B(737,402;910,444) | core |

Three rounded, tinted, fully enclosed subflows with titles in the top border: WAN B(68,211;270,535), title (94,210); MUX B(396,294;597,453), title (419,293); CORE B(722,294;925,453), title (753,293). All declared members are inside. Title background masks short top-border spans intentionally.

The four ISP→MUX edges have no labels in HTML and none in the image: ISP A and B lead to MUX 1; ISP C and D lead to MUX 2. A/B routes share final horizontal x≈333–410 at y≈340; C/D share x≈333–410 at y≈423. Branch/elbow junctions at (333,340) and (333,423); separate outer elbows at (333,257) and (333,506). These are merged approaches, not clean X crossings.

Every visible edge-label instance:

| HTML owner | Text | Center | Visual ownership |
|---|---|---|---|
| MUX 1 → Core 1 | x-connect | (660,329) | Top member of upper stack; above shared upper horizontal. |
| MUX 1 → Core 2 | x-connect | (660,351) | Bottom member of upper stack; adjacent to central down leg. |
| MUX 2 → Core 1 | x-connect | (660,412) | Top member of lower stack; adjacent to central up leg. |
| MUX 2 → Core 2 | x-connect | (660,434) | Bottom member of lower stack; below shared lower horizontal. |

Crossing/shared corridor: the four MUX→core paths visually form two horizontal rails at y≈340 and423 connected by a single coincident vertical at x≈660. The two cross-rank edges occupy that same vertical in opposite directions, while sharing outgoing and incoming horizontal sections with the straight edges. Labels cover the junction regions near (660,340) and (660,423). There is no separately visible X crossing or bridge, and no way to assign each identical label to an independent full route from the screenshot alone. HTML supplies the owner table above. Arrowheads at Core 1 and Core 2 are visible but coincide for incoming edge pairs.

Animation: no yellow flow dots anywhere in this view. All eight HTML edges have `animated: false`, so the circle/SMIL branch is not instantiated.

## v2 — core / firewall / border leaf / spine

Canvas B(21,712;971,1317). Eight nodes, complete rounded borders:

| Node | Bounds | Group |
|---|---|---|
| Core 1 | B(76,975;201,1006) | core |
| Core 2 | B(76,1035;201,1066) | core |
| FW1 | B(314,975;440,1006) | firewall |
| FW2 | B(314,1035;440,1066) | firewall |
| BL 1 | B(553,975;678,1006) | border-leaf |
| BL 2 | B(553,1035;678,1066) | border-leaf |
| Spine 1 | B(791,975;917,1006) | spine |
| Spine 2 | B(791,1035;917,1066) | spine |

Subflows are titled, bordered, tinted and contain both members: CORE B(65,957;212,1073), title (87,956); FIREWALL B(303,957;451,1073), title (334,956); BORDER-LEAF B(542,957;689,1073), title (582,956); SPINE B(780,957;928,1073), title (807,956). Firewall and spine use essentially the same teal family, but have distinct titles and separate boxes.

Every visible edge-label instance:

| HTML owner | Text | Center |
|---|---|---|
| Core 1 → FW1 | active | (258,982) |
| Core 1 → FW2 | standby? | (258,998) |
| Core 2 → FW1 | active | (258,1042) |
| Core 2 → FW2 | standby? | (258,1058) |
| FW1 → BL 1 | active | (496,982) |
| FW1 → BL 2 | active | (496,998) |
| FW2 → BL 1 | standby? | (496,1042) |
| FW2 → BL 2 | standby? | (496,1058) |
| BL 1 → Spine 1 | ECMP | (735,982) |
| BL 1 → Spine 2 | ECMP | (735,998) |
| BL 2 → Spine 1 | ECMP | (735,1042) |
| BL 2 → Spine 2 | ECMP | (735,1058) |

All twelve texts are readable, but labels are stacked above/below source-height rails rather than attached to four independent paths per gutter. Ownership table is grounded in HTML; screenshot-only destination attribution is uncertain for every paired stack, especially repeated `active` and `ECMP`.

Crossings / shared corridors, exhaustively by gutter:
- Core→firewall: shared horizontal rails y≈990 and1051 between x≈201–314; opposing cross-rank routes coincide at x≈258, y≈990–1051. Intersections at (258,990), (258,1051), partly covered by labels. Solid `active` and dashed `standby?` routes use overlapping corridors. Visible approach into FW1 is solid and into FW2 dashed, but individual source-to-target traces are not distinct.
- Firewall→border-leaf: shared rails y≈990 and1051 between x≈440–553; central vertical x≈496, y≈990–1051. Intersections at (496,990), (496,1051), masked near the labels. Upper-source active edges and lower-source dashed standby edges overlap on cross connections; some dashes remain visible on the lower rail. Separate dashed versus solid cross routes cannot be followed end to end.
- Border-leaf→spine: shared rails y≈990 and1051 between x≈678–791; central vertical x≈735, y≈990–1051. Intersections at (735,990), (735,1051). All solid; paired target arrowheads coincide.
- No additional isolated X crossing, route over a node interior, or canvas clipping is visible. The ambiguity is merged/counterflow corridors, not a large free-standing tangle.

Animation: none visible; all twelve edges explicitly nonanimated in HTML. `standby?` is dashed, not a motion effect.

## v3 — spines / rack leaves / racks

Canvas B(21,1354;971,1959). Six nodes, all readable and fully bordered:

| Node | Bounds | Group |
|---|---|---|
| Spine 1 | B(82,1602;255,1644) | spine |
| Spine 2 | B(82,1685;255,1727) | spine |
| Leaf 1 | B(410,1602;583,1644) | rack-leaf |
| Leaf 2 | B(410,1685;583,1727) | rack-leaf |
| Rack 1 | B(737,1602;910,1644) | rack |
| Rack 2 | B(737,1685;910,1727) | rack |

Subflows: SPINE B(68,1577;270,1735), title (102,1576); RACK-LEAF B(396,1577;597,1735), title (444,1576); RACK B(722,1577;925,1735), title (752,1576). All tinted/bordered/titled, every member inside. Spine and rack-leaf share the teal family; titles make grouping explicit.

Every visible edge-label instance:

| HTML owner | Text | Center |
|---|---|---|
| Spine 1 → Leaf 1 | ECMP | (333,1611) |
| Spine 1 → Leaf 2 | ECMP | (333,1634) |
| Spine 2 → Leaf 1 | ECMP | (333,1694) |
| Spine 2 → Leaf 2 | ECMP | (333,1717) |
| Leaf 1 → Rack 1 | dual | (660,1611) |
| Leaf 1 → Rack 2 | dual | (660,1634) |
| Leaf 2 → Rack 1 | dual | (660,1694) |
| Leaf 2 → Rack 2 | dual | (660,1717) |

All eight label boxes are readable. Ownership by individual edge is not uniquely indicated visually: each gutter has two stacked labels at each source height and a shared four-edge routing skeleton.

Crossings / shared corridors:
- Spine→leaf gutter: horizontal rails y≈1623 and1706 from x≈255 to410; opposing cross-rank edges co-route vertically x≈333 between those heights. Junctions (333,1623), (333,1706) under/near labels. Both horizontal rails are also shared with the straight edges.
- Leaf→rack gutter: same pattern, horizontal x≈583–737 at y≈1623 and1706, shared counterflow vertical x≈660; junctions (660,1623), (660,1706).
- No isolated independent X crossover, no node-interior route occlusion visible. Arrowheads into each target are present but do not separate its two incoming routes.

Animation: absent in capture and disabled on all eight HTML edges.

## Fit, borders, attribution, and blind scorecard

All three graphs, including all groups, fit completely inside their own captured canvases at the captured zoom, with large vertical margins and no graph pan needed. This full-page PNG does not establish that all three canvases fit simultaneously on the physical browser screen. All 22 node-instance borders are complete, unoccluded and unclipped. Group titles interrupt short top-border spans intentionally; that is not node-border loss.

React Flow attribution badges appear in the lower-right corners approximately B(912,662;971,675), B(912,1303;971,1316), B(912,1945;971,1958). No graph overlaps these badges. They are chrome and discounted.

Stage-A-only provisional scorecard (not a paired verdict; no undisclosed expectations applied):

| Aspect | Blind assessment |
|---|---|
| Structural inventory / rendered fidelity to HTML | All 22 node instances, 10 subflow boxes, and 24 nonempty edge-label instances visible. HTML has 28 edges; independently drawn routes cannot all be distinguished because of merging. |
| Arrow traceability / label ownership | Deficient in every view: all-to-all gutters collapse to shared two-rail/one-vertical shapes, incoming arrows coincide, identical labels are stacked. Dashed/solid paths in v2 overlap. |
| Layout fit | Pass per captured canvas; whole node/group extent visible without graph pan. |
| Grouping | Pass: all groups explicitly boxed/titled, members inside; some adjacent/distinct groups share teal. |
| Node borders | Pass: no incomplete, occluded or clipped node borders observed. |
| Animation evidence | Absent: zero yellow dots visible, all 28 edges nonanimated in HTML. |
| Workflow evidence | Not assessed in Stage A; commands, attempts and determinism evidence were deliberately not read. |

Record to be frozen by SHA-256 immediately after writing. No comparison or overall green/red decision performed.
