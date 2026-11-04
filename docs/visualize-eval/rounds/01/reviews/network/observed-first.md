# Network round 01 — blind Stage A observations

## Scope and method

This is an observation record, not a source comparison or full rubric verdict. I inspected only the final raw evidence under these three capture directories:

- `docs/visualize-eval/rounds/01/network/views/01-request-path/captures/`
- `docs/visualize-eval/rounds/01/network/views/02-core-cache-fill/captures/`
- `docs/visualize-eval/rounds/01/network/views/03-session-fill/captures/`

Files inspected: `unselected.txt`, `unselected.ansi.txt`, `selected-tab.txt`, `selected-tab.ansi.txt`, `selected-right.txt`, `selected-right.ansi.txt`, `selected-after-frames.txt`, `frames/frame-01.txt` through `frame-04.txt`, `dims-raw.txt`, `timestamps.txt`, and `commands.txt`. No spec, spec hash, check, verification report/helper, source brief, renderer source, attempt, or earlier-round content was read. The command records contain spec filenames; I did not open those files. No panes or sessions were operated.

I used an independently written, standard-library Python SGR parser, run with `uv run --no-project`, to map captured characters and truecolor/bold attributes to cells. Its decoded ANSI text matches the corresponding plain-text captures after trailing-space removal. All changes between each view's unselected text and its selected/animation text are `│`/`●` substitutions; labels, borders, arrowheads, and placement remain unchanged. Temporary analysis scripts/output are in `/tmp`, not the repository.

All locations below use **1-based `[column,row,width,height]`**, relative to the named capture. Single cells have width and height 1. RGB values are the captured ANSI values, not inferred from color names. Coordinates describe terminal cells, not pixels.

## Measured surface, UI, and capture provenance

All three `dims-raw.txt` files show `47 77` at `[1,6,5,1]`, `77` at `[1,7,2,1]`, and `47` at `[1,8,2,1]`, following `stty size; tput cols; tput lines`. Thus the measured surface is **77 columns × 47 rows**. ANSI exports reach row 47, which is blank; plain-text exports end at row 46 with trailing blank space removed.

The visible header is at `[2,1,75,1]`:

- View 01: `rataflow-view · spec.json · 5 nodes · 4 edges · 4 flows · drag pan · scroll`
- Views 02 and 03: `rataflow-view · spec.json · 3 nodes · 2 edges · 2 flows · drag pan · scroll`

These are visible UI counts, not independent knowledge of hidden data. The final visible word is `scroll`; no numeric zoom indicator or scenario-specific title is visible. The target was natural 100%; the capture records show a direct application launch with no zoom argument, but **a numerical 100% scale cannot independently be established from these captures alone**.

Every view has the same control box `[2,41,9,6]`, with a complete square-cornered outline and these labels:

| Label | Location |
|---|---|
| `+ [+]` | `[4,42,5,1]` |
| `− [-]` | `[4,43,5,1]` |
| `⊡ [f]` | `[4,44,5,1]` |
| `□ [i]` | `[4,45,5,1]` |

The control box does not touch graph content. Its border is RGB `(168,153,104)`, labels `(235,219,178)`. The header is `(102,92,84)`. The background is `(40,40,40)`.

Capture times from the permitted timestamp/command records, all on 2026-11-02 in UTC:

| View | Dimension capture / application launch | Frames 01 / 02 / 03 / 04 | Unselected / selected-tab / selected-right / selected-after-frames |
|---|---|---|---|
| 01 | 08:32:03 / 08:32:03 | 08:32:06 / 08:32:08 / 08:32:11 / 08:32:13 | 08:32:16 / 08:32:17 / 08:32:18 / 08:32:18 |
| 02 | 08:32:24 / 08:32:24 | 08:32:27 / 08:32:30 / 08:32:32 / 08:32:35 | 08:32:37 / 08:32:39 / 08:32:40 / 08:32:40 |
| 03 | 08:32:44 / 08:32:44 | 08:32:47 / 08:32:49 / 08:32:52 / 08:32:54 | 08:32:57 / 08:32:58 / 08:32:59 / 08:32:59 |

The records describe right-side half-width splits and application launches, followed by `q` and pane disappearance. They do not enumerate the Tab/Right input events themselves; the selected-state names and timestamps identify the captured states, while the ANSI shows what visibly changed.

## View 01 — visible request chain

### Nodes, labels, and fit

