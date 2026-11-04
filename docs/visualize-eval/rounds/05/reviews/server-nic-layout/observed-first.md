# Stage A — blind observed-first record

Case: `server-nic-layout`, round `05`.

This record uses only the three declared final JSON specs and their supplied text, ANSI, selected-state ANSI, frame captures, pinned77 frame captures, and captured `--check` output. No source, expected data, rubric, dataset manifest, other case, earlier round, attempt log, or evidence manifest was read. No viewer session was launched, no diagram was fixed, and no subagent was used. This is an observation record, not an expectations-based grade.

## Spec identity

Computed with `shasum -a 256`:

| Final spec | SHA-256 |
|---|---|
| `specs/v1-a3.json` | `9a168877e235238ef065eeeddf3c3424273ac85a9d1a745d23f73aff62b5e19e` |
| `specs/v2-a2.json` | `36288a634dbcb7c4a832f4e63576f8c831059ba17e6575b2b3c9c926270813c6` |
| `specs/v3-a3.json` | `e763922cf2b57393818e9c176ee697d63a25fc6906bd40ba7d0fd5cb8e9131a6` |

These identify the inspected bytes. No independent expected-hash manifest was read or compared.

## Coordinate convention and coverage

All rectangles are 1-based `[column,row,width,height]` in the rendered screen, not line numbers in a file containing shell output. A route point is `[column,row]`. The first coordinate column in the tables describes the 83×51 capture; the second describes the pinned 77×47 capture. For all graph labels, boxes, route cells, and arrowheads, pinned coordinates equal normal coordinates minus three columns and two rows. UI controls do not use that translation.

Each view has five frames at 0, 100, 200, 300, and 400 ms in both evidence frame formats and the pinned text capture. All five frame grids in each sequence are identical. The normal ANSI and selected ANSI strip to the same diagram characters as the plain text. The normal frame grids also match the normal ANSI grid after removing ANSI and trailing whitespace. All supplied text/ANSI capture formats were readable.

## Every visible graph label

Widths include all characters of the quoted label and do not include borders or surrounding padding. All labels are one line, complete, and readable. IDs below are convenient names from the allowed specs; IDs themselves are not shown as extra screen labels.

### v1

| Type / owner | Verbatim label | 83×51 | 77×47 |
|---|---|---|---|
| node `fresh` | `fresh 1.5d, no GPUs` | [26,12,19,1] | [23,10,19,1] |
| node `dark` | `7 of 8 dark` | [30,16,11,1] | [27,14,11,1] |
| node `s1` | `server1 R7725 .58` | [30,24,17,1] | [27,22,17,1] |
| node `nic` | `eno16595np0 25 GbE` | [30,32,18,1] | [27,30,18,1] |
| node `gw` | `Arista 103.19.91.57 AS132717` | [30,40,28,1] | [27,38,28,1] |
| edge `dark -> s1` | `no cable?` | [32,20,9,1] | [29,18,9,1] |
| edge `s1 -> nic` | `only uplink` | [32,28,11,1] | [29,26,11,1] |
| edge `nic -> gw` | `def gw 0.1 ms` | [32,36,13,1] | [29,34,13,1] |

### v2

| Type / owner | Verbatim label | 83×51 | 77×47 |
|---|---|---|---|
| node `gw` | `103.19.91.57/29` | [54,28,15,1] | [51,26,15,1] |
| node `nic` | `eno16595np0` | [16,12,11,1] | [13,10,11,1] |
| node `s2` | `server2 R7725 .59` | [16,26,17,1] | [13,24,17,1] |
| node `spare` | `.60-.62 free?` | [16,40,13,1] | [13,38,13,1] |
| edge `nic -> gw` | `no NAT, no v6` | [33,11,13,1] | [30,9,13,1] |
| edge `s2 -> gw` | `same /29` | [38,25,8,1] | [35,23,8,1] |
| edge `spare -> gw` | `free? in /29` | [34,39,12,1] | [31,37,12,1] |

### v3

