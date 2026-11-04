# Network — round 02, stage A blind observation

## Scope and evidence

This record judges the two final views, `network/v1.json` and `network/v2.json`, from `network/evidence/v1/` and `network/evidence/v2/`. Coordinates below are 1-based terminal cells, including the title row. Rectangles are `[column,row,width,height]`; route points are `[column,row]`. Node and edge counts are occurrences across these two views, not counts of unique entities.

Read the final `*-text.txt`, normal `*-ansi.ansi`, `*-selected.ansi`, and timestamped `*-frames.txt` captures. Also inspected the timestamped blocks in `*-frames.ansi` by parsing the saved files, without rendering or launching a viewer. The final specs supply intended names only; the observations below come from the captures. Neither checker/validator success nor generator claims establish visual correctness here. No expectations, source brief, rubric, other cases, or earlier-round results were read.

The separately named `evidence/v1-pre-split/` is not counted as a final view: its text capture shows a different six-node/seven-edge composition, whereas the final v1 capture shows five nodes/four edges. Its text was inspected to distinguish that archived candidate from final evidence; its borders and motion were not judged. Final-view totals below do not combine that obsolete composition with its replacements.

## Visible labels

All graph labels are single-line. Spaces inside labels are preserved. No pair of word labels touches to form a fused word.

### Final v1

| Kind | Verbatim visible label | Rectangle |
|---|---|---|
| Node | `WAN` | `[35,12,3,1]` |
| Node | `Firewall` | `[35,20,8,1]` |
| Node | `Core switch` | `[35,28,11,1]` |
| Node | `Redis` | `[22,36,5,1]` |
| Node | `Web tier` | `[48,36,8,1]` |
| Edge | `1 GbE` | `[37,16,5,1]` |
| Edge | `10 GbE` | `[37,24,6,1]` |
| Edge | `25 GbE` | `[26,32,6,1]` |
| Edge | `10 GbE` | `[39,32,6,1]` |

### Final v2

| Kind | Verbatim visible label | Rectangle |
|---|---|---|
| Node | `Web tier` | `[29,20,8,1]` |
| Node | `Redis` | `[31,28,5,1]` |
| Node | `DB tier` | `[43,28,7,1]` |
| Edge | `queries` | `[34,23,7,1]` |
| Edge | `session` | `[33,25,7,1]` |
| Edge | `fill` | `[37,27,4,1]` |

`session` has an uncertain owning edge from placement alone. It is immediately below the long Web tier → DB tier horizontal route, but just to the right of the shorter Web tier → Redis route's final bend. The spec's intended owner does not resolve what the capture communicates. This is one uncertain label, with two plausible routes.

`fill` sits immediately after Redis's upper-right corner: border cell `[36,27]`, then label cells `[37..40,27]`. There is no intervening blank cell between border and label. This is border/label touching, not two fused words. Its position immediately above the Redis → DB tier horizontal edge makes that owner readable. The other five edge-label occurrences have clear nearby owners.

### Viewer chrome, separately from graph-label counts

| View | Verbatim title, excluding outer padding | Rectangle |
|---|---|---|
| v1 | `rataflow-view · 77x47 @100% · v1.json · 5 nodes · 4 edges · q quit` | `[2,1,66,1]` |
| v2 | `rataflow-view · 77x47 @100% · v2.json · 3 nodes · 3 edges · q quit` | `[2,1,66,1]` |

Both views also show `+ [+]` at `[4,42,5,1]`, `− [-]` at `[4,43,5,1]`, `⊡ [f]` at `[4,44,5,1]`, and `□ [i]` at `[4,45,5,1]`. These are eight control-label occurrences plus two titles, not graph labels. Shell prompts and command preambles surrounding timestamped frames are not part of the diagram viewport.

## Arrow-by-arrow trace

All seven visible routes have one visible terminal arrowhead. All seven routes can be followed geometrically without guessing a crossing or joining separate strokes. Label ownership is a separate issue from geometric traceability.

### Final v1: four arrows

1. **WAN → Firewall, downward.** Leaves WAN's bottom at column 35; vertical route cells `[35,15..18]`, with `▼` at `[35,18]`, immediately above Firewall's top at row 19. `1 GbE` is to its right. Fully traceable.
2. **Firewall → Core switch, downward.** Vertical cells `[35,23..26]`, with `▼` at `[35,26]`, immediately above Core switch's top at row 27. `10 GbE` at row 24 belongs to this route. Fully traceable.
3. **Core switch → Redis, down/left/down.** Separate bottom port at column 35; down through rows 31–32, bend `╯` at `[35,33]`, left along row 33 to `╭` at `[22,33]`, then `▼` at `[22,34]`, above Redis's top at row 35. `25 GbE` sits above this left-going run. Fully traceable.
4. **Core switch → Web tier, down/right/down.** Separate bottom port at column 37; down through rows 31–32, bend `╰` at `[37,33]`, right along row 33 to `╮` at `[48,33]`, then `▼` at `[48,34]`, above Web tier's top at row 35. `10 GbE` at `[39,32]` belongs to this right-going run. Fully traceable.