| Visible node | Complete box | Label | Unselected border RGB | Neutral top/bottom cells |
|---|---|---|---|---|
| WAN | `[33,7,5,4]` | `[34,8,3,1]` | `(216,166,87)` amber | `[35,7,1,1]`, `[35,10,1,1]` |
| Firewall | `[33,15,10,4]` | `[34,16,8,1]` | `(125,174,163)` teal | `[38,15,1,1]`, `[38,18,1,1]` |
| Core switch | `[33,23,13,4]` | `[34,24,11,1]` | `(211,134,155)` pink | `[39,23,1,1]`, `[39,26,1,1]` |
| Web tier | `[33,31,10,4]` | `[34,32,8,1]` | `(169,182,101)` green | `[38,31,1,1]`, `[38,34,1,1]` |
| DB tier | `[33,39,9,4]` | `[34,40,7,1]` | `(125,160,184)` blue | `[37,39,1,1]`, `[37,42,1,1]` |

The graph occupies `[33,7,13,36]`, including its edge labels. All five complete labels and box outlines fit. No graph label is clipped or wrapped. There are 32 blank columns on each side of the widest graph extent. The last graph border ends on row 42, leaving five rows below it. The control box shares rows 41–42 with DB tier but remains separated horizontally. No oversize warning is visible.

### Apparent relations and complete traces

I read a single downward chain: **WAN → Firewall → Core switch → Web tier → DB tier**. Each relation has an uninterrupted, four-cell vertical corridor in column 34 between adjacent boxes. Every arrowhead is `▼`, so the apparent direction is downward. The source and target contact cells below are horizontal box-border `─` cells, not T-junction glyphs.

| Apparent relation | Source bottom contact | Entire stem-to-arrow corridor | Unselected corridor characters, top to bottom | Arrowhead | Target top contact | Associated edge label |
|---|---|---|---|---|---|---|
| WAN → Firewall | `[34,10,1,1]` | `[34,11,1,4]` | `│ │ ● ▼` | `[34,14,1,1]` | `[34,15,1,1]` | `1 GbE` at `[36,12,5,1]` |
| Firewall → Core switch | `[34,18,1,1]` | `[34,19,1,4]` | `│ │ ● ▼` | `[34,22,1,1]` | `[34,23,1,1]` | `10 GbE` at `[36,20,6,1]` |
| Core switch → Web tier | `[34,26,1,1]` | `[34,27,1,4]` | `│ │ ● ▼` | `[34,30,1,1]` | `[34,31,1,1]` | `10 GbE` at `[36,28,6,1]` |
| Web tier → DB tier | `[34,34,1,1]` | `[34,35,1,4]` | `│ │ ● ▼` | `[34,38,1,1]` | `[34,39,1,1]` | `queries` at `[36,36,7,1]` |

There are no bends, crossing strokes, visible forks, alternative targets, or shared corridor cells in this view. Although all four relations use column 34, their row spans are disjoint and separated by node boxes. Labels sit one blank column to the right of their own corridor, within the corresponding inter-node gap. Their association is clear. The two `10 GbE` labels belong to different, vertically separated edges, not one long edge.

The graph is left-aligned at column 33 rather than center-aligned by node width. Each connector touches the first interior column of a node's horizontal border. The neutral-colored top/bottom cells are farther right, so they are **not aligned with these visible connectors**. I cannot infer a separate hidden route from those neutral cells.

### Selection

In both `selected-tab.ansi.txt` and `selected-right.ansi.txt`, **Core switch** at `[33,23,13,4]` has amber `(216,166,87)` bold borders instead of its pink normal borders. All four corners and both side strokes change; the neutral cells `[39,23,1,1]` and `[39,26,1,1]` remain neutral-colored but acquire bold. The label remains cream, not recolored. WAN is already the same amber hue in the unselected state but is not bold. Thus hue alone does not uniquely identify selection. No selected node relocation is visible, and the Right-named capture still highlights Core switch.

## View 02 — visible core/cache chain

### Nodes, labels, and fit

| Visible node | Complete box | Label | Unselected border RGB | Neutral top/bottom cells |
|---|---|---|---|---|
| Core switch | `[33,15,13,4]` | `[34,16,11,1]` | `(216,166,87)` amber | `[39,15,1,1]`, `[39,18,1,1]` |
| Redis cache | `[33,23,13,4]` | `[34,24,11,1]` | `(125,174,163)` teal | `[39,23,1,1]`, `[39,26,1,1]` |
| DB tier | `[33,31,9,4]` | `[34,32,7,1]` | `(211,134,155)` pink | `[37,31,1,1]`, `[37,34,1,1]` |

