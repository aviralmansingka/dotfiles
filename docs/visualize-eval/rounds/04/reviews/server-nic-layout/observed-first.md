# Round 04 — server-nic-layout — stage A blind observation

This record uses only the three final JSON specs and their text, normal ANSI, selected ANSI, check, and manifest evidence. No source, expectations, rubric, dataset manifest, earlier rounds, attempts, or other cases were read. No viewer was run. The record is sealed after its first save; its SHA-256 is reported separately.

## Evidence identity and limits

`shasum -a 256` on the final specs produced these hashes, each matching its evidence manifest:

| Spec | SHA-256 |
| --- | --- |
| v1-host.json | a68544d0acc4fc1efbf2b864e3b65094e735bc397acbad605242b3312e8815e5 |
| v2-subnet.json | ce4cf67d58718dbb7a017de5b6ea363614ee71b649f63b2a8b0669163cb27ced |
| v3-upstream.json | 78d192cf1b141bf48a3afd6017a9ca43a3d0a942881bfad2e826ecb86d782e7a |

All five artifact hashes listed in each manifest matched the corresponding file bytes. The manifest binary hash is `0da16d8d8ed46e2a25eb773fc71ecad4de9e310cd33e303a4c7fe77231ad95bc`; I did not execute or independently inspect that binary. All manifests report `cleanup: confirmed_closed` and `select_all_frame: true`.

All text and ANSI captures were readable. Every normal ANSI capture has exactly 47 rows of 77 character cells. Its text capture agrees on the first 46 rows after removing ANSI and trailing blanks, but omits the final blank row 47. Selected captures have identical character geometry to the corresponding normal ANSI capture. Coordinates below come from ANSI cells and are 1-based `[column,row,width,height]`; every content label occupies one row. Arrows/bends use `(column,row)`.

There are no frame dumps for any view; manifests say `frames: null`. I cannot observe movement, frame-to-frame dot counts, timing, or dot trajectories. This is a static case: no dot is visible in any supplied capture, and every specified edge has `dots: 0`. Missing temporal evidence is not treated as proof of correct temporal behavior.

## v1 — host

### Every content label

| Kind / node ID | Verbatim label | Rectangle |
| --- | --- | --- |
| node host | `up 1.5 d · no GPU · no bench` | [17,16,28,1] |
| node dark | `7 of 8 dark` | [51,16,11,1] |
| node s1 | `server1 R7725 103.19.91.58` | [18,24,26,1] |
| node nic | `eno16595np0 25 GbE` | [22,32,18,1] |
| edge dark → s1 | `no cable?` | [31,20,9,1] |
| edge s1 → nic | `only uplink` | [20,28,11,1] |

### Arrows and all route bends

1. `7 of 8 dark` → `server1 R7725 103.19.91.58`: leaves below the dark box at (51,19), descends to `╯` at (51,21), travels left to `╭` at (18,21), and ends in a clear downward `▼` at (18,22), directly above the server1 top border at row 23. Solid, not dashed. Whole route is traceable; `no cable?` sits just above its horizontal leg with no competing route.
2. `server1 R7725 103.19.91.58` → `eno16595np0 25 GbE`: leaves below server1 at (18,27), descends to `╰` at (18,29), travels right to `╮` at (22,29), and ends in a clear downward `▼` at (22,30), above the NIC top at row 31. Solid. Whole route is traceable. `only uplink` is beside its vertical leg.

No crossing, bridge glyph, shared segment, touching pair of distinct routes, junction, or apparent branch is visible. The long leftward sweep on the first edge is conspicuous but does not loop back over itself. Both routes make one horizontal offset between their ports.

### Node borders

All four sides and all four rounded corners are complete for each node. Normal and selected borders each retain one foreground color around their entire perimeter, including arrow-adjacent cells. No edge erases a border cell.

| Node | Border rectangle | Normal border RGB | Selected border |
| --- | --- | --- | --- |
| host | [16,15,30,4] | (125,174,163) | complete, continuous (216,166,87), bold |
| dark | [50,15,13,4] | (216,166,87) | complete, continuous (216,166,87), bold |
| s1 | [17,23,28,4] | (211,134,155) | complete, continuous (216,166,87), bold |
| nic | [21,31,20,4] | (228,184,111) | complete, continuous (216,166,87), bold |