| Type / owner | Verbatim label | 83×51 | 77×47 |
|---|---|---|---|
| node `gw` | `Arista 103.19.91.57` | [34,14,19,1] | [31,12,19,1] |
| node `airtel` | `Airtel 14.143.x` | [13,22,15,1] | [10,20,15,1] |
| node `airtelbb` | `Airtel BB 14.141.x` | [13,30,18,1] | [10,28,18,1] |
| node `cf` | `1.1.1.1 AS13335` | [13,38,15,1] | [10,36,15,1] |
| node `l2q` | `L2? hops 3,6 nil` | [55,22,16,1] | [52,20,16,1] |
| edge `gw -> airtel` | `1.8 ms, 1 ISP` | [18,18,13,1] | [15,16,13,1] |
| edge `airtel -> airtelbb` | `7.1 ms` | [15,26,6,1] | [12,24,6,1] |
| edge `airtelbb -> cf` | `8.3-8.6 ms` | [15,34,10,1] | [12,32,10,1] |
| edge `gw -> l2q` | `unproven` | [41,18,8,1] | [38,16,8,1] |

### UI labels, also visible

Each title is at `[2,1,69,1]` in its corresponding viewport:

- v1 normal: `rataflow-view · 83x51 @100% · v1-a3.json · 5 nodes · 3 edges · q quit`
- v1 pinned: `rataflow-view · 77x47 @100% · v1-a3.json · 5 nodes · 3 edges · q quit`
- v2 normal: `rataflow-view · 83x51 @100% · v2-a2.json · 4 nodes · 3 edges · q quit`
- v2 pinned: `rataflow-view · 77x47 @100% · v2-a2.json · 4 nodes · 3 edges · q quit`
- v3 normal: `rataflow-view · 83x51 @100% · v3-a3.json · 5 nodes · 4 edges · q quit`
- v3 pinned: `rataflow-view · 77x47 @100% · v3-a3.json · 5 nodes · 4 edges · q quit`

The following controls occur once in each view:

| Verbatim label | 83×51 | 77×47 |
|---|---|---|
| `+ [+]` | [4,46,5,1] | [4,42,5,1] |
| `− [-]` | [4,47,5,1] | [4,43,5,1] |
| `⊡ [f]` | [4,48,5,1] | [4,44,5,1] |
| `□ [i]` | [4,49,5,1] | [4,45,5,1] |

There are no additional visible group names, group boxes, legends, or trunk labels in the diagram screens. Shell prompts and command echoes surrounding the frame grids are capture scaffolding, not diagram labels.

## Every visible arrow and route

All ten routes are fully traceable without guessing, in both sizes. Each has exactly one intact target arrowhead, no source arrowhead, and no arrowhead hidden in a border. Target borders remain intact one cell beyond the arrowhead. The following points use the normal 83×51 coordinates; apply the stated [-3,-2] translation for pinned coordinates.

| View | Source box -> target box | Direction, complete route, arrowhead | Style |
|---|---|---|---|
| v1 | `7 of 8 dark` -> `server1 R7725 .58` | Down: [30,19] through [30,21], then `▼` [30,22]; target top border is row 23. | dashed `╎` |
| v1 | `server1 R7725 .58` -> `eno16595np0 25 GbE` | Down: [30,27] through [30,29], then `▼` [30,30]; target top border is row 31. | solid |
| v1 | `eno16595np0 25 GbE` -> `Arista 103.19.91.57 AS132717` | Down: [30,35] through [30,37], then `▼` [30,38]; target top border is row 39. | solid |
| v2 | `eno16595np0` -> `103.19.91.57/29` | Right from [28,12] to `╮` [51,12], down to `╰` [51,26], right to `▶` [52,26]. | solid |
| v2 | `server2 R7725 .59` -> `103.19.91.57/29` | Right from [34,26] to `╮` [50,26], down through [50,27] to `╰` [50,28], right through [51,28] to `▶` [52,28]. | solid |
| v2 | `.60-.62 free?` -> `103.19.91.57/29` | Right from [30,40] to `╯` [51,40], up to `╭` [51,30], right to `▶` [52,30]. | solid |
| v3 | `Arista 103.19.91.57` -> `Airtel 14.143.x` | Down from [34,17] through [34,18] to `╯` [34,19], left to `╭` [13,19], down to `▼` [13,20]. | solid |
| v3 | `Airtel 14.143.x` -> `Airtel BB 14.141.x` | Down: [13,25] through [13,27], then `▼` [13,28]. | solid |
| v3 | `Airtel BB 14.141.x` -> `1.1.1.1 AS13335` | Down: [13,33] through [13,35], then `▼` [13,36]. | solid |
| v3 | `Arista 103.19.91.57` -> `L2? hops 3,6 nil` | Down with `╎` at [36,17] and [36,18], `╰` at [36,19], right with `╌` at columns 37–54 on row 19 to `╮` [55,19], then down to `▼` [55,20]. | dashed, with solid corner/arrowhead glyphs |