The complete graph occupies `[33,15,13,20]`. Labels and boxes fit without clipping or wrapping. There is substantial unused space above and below the three-node chain; the control box starts seven rows after the graph's final occupied row. No warning is visible.

### Apparent relations and complete traces

I read **Core switch → Redis cache → DB tier**.

| Apparent relation | Source bottom contact | Entire stem-to-arrow corridor | Unselected corridor characters | Arrowhead | Target top contact | Associated edge label |
|---|---|---|---|---|---|---|
| Core switch → Redis cache | `[34,18,1,1]` | `[34,19,1,4]` | `│ │ ● ▼` | `[34,22,1,1]` | `[34,23,1,1]` | `25 GbE` at `[36,20,6,1]` |
| Redis cache → DB tier | `[34,26,1,1]` | `[34,27,1,4]` | `│ │ ● ▼` | `[34,30,1,1]` | `[34,31,1,1]` | `fill` at `[36,28,4,1]` |

Both traces are continuous downward columns, with no bends or visible branches/crossings. Each label is immediately to the right of its own corridor. In particular, **the visible `fill` arrow points from Redis cache down toward DB tier**; I do not reverse it based on the word's possible meaning. Contact geometry and the non-aligned neutral border cells have the same appearance as in view 01.

### Selection

Both selected ANSI captures highlight **Redis cache** at `[33,23,13,4]`: normal teal becomes amber/bold on all corners and side strokes and the non-neutral top/bottom cells. Neutral cells `[39,23,1,1]` and `[39,26,1,1]` retain neutral RGB and become bold. Core switch remains normal amber, DB tier remains pink. Text and geometry do not move; the Right-named capture still highlights Redis cache.

## View 03 — visible session/cache chain

### Nodes, labels, and fit

| Visible node | Complete box | Label | Unselected border RGB | Neutral top/bottom cells |
|---|---|---|---|---|
| Web tier | `[33,15,10,4]` | `[34,16,8,1]` | `(216,166,87)` amber | `[38,15,1,1]`, `[38,18,1,1]` |
| Redis cache | `[33,23,13,4]` | `[34,24,11,1]` | `(125,174,163)` teal | `[39,23,1,1]`, `[39,26,1,1]` |
| DB tier | `[33,31,9,4]` | `[34,32,7,1]` | `(211,134,155)` pink | `[37,31,1,1]`, `[37,34,1,1]` |

The graph occupies `[33,15,13,20]`, with the same ample margins as view 02. Every label and border is visible, without clipping, wrapping, or overlap with controls.

### Apparent relations and complete traces

I read **Web tier → Redis cache → DB tier**.

| Apparent relation | Source bottom contact | Entire stem-to-arrow corridor | Unselected corridor characters | Arrowhead | Target top contact | Associated edge label |
|---|---|---|---|---|---|---|
| Web tier → Redis cache | `[34,18,1,1]` | `[34,19,1,4]` | `│ │ ● ▼` | `[34,22,1,1]` | `[34,23,1,1]` | `session` at `[36,20,7,1]` |
| Redis cache → DB tier | `[34,26,1,1]` | `[34,27,1,4]` | `│ │ ● ▼` | `[34,30,1,1]` | `[34,31,1,1]` | `fill` at `[36,28,4,1]` |

Both relations have complete downward traces. There are no visible crossings, false branches, or ambiguous label associations. Again, `fill` visibly points toward DB tier. There is no reverse arrow or side route in this view.

### Selection

Both selected ANSI captures highlight **Redis cache** at `[33,23,13,4]`, exactly as in view 02. Web tier remains normal amber and DB tier remains pink. Selection changes the node outline's color/bold attributes, not its position or label. The Right-named capture does not show a different node selected.

## Border-side and corner audit, common to all views

Every node in the tables has a fully closed four-row outline. For each listed box `[x,y,w,4]`, these are the exact border-side locations:

- Top, including corners: `[x,y,w,1]`; bottom, including corners: `[x,y+3,w,1]`.
- Left side excluding corners: `[x,y+1,1,2]`; right side excluding corners: `[x+w−1,y+1,1,2]`.
- Individual corners: `╭` at `[x,y,1,1]`, `╮` at `[x+w−1,y,1,1]`, `╰` at `[x,y+3,1,1]`, `╯` at `[x+w−1,y+3,1,1]`.

