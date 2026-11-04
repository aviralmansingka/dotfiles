# Network — blind observations, round 10, stage A

Evidence scope: final specs and supplied captures only. Coordinates below are 1-based `[column,row,width,height]` in the pinned 77×47 frame, including its header as row 1; they are not coordinates in the 82×51 live capture. Labels mean graph node and edge text, not viewer chrome. Group tags do not call for any enclosure. No source, expectations, rubric, generation record, attempt records, or prior-round files were read.

Final spec SHA-256: v1 `1503a71fd98001e5ce89502f6905560de425ccbab43f8c341ec3889b85b916ba`; v2 `5cdec6d982ff0f380d182ee989abacdc60b44a3fbd3391e1b1a907e7b2907959`.

## Labels and routes

| View | Visible label | Rectangle | Owner |
|---|---|---|---|
| v1 | WAN | [8,24,3,1] | node |
| v1 | Firewall | [21,24,8,1] | node |
| v1 | Core switch | [40,24,11,1] | node |
| v1 | Redis | [64,21,5,1] | node |
| v1 | Web tier | [62,26,8,1] | node |
| v1 | 1 GbE | [13,23,5,1] | WAN → Firewall |
| v1 | 10 GbE | [31,23,6,1] | Firewall → Core switch |
| v1 | 25 GbE | [53,22,6,1] | Core switch → Redis |
| v1 | 10 GbE | [52,26,6,1] | Core switch → Web tier |
| v2 | Core switch | [27,11,11,1] | node |
| v2 | Web tier | [43,11,8,1] | node |
| v2 | Redis | [32,25,5,1] | node |
| v2 | DB tier | [36,36,7,1] | node |
| v2 | 25 GbE | [34,14,6,1] | Core switch → Redis |
| v2 | session | [37,21,7,1] | Web tier → Redis |
| v2 | queries | [40,27,7,1] | Web tier → DB tier |
| v2 | fill | [36,30,4,1] | Redis → DB tier |

Viewer chrome is also visible: `rataflow-view · 77x47 @100% · v1.json · 5 nodes · 4 edges · q quit` or the v2 counterpart, plus the lower-left boxed controls `+ [+]`, `− [-]`, `⊡ [f]`, `□ [i]`. They are interface text, not graph labels.

All eight route occurrences have a distinct visible arrowhead and are traceable: v1 WAN → Firewall, right `▶` at (19,24); Firewall → Core switch, right `▶` at (38,24); Core switch → Redis, right `▶` at (62,21), rising from the upper core outlet; Core switch → Web tier, right `▶` at (60,26), descending from the lower core outlet. V2 Core switch → Redis, down `▼` at (33,23); Web tier → Redis, down `▼` at (35,23); Web tier → DB tier, down `▼` at (40,34); Redis → DB tier, down `▼` at (38,34). Redis and DB each receive two separate, adjacent but non-touching routes in v2. The v1 upper and lower core outlets are physically separate, not a junction; likewise v2 web outlets are separate. There are no visible crossings, bridges, touching bends, shared segments, or route junctions. There is no apparent spurious branch. Bends are visible in both fan routes and all four v2 routes.

Label ownership: zero uncertain to this reader. In particular, the v1 `25 GbE` is immediately above the upper fan route and `10 GbE` immediately below the lower one; the v2 `session` ends beside the Web-to-Redis stem, `queries` ends beside the outer Web-to-DB stem, and `fill` sits beside the Redis-to-DB stem. These are relatively close gutter placements, but the complete routes and relative alignment distinguish them. This is an independent visual judgment, not an assertion that every reader will find them equally clear. Both check captures report 0 bridges, 0 touching bends, 0 labels on routes, 0 skipped and 0 ambiguous owners; I see no counterexample.

Across views there are 9 node occurrences representing 6 named nodes, and 8 edge occurrences representing 7 distinct directed relations. Core switch → Redis (25 GbE) is intentionally repeated and still visible with separate heads from Web → Redis in v2; it is duplicated display, not an eighth distinct relation. No reverse edge or anti-parallel node pair appears. Widest outgoing fan is two (Core switch in v1 and Web tier in v2). In the combined relation set, Redis and DB tier receive two separate arrows each. V1 by itself is one connected transit chain ending in a two-way fan. V2 shows the core/Redis pair and the Web/Redis/DB triangle as joined through Redis, not disjoint worlds. No separate phase-like page ordering is marked; left-to-right or top-to-bottom placement expresses the graph. Text is sparse: short names, four bandwidth labels, and three short relation qualifiers; there are no long identifiers.

## Borders, groups, ranks, attachment

All node occurrences have four complete sides and corners. Pinned border rectangles: v1 WAN [7,23,5,4], Firewall [20,23,10,4], Core switch [39,22,13,5], Redis [63,20,7,4], Web tier [61,25,10,4]; v2 Core switch [26,10,13,4], Web tier [42,10,10,4], Redis [31,24,7,4], DB tier [35,35,9,4]. The ANSI captures show node borders continuously colored, including their sides and corners; the selected captures use bold RGB (216,166,87) for every node occurrence, 9/9, rather than group colors. This is a select-all capture, not nine independent selection interactions.