The first v1 box, `fresh 1.5d, no GPUs`, has no arrow in or out. Its bottom border at row 14 is immediately above the dark-port box's top border at row 15, but neither border is shared or connected by a route. Their spatial adjacency alone does not establish an explicit edge.

### Crossings, bends, branches, and ownership

- No route crossings, bridge glyphs, shared route runs, or actual line junctions are visible in any view. The captured checks report `crossings: 0 bridges, 0 touching bends` for all three views, consistent with the drawn connectivity.
- Every route bend is enumerated in the arrow table: zero in v1, six in v2, four in v3.
- v2 has a conspicuous adjacent-but-not-connected bend pair: `╮` [50,26] beside `╰` [51,26]. The left cell connects west/south and the right connects north/east; no horizontal stroke joins them. This is visual proximity, not a crossing or merged junction. Pinned positions are [47,24] and [48,24]. Three independent arrowheads at rows 26, 28, and 30 enter three separate cells along the gateway's left side. They do not merge into one bus.
- v3 has an apparent source fan-out from one gateway, but two separate departure columns, 34 and 36. The two row-19 corridors turn away from each other, leaving column 35 empty. There is no Y/T junction. The source box, not a shared run, is their common point.
- No graph label has an uncertain geometric owner. The uncertainty in `free?`, `L2?`, and `no cable?` concerns the content, not label placement. All ten edge labels can be assigned to their routes. The bare `fresh` fact is an isolated node, not an ambiguously placed edge label.

## Every node border and color continuity

All fourteen node occurrences have all four complete sides and all four rounded corners (`╭╮╰╯`) in normal and selected ANSI evidence and in pinned text. Border glyphs were checked cell by cell. No route or arrow replaces a border cell. Normal border colors below are ANSI foreground RGB values; every border cell of each listed node has the same foreground. Background is RGB(40,40,40).

| View / node | 83×51 border rectangle | 77×47 border rectangle | Normal border RGB |
|---|---|---|---|
| v1 `fresh` | [25,11,21,4] | [22,9,21,4] | (125,160,184) |
| v1 `dark` | [29,15,13,4] | [26,13,13,4] | (151,184,206) |
| v1 `s1` | [29,23,19,4] | [26,21,19,4] | (98,132,156) |
| v1 `nic` | [29,31,20,4] | [26,29,20,4] | (176,205,224) |
| v1 `gw` | [29,39,30,4] | [26,37,30,4] | (169,182,101) |
| v2 `nic` | [15,11,13,4] | [12,9,13,4] | (125,160,184) |
| v2 `s2` | [15,25,19,4] | [12,23,19,4] | (189,201,124) |
| v2 `gw` | [53,25,17,7] | [50,23,17,7] | (169,182,101) |
| v2 `spare` | [15,39,15,4] | [12,37,15,4] | (143,157,79) |
| v3 `gw` | [33,13,21,4] | [30,11,21,4] | (169,182,101) |
| v3 `airtel` | [12,21,17,4] | [9,19,17,4] | (211,134,155) |
| v3 `l2q` | [54,21,18,4] | [51,19,18,4] | (211,134,155) |
| v3 `airtelbb` | [12,29,20,4] | [9,27,20,4] | (226,156,175) |
| v3 `cf` | [12,37,17,4] | [9,35,17,4] | (125,160,184) |

