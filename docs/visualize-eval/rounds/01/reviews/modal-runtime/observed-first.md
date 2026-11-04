# ASTRA blind observations — modal-runtime, round01, Stage A

## Scope and method

Observed first; no expected graph/spec comparison and no full rubric verdict. I inspected only the permitted final captures and the three measured terminal-dimension files. I did not inspect source specifications, renderer code, generation reports, audit helpers, prior variants, or prior rounds. No pane/session operations or fixes were performed.

Capture root: `docs/visualize-eval/rounds/01/modal-runtime/captures/`.

Exact files inspected:

- `overview.text.none.txt`, `overview.ansi.none.txt`, `overview.text.sel-tab.txt`, `overview.ansi.sel-tab.txt`, `overview.text.sel-right.txt`, `overview.ansi.sel-right.txt`.
- `seams.text.none.txt`, `seams.ansi.none.txt`, `seams.text.sel-tab.txt`, `seams.ansi.sel-tab.txt`, `seams.text.sel-right.txt`, `seams.ansi.sel-right.txt`.
- `execution.text.none.txt`, `execution.ansi.none.txt`, `execution.text.sel-tab.txt`, `execution.ansi.sel-tab.txt`, `execution.text.sel-right.txt`, `execution.ansi.sel-right.txt`.

Dimension files under `docs/visualize-eval/rounds/01/modal-runtime/evidence/`: `overview.tty-size.txt`, `seams.tty-size.txt`, `execution.tty-size.txt`. Each contains `47 77`, interpreted as 47 rows by 77 columns. Independently decoding each ANSI capture gives exactly 47 rows of 77 cells. Plain-text captures have 46 lines; their omitted last row is blank. After removing terminal trailing-space/blank-row padding, each ANSI character grid exactly matches its corresponding text capture.

All rectangles below are **1-based [column,row,width,height]**, including arrowheads and single-cell stems. Within a family the three text grids are identical; all geometry observations therefore apply to its `.text.none.txt`, `.text.sel-tab.txt`, and `.text.sel-right.txt`, and to the character grids of the three corresponding ANSI files. Color observations come from the ANSI files, independently parsed as SGR-colored cells with a small local Python program run through uv. No generator-computed audits were used.

## Common visual observations

- Every graph node has a four-row rounded rectangle: continuous top and bottom, two intact vertical side cells on each side, and all four corners `╭ ╮ ╰ ╯`. I checked the actual perimeter characters in all nine ANSI captures. No node-border hole or corner substitution is visible. For every node rectangle `[x,y,w,4]` listed below, the four sides occupy `[x,y,w,1]`, `[x,y+3,w,1]`, `[x,y,1,4]`, and `[x+w-1,y,1,4]`; the corners are their intersections. This specifies all side/corner locations without treating an enclosing rectangle as proof by itself.
- Node names and edge texts are single-line, cream RGB `(235,219,178)` on charcoal `(40,40,40)`. Node-name rows touch the inside of both side borders without extra horizontal padding. No graph label is visibly truncated.
- All visible edge segments, bends, source stems, and target arrowheads are muted RGB `(124,111,100)`. No colored port/handle glyph is separately visible. Stems abut intact borders; edges do not replace border cells. Arrowheads are outside the target boxes and point toward them.
- The controls are a separate square-cornered box `[2,41,9,6]`, complete on all four sides. Border RGB `(168,153,104)`. Visible strings: `+ [+]` at `[4,42,5,1]`, `− [-]` at `[4,43,5,1]`, `⊡ [f]` at `[4,44,5,1]`, `□ [i]` at `[4,45,5,1]`. They do not overlap any graph.
- There are no visible edge-edge crossings, shared line runs, T-junctions, or false extra branches in the traced geometry. Adjacent outgoing stems are distinct, separated by one blank column. Labels can nevertheless make the *association* of an edge name ambiguous, as detailed below.
- No conditional `true`/`false` labels or decision diamonds appear. No untraced dangling line or unassigned arrowhead remains after the paths below are accounted for.
- The requested target is 77×47 at 100%. The dimensions are supported by the supplied files and decoded cell grids. The captures contain no visible zoom percentage, so **100% zoom itself is not independently established** by these captures.

## Overview

Evidence: `overview.text.none.txt` and `overview.ansi.none.txt`, with the corresponding `sel-tab` and `sel-right` final files for unchanged geometry and selection changes.

### Visible nodes, labels, borders, and base colors