All four corners and both complete side strokes carry the node's tabled color. Top and bottom horizontal strokes also carry that color **except the two explicitly located neutral cells per node**, RGB `(146,131,116)`. Those exceptions are still `─` glyphs, not gaps or arrows. No corner or side is absent. The second interior row is blank. Node labels and edge labels use cream `(235,219,178)`; ordinary stems and arrowheads use muted `(124,111,100)`; animated dots use amber `(216,166,87)`. Unselected outlines are non-bold. Selected outlines are bold as described above, including their neutral cells; other nodes retain their normal attributes.

For example, the selected middle box common to all views has top `[33,23,13,1]`, bottom `[33,26,13,1]`, left `[33,24,1,2]`, right `[45,24,1,2]`, and corners `[33,23,1,1]`, `[45,23,1,1]`, `[33,26,1,1]`, `[45,26,1,1]`. Its color exception cells are `[39,23,1,1]` and `[39,26,1,1]`.

## Animation evidence and limits

The four timestamped frames show dots changing occupied cells while graph geometry, text, and arrowheads stay fixed. All visible relations in a given frame have the same relative dot phase. No dots appear off the traced edge corridors.

Exact dot locations are tabulated below. **Each listed row `r` means the single-cell rectangle `[34,r,1,1]`**; there are no other dot columns.

| View / capture | Dot rows |
|---|---|
| 01 frame-01 | 13, 21, 29, 37 |
| 01 frame-02 | 12, 13, 20, 21, 28, 29, 36, 37 |
| 01 frame-03 | 12, 20, 28, 36 |
| 01 frame-04 | 13, 21, 29, 37 |
| 01 unselected | 13, 21, 29, 37 |
| 01 selected-tab | 12, 13, 20, 21, 28, 29, 36, 37 |
| 01 selected-right | 13, 21, 29, 37 |
| 01 selected-after-frames | 13, 21, 29, 37 |
| 02 frame-01 | 21, 29 |
| 02 frame-02 | 20, 21, 28, 29 |
| 02 frame-03 | 20, 28 |
| 02 frame-04 | 21, 29 |
| 02 unselected | 21, 29 |
| 02 selected-tab | 20, 28 |
| 02 selected-right | 21, 29 |
| 02 selected-after-frames | 21, 29 |
| 03 frame-01 | 21, 29 |
| 03 frame-02 | 20, 21, 28, 29 |
| 03 frame-03 | 20, 28 |
| 03 frame-04 | 20, 28 |
| 03 unselected | 21, 29 |
| 03 selected-tab | 20, 21, 28, 29 |
| 03 selected-right | 21, 29 |
| 03 selected-after-frames | 21, 29 |

Some frames show two adjacent dots per edge, not a single point. In views 01 and 02, the chronological samples go lower-only → both → upper-only → lower-only. View 03 ends upper-only in frame-04 and is lower-only by the later unselected capture. This establishes temporal change/recurrence. With samples two to three seconds apart on four-cell corridors, it does **not** establish continuous direction, speed, smoothness, or a unique tracked particle. The arrows indicate downward graph direction; I do not treat that as proof of downward dot motion. The selected-tab and selected-right samples differ in dot occupancy, so temporal activity remains visible across selected-state captures. The immediate `selected-after-frames` text is identical to `selected-right` in each view and does not, by itself, add a new motion sample.

## Visible conceptual structure and remaining unknowns

- Each capture presents one isolated, linear top-to-bottom chain, not a simultaneously visible branching network. View 01 reads as a sequence of named network/application components. Views 02 and 03 each show a cache-mediated continuation to DB tier.
- Repeated labels suggest that Core switch, Web tier, Redis cache, and DB tier refer to related concepts across captures. That is a label-based inference, not proof of shared hidden node identity. I do not infer any link that is absent from these visible traces.
- There are no group boxes, swimlanes, layer names, legends, or scenario-specific headings. The only visible grouping is sequential placement and differently colored node outlines. A multi-view union could suggest branches, but those branches are not shown together in any capture.
- Normal colors do not remain attached to the same named concept across all views: Core switch is pink in view 01 but amber in view 02; Web tier is green in view 01 but amber in view 03; DB tier is blue in view 01 but pink in views 02/03. Redis cache is teal in both views where it appears. The colors visually distinguish positions/nodes within a view, but a stable semantic grouping or layer-color legend is not recoverable from this evidence alone.
- All visible links listed above have locally unambiguous source/target adjacency and downward arrowheads. There are no additional visible links to classify. Hidden/offscreen links, intended topology, intended `fill` semantics, and completeness relative to any source remain unknown.
- Measured terminal fit is supported; numerical natural-100% zoom and continuous animation direction/speed remain unverified from the allowed evidence.

**Stage A stops here. No source comparison, correctness score, or full rubric verdict is made.**