In each `--select-all` capture, every cell on every one of those borders is bold RGB(216,166,87), without color breaks. Coverage is v1 5/5, v2 4/4, v3 5/5: **14/14 node occurrences** have their own selected border present. These are simultaneous all-selected captures, not fourteen individually selected sessions. Pinned evidence is text only, so pinned border color and pinned selected-state color are not independently demonstrated; do not infer color from those text dumps.

Route strokes are muted RGB(124,111,100), distinct from label text RGB(235,219,178). The palette has its own rectangular border, not a node border, at `[2,45,9,6]` in normal captures and `[2,41,9,6]` in pinned captures; its foreground is RGB(168,153,104) in the normal ANSI evidence. Its entire footprint spans columns 2–10. It overwrites **zero node-border cells**. In particular, the pinned v3 Cloudflare border at columns 9–25 occupies rows 35–38, above palette rows 41–46. The pinned v1/v2 bottom boxes reach row 40 but start at columns 26/12, to the right of the palette. Neither same-column nor same-row proximity is an overlap.

Normal hues do not uniquely identify every semantic group: v3 Airtel and the `L2?` caveat box have the same RGB despite different spec group strings. This is an observed color reuse, not a broken border. Group names are present in the specs/check capture, not printed as screen legends.

## Coordinate checks on subnet facts and uncertainty

### `/29`, addresses, server2

- v2 visibly says `103.19.91.57/29`, not merely an unlabeled gateway. The address substring is `[54,28,12,1]`, and `/29` is `[66,28,3,1]`; pinned they are `[51,26,12,1]` and `[63,26,3,1]`.
- `same /29` is `[38,25,8,1]` (pinned `[35,23,8,1]`) on the `server2 R7725 .59` route. The full server2 label is `[16,26,17,1]` (pinned `[13,24,17,1]`). It is legible and its arrow enters the gateway at [52,28] (pinned [49,26]).
- `.60-.62 free?` and `free? in /29` are both visible at the coordinates in the label table. The latter route points to the same gateway as server2. The qualification question marks survive in full.
- v1 separately shows `.58` in the server1 label and `103.19.91.57` in the gateway label; the latter address substring is `[37,40,12,1]`, pinned `[34,38,12,1]`.
- v3 repeats `103.19.91.57` within the Arista label at `[41,14,12,1]`, pinned `[38,12,12,1]`.
- No diagram label explicitly prints `.56` as network, `.63` as broadcast, a dotted netmask, or a full usable-host range. The visible `/29` facts are the prefix, `same /29`, server suffixes `.58` and `.59`, and the questioned `.60-.62` range. More complete subnet arithmetic is not a visible fact and is not silently supplied by this review.

### Which uncertainty routes are actually dashed

- `no cable?` in v1 is on a visibly dashed route, as its spec declares.
- `L2? hops 3,6 nil` in v3 is reached by a visibly dashed route with the additional edge qualifier `unproven` at `[41,18,8,1]`, pinned `[38,16,8,1]`. That qualification is not placed on the Airtel route.
- The v2 `free? in /29` route is **solid**, not dashed. Both `free?` qualifications are readable, but uncertainty is communicated by words/question marks only. Its final spec also omits a dashed style.
- `8.3-8.6 ms` is complete at `[15,34,10,1]`, pinned `[12,32,10,1]`, and belongs to the solid Airtel-BB-to-Cloudflare route. It is **not** a dashed route. The numeric range itself survives; this review does not turn it into a midpoint or a claim of confirmed mechanism.

Thus there are exactly two visibly dashed routes across the views, not one dashed route for every questioned or ranged statement.

## Motion / static verification