| Node name | Complete border rectangle | Name rectangle | Border RGB in `overview.ansi.none.txt` |
|---|---|---|---|
| modal-worker | [11,6,14,4] | [12,7,12,1] | (216,166,87), amber |
| modal-runtime | [10,14,15,4] | [11,15,13,1] | (125,174,163), teal |
| Task engine | [11,22,13,4] | [12,23,11,1] | (211,134,155), pink |
| Container backend | [8,31,19,4] | [9,32,17,1] | (169,182,101), green |
| Filesystem + volumes | [31,31,22,4] | [32,32,20,1] | (189,201,124), lighter green |
| modal-daemon | [57,31,14,4] | [58,32,12,1] | (143,157,79), darker green |
| Task container | [34,39,16,4] | [35,40,14,1] | (125,160,184), blue |
| Blobnet | [60,39,9,4] | [61,40,7,1] | (151,184,206), lighter blue |

Every listed base color is uniform around all four sides and corners of that node, not merely its top edge. Node text remains cream, not border-colored.

### Independently traced directed links

The endpoints/directions below are recoverable from continuous lines and arrowheads, separately from the label association.

| Visible source → target | Source stem | Intermediate route rectangles | Target head |
|---|---|---|---|
| modal-worker → modal-runtime | [12,10,1,2] | turn [11,12,2,1] | `▼` [11,13,1,1] |
| modal-runtime → modal-worker | [25,15,1,1] | return up column 26, [26,7,1,9], with bends at its ends | `◀` [25,7,1,1] |
| modal-runtime → Task engine | [11,18,1,2] | turn [11,20,2,1] | `▼` [12,21,1,1] |
| modal-runtime → modal-daemon | [13,18,1,1] | horizontal turn/run [13,19,46,1], vertical [58,20,1,10] | `▼` [58,30,1,1] |
| Task engine → Container backend | [12,26,1,3] | left turn/run [9,29,4,1] | `▼` [9,30,1,1] |
| Task engine → Filesystem + volumes | [14,26,1,3] | right turn/run [14,29,19,1] | `▼` [32,30,1,1] |
| Container backend → Task container | [9,35,1,2] | right turn/run [9,37,27,1] | `▼` [35,38,1,1] |
| Filesystem + volumes → Blobnet | [32,35,1,1] | right turn/run [32,36,30,1], then [61,37,1,1] | `▼` [61,38,1,1] |

All eight arrowheads are visible. The two top links are a cycle with distinct paths, not a bidirectional line with a shared stem. modal-runtime has two separate downward exits plus its right-hand return exit. Task engine has two separate downward exits. modal-daemon has no visible outgoing edge.

### Every edge-text label and its association

| Visible text | Rectangle | Blind association |
|---|---|---|
| control gRPC | [14,11,12,1] | Likely worker → runtime, beside its outgoing stem. Its last letter directly abuts the opposite-direction return line at [26,11,1,1], so local visual association is not completely isolated. |
| events gRPC | [28,11,11,1] | Clearer association to runtime → worker, on the right of the return line. |
| fs HTTP over UDS | [27,18,16,1] | Clearly above the long runtime → daemon horizontal run. |
| task dispatch | [14,20,13,1] | Beside runtime → Task engine's short bend/head approach. |
| mount/snapshot | [16,28,14,1] | Above Task engine → Filesystem + volumes' long horizontal run. |
| starts/manages | [14,30,14,1] | **Ambiguous from placement alone.** It is to the right of the Container backend head, but directly below the Filesystem horizontal run, between the two heads. The source/target links themselves are clear; this label's unique edge association is not. |
| runs process | [16,36,12,1] | Above the Container backend → Task container run. |
| image/vol data | [39,35,14,1] | Above the Filesystem + volumes → Blobnet run. |

The `starts/manages` placement could suggest another label on the filesystem branch; I do not resolve that ambiguity using assumed domain meaning.

### Selection, grouping, and fit

- In `overview.ansi.sel-tab.txt`, only Container backend's entire perimeter `[8,31,19,4]` changes: all 42 border cells become bold amber `(216,166,87)`. Its label, interior, incoming head, outgoing stem, and all other cells remain unchanged.
- In `overview.ansi.sel-right.txt`, only Filesystem + volumes' entire perimeter `[31,31,22,4]` differs from `none`: all 48 border cells become the same bold amber. Container backend is back to its base color. No mixed selected/unselected border patches or separately colored handles appear.
- Selection uses the same RGB as the unselected modal-worker's base border; boldness distinguishes the selected outline. The selected border loses its prior green hue, consistently over the complete perimeter.
- Apparent grouping: a vertical control chain on the left; a same-row green tier of Container backend, Filesystem + volumes, and modal-daemon; and a blue bottom tier of Task container and Blobnet. This is layout/color grouping only: there are no visible group names or enclosing group boxes. The daemon's same-row green grouping with the two engine children does not mean it is linked from the engine; its actual stem comes from runtime.
- Graph extent including node rectangles and edge labels is `[8,6,63,37]` (through column 70, row 42). It fits inside the measured pane with no clipped graph border, head, or label. Lower nodes sit beside but not behind the controls.
- Header text occupies row 1: `rataflow-view · overview.json · 8 nodes · 8 edges · 0 flows · drag pan · scr`, with a leading blank at column 1. This is visible UI text, not independent source truth. The trailing `scr` at `[75,1,3,1]` is cut at the pane edge; the graph itself is not cut.