The two Core switch outputs are an apparent fan-out from one box, not a shared edge branch: columns 35 and 37 have an empty column 36 between them, including between the two row-33 bends. No touching bends, shared runs, route crossings, bridge glyphs, or route junctions appear. There are exactly four route bends, listed above.

### Final v2: three arrows

1. **Web tier → Redis, down/right/down.** Leaves the bottom at column 29, descends through rows 23–24, turns at `╰` `[29,25]`, crosses the one straight cell `[30,25]`, turns at `╮` `[31,25]`, then `▼` `[31,26]` above Redis at row 27. Fully traceable. The closely spaced bends are connected by one straight cell, not touching another route. The nearby `session` label has the ownership ambiguity described above.
2. **Web tier → DB tier, down/right/down.** Leaves a separate bottom port at column 31, with vertical cell `[31,23]`, bend `╰` `[31,24]`, horizontal run through `[32..42,24]`, bend `╮` `[43,24]`, vertical cell `[43,25]`, and `▼` `[43,26]` above DB tier at row 27. `queries` appears directly above its horizontal run. Fully traceable.
3. **Redis → DB tier, rightward.** Starts immediately outside Redis's right side at `[37,28]`, proceeds horizontally through column 40, and ends in `▶` at `[41,28]`, immediately before DB tier's left side at column 42. `fill` is immediately above this edge. Fully traceable.

The two Web tier outputs form an apparent box-level fan-out, not a shared bus or route junction. Their four route bends are `[29,25]`, `[31,25]`, `[31,24]`, and `[43,24]`. Two bends from different routes, `[31,24]` and `[31,25]`, occupy vertically adjacent cells. These are **one adjacent/touching-bend pair** with no blank row between them, but their glyph orientations do not join: the upper bend turns from above to the right, and the lower bend turns from the left downward. The route trace remains distinguishable; the proximity contributes to the crowding around `session`. No crossing, bridge glyph, shared run, or actual route junction is visible.

DB tier has two incoming arrows on different sides, not one route branching at a junction.

## Node borders and selected-state evidence

The normal and selected ANSI captures each contain 47 rows of 77 cells. Every perimeter cell for all eight final node occurrences was checked, not just a representative side. Each has a complete top, bottom, left and right side and all four rounded corners. Incoming/outgoing routes do not erase the border cells.

| View | Node | Box rectangle | Perimeter cells | Normal border foreground RGB |
|---|---|---|---:|---|
| v1 | WAN | `[34,11,5,4]` | 14 | `(216,166,87)` |
| v1 | Firewall | `[34,19,10,4]` | 24 | `(228,184,111)` |
| v1 | Core switch | `[34,27,13,4]` | 30 | `(125,174,163)` |
| v1 | Redis | `[21,35,7,4]` | 18 | `(169,182,101)` |
| v1 | Web tier | `[47,35,10,4]` | 24 | `(211,134,155)` |
| v2 | Web tier | `[28,19,10,4]` | 24 | `(216,166,87)` |
| v2 | Redis | `[30,27,7,4]` | 18 | `(125,174,163)` |
| v2 | DB tier | `[42,27,9,4]` | 22 | `(147,194,183)` |

Each normal perimeter is color-continuous in its listed RGB, including corners. All selected perimeters are complete, bold (`SGR 1`) and uniformly `(216,166,87)`. Thus **8/8 node occurrences have their own border visible in the selected-state capture**, and **8/8 can be checked for normal and selected border completeness/color continuity; 0/8 cannot**. Coverage comes from simultaneous select-all captures, not eight independent single-node selection demonstrations. The first node in each normal view already has the same hue as selected borders, but is not bold; the selected capture changes it to bold.

Normal edges and arrowheads use muted `(124,111,100)`, text labels `(235,219,178)`, and static-capture dots `(216,166,87)` on background `(40,40,40)`. The control panel has a complete rectangular border at `[2,41,9,6]`, uniformly `(168,153,104)` in the normal and selected ANSI captures; it is not a graph node.

## Motion

Both timestamped text captures contain five frames at 0, 100, 200, 300 and 400 ms. Every one of the seven animated routes has **exactly one visible dot in each of its five frames**: 35 route/frame observations, with no absent or additional dots. Within-route dot spacing is not applicable because there is only one dot per route.

The matching timestamped diagram blocks in `*-frames.ansi` contain plain diagram text, without foreground-color SGR sequences on their cells. Surrounding shell text has ANSI escapes, but does not supply color evidence for the actual motion frames. Consequently the normal and selected ANSI snapshots prove border/dot colors at those snapshots; color continuity during every timestamped motion frame is not independently demonstrated.

### Dot positions, final v1

Each entry is the single dot's `[column,row]`.

| Route | 0 ms | 100 ms | 200 ms | 300 ms | 400 ms |
|---|---|---|---|---|---|
| WAN → Firewall | `[35,16]` | `[35,17]` | `[35,16]` | `[35,17]` | `[35,16]` |
| Firewall → Core switch | `[35,24]` | `[35,25]` | `[35,24]` | `[35,25]` | `[35,24]` |
| Core switch → Redis | `[35,32]` | `[34,33]` | `[33,33]` | `[32,33]` | `[31,33]` |
| Core switch → Web tier | `[37,32]` | `[38,33]` | `[39,33]` | `[40,33]` | `[41,33]` |

