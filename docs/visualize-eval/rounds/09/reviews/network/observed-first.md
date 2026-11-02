# Round 09 network — blind observation, stage A

Scope: final spec, capture bundle and pinned dump only. Coordinates below are 1-based screen columns and rows in **pinned frame 0**, including its header as row 1; rectangles are `[column,row,width,height]`. The live capture has a different offset. I did not inspect generation.json, records, expectations, source or rubric. Final spec SHA-256: `3c5d4fc340a20dd4f727c3931dbb434a6e71e1fef7594ca718b6b818f75e6958`, matching the capture manifest.

## Visible labels

Node text: `WAN` [38,3,3,1]; `Firewall` [35,11,8,1]; `Core switch` [34,19,11,1]; `Web tier` [33,27,8,1]; `Redis` [39,36,5,1]; `DB tier` [36,44,7,1].

Route text: `1 GbE` [41,6,5,1]; `10 GbE` [41,14,6,1]; `10 GbE` [41,22,6,1]; `25 GbE` [41,23,6,1]; `session` [39,30,7,1]; `queries` [39,31,7,1]; `fill` [43,39,4,1]. All seven are present and none occupies a route cell. The two core labels share the same right-hand gutter beside two parallel vertical routes; the two web labels similarly share a gutter beside two parallel routes. Without relying on spec edge order, the association within each pair is not visually established by a leader or exclusive adjacent cell: four labels have uncertain owners to this reader. In particular both core labels lie closer to the right-hand route, as do both web labels. This differs from the check's `0 ambiguous owners` claim. The other three labels have a reasonably identifiable route.

UI text: `rataflow-view · 77x47 @100% · v1.json · 6 nodes · 7 edges · q quit` [2,1,67,1]; `+ [+]` [4,42,5,1]; `− [-]` [4,43,5,1]; `⊡ [f]` [4,44,5,1]; `□ [i]` [4,45,5,1]. UI is not included in the graph label score.

## Routes and topology

Seven individually drawn, downward arrowheads `▼`, all visibly complete. Tracing the lines and their bends gives:

- WAN → Firewall, arrow at (35,9); bends at (38,8), (35,8); traceable.
- Firewall → Core switch, arrow at (34,17); bends at (35,16), (34,16); traceable.
- Core switch → Web tier, arrow at (33,25); bends at (34,24), (33,24); traceable.
- Core switch → Redis, arrow at (41,34); bends at (36,24), (47,24), (47,33), (41,33); traceable around the right side of Web tier.
- Web tier → Redis, arrow at (39,34); bends at (33,33), (39,33); traceable across the bridge.
- Web tier → DB tier, arrow at (36,42); bends at (35,41), (36,41); traceable beneath the bridge.
- Redis → DB tier, arrow at (38,42); bends at (39,41), (38,41); traceable.

Redis and DB tier each have two distinct incoming routes, with separate adjacent arrowheads and border ports. No arrow pair runs in both directions. The single bridge `⌒` is at pinned screen (35,33); it separates the Web→Redis horizontal path from the Web→DB vertical path. In the live 82×51 text it is at (38,35). The task reports the generator's (32,34), but its coordinate basis is not established by the permitted captures; it must not be confused with these screen coordinates. The check reports `crossings: 1 bridges, 0 touching bends`, consistent with the visible single bridge. No actual junction, touching bend, or line branch is visible: the fan-out uses distinct ports, and each convergence uses distinct ports. Close parallel paths and the crossing require careful tracing, but the routes themselves can be followed.

Six nodes, seven edges, widest fan-out two (Core switch and Web tier each send two). Two nodes receive two arrowheads apiece. The graph is one connected world, not disjoint worlds. Labels are short names and link rates, plus brief purpose words; few identifiers or qualifiers. The top-to-bottom ordering proceeds from WAN through firewall/core to web and data, but does not show labeled phases.

## Groups, tiers, pins and borders