Selected-state coverage: 4/4 node occurrences have their own complete selected perimeter in the select-all capture. These are not four separate single-selection interaction captures.

The host facts box has no incident arrow. Its text is owned by that box, but the drawing alone does not explicitly attach these facts to server1. This is a contextual-scope limitation, not a geometrically ambiguous edge label.

## v2 — subnet

### Every content label

| Kind / node ID | Verbatim label | Rectangle |
| --- | --- | --- |
| node nic | `eno16595np0 25 GbE` | [6,19,18,1] |
| node s2 | `server2 R7725 .59` | [6,25,17,1] |
| node spare | `.60-.62` | [6,30,7,1] |
| node gw | `Arista ToR? 103.19.91.57` | [48,19,24,1] |
| node note | `/29 · no NAT · no v6` | [48,25,20,1] |
| edge nic → gw | `0.1 ms` | [31,18,6,1] |
| edge s2 → gw | `same /29` | [30,24,8,1] |
| edge spare → gw | `free? in /29` | [23,29,12,1] |

### Arrows, short risers, and all route bends

All three arrowheads point right into distinct positions beside the Arista left border at column 47. Each is a visible `▶` at column 46, not a shared arrowhead.

1. NIC → Arista: leaves the NIC right border (24,19), runs right through columns 25–43 at row 19, turns upward at `╯` (44,19), rises through (44,18), turns right at `╭` (44,17), passes (45,17), and reaches `▶` (46,17). Solid. `0.1 ms` belongs to this route. Fully traceable.
2. server2 → Arista: leaves server2 right border (23,25), runs right through columns 24–43 at row 25, turns upward at `╯` (44,25), rises at column 44 through rows 24–21, turns right at `╭` (44,20), immediately turns upward at `╯` (45,20), then right at `╭` (45,19) into `▶` (46,19). Solid. This one-cell horizontal stair between two riser columns is real, not a missing bridge. `same /29` belongs to this route. Traceable by following the bend orientations, although this is the most crowded route in the bundle.
3. `.60-.62` → Arista: leaves the spare box right border (13,30), runs right through columns 14–44 at row 30, turns upward at `╯` (45,30), rises at column 45 through rows 29–22, turns right at `╭` (45,21) into `▶` (46,21). Solid, not dashed. `free? in /29` belongs to this route; the question mark remains visible. Fully traceable.

### Crossings and contacts

No two routes occupy the same cell. No bridge glyph, true crossing, T junction, or shared bus segment is visible. There are, however, three noteworthy adjacent-cell contacts near the short risers:

- At row 19, NIC `╯` (44,19) directly abuts server2 `╭` (45,19). Their glyph strokes point away from the inter-cell gap, so this is not an actual joined bend, but it is visually tight.
- At row 21, server2 `│` (44,21) directly neighbors spare `╭` (45,21).
- At row 25, server2 `╯` (44,25) directly neighbors spare `│` (45,25).

The two independent vertical lines also run side-by-side at columns 44 and 45, rows 22–24. They can momentarily resemble a narrow bus at a glance; following the distinct heads and elbows resolves all three incoming edges. I count zero actual touching/joined bends and zero apparent drawn branch junctions, but separately record these three crowded adjacency sites rather than let the machine's zero conceal them. None has a junction glyph. The `╭╯` at (44,20)/(45,20) belongs to one route and is an intentional tiny stair.

### Node borders

All four sides and all four rounded corners are complete and color-continuous for every node. The Arista box is taller to receive three arrows; all five intermediate cells on each vertical side remain intact. Incoming heads stop outside its left border.

| Node | Border rectangle | Normal border RGB | Selected border |
| --- | --- | --- | --- |
| nic | [5,18,20,4] | (216,166,87) | complete, continuous (216,166,87), bold |
| s2 | [5,24,19,4] | (125,174,163) | complete, continuous (216,166,87), bold |
| spare | [5,29,9,4] | (211,134,155) | complete, continuous (216,166,87), bold |
| gw | [47,16,26,7] | (169,182,101) | complete, continuous (216,166,87), bold |
| note | [47,24,22,4] | (125,160,184) | complete, continuous (216,166,87), bold |

Selected-state coverage: 5/5, in one select-all capture. No content label has an uncertain geometric owner. The `/29 · no NAT · no v6` box is a standalone note with no incident edge; its scope is contextual rather than explicitly connected.

### Subnet and identity observations

