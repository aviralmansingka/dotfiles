# modal-runtime — stage A blind observation

This record uses only the three final spec files and supplied captures (including their check/manifest metadata). No source, expectations, rubric, other case, earlier round, or candidate-attempt log was read. No viewer was run. This is an observation record, not a source-fidelity score. Coordinates are 1-based terminal cells, `[column,row,width,height]`; route coordinates below use `(column,row)`.

## Identity and integrity of the observed material

Final-spec SHA-256 values, independently computed with `shasum -a 256`, match their capture manifests:

- `v1-a5.json`: `729bbd45f3afb18e2eec2970fbc93478999e55b833b6b5a0997a3830d84c9b55`
- `v2-a4.json`: `89dc3b3a59735954b66eda8bd6fb38dab6c1490623eddcf03511891f3fa86b5e`
- `v3-a1.json`: `2cb9289096cdf5672e4f6e86eac92c9a1074b9211e875002f793f2734c307ccb`

All manifest-listed capture artifact SHA-256 values match the supplied bytes. Each `pinned-77x47/vN-frames.txt` is byte-identical to its `evidence/vN/vN-frames-77x47.txt` copy. Binary execution was not part of this review.

## Every diagram label and node border

The second coordinate column is the pinned 77×47 view. The geometry of all three graphs is translated by `(-3,-2)` from the 83×51 capture; labels and shapes are unchanged. All labels below are verbatim, including abbreviations and plus signs. All label heights are one cell.

### v1

| Kind | Visible label | 83×51 label bounds | 77×47 label bounds |
|---|---|---|---|
| Node | `modal-worker` | [21,26,12,1] | [18,24,12,1] |
| Node | `modal-runtime` | [51,26,13,1] | [48,24,13,1] |
| Edge | `task+ctrl RPC` | [35,25,13,1] | [32,23,13,1] |

| Node | 83×51 border bounds | 77×47 border bounds | Normal ANSI perimeter RGB | Perimeter cells |
|---|---|---|---|---|
| modal-worker | [20,25,14,4] | [17,23,14,4] | (216,166,87), gold/accent | 32 |
| modal-runtime | [50,25,15,4] | [47,23,15,4] | (125,160,184), blue | 34 |

### v2

| Kind | Visible label | 83×51 label bounds | 77×47 label bounds |
|---|---|---|---|
| Node | `modal-runtime` | [21,27,13,1] | [18,25,13,1] |
| Node | `modal-worker` | [51,31,12,1] | [48,29,12,1] |
| Node | `modal-daemon` | [51,21,12,1] | [48,19,12,1] |
| Edge | `events+mg RPC` | [35,29,13,1] | [32,27,13,1] |
| Edge | `HTTP over UDS` | [35,25,13,1] | [32,23,13,1] |

| Node | 83×51 border bounds | 77×47 border bounds | Normal ANSI perimeter RGB | Perimeter cells |
|---|---|---|---|---|
| modal-runtime | [20,25,15,5] | [17,23,15,5] | (125,160,184), blue | 36 |
| modal-daemon | [50,20,14,4] | [47,18,14,4] | (125,174,163), teal | 32 |
| modal-worker | [50,30,14,4] | [47,28,14,4] | (147,194,183), lighter teal | 32 |

### v3

| Kind | Visible label | 83×51 label bounds | 77×47 label bounds |
|---|---|---|---|
| Node | `modal-runtime` | [33,14,13,1] | [30,12,13,1] |
| Node | `Task engine` | [33,22,11,1] | [30,20,11,1] |
| Node | `Container backend` | [13,30,17,1] | [10,28,17,1] |
| Node | `Task container` | [13,38,14,1] | [10,36,14,1] |
| Node | `Filesystem+volumes` | [53,30,18,1] | [50,28,18,1] |
| Node | `Blobnet` | [53,38,7,1] | [50,36,7,1] |
| Edge | `task dispatch` | [35,18,13,1] | [32,16,13,1] |
| Edge | `starts+manages` | [16,26,14,1] | [13,24,14,1] |
| Edge | `user proc` | [15,34,9,1] | [12,32,9,1] |
| Edge | `mount+snapshot` | [37,26,14,1] | [34,24,14,1] |
| Edge | `image+vol data` | [55,34,14,1] | [52,32,14,1] |

| Node | 83×51 border bounds | 77×47 border bounds | Normal ANSI perimeter RGB | Perimeter cells |
|---|---|---|---|---|
| modal-runtime | [32,13,15,4] | [29,11,15,4] | (125,160,184), blue | 34 |
| Task engine | [32,21,13,4] | [29,19,13,4] | (151,184,206), lighter blue | 30 |
| Container backend | [12,29,19,4] | [9,27,19,4] | (211,134,155), pink | 42 |
| Task container | [12,37,16,4] | [9,35,16,4] | (226,156,175), lighter pink | 36 |
| Filesystem+volumes | [52,29,20,4] | [49,27,20,4] | (125,160,184), blue | 44 |
| Blobnet | [52,37,9,4] | [49,35,9,4] | (151,184,206), lighter blue | 22 |