All ten final-spec edges set `dots: 0`. Independently of that intent, the captures show **zero animated dot glyphs on all routes in all frames and states**. A full non-ASCII vocabulary scan of normal, selected, frame ANSI, frame text, and pinned text found no filled-circle/bullet motion glyph, nor any other unexplained dot-like route mark. All rendered frames are static. The middle dots `·` in title separators are UI typography, not moving route dots; address periods and decimal points are text.

For every route, the observed per-frame dot counts are `[0,0,0,0,0]`. Dot spacing, travel direction, starting at the true origin, and same-frame arrowhead arrival are not applicable: no route is animated. There are zero dots on corners, bridges, arrowheads, borders, or anywhere else on a route. Do not credit this as successful animation synchronization. Captured checks say `flows=0`, `0 single-dot routes`, `0 periodic routes`, `0 violations`, `origins: 0/0`, and `arrivals: 0/0`, matching the static observation.

## Fit, checks, detours, and trunks

- Normal ANSI grids measure exactly **83 columns × 51 rows**. The corresponding capture line is `viewport: 83x51 zoom: 1.00 natural` for all three views. Plain text dumps trim right padding and the final empty screen row: 50 stored rows, with longest nonblank lines 70 characters in v1/v2 and 71 in v3. This is trimming, not a smaller viewport or clipping.
- Pinned captures say `viewport: 77x47 zoom: 1.00 natural`; each frame occupies 47 rows with trimmed right padding. Titles say `77x47 @100%`. All labels, borders, ten arrows, and controls still fit. No content appears clipped, hidden, or available only through pan/zoom in either supplied size. A capture cannot prove the absence of entirely unrecorded content; no such content is inferred.
- `--check` says `viewport: unknown zoom: 1.00 natural`, unlike the actual view captures. It reports extents v1 `34x32`, v2 `62x39`, and v3 `64x32` cells. These are reported layout extents, not substituted for the measured terminal dimensions. Visible node/route/label bounds are v1 columns 25–58, rows 11–42; v2 columns 15–69, rows 11–42; v3 columns 12–71, rows 13–40.
- Each check reports zero bridges/touching bends. Visible crossings agree at zero. Each reports all edge labels placed (3/3, 3/3, 4/4), none on route cells, none skipped, and no ambiguous owners, consistent with the screenshots.
- There is **no `routes: N/M near-minimal` line** in these supplied check captures. That measurement is missing. Visually, v1 has three straight routes; v2 has long upper/lower elbows into the tall gateway, with an adjacent center bend pair; v3 has two outward elbows then straight downward links. All are monotone orthogonal paths without a loop or reversal detour. v2 is conspicuously vertically spread, but its long stems remain traceable and fully fit; this is not evidence of a hidden loop.
- All three checks contain an empty `trunks:` line. The allowed final specs declare no trunks, and the screens show no shared runs. On the visible topology, **an honest no-trunk choice is plausible and not by itself a rendering defect**: v1 is a chain plus an isolated fact; v2 uses three independent source-to-gateway routes/ports; v3 uses two separate gateway departures followed by a chain. No visible bus has been drawn and then lost.
- However, a written/recorded reason for omitting trunks is **not present in the inspected specs or captures**. Any such reason in attempts or other material is outside this stage's read boundary. Therefore the particular recorded rationale cannot be verified here; the preceding assessment is based only on visible independent routing and absent declarations.

## Tool-usable blind scorecard

Counts below are node/edge occurrences across the three final views, not a deduplicated inventory of real machines. Repeated frames and the second viewport size do not multiply topology counts. `labels` counts graph labels only; UI labels are separately counted as one whole title and four control strings per view. Crossings, touching bends, and junctions refer to actual drawn connectivity, not adjacent unconnected bend cells.