The two short vertical routes alternate between two interior cells every 100 ms, repeating every 200 ms. Each downward step is followed by a jump back upward; the samples do not show a smooth full-route traversal or make direction continuously obvious. The two longer routes progress down and outward, then one horizontal cell per 100 ms; the first sampled transition skips the bend rather than occupying it. Their final descent into target boxes is not sampled in this 400 ms window.

### Dot positions, final v2

| Route | 0 ms | 100 ms | 200 ms | 300 ms | 400 ms |
|---|---|---|---|---|---|
| Web tier → Redis | `[29,24]` | `[30,25]` | `[29,24]` | `[30,25]` | `[29,24]` |
| Web tier → DB tier | `[32,24]` | `[33,24]` | `[34,24]` | `[35,24]` | `[36,24]` |
| Redis → DB tier | `[38,28]` | `[39,28]` | `[40,28]` | `[38,28]` | `[39,28]` |

Web tier → Redis alternates between two eligible straight cells every 100 ms, repeating every 200 ms; the visible down/right progression is followed by a reset. At `[30,25]` the dot is between two bends, not on either corner. Web tier → DB tier advances right by one cell per 100 ms; no target-side descent is sampled. Redis → DB tier advances right one cell per 100 ms across three cells, then resets; its sampled repeat period is 300 ms.

**Observed dot violations: 0.** No dot occupies a corner, bridge, junction or arrowhead in any supplied timestamped frame or the normal/selected snapshots. The dot at `[40,28]` in v2's 200 ms frame is immediately next to, not on, the arrowhead at `[41,28]`. This is a sampled observation, not a guarantee about all intervening times or unsampled parts of the routes.

## Fit and missing evidence

For **both final views**, the capture title token is `77x47 @100%`, and the captured command transcript explicitly says:

`viewport: 77x47 zoom: 1.00 natural`

The normal and selected ANSI cell arrays independently measure **77 columns × 47 rows**. The plain `*-text.txt` snapshots have 46 lines because the last blank row is omitted; the ANSI captures retain all 47 rows. This is not a clipped graph item.

v1's visible graph occupies columns 21–56 and rows 11–38; v2's occupies columns 28–50 and rows 19–30. All node labels, edge-label strings, node perimeters, route bends and arrowheads are inside the viewport. No graph item is visibly clipped. No pan or zoom is needed to inspect the captured content. These observations do not establish that any expected but absent relationship is present, nor that content outside the saved view never existed.

No final required text, normal ANSI, selected ANSI or timestamped motion file is missing or unreadable. Limitations: no cell-level motion color evidence in the timestamped diagram blocks; only five samples across 400 ms; no independent pane-rectangle measurement beyond the captured viewport and 77×47 ANSI arrays. There is no basis to claim smoothness between samples or full traversal of the longer paths.

## Tool-usable blind scorecard

```json
{
  "case": "network",
  "round": "02",
  "stage": "A",
  "final_views": ["v1", "v2"],
  "visible_node_occurrences": 8,
  "unique_visible_node_labels": 6,
  "visible_edges": 7,
  "traceable_edges": 7,
  "visible_arrowheads": 7,
  "visible_graph_label_occurrences": 15,
  "visible_node_label_occurrences": 8,
  "visible_edge_label_occurrences": 7,
  "visible_chrome_label_occurrences": 10,
  "crossings": 0,
  "bridge_glyphs": 0,
  "route_junctions": 0,
  "adjacent_different_route_bend_pairs": 1,
  "apparent_box_level_fanouts": 2,
  "uncertain_label_owners": 1,
  "uncertain_labels": [{"view": "v2", "label": "session", "rect": [33,25,7,1]}],
  "fused_word_label_pairs": 0,
  "border_touching_labels": 1,
  "clipped_items": 0,
  "selected_state_coverage": {"captured": 8, "total": 8, "mode": "select-all"},
  "normal_and_selected_border_checkable_occurrences": 8,
  "normal_and_selected_border_uncheckable_occurrences": 0,
  "border_incomplete_occurrences": 0,
  "border_color_discontinuities": 0,
  "animated_routes": 7,
  "timestamped_route_frame_observations": 35,
  "dot_count_violations": 0,
  "dot_corner_bridge_junction_arrowhead_violations": 0,
  "dot_violations": 0,
  "motion_frame_cell_color_evidence": false,
  "viewport": {"v1": "77x47 @100%", "v2": "77x47 @100%"},
  "viewport_line": "viewport: 77x47 zoom: 1.00 natural",
  "pan_or_zoom_needed_for_visible_content": false,
  "unreadable_required_files": []
}
```

This is the blind record. It does not assign expectation-dependent fidelity or rubric scores. Save and hash this file before any stage-B reveal; do not revise it afterwards.