For **every one of the 11 node occurrences** tabulated above, top and bottom horizontal sides are complete, both vertical sides are complete, and all four rounded corners (`╭╮╰╯`) are present. The recorded border rectangle determines all side/corner coordinates. Decoding the ANSI cells shows one uniform foreground color on each entire normal perimeter: no palette-overwritten cell, hole, stray label, or differently colored corner was found. This checks 372 normal perimeter cells, and the same 372 cells in the selected captures. Text alone would not establish color continuity.

In all three `vN-selected.ansi` captures, every node's own complete perimeter is gold `(216,166,87)`. Selected coverage is **2/2 + 3/3 + 6/6 = 11/11 occurrences**, not merely seven unique node names. These are simultaneous select-all captures, not eleven individual interactive selection trials. The pinned 77×47 material is text-only and has no separate selected/colored capture; selected color continuity at that size is therefore unproven, although all its border glyphs are complete.

### Visible viewer labels (not diagram labels)

Each full header occupies `[1,1,70,1]` in its respective view:

- ` rataflow-view · 83x51 @100% · v1-a5.json · 2 nodes · 1 edges · q quit`
- ` rataflow-view · 83x51 @100% · v2-a4.json · 3 nodes · 2 edges · q quit`
- ` rataflow-view · 83x51 @100% · v3-a1.json · 6 nodes · 5 edges · q quit`

Pinned headers have the identical strings with `77x47` substituted for `83x51`, at the same bounds. The leading space is included. Viewer controls are `+ [+]`, `− [-]`, `⊡ [f]`, `□ [i]`, at `[4,46,5,1]`, `[4,47,5,1]`, `[4,48,5,1]`, `[4,49,5,1]` respectively in every 83×51 view; their pinned rows are 42,43,44,45. Their complete square-cornered UI border is `[2,45,9,6]`, or `[2,41,9,6]` pinned. Its ANSI perimeter is uniformly `(168,153,104)` and is not a group enclosure.

## Every visible directed route

Coordinates here are 83×51; subtract `(3,2)` for every pinned route coordinate. The source/target box borders remain intact; arrowheads sit immediately outside the target border. Every route has one clear arrowhead and can be followed end-to-end without guessing. Normal routes and arrowheads are muted RGB `(124,111,100)`; label text is `(235,219,178)` on background `(40,40,40)`.

| View | Source → target | Complete visible route, including bends/head | Label ownership and direction |
|---|---|---|---|
| v1 | modal-worker → modal-runtime | From source right border at (33,26), horizontal route x34–48 at row26, `▶` at (49,26), target left border x50 | `task+ctrl RPC` immediately above; rightward only |
| v2 | modal-runtime → modal-daemon | From source right border (34,26), x35–47 row26, `╯` (48,26), up x48 rows25–22, `╭` (48,21), `▶` (49,21), target x50 | `HTTP over UDS` at row25 above the horizontal segment; right/up/right |
| v2 | modal-runtime → modal-worker | From source right border (34,28), x35–47 row28, `╮` (48,28), down x48 rows29–30, `╰` (48,31), `▶` (49,31), target x50 | `events+mg RPC` at row29 below the horizontal segment; right/down/right |
| v3 | modal-runtime → Task engine | Under source bottom (33,16), x33 rows17–19, `▼` (33,20), target top row21 | `task dispatch`, right of the straight downward route |
| v3 | Task engine → Container backend | Under source bottom (33,24), x33 rows25–26, `╯` (33,27), x32–14 row27, `╭` (13,27), `▼` (13,28), target top row29 | `starts+manages` above its leftward horizontal segment; down/left/down |
| v3 | Task engine → Filesystem+volumes | Under source bottom (35,24), x35 rows25–26, `╰` (35,27), x36–52 row27, `╮` (53,27), `▼` (53,28), target top row29 | `mount+snapshot` above its rightward horizontal segment; down/right/down |
| v3 | Container backend → Task container | Under source bottom (13,32), x13 rows33–35, `▼` (13,36), target top row37 | `user proc`, right of downward route |
| v3 | Filesystem+volumes → Blobnet | Under source bottom (53,32), x53 rows33–35, `▼` (53,36), target top row37 | `image+vol data`, right of downward route |

### Crossings, bends, branches, and the anti-parallel question