## Seams

Evidence: `seams.text.none.txt`, `seams.ansi.none.txt`, and their final `sel-tab` / `sel-right` counterparts.

### Visible nodes, labels, borders, and base colors

| Node name | Complete border rectangle | Name rectangle | Border RGB in `seams.ansi.none.txt` |
|---|---|---|---|
| modal-worker | [24,15,14,4] | [25,16,12,1] | (216,166,87), amber |
| modal-runtime | [23,23,15,4] | [24,24,13,1] | (125,174,163), teal |
| modal-daemon | [24,31,14,4] | [25,32,12,1] | (211,134,155), pink |
| Task engine | [42,31,13,4] | [43,32,11,1] | (226,156,175), lighter pink |

Every perimeter is complete and uniformly colored, including all corners. Node text is cream.

### Independently traced directed links

| Visible source → target | Source stem | Intermediate route rectangles | Target head |
|---|---|---|---|
| modal-worker → modal-runtime | [25,19,1,2] | turn [24,21,2,1] | `▼` [24,22,1,1] |
| modal-runtime → modal-worker | [38,24,1,1] | return [39,16,1,9], with bends at its ends | `◀` [38,16,1,1] |
| modal-runtime → modal-daemon | [24,27,1,2] | turn [24,29,2,1] | `▼` [25,30,1,1] |
| modal-runtime → Task engine | [26,27,1,1] | turn/run [26,28,18,1], then [43,29,1,1] | `▼` [43,30,1,1] |

Four distinct paths, four visible target heads. No edge between daemon and engine, and no extra branch at the parallel runtime stems. Worker/runtime again have separate opposite-direction paths.

### Every edge-text label and its association

| Visible text | Rectangle | Blind association |
|---|---|---|
| control gRPC | [27,20,12,1] | Likely worker → runtime. Last letter directly abuts the return line at [39,20,1,1], as in overview. |
| events gRPC | [41,20,11,1] | Beside runtime → worker's return line. |
| task dispatch | [28,27,13,1] | Above runtime → Task engine's horizontal run. |
| fs HTTP over UDS | [27,29,16,1] | **Not uniquely associated by local placement.** It begins beside runtime → daemon's bend but lies below the runtime → Task engine run and ends immediately against that branch's vertical segment at [43,29,1,1]. A daemon association is plausible; a clear exclusive visual attachment is absent. |

I keep the filesystem-text association ambiguous rather than transferring overview meaning into this subview.

### Selection, grouping, and fit

- `seams.ansi.sel-tab.txt`: only modal-daemon's complete perimeter `[24,31,14,4]` changes, all 32 cells to bold amber `(216,166,87)`.
- `seams.ansi.sel-right.txt`: only Task engine's complete perimeter `[42,31,13,4]` differs from `none`, all 30 cells to bold amber. Daemon returns to base pink. No characters change; stems/heads retain their muted edge color.
- Apparent grouping is worker above runtime above a pair of pink leaves. No group boundary or category text is shown.
- Graph extent `[23,15,32,20]` (through column 54, row 34) fits with substantial whitespace. The rightmost edge-text `events gRPC` ends at column 51 and remains inside that extent.
- Header at row 1 reads `rataflow-view · seams.json · 4 nodes · 4 edges · 0 flows · drag pan · scroll`, after the leading blank. `scroll` occupies `[72,1,6,1]` through column 77. Whether any further help text existed outside the pane is unknown.

## Execution

Evidence: `execution.text.none.txt`, `execution.ansi.none.txt`, and their final `sel-tab` / `sel-right` counterparts.

### Visible nodes, labels, borders, and base colors

| Node name | Complete border rectangle | Name rectangle | Border RGB in `execution.ansi.none.txt` |
|---|---|---|---|
| Task engine | [20,15,13,4] | [21,16,11,1] | (216,166,87), amber |
| Container backend | [17,23,19,4] | [18,24,17,1] | (125,174,163), teal |
| Filesystem + volumes | [40,23,22,4] | [41,24,20,1] | (147,194,183), lighter teal |
| Task container | [19,31,16,4] | [20,32,14,1] | (211,134,155), pink |
| Blobnet | [47,31,9,4] | [48,32,7,1] | (226,156,175), lighter pink |