```json
{
  "stage": "A",
  "case": "server-nic-layout",
  "round": "05",
  "views": {
    "v1": {
      "visible_nodes": 5,
      "visible_edges": 3,
      "node_labels": 5,
      "edge_labels": 3,
      "labels": 8,
      "ui_labels": 5,
      "crossings": 0,
      "bridges": 0,
      "touching_bends": 0,
      "route_bends": 0,
      "junctions": 0,
      "uncertain_label_owners": 0,
      "clipped_items": 0,
      "selected_nodes_captured": 5,
      "selected_nodes_total": 5,
      "complete_node_borders": 5,
      "color_discontinuous_node_borders": 0,
      "palette_overwritten_node_border_cells": 0,
      "dashed_edges": 1,
      "animated_routes": 0,
      "visible_route_dots_per_frame": [0, 0, 0, 0, 0],
      "dot_violations": 0
    },
    "v2": {
      "visible_nodes": 4,
      "visible_edges": 3,
      "node_labels": 4,
      "edge_labels": 3,
      "labels": 7,
      "ui_labels": 5,
      "crossings": 0,
      "bridges": 0,
      "touching_bends": 0,
      "adjacent_unconnected_bend_pairs": 1,
      "route_bends": 6,
      "junctions": 0,
      "uncertain_label_owners": 0,
      "clipped_items": 0,
      "selected_nodes_captured": 4,
      "selected_nodes_total": 4,
      "complete_node_borders": 4,
      "color_discontinuous_node_borders": 0,
      "palette_overwritten_node_border_cells": 0,
      "dashed_edges": 0,
      "animated_routes": 0,
      "visible_route_dots_per_frame": [0, 0, 0, 0, 0],
      "dot_violations": 0
    },
    "v3": {
      "visible_nodes": 5,
      "visible_edges": 4,
      "node_labels": 5,
      "edge_labels": 4,
      "labels": 9,
      "ui_labels": 5,
      "crossings": 0,
      "bridges": 0,
      "touching_bends": 0,
      "route_bends": 4,
      "junctions": 0,
      "uncertain_label_owners": 0,
      "clipped_items": 0,
      "selected_nodes_captured": 5,
      "selected_nodes_total": 5,
      "complete_node_borders": 5,
      "color_discontinuous_node_borders": 0,
      "palette_overwritten_node_border_cells": 0,
      "dashed_edges": 1,
      "animated_routes": 0,
      "visible_route_dots_per_frame": [0, 0, 0, 0, 0],
      "dot_violations": 0
    }
  },
  "total": {
    "visible_nodes": 14,
    "visible_edges": 10,
    "traceable_edges": 10,
    "intact_target_arrowheads": 10,
    "node_labels": 14,
    "edge_labels": 10,
    "labels": 24,
    "ui_labels": 15,
    "labels_including_ui": 39,
    "crossings": 0,
    "bridges": 0,
    "touching_bends": 0,
    "adjacent_unconnected_bend_pairs": 1,
    "route_bends": 10,
    "junctions": 0,
    "uncertain_label_owners": 0,
    "clipped_items": 0,
    "selected_nodes_captured": 14,
    "selected_nodes_total": 14,
    "complete_node_borders": 14,
    "color_discontinuous_node_borders": 0,
    "palette_overwritten_node_border_cells": 0,
    "dashed_edges": 2,
    "animated_routes": 0,
    "visible_route_dots": 0,
    "dot_violations": 0
  },
  "normal_viewport": [83, 51],
  "pinned_viewport": [77, 47],
  "zoom": 1.0,
  "pinned_selected_color_evidence": false,
  "near_minimal_route_metric": null,
  "recorded_no_trunk_reason_in_allowed_material": null,
  "unreadable_capture_files": []
}
```

## Blind conclusion

The three supplied views are readable, static, and fit both captured sizes. Their fourteen boxes have intact, color-continuous normal and selected borders, ten traceable arrows, no crossings, no clipped labels, and no palette-overwritten node border. The subnet prefix, gateway address, server2 identity, question marks, and latency range survive at the coordinates above. The free-address and 8.3–8.6 ms links are solid, while only `no cable?` and `unproven`/`L2?` are dashed. No claim is made about fidelity to an unseen source or success against an unseen rubric. The absent recorded trunk rationale and near-minimal metric remain explicitly unverified.