`R7725` is visibly part of the server2 label at [14,25,5,1], not just a model mentioned elsewhere. Server2 has `.59`, not a printed full IPv4 address. The gateway's `103.19.91.57` is present at [60,19,12,1]. `/29` appears in the standalone facts label at [48,25,3,1], in `same /29` at [35,24,3,1], and in `free? in /29` at [32,29,3,1]. The spare range `.60-.62` is fully visible. The drawing does not print an explicit base network address, subnet mask, network address, or broadcast address; I do not infer those as visible facts.

## v3 — upstream

### Every content label

| Kind / node ID | Verbatim label | Rectangle |
| --- | --- | --- |
| node gw | `Arista 103.19.91.57 AS132717` | [7,12,28,1] |
| node airtel | `Airtel 14.143.x` | [14,20,15,1] |
| node airtelbb | `Airtel BB 14.141.x` | [12,28,18,1] |
| node cf | `Cloudflare 1.1.1.1 AS13335` | [8,36,26,1] |
| node fabric | `fabric: bridge? tunnel? silent?` | [41,20,31,1] |
| node ecmp | `1 uplink · no ECMP` | [48,28,18,1] |
| edge gw → airtel | `1.8 ms · L2?` | [8,16,12,1] |
| edge airtel → airtelbb | `7.1 ms` | [16,24,6,1] |
| edge airtelbb → cf | `8.3-8.6 ms` | [14,32,10,1] |

### Arrows and all route bends

1. Arista → Airtel: leaves beneath the Arista bottom border at column 7. Two `╎` cells are at (7,15) and (7,16); the turn is represented by `╶` (7,17), six `╌` cells (8–13,17), and `╷` (14,17). A clear solid `▼` at (14,18) points at Airtel's top border row 19. This is the only visibly dashed route across the three views. The dashed elbow uses end-cap glyphs rather than a continuous rounded corner, but it remains unambiguous because no other route is nearby. `1.8 ms · L2?` is fully readable and clearly owned by this edge.
2. Airtel → Airtel BB: leaves below Airtel at (14,23), descends to `╯` (14,25), runs left through (13,25) to `╭` (12,25), and ends in a clear downward `▼` (12,26), above Airtel BB at row 27. Solid, labeled `7.1 ms`. Fully traceable.
3. Airtel BB → Cloudflare: leaves below Airtel BB at (12,31), descends to `╯` (12,33), runs left through columns 11–9 at row 33 to `╭` (8,33), and ends in a clear downward `▼` (8,34), above Cloudflare at row 35. Solid, not dashed. `8.3-8.6 ms` is fully readable beside the vertical leg; it is a range, not a point value. Fully traceable.

There are no crossings, touching distinct-route bends, bridge glyphs, junctions, shared runs, apparent branch points, loops, or conspicuous detours. No edge label has an uncertain owner.

The fabric and ECMP fact boxes have no incident arrows. Their labels are clearly owned by their respective boxes, but the drawing does not explicitly attach either note to a particular upstream edge. `fabric: bridge? tunnel? silent?` remains explicitly tentative text, not a proved intermediate forwarding node in the connected chain.

### Node borders

Every node has four complete sides and all four rounded corners. Normal and selected perimeter colors are continuous, including near arrowheads.

| Node | Border rectangle | Normal border RGB | Selected border |
| --- | --- | --- | --- |
| gw | [6,11,30,4] | (216,166,87) | complete, continuous (216,166,87), bold |
| airtel | [13,19,17,4] | (125,174,163) | complete, continuous (216,166,87), bold |
| fabric | [40,19,33,4] | (169,182,101) | complete, continuous (216,166,87), bold |
| airtelbb | [11,27,20,4] | (147,194,183) | complete, continuous (216,166,87), bold |
| ecmp | [47,27,20,4] | (189,201,124) | complete, continuous (216,166,87), bold |
| cf | [7,35,28,4] | (211,134,155) | complete, continuous (216,166,87), bold |

Selected-state coverage: 6/6, in one select-all capture. The address `103.19.91.57` is visible inside Arista at [14,12,12,1].

## UI labels, common colors, and fit

The visible header labels are:

| View | Verbatim header | Rectangle |
| --- | --- | --- |
| v1 | `rataflow-view · 77x47 @100% · v1-host.json · 4 nodes · 2 edges · q quit` | [2,1,71,1] |
| v2 | `rataflow-view · 77x47 @100% · v2-subnet.json · 5 nodes · 3 edges · q quit` | [2,1,73,1] |
| v3 | `rataflow-view · 77x47 @100% · v3-upstream.json · 6 nodes · 3 edges · q quit` | [2,1,75,1] |

Each view also has `+ [+]` at [4,42,5,1], `− [-]` at [4,43,5,1], `⊡ [f]` at [4,44,5,1], and `□ [i]` at [4,45,5,1]. Their UI panel is [2,41,9,6], with complete square corners, four complete sides, and a continuous normal RGB (168,153,104) perimeter in both captured states. These are UI labels, not extra graph nodes or edges.

ANSI proves content labels use RGB (235,219,178), routes and heads use muted RGB (124,111,100), and the background is (40,40,40). Header foreground is (102,92,84). Selection changes each node perimeter to bold RGB (216,166,87), without changing route geometry or obscuring labels. Related normal-state nodes sometimes share a hue family, but selection removes those normal hue distinctions. Plain text alone could not prove any of these color claims.

| View | Measured ANSI frame | Header viewport token | Literal check viewport line | Reported extent | Observed graph bounding rectangle | Reported routes |
| --- | --- | --- | --- | --- | --- | --- |
| v1 | 77 × 47 | `77x47 @100%` | `viewport: unknown zoom: 1.00 natural` | 48 × 21 | [16,15,47,20] | `2/2 near-minimal, 0 detours, 0 shortened` |
| v2 | 77 × 47 | `77x47 @100%` | `viewport: unknown zoom: 1.00 natural` | 69 × 18 | [5,16,68,17] | `3/3 near-minimal, 0 detours, 0 shortened` |
| v3 | 77 × 47 | `77x47 @100%` | `viewport: unknown zoom: 1.00 natural` | 68 × 29 | [6,11,67,28] | `3/3 near-minimal, 0 detours, 0 shortened` |

Reported extents exceed each observed glyph bounding box by one column and one row; I record both measurements without assuming an explanation. All graph content and the UI fit in the captured frame at 100%. No visible label, route, arrowhead, or border is clipped or covered by the controls. All specified nodes, edges, and labels have corresponding visible occurrences; none requires pan or zoom to see in these captures. This does not establish behavior under resizing or navigation, which was not captured.

Each check says `crossings: 0 bridges, 0 touching bends`. Visible actual crossings and shared/joined bends agree with zero. v2's three adjacent-cell congestion sites are additional observations, not crossing cells and not evidence of a bridge. Reported label results are 2/2, 3/3, and 3/3 placed respectively, with zero on-route cells, skipped labels, or ambiguous owners; the visible edge-label inventory agrees.

## Uncertainty and empty trunks

Visible qualifiers are preserved: `no cable?`, `Arista ToR?`, `free? in /29`, `1.8 ms · L2?`, `fabric: bridge? tunnel? silent?`, and `8.3-8.6 ms`. Only the Arista → Airtel route is dashed. In particular, the spare-IP route with `free?` and the Cloudflare route with `8.3-8.6 ms` are visibly solid, as are their specs. Thus the artifact uses textual uncertainty more broadly than dashed styling. Without expectations, I do not presume that a timing range must mean uncertain topology, but I do not call these solid routes dashed.

Every check has the literal empty `trunks:` line. None of the permitted final specs declares a trunk, and no shared bus is visibly drawn. This reads as an honest no-bus design choice, not a rendering defect: the v2 connections retain separate heads and independent routes rather than inventing a common shared run; v3 explicitly says `1 uplink · no ECMP`. An empty check heading is not itself missing art. However, I did not find a prose recorded reason in the inspected specs/captures/checks/manifests. I have not sought one in attempts or other material because stage A is restricted. The design-choice assessment is grounded in visible structure, not an unseen justification. No claim about correctness relative to unrevealed requirements is made.

## Motion and dot accounting

Visible animated routes: zero. Visible dots in every supplied normal or selected capture: zero. Observed dot violations: zero. Checks report zero flows, zero single-dot routes, zero periodic routes, zero violations, `origins: 0/0`, and `arrivals: 0/0`. Per-frame spacing, direction, corner/bridge/head occupancy, true-origin position, and simultaneous arrival are not measurable without frames; for the depicted static routes these motion requirements are not applicable. The missing frame files remain an explicit evidence gap rather than a fabricated temporal pass.