The spec declares logical tags edge (WAN, Firewall), fabric (Core switch), app (Web tier), data (Redis, DB tier). ANSI border foreground RGBs: edge is blue `(125,160,184)` and `(151,184,206)`; data pink `(211,134,155)` and `(226,156,175)`; fabric and app both exactly teal `(125,174,163)`. Thus four logical groups produce only **three** distinct hue families; fabric/app visually collide exactly. All members of each multi-node group have consistent top-to-bottom order in the sole final view; the other groups are singletons. No group box, group border or group title is drawn, correctly for this round's tag-only contract. `Web tier` and `DB tier` contain tier words, but no separate source-named tier line or hue band is visible; teal is shared with Core switch and pink is shared with Redis.

All six node boxes have complete top, bottom, left and right sides and all four rounded corners. ANSI confirms each individual border is color-continuous. The selected capture paints all six borders bold gold `(216,166,87)` in the same image: selected-state occurrence coverage **6/6**. This is a select-all capture, not six separately selected screenshots.

No rank pins appear in the final spec or the permitted captures. The requested generation.json declaration was not inspected because stage A limits reads to captures and spec files, so any generator-declared pin list is unavailable, not assumed empty. Visible node rows in order: WAN 2–5, Firewall 10–13, Core switch 18–21, Web tier 26–29, Redis 35–38, DB tier 43–46.

## Motion

The pinned dump contains 21 frames, 0–2000 ms at 100 ms intervals. Each has exactly seven dots, one per route. They stay in place for adjacent 100 ms frame pairs and advance one eligible straight route cell per 200 ms, moving source to target and wrapping individually; spacing between different routes is not synchronized and is not a multi-dot spacing on any route. Frame 0 dot coordinates: WAN (38,6), Firewall (35,14), Core→Web (34,22), Core→Redis (36,22), Web→Redis (33,30), Web→DB (35,30), Redis→DB (39,39). Each is the first drawn route cell immediately outside its source border, including routes that later bend immediately; no corner-first origin is hidden by a dot in this pinned frame. The check independently claims `origins: 7/7 routes start at their arrow origin`.

Across the 21 pinned frames, dots only occupy straight `│` or `─` cells; none covers a corner, bridge or arrowhead. The dots skip the visible corner/bridge glyph cells and wrap before displaying on arrowheads. They do not all reach arrowheads in any same frame, and none is on an arrowhead in the observed frames. `--check` reports seven single-dot routes, zero periodic routes, zero violations, seven constant at 0.5c/step and zero same-arrival routes. Observed dot violations: 0; same-arrival was not declared. The live frames text begins with a fragment before `frame 2`, so the complete pinned frame 0 is important evidence rather than an inference from the truncated live motion capture.

## Fit, evidence limits and classification

Live text header reports `82x51 @100%`; check says `viewport: unknown zoom: 1.00 natural` and `extent=27x45 cells`. Manifest reports 51 rows and viewport token `82x51 @100%`, with pane_cols and viewport_line null. The accepted independent pinned dump says `viewport: 77x47 zoom: 1.00 natural` and shows the entire graph and UI, without clipping or a need to pan or zoom. No visible clipped items. Its 46th row is the bottom of both the DB box and UI; row 47 is blank. The check lacks a `routes:` line, as expected.

The task itself states the generator classification is `family: service-meshes`, with no anti-parallel pair and no yield. No `family:` or `evidence:` classification line appears in the permitted captures or specs, so its full verbatim `evidence:` text and original location cannot be verified in stage A; I do not invent either. The observation above is neutral, not a classification verdict.

All specified capture formats were readable as text or ANSI escape sequences. The live frames capture is incomplete at its beginning; pinned frame sequence supplies full frames. Rank-pin declaration and original classification line/location are unavailable under the stage-A read restriction.

## Blind scorecard

- Visible nodes: 6; edges: 7; graph labels: 13 (6 node, 7 route).
- Group tags: 4; distinct visible hue families: 3; collision: fabric/app.
- Pinned ranks: unknown generator declaration; 0 pins declared in final spec.
- Crossings: 1 bridge, 0 touching bends; uncertain route-label owners: 4 by visual inspection (check claims 0).
- Clipped items: 0 in pinned 77×47; selected-state coverage: 6/6.
- Dot violations: 0 observed; 7/7 frame-0 origins, 7 dots per frame, no dot on corner/bridge/arrowhead; same-frame arrowhead arrival not observed or specified.