All four sides and corners are present with one consistent border RGB per unselected node; labels are cream.

### Independently traced directed links

| Visible source → target | Source stem | Intermediate route rectangles | Target head |
|---|---|---|---|
| Task engine → Container backend | [21,19,1,2] | turn/run [18,21,4,1] | `▼` [18,22,1,1] |
| Task engine → Filesystem + volumes | [23,19,1,2] | turn/run [23,21,19,1] | `▼` [41,22,1,1] |
| Container backend → Task container | [18,27,1,2] | turn/run [18,29,3,1] | `▼` [20,30,1,1] |
| Filesystem + volumes → Blobnet | [41,27,1,2] | turn/run [41,29,8,1] | `▼` [48,30,1,1] |

All four heads point down into their respective targets. There is no shared outgoing stem at engine and no cross-link between the two lower branches.

### Every edge-text label and its association

| Visible text | Rectangle | Blind association |
|---|---|---|
| mount/snapshot | [25,20,14,1] | Above Task engine → Filesystem + volumes' horizontal run. |
| starts/manages | [23,22,14,1] | **Ambiguous**, just as in overview: between the two heads, to the right of the backend head but directly below the filesystem run. Endpoint topology is clear; unique label assignment is not. |
| runs process | [20,27,12,1] | Beside Container backend's outgoing stem toward Task container. |
| image/vol data | [26,28,14,1] | Likely Filesystem + volumes → Blobnet, ending one blank column before its outgoing stem at [41,28,1,1]. It is positioned left of that stem, between the two vertical paths, rather than over its short horizontal run. More weakly attached than the overview placement. |

### Selection, grouping, and fit

- `execution.ansi.sel-tab.txt`: only Container backend's full perimeter `[17,23,19,4]` changes; all 42 cells become bold amber `(216,166,87)`.
- `execution.ansi.sel-right.txt`: only Task container's full perimeter `[19,31,16,4]` differs from `none`; all 36 cells become bold amber. Container backend reverts to teal. Thus the capture named `sel-right` highlights the *lower Task container*, not the same-row Filesystem + volumes. This records the observed state, not an assumed navigation rule.
- As elsewhere, the selected perimeter changes uniformly, while text, stems, heads, and background do not. No visible special handles.
- Apparent grouping: amber root, teal middle pair, pink lower pair; two descending branches. No enclosing group or group label.
- Graph extent `[17,15,45,20]` (through column 61, row 34) fits fully. All names, bends, arrowheads, and borders are inside the pane and clear of the controls.
- Header at row 1 reads `rataflow-view · execution.json · 5 nodes · 4 edges · 0 flows · drag pan · sc`, after the leading blank. Trailing `sc` at `[76,1,2,1]` is visibly cut at the right edge.

## Cross-capture color and animation limits

- Within each individual capture, every node has a consistent perimeter hue, including selected corners; there are no isolated differently colored handle cells. Selection replaces the whole border hue with bold amber, not a mixture of old and new colors.
- Base hues are **not stable identities across views**. Task engine is pink in overview, lighter pink in seams, and amber in execution. Container backend and Filesystem + volumes are green-family in overview but teal-family in execution. Task container and Blobnet are blue-family in overview but pink-family in execution. modal-daemon is green in overview and pink in seams. Worker and runtime retain their amber/teal colors in overview and seams. The apparent scheme follows local visual tiers rather than a persistent component identity; the captures do not contain a legend to establish intended semantics.
- Across `none`, `sel-tab`, and `sel-right`, geometry and all characters remain identical. Only the selected node's perimeter SGR color/boldness changes as described. There is no dot displacement or other visible animation sample.
- All three headers visibly say `0 flows`; no moving-dot glyph is visible on any path. These are still captures, not timed animation evidence. **Animation presence, speed, smoothness, or absence at other times remains unknown.** I cannot establish a live animation from them.

## Blind-stage summary (not a rubric verdict)

I can trace 8 directed links in overview, 4 in seams, and 4 in execution without inventing crossings or branch junctions. Every graph node, node label, source stem, target head, and complete four-sided border fits in the measured 77×47 cell grids. Graph labels are readable; some header help text is clipped. The principal unresolved issue is label-to-edge association, especially `starts/manages` in overview/execution and `fs HTTP over UDS` in seams. Border selection is internally consistent, but base node hues change between views and overlap the selection hue. No animation is evidenced by these stills. These observations are frozen before any expected source/spec reveal.