- No crossing, bridge glyph, touching bend, shared route cell, or route junction is visible in any **final** view. All eight ordinary route bends are explicitly listed in the table: four in v2 and four in v3. They are separated, not touching.
- v2 has a two-way *outgoing fan-out*, with separate ports on modal-runtime at rows26 and28. v3 has a two-way outgoing fan-out from Task engine at columns33 and35. These are apparent conceptual branches at a common node, not a shared bus or drawn junction.
- The worker/runtime opposite directions are split across **two views**: v1 shows worker→runtime (`▶` at [49,26,1,1], label [35,25,13,1]); v2 shows runtime→worker (`▶` at [49,31,1,1], label [35,29,13,1]). Both labels are visible and attributable. Pinned equivalents are arrowheads [46,24,1,1] and [46,29,1,1], labels [32,23,13,1] and [32,27,13,1]. Repeated node names let a reader pair these as opposite relationships across views, but no single final panel displays an anti-parallel pair together.
- The briefing's warning about a dropped anti-parallel label/shared corridor is **not reproduced by the final supplied captures**. I did not open earlier candidate captures or raw attempt logs to locate it. These final specs themselves declare one edge in v1 and two outgoing edges in v2. It would be incorrect to report a hidden second route or a shared corridor in either final panel.
- Uncertain visible label owners: **0**. This does not establish that the shortened labels fully express the source semantics.

## Seam specificity and grouping visible to a reader

`task+ctrl RPC` visibly names an RPC seam and abbreviates control as `ctrl`; it does not spell out distinct task and control operations. `events+mg RPC` visibly names RPC and events, but `mg` is unexplained: the full word or exact operation cannot be recovered from this capture. `HTTP over UDS` explicitly specifies HTTP over a UDS transport; UDS itself is not expanded. `user proc` is the very short label on backend→container; it names neither a particular executable nor a more specific process interface. No fuller wording or explanatory legend is visible. These are specificity observations, not a source comparison.

There is **no drawn group block, group title, enclosing orchestration region, compute region, storage region, or group legend**. Only individual node borders carry hue. The spec group strings `orchestration`, `compute`, and `storage` do not appear as rendered labels. The storage/orchestration collision is exact, not merely similar: modal-runtime and Filesystem+volumes both use `(125,160,184)`; Task engine and Blobnet both use `(151,184,206)`. Thus hue alone cannot distinguish storage from orchestration. Container backend/Task container use a pink family. Worker color also changes between views (gold in v1 normal capture, light teal in v2), so its repeated textual label is a better cross-view identity cue than color. Select-all replaces the hue distinctions with gold.

## Motion: static, verified

All declared edges have `dots: 0`. More importantly, each of the five actual displayed frames at 0,100,200,300,400ms contains **zero flow-dot glyphs**, in all three views at both sizes. The only dot-like characters are the five middle-dot separators on each viewer header, not route animation. No dots occur in the graph body, at corners, bridges, or arrowheads. Motion direction, spacing, true-origin initialization, and simultaneous dot arrival are **not applicable**, not failures and not evidence of animation. Dot violations: **0**.

Byte comparison of each captured frame's displayed content, through the control panel's last nonblank row, gives five identical payloads per stream. SHA-256 values of that payload are:

| View | 83×51 text | 83×51 ANSI frame stream | 77×47 text |
|---|---|---|---|
| v1 | bbdcbe08b60596afb030d0350cdd1e74516d9a109f88bc8bd11e83b385d70ecc | fef17a3335497faf7bfba948c9ab897c09705d48cf640d5b41bd01bf48f72c0e | 6e91b9633acc610f6c33c65ca6e01b67b3a68cf536035a7b878be113dd762f11 |
| v2 | 4997c9e626ccacc1a499d736ba915532e9fb823dcad94b166d7a6c74f44c4859 | 6f558a9a5ad02e085aa10f14f778da6ab6ea937e996aa5508e08b3f03cce8e06 | 52666af76e938028aa8793ef4a52125d37d7b3f42fd3a0bac91e6c2067ff8188 |
| v3 | 1a71e6ab4879ecf45d55dcfd3a8b29231949ac8b634a407d758ebf2263af2c9d | 78cf0c28d85fd76be4d7671e2d6dbebf8c4d2c590928bf8a976c5f9ab1628036 | 55dd7cbfa1d956c3cbd18c9086f800559823f01a2a752f07a38802f3e9347b86 |

Frame markers themselves differ by number/time, of course. The live-pane 83×51 files include shell transcripts before/after the frames, and the terminal adds an extra trailing blank separator after frame4; untrimmed marker-delimited transcript chunks are therefore NOT all byte-identical. That delimiter/shell difference is not a changed displayed glyph. Pinned payloads including their blank separators are identical in all five frames. The ANSI frame stream is not a substitute for the dedicated normal/selected ANSI color evidence audited above.

## Fit and diagnostic comparison

Each dedicated normal and selected ANSI buffer decodes to exactly **83 columns × 51 rows**. The live frame transcripts contain `viewport: 83x51 zoom: 1.00 natural`; each pinned file begins `viewport: 77x47 zoom: 1.00 natural`. The text-only normal exports strip trailing spaces and the final empty row (50 serialized rows); the pinned displayed exports similarly end at nonblank row46 of 47. These are not evidence of clipping.