## Tool-usable blind scorecard

Content-label counts include each node label and edge label once per final view, not repeated across capture states. UI labels are counted separately. Nodes repeated across views are separate node occurrences. Actual touching bends mean distinct routes visibly joining/touching through their strokes; adjacent but unjoined cells are separately counted.

```json
{
  "stage": "A",
  "case": "server-nic-layout",
  "views": {
    "v1": {
      "visible_nodes": 4,
      "visible_edges": 2,
      "visible_content_labels": 6,
      "visible_ui_labels": 5,
      "visible_arrowheads": 2,
      "traceable_routes": 2,
      "dashed_routes": 0,
      "crossings": 0,
      "bridge_glyphs": 0,
      "actual_touching_bends": 0,
      "crowded_distinct_route_adjacency_sites": 0,
      "junctions": 0,
      "apparent_branch_junctions": 0,
      "uncertain_geometric_label_owners": 0,
      "clipped_items": 0,
      "complete_normal_borders": 4,
      "complete_selected_borders": 4,
      "selected_state_coverage": {"captured": 4, "total": 4},
      "visible_dots": 0,
      "observed_dot_violations": 0,
      "animated_routes": 0,
      "frame_evidence_available": false
    },
    "v2": {
      "visible_nodes": 5,
      "visible_edges": 3,
      "visible_content_labels": 8,
      "visible_ui_labels": 5,
      "visible_arrowheads": 3,
      "traceable_routes": 3,
      "dashed_routes": 0,
      "crossings": 0,
      "bridge_glyphs": 0,
      "actual_touching_bends": 0,
      "crowded_distinct_route_adjacency_sites": 3,
      "junctions": 0,
      "apparent_branch_junctions": 0,
      "uncertain_geometric_label_owners": 0,
      "clipped_items": 0,
      "complete_normal_borders": 5,
      "complete_selected_borders": 5,
      "selected_state_coverage": {"captured": 5, "total": 5},
      "visible_dots": 0,
      "observed_dot_violations": 0,
      "animated_routes": 0,
      "frame_evidence_available": false
    },
    "v3": {
      "visible_nodes": 6,
      "visible_edges": 3,
      "visible_content_labels": 9,
      "visible_ui_labels": 5,
      "visible_arrowheads": 3,
      "traceable_routes": 3,
      "dashed_routes": 1,
      "crossings": 0,
      "bridge_glyphs": 0,
      "actual_touching_bends": 0,
      "crowded_distinct_route_adjacency_sites": 0,
      "junctions": 0,
      "apparent_branch_junctions": 0,
      "uncertain_geometric_label_owners": 0,
      "clipped_items": 0,
      "complete_normal_borders": 6,
      "complete_selected_borders": 6,
      "selected_state_coverage": {"captured": 6, "total": 6},
      "visible_dots": 0,
      "observed_dot_violations": 0,
      "animated_routes": 0,
      "frame_evidence_available": false
    }
  },
  "totals": {
    "visible_nodes": 15,
    "visible_edges": 8,
    "visible_content_labels": 23,
    "visible_ui_labels": 15,
    "visible_labels_including_ui": 38,
    "visible_arrowheads": 8,
    "traceable_routes": 8,
    "dashed_routes": 1,
    "crossings": 0,
    "bridge_glyphs": 0,
    "actual_touching_bends": 0,
    "crowded_distinct_route_adjacency_sites": 3,
    "junctions": 0,
    "apparent_branch_junctions": 0,
    "uncertain_geometric_label_owners": 0,
    "clipped_items": 0,
    "complete_normal_borders": 15,
    "complete_selected_borders": 15,
    "selected_state_coverage": {"captured": 15, "total": 15},
    "visible_dots": 0,
    "observed_dot_violations": 0,
    "animated_routes": 0,
    "motion_verified_from_frames": false
  },
  "unreadable_evidence": [],
  "missing_evidence": [
    "v1 frame dump",
    "v2 frame dump",
    "v3 frame dump"
  ],
  "limits": [
    "No frame-derived temporal claims are possible.",
    "Check viewport is unknown; capture size and header supply 77x47 at 100%.",
    "Trunk omission reason is not present in inspected permitted material.",
    "Standalone fact boxes have contextual scope, not explicit incident arrows."
  ]
}
```
