# Round 13 network — stage A blind observation

No source, brief, rubric, expected data, or triage block was opened. Coordinates below are 1-based `[column,row,width,height]` in the 77×47 pinned frame 0; they include the viewer header. A separate 68×44 capture and its ANSI and select-all captures corroborate the graph and colors.

## Surface v1 — single graph

**Shape:** 6 boxes, 7 directed edges, 7 distinct routes, 7 edge labels and 6 node labels. No canvas or separate diagrams. No diagram title or description appears or is specified; their regions and clipping are not applicable. One 77×47-fitting single view is exempt from diagram-description requirements. Viewer header is not a diagram title.

**Labels, verbatim:** WAN [38,5,3,1]; Firewall [35,13,8,1]; Core switch [34,21,11,1]; Web tier [30,34,8,1]; Redis [43,34,5,1]; DB tier [36,42,7,1]; `1 GbE` [41,8,5,1]; `10 GbE` [41,16,6,1] (Firewall→Core); `10 GbE` [31,27,6,1] (Core→Web); `25 GbE` [42,27,6,1]; `session` [37,32,7,1]; `queries` [36,37,7,1]; `fill` [47,37,4,1]. All graph labels are visible and unclipped. `session` sits above the short lateral edge, close to the two incoming arrowheads but appears to label that lateral relation; `queries` is between two downward routes but closer to its left origin. No label owner is uncertain on this capture; check reports `labels: 7/7 placed, 0 leader-ticked, 0 on route, 0 skipped, 0 ambiguous owners`.

**Arrows:** WAN→Firewall downward `▼`, Firewall→Core switch downward `▼`, Core switch→Web tier downward `▼` with left jog, Core switch→Redis downward `▼` with right jog, Web tier→Redis rightward `▶` (three visible route cells), Web tier→DB tier downward `▼` with inward jog, Redis→DB tier downward `▼` with inward jog. All seven are traceable with intact visible heads and separate ports. No crossing, bridge glyph, touching bend, junction, shared run, or apparent branch; the fan is two separate lines, not a junction. The check agrees: `crossings: 0 bridges, 0 touching bends`.

**Near misses:** None of e0 WAN→Firewall, e1 Firewall→Core, e2 Core→Web, e3 Core→Redis, e4 Web→Redis, e5 Web→DB, or e6 Redis→DB visibly enters the two-cell unrelated-node margin. Thus no unrelated node, closest cell, or inside-margin run applies. Check: `near-misses: 0 cell(s) inside the 2-cell margin of a node the route does not serve (0 on trunk buses)` and `passes-near-unrelated-node: 0`; no individual `near-miss: route eN passes …` lines. Capture and check agree.

**Groups and ranks:** `fabric` is blue: Firewall RGB 115,161,206; Core switch 153,186,219. `tiers` is purple: Web tier 138,115,206; Redis 170,153,219; DB tier 106,78,193. WAN, ungrouped, is gold 216,166,87. Neither group has an enclosing border, box, or title. Group sibling order in this one view: Firewall then Core top to bottom; Web then Redis left to right, DB below. Stable across the observed frames; no second diagram for comparison. Labels themselves say `Web tier` and `DB tier`; no separate tier band or tier title. The five pinned ranks declared by `layers` are observed as WAN / Firewall / Core switch / Web tier and Redis / DB tier; check says `layers=5 (6 pinned, within-rank order automatic)` and `pins: 6 pinned, 0 conflict(s)`. Source-listing order cannot be independently verified blind.

**Borders and selected states:** All six boxes have all four sides and four rounded corners. The normal ANSI capture shows each individual border continuously in its node RGB; no missing or differently colored segments. The select-all ANSI capture shows all six node borders bold gold, 6/6 node occurrences selected; this is one select-all state, not six individually captured selections.

**Motion evidence:** Four animated routes, one dot each in every one of the 30 pinned frames; three lower application routes remain static. At frame 0 each dot is on the first drawn route cell, matching `origins: 4/4 routes start at their arrow origin`. Positions below are `[column,row]` in the pinned capture. Every listed pair of adjacent frame numbers has identical positions; frame n is at n×100 ms. In each entry values are WAN→Firewall, Firewall→Core, Core→Web, Core→Redis, in that order:

- frames 0–1: (39,8) (38,16) (38,24) (40,24)
- 2–3: (39,9) (38,17) (38,25) (40,25)
- 4–5: (39,8) (38,16) (38,26) (40,26)
- 6–7: (39,9) (38,17) (38,27) (40,27)
- 8–9: (39,8) (38,16) (38,28) (40,28)
- 10–11: (39,9) (38,17) (38,29) (40,29)
- 12–13: (39,8) (38,16) (37,30) (41,30)
- 14–15: (39,9) (38,17) (36,30) (42,30)
- 16–17: (39,8) (38,16) (35,30) (43,30)
- 18–19: (39,9) (38,17) (34,30) (44,30)
- 20–21: (39,8) (38,16) (33,31) (45,31)
- 22–23: (39,9) (38,17) (38,24) (40,24)
- 24–25: (39,8) (38,16) (38,25) (40,25)
- 26–27: (39,9) (38,17) (38,26) (40,26)
- 28–29: (39,8) (38,16) (38,27) (40,27).

Within each route there is only one dot, so intra-route spacing is not applicable. The two fan dots move downward, outward on the horizontal runs, then down, and wrap to the origin at frame 22. The first two alternate between two straight cells, returning to origin every four frames; no captured dot occupies their corner or arrowhead. None of the four dots visibly rests on a corner, bridge, junction, label, or arrowhead; there are no bridge/junction glyphs. The dots do not reach all arrowheads together, or visibly reach any arrowhead in the frames. The check reports `dots: 4 single-dot routes, 0 periodic routes, 0 violations, 4 constant at 0.5c/step, 0 same-arrival at 2000ms` and `arrivals: 0/0 same-arrival routes show their dot at the arrowhead on the final step`. The frame audit reports 0.500 cells/frame for four tracked routes and PASS; however, its `r1` and `r2` claim 14-cell routes, while the actual first two dot positions above repeatedly wrap after just two visible cells. Thus the audit's constant-rate result cannot by itself establish traversing the entire first two drawn routes; this capture discrepancy is material. It does show the fan movement and repeated two-cell cycles at one cell per two frames.

Dot / source border / destination border RGB respectively: WAN→Firewall 115,161,206 / 216,166,87 / 115,161,206; Firewall→Core 153,186,219 / 115,161,206 / 153,186,219; Core→Web 138,115,206 / 153,186,219 / 138,115,206; Core→Redis 170,153,219 / 153,186,219 / 170,153,219. Four destination matches, zero source matches, zero shared-hue pairs among visible dots. Check agrees: `dot hues: 0 by source, 4 by destination, 0 shared-hue pair(s) (source-only 1, destination-only 0)`.

**Fit:** Check prints `viewport: unknown zoom: 1.00 natural` and `extent=34x41 cells`. The actual pane text/ANSI header gives `68x44 @100%`; pinned capture prints `viewport: 77x47 zoom: 1.00 natural`. There is no `canvas:` block or `diagram <n> ...` line: graph form, not a canvas. No drawing content is clipped, hidden, overlapping another diagram, or requires pan/zoom; no overflow banner. The 68-column viewer header itself ends in `q qui` (clipped chrome, not graph content). `routes:` is not printed, as expected. Manifest records `confirmed_closed`; select-all and frame captures are present. Pinned 77×47 view has no diagram-description requirement.

**Neutral structure:** Six nodes, seven edges, widest outgoing fan two (Core switch and Web tier); no pair has edges in both directions. Redis and DB tier each receive two separate arrowheads. The graph is connected, no disjoint worlds. Identifiers are sparse: WAN and GbE abbreviations, no visible addresses, ports, numbers other than speeds, or uncertainty qualifiers. Five descending ranks resemble successive stages but contain a side relation and a convergence rather than a simple sequence.

**Generator classification, verbatim, from `generation.json` classification fields:**

family: service-meshes

evidence: The core switch is a two-edge fan (core->web 10 GbE, core->cache 25 GbE) with a second fan of application relations below it, and the same targets carry two different relations (core->cache 25 GbE vs web->cache session; fw->core and core->web are both 10 GbE) — the family's parallel/anti-parallel pressure.

## Canvas total / blind scorecard

Not a canvas; total equals v1. Surface count 1; visible nodes 6; edges 7; routes 7; edge labels 7 (13 including node labels); groups 2 (blue fabric, purple tiers); ranks 5 with 6 pinned; crossings 0; uncertain label owners 0; clipped graph items 0 (header chrome truncated in 68×44 capture); selected-state coverage 6/6 in select-all; check-reported dot violations 0, with the first-two-route frame/audit discrepancy described above; near-miss routes 0; dot hue matches source 0, destination 4, shared pairs 0. Diagram title/description/origin/extent and cross-diagram hue changes are not applicable; graph extent 34×41; no description to misdescribe. No unavailable or unsupported capture format was encountered. Source listing and rubric expectations were deliberately not inspected.