The standalone checks all say `viewport: unknown zoom: 1.00 natural`, not a measured viewport. Each manifest has a null `viewport_line`, null pane columns/rectangle, and pane_rows 51, while its viewport token is `83x51 @100%`. Thus the exact viewport is proven by ANSI buffer dimensions and live transcript, not the natural-layout check alone.

- v1 reports extent=49×8, labels 1/1 placed, 0 skipped, 0 on route cells, 0 ambiguous owners.
- v2 reports extent=49×19, labels 2/2 placed, 0 skipped, 0 on route cells, 0 ambiguous owners.
- v3 reports extent=64×32, labels 5/5 placed, 0 skipped, 0 on route cells, 0 ambiguous owners.
- Every check reports `crossings: 0 bridges, 0 touching bends`, matching the observed graphs. It reports zero flows and zero dot violations, matching the captures.
- No `routes: N/M near-minimal` line is supplied in these check files or visible frame captures. A quantitative near-minimal claim is therefore unavailable. Visually, there is no conspicuous loop: v2 uses two ordinary right/up/right or right/down/right elbows, and v3's lateral branches fan toward the two child columns with two bends each. No route doubles back into a loop.
- All declared nodes and labels are present and fully readable at 100% in both captured sizes. No clipped item, hidden declared item, overlap with UI controls, or demonstrated need to pan/zoom is visible. This is scoped to the supplied specs/captures; it does not infer that absent source concepts are present offscreen.

## Tool-usable blind scorecard

Counts aggregate the three final conceptual views once, rather than counting identical frames or alternate-size copies as new graph occurrences. There are seven unique node names and eleven visible node occurrences. Diagram labels exclude viewer chrome; including one full header plus four controls per view gives 34 total visible label occurrences (19 diagram + 15 UI). The pinned text repeats the same graph counts; separate pinned selected-color coverage is unavailable.

```json
{
  "stage": "A",
  "case": "modal-runtime",
  "count_basis": "three final views, each counted once; alternate sizes and frames are copies",
  "views": {
    "v1": {"visible_nodes": 2, "visible_edges": 1, "node_labels": 2, "edge_labels": 1, "diagram_labels": 3, "crossings": 0, "bridges": 0, "touching_bends": 0, "ordinary_route_bends": 0, "uncertain_label_owners": 0, "clipped_items": 0, "selected_covered": 2, "selected_total": 2, "dot_violations": 0},
    "v2": {"visible_nodes": 3, "visible_edges": 2, "node_labels": 3, "edge_labels": 2, "diagram_labels": 5, "crossings": 0, "bridges": 0, "touching_bends": 0, "ordinary_route_bends": 4, "uncertain_label_owners": 0, "clipped_items": 0, "selected_covered": 3, "selected_total": 3, "dot_violations": 0},
    "v3": {"visible_nodes": 6, "visible_edges": 5, "node_labels": 6, "edge_labels": 5, "diagram_labels": 11, "crossings": 0, "bridges": 0, "touching_bends": 0, "ordinary_route_bends": 4, "uncertain_label_owners": 0, "clipped_items": 0, "selected_covered": 6, "selected_total": 6, "dot_violations": 0}
  },
  "totals": {
    "visible_nodes": 11,
    "unique_node_names": 7,
    "visible_edges": 8,
    "traceable_edges": 8,
    "visible_arrowheads": 8,
    "node_labels": 11,
    "edge_labels": 8,
    "visible_diagram_labels": 19,
    "visible_labels_including_ui": 34,
    "crossings": 0,
    "bridges": 0,
    "touching_bends": 0,
    "ordinary_route_bends": 8,
    "shared_route_cells": 0,
    "route_junctions": 0,
    "common_node_fanouts": 2,
    "uncertain_label_owners": 0,
    "clipped_items": 0,
    "selected_covered": 11,
    "selected_total": 11,
    "complete_node_borders": 11,
    "color_continuous_normal_borders": 11,
    "palette_overwritten_border_cells": 0,
    "drawn_group_blocks": 0,
    "drawn_group_titles": 0,
    "animated_routes": 0,
    "flow_dots_per_frame": [0,0,0,0,0],
    "dot_violations": 0
  },
  "displayed_frame_payloads_identical": true,
  "untrimmed_live_transcript_chunks_identical": false,
  "captured_sizes": [[83,51],[77,47]],
  "missing_evidence": ["77x47 ANSI color and selected capture", "routes near-minimal diagnostic"],
  "unreadable_evidence": []
}
```

All supplied formats inspected were readable. No numeric rubric grade is assigned before expectations are revealed. Stage A ends here; this file must not be modified after saving.