Normal ANSI border RGBs: network WAN (115,206,183), Firewall (153,219,203), Core switch (78,193,164) in v1 and (115,206,183) in v2; their hue is about 168° throughout despite different lightness. App Web tier (206,115,206), 300°. State Redis (206,161,115) and DB tier (219,186,153), 30°. Thus three visibly distinguishable hue families and stable within-family hue; group identity is logical only, with no enclosing border, background box, or group title. No separate tier-marking line or hue band is visible; `Web tier` and `DB tier` are node labels. Network v1 runs WAN, Firewall, Core left to right; state v2 runs Redis above DB. Group memberships differ across views, so there is no common multi-member sibling sequence to compare across both views.

The final specs declare no rank pins. The task mentions `generation.json`, but stage A explicitly restricts reading to captures and spec files, so any generator-reported pins are unavailable here. Observed rows/ranks: v1 WAN/Firewall/Core share a horizontal center; Redis above Web to the right. V2 Core and Web share the top row, Redis is below, DB below Redis.

For v1 four-row boxes, the two interior rows are equally central. WAN and Firewall source stems exit at row 24, and Firewall's incoming head at row 24; Redis incoming head is at row 21 and Web's at row 26: all use the upper of the two middle interior cells. Core's five-row box has three interior rows and its two separate source stems exit at rows 23 and 25 around its center row 24. In v2, Core source stem is x32, the middle of its x26–38 span; Web's two stems x45 and x47 straddle the center x46. Redis's incoming arrows x33 and x35 straddle its center x34; DB's x38 and x40 straddle its center x39. This is a consistent upper-middle tie break for lone side attachments; multi-edge ports spread around the center.

## Motion and fit

Pinned evidence has 41 frames for v1 and 61 for v2 at 100 ms steps, all with exactly four dots. There is one dot per route rather than multiple dots whose spacing can be compared. Frame-0 origins are the first drawn route cells immediately outside source borders: v1 (12,24), (30,24), (52,23), (52,25); v2 (32,14), (45,14), (47,14), (34,28). Dots move in the indicated arrow direction and wrap. Sample frame 6 positions are v1 (15,24), (33,24), (55,23), (55,25) and v2 (32,17), (45,17), (47,17), (34,31): three drawn straight cells in 600 ms. Full laps are observable within the respective dumps. The claimed 0.5 cells per 100 ms is supported for successive eligible straight route cells, but not as a literal constant speed over every rendered route cell: every bend glyph is skipped as a dot location. For example v1 upper fan goes from (60,23) to (61,22), skipping corner (61,23); v2 paths similarly omit their corner glyphs. No dot occupies a corner, bridge, or arrowhead in any pinned frame; arrows remain visible. Thus there are zero visible dot-on-corner/bridge/head violations, but corners are not included as occupied animation cells, and apparent movement across a bend is two grid cells in a single position advance. The shortest cycles wrap before the longer ones; no frame has every route dot on its arrowhead (indeed none ever occupies an arrowhead). The check output's 0 same-arrival routes and 0 dot violations describe its own criteria and do not establish literal corner-by-corner motion.

Both pinned captures explicitly say `viewport: 77x47 zoom: 1.00 natural`; live text/ANSI captures show `82x51 @100%`, and manifests report 51 pane rows and that viewport token, though `pane_cols` and `viewport_line` are null. Check captures separately say `viewport: unknown zoom: 1.00 natural` and extent v1 75×9, v2 37×29. Both final pinned views show all graph content and controls without clipping or pan/zoom; no content appears hidden. No `routes:` line is expected.

## Classification and missing evidence

The generator's classification line and its location are not present in the allowed final specs, check captures, viewport captures, or capture manifests I inspected. The prompt mentions a `family: service-meshes` claim, but does not supply the whole verbatim `family: … / evidence: …` line or its location; I cannot quote or locate it without reading outside stage-A scope. Likewise generator-reported rank pins are unavailable under the stage-A restriction. No supplied capture format was unreadable.

## Blind scorecard

- Visible nodes: v1 5, v2 4, total occurrences 9, unique 6.
- Visible edges: v1 4, v2 4, occurrences 8, distinct directed relations 7.
- Graph labels: v1 9, v2 8, total occurrences 17 (9 node + 8 edge); all placed.
- Group hue families: 3 (network aqua, app magenta, state orange); group enclosures 0.
- Spec-declared rank pins: 0; generator-reported pins unknown under allowed evidence.
- Crossings/bridges/touching bends: 0/0/0 in each view. Uncertain label owners: 0 as judged visually.
- Clipped or hidden graph items: 0 in pinned final views.
- Selected borders: 9/9 occurrences in select-all captures.
- Dots: 4 in each frame; 0 visible dots on a corner, bridge or arrowhead; 0 missing or extra dots. Literal corner occupancy is absent and corner-by-corner constant movement is not demonstrated.
