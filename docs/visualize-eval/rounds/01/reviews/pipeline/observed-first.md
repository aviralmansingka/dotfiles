# Pipeline — round 01 — blind Stage A observation

This is an observation of saved terminal captures, not a source/spec comparison or a full rubric pass. I did not generate this diagram. I read AGENTS.md and the visualize and ponytail skills. I inspected only this case's capture directory for diagram evidence; no specs, briefs, expected data, reports, check output, renderer code, other cases, or prior rounds were consulted. ANSI colors below come from inspecting captured SGR sequences and independently decoding character cells, not generator conclusions.

## Evidence and coordinate convention

Directory: `docs/visualize-eval/rounds/01/pipeline/captures/`. All filenames below are relative to it. Coordinates are 1-based `[column,row,width,height]` in the terminal capture, **excluding** the leading `#` metadata line in text captures. Row 1 is the application header. ANSI files have no metadata row.

Primary evidence: `view1-visible.txt` (2026-11-02T08:27:04Z), `view1-ansi-unselected.txt`, `view1-selected1-visible.txt` (08:27:07Z), `view1-selected1-ansi.txt`, `view1-selected2-visible.txt` (08:27:16Z), and `view1-selected2-ansi.txt`. Animation: `view1-frame1.txt` through `view1-frame4.txt` (08:26:36/38/40/42Z) and `view1-live-frame1.txt` through `view1-live-frame3.txt` (08:27:30/32/34Z). I also inspected the saved attempt1 text/ANSI, attempt2 text, attempt3 text, all three dimension files, and `view1-timestamps.txt`.

`view1-dims.txt`, `view1-attempt2-dims.txt`, and `view1-attempt3-dims.txt` each contain `47 77`: 47 rows, 77 columns. Primary text metadata agrees. Independently decoded primary unselected and both selected ANSI captures each contain exactly 47 rows of 77 cells. Thus actual captured size matches the requested **77 columns × 47 rows**. The images do not display a numeric zoom value; **100% zoom is not independently established by these captures**. No zoom or pane operation was performed during this review.

## What the primary display says

Six readable nodes, arranged as a downward process with two branches and a shared lower destination. Labels and their full box bounds in `view1-visible.txt` and the primary ANSI files:

| Node | Label rectangle | Complete box rectangle |
|---|---|---|
| CLI | [37,8,3,1] | [36,7,5,4] |
| API gateway | [37,16,11,1] | [36,15,13,4] |
| Job queue | [24,24,9,1] | [23,23,11,4] |
| Auth | [50,24,4,1] | [49,23,6,4] |
| Worker pool | [24,32,11,1] | [23,31,13,4] |
| Postgres | [37,40,8,1] | [36,39,10,4] |

Every label is intact. The upper-centered CLI leads to API gateway. Job queue is below-left of the gateway, Auth below-right. Worker pool follows Job queue. Postgres is below and between the two branches. This suggests a request entry point, a queue/worker branch, a parallel authentication branch, and a common database destination. This is the interpretation suggested by spatial grouping and words, not a claim about intended system semantics.

### Apparent links, inferred by tracing visible lines and arrows

All six have downward `▼` arrowheads; none has a reverse arrow. Edge labels in this table are the complete visible edge-label inventory.

| Apparent relationship | Label rectangle | Visible path and attachment evidence |
|---|---|---|
| CLI → API gateway | request [39,12,7,1] | Stem [37,11,1,3], arrow [37,14,1,1], immediately above gateway top row 15. Stem begins immediately below CLI bottom row 10. |
| API gateway → Job queue | enqueue [28,20,7,1] | Stem [37,19,1,2], left-going run [24,21,14,1], arrow [24,22,1,1] above queue top row 23. |
| API gateway → Auth | verify [41,20,6,1] | Separate stem [39,19,1,2], right-going run [39,21,12,1], arrow [50,22,1,1] above Auth top row 23. |
| Job queue → Worker pool | dispatch [26,28,8,1] | Stem [24,27,1,3], arrow [24,30,1,1] immediately above worker top row 31. |
| Worker pool → Postgres | write [28,36,5,1] | Stem [24,35,1,2], right-going run [24,37,14,1], arrow [37,38,1,1] above Postgres top row 39. |
| Auth → Postgres | read [43,36,4,1] | Long stem [50,27,1,10], left-going run [39,37,12,1], arrow [39,38,1,1] above Postgres top row 39. |

In particular, the display points **Auth toward Postgres**, even though the word `read` could describe a request or the opposite direction of returned data. I do not reverse that arrow based on the endpoint names.

All source stems adjoin a bottom border on the next row; all arrow tips adjoin a target's top border on the next row. No floating endpoint gap is visible. Attachments are near each box's left interior column, rather than centered, but still fall within the box width. Borders retain their horizontal strokes at the attachment locations; there are no junction/port dots on the box outlines.

There are **no observed crossings or false branch junctions** in the primary layout. Gateway's two outputs have a blank separating cell at column 38 on rows 19–21. The two lower incoming routes likewise remain separate at [38,37,1,2]. The long Auth route stays at column 50, clear of Worker pool's right border at column 35. Its adjacent region [36,31,14,4] is empty. Therefore I can trace all six relationships without using the header's claimed edge count to fill gaps. No additional relationship is legible or implied by a connected line.

Labels have clear route association: enqueue/verify sit over their respective horizontal runs; write/read sit over their respective lower runs; request/dispatch sit next to isolated vertical stems. None touches a box or overwrites a line. Dots sometimes replace corners, making a single-frame turn less explicit: [50,21,1,1] in the unselected capture, and [24,21,1,1] and [37,37,1,1] in selected2. The adjacent arrow/stem still identifies the route, and other captures restore those corners.

## Border completeness, colors, selection, and handles

The following describes **all four sides and all four corners**, not just label text or top-edge samples. For each row, top and bottom rectangles include their corner cells; left/right rectangles list the two intervening vertical cells. The four corners are the endpoints of those top/bottom rectangles and are visible as `╭ ╮ ╰ ╯`. No side has a missing cell. These exact shapes persist in both selected captures.

| Node | Top; bottom | Left; right | Unselected RGB / apparent hue |
|---|---|---|---|
| CLI | [36,7,5,1]; [36,10,5,1] | [36,8,1,2]; [40,8,1,2] | (216,166,87), warm gold |
| API gateway | [36,15,13,1]; [36,18,13,1] | [36,16,1,2]; [48,16,1,2] | (125,174,163), muted aqua |
| Job queue | [23,23,11,1]; [23,26,11,1] | [23,24,1,2]; [33,24,1,2] | (211,134,155), pink |
| Auth | [49,23,6,1]; [49,26,6,1] | [49,24,1,2]; [54,24,1,2] | (226,156,175), lighter pink |
| Worker pool | [23,31,13,1]; [23,34,13,1] | [23,32,1,2]; [35,32,1,2] | (169,182,101), muted green |
| Postgres | [36,39,10,1]; [36,42,10,1] | [36,40,1,2]; [45,40,1,2] | (125,160,184), muted blue |

Independent cell inspection found one uniform unselected foreground color per entire node perimeter (respectively 14, 30, 26, 16, 30, and 24 cells), no bold. Background and box interiors are RGB (40,40,40). All node/edge labels are cream (235,219,178). Edges and arrowheads are muted brown-gray (124,111,100); flow dots are gold (216,166,87).

In `view1-selected1-ansi.txt`, **all 30 API gateway perimeter cells** turn gold (216,166,87) and bold. In `view1-selected2-ansi.txt`, **all 16 Auth perimeter cells** turn gold and bold, and gateway reverts to aqua/nonbold. Every other node keeps its unselected perimeter color in each capture. Text labels remain cream; no label gets swallowed or clipped. Plain selected text captures do not expose the selection: their geometry and node glyphs remain unchanged.

No separate resize/connection handles are visible on or around any node in these primary captures, selected or otherwise. There are no colored handle remnants interrupting side/corner colors. The ordinary unselected CLI already uses the **same RGB gold as selection and flow dots**; selected nodes differ through bold plus color change, but color alone is not exclusive to selection.

Spatial rows and color together suggest five levels: CLI, gateway, the pink queue/Auth pair, Worker pool, Postgres. The pink pair appears coordinated despite different labels/functions. No enclosing group boxes, legend, or explicit group labels are visible. Color semantics beyond this apparent same-level grouping are unknown.

## Fit and surrounding UI

The primary graph including its labels fits inside [23,7,32,36], ending at column 54 and row 42. All six boxes and six arrows are visible, with ample lateral space and bottom margin. No graph content intersects the lower-left control palette [2,41,9,6]. The palette has a complete rectangular outline and the visible controls `+ [+]`, `− [-]`, `⊡ [f]`, `□ [i]`. There is no visible overflow warning or clipped node label.

The application header at row 1 reads `rataflow-view · view1.json · 6 nodes · 6 edges · 6 flows · drag pan · scroll` (with leading space). These counts are UI text, not independent evidence of correctness. There is no on-screen title explaining what the pipeline is, and no numeric zoom readout.

## Animation observations and limits

Both timestamped series show changing gold-dot positions while the boxes, labels, routes, and arrowheads remain fixed. The following are representative single-cell rectangles, not conclusions from a flow-speed field:

- `view1-frame1.txt` at 08:26:36Z: long Auth stem dot [50,33,1,1]; enqueue dots [26,21,1,1] and [33,21,1,1]; write dots [28,37,1,1] and [35,37,1,1].
- `view1-frame2.txt` at 08:26:38Z: Auth stem [50,30,1,1]; enqueue [29,21,1,1], [36,21,1,1]; write [25,37,1,1], [32,37,1,1].
- `view1-frame3.txt` at 08:26:40Z: Auth stem [50,34,1,1]; enqueue [25,21,1,1], [32,21,1,1]; write [29,37,1,1], [36,37,1,1].
- `view1-frame4.txt` at 08:26:42Z: Auth stem [50,31,1,1]; enqueue [28,21,1,1], [35,21,1,1]; write [26,37,1,1], [33,37,1,1].
- `view1-live-frame1.txt` at 08:27:30Z: Auth stem [50,28,1,1] and [50,35,1,1]; verify [45,21,1,1].
- `view1-live-frame2.txt` at 08:27:32Z: Auth stem [50,32,1,1]; verify [42,21,1,1], [49,21,1,1].
- `view1-live-frame3.txt` at 08:27:34Z: Auth stem [50,29,1,1], [50,36,1,1]; verify [39,21,1,1], [46,21,1,1].

The seven-cell spacing on long runs makes these two-second samples **direction-aliased**. For example, frame2→frame3 can be read as enqueue left four cells, write right four cells, Auth down four cells, consistent with the arrows; periodic dots also permit the opposite three-cell phase shift. Thus movement is observed, and source→target movement is plausible, but **dot travel direction and smooth/slow perceived animation are not uniquely proven** by these sparse stills. Direction of the drawn arrows is unambiguous.

Short stems sometimes show adjacent dots: request [37,12,1,2] and dispatch [24,28,1,2] in frame1/frame4 and live-frame3. These occupy two of the three pre-arrow cells; the arrow stays visible. Dots sometimes mask elbows but do not mask text or node outlines. The live-frame metadata claims Worker pool selection; those files are plain text, so that claim cannot independently establish Worker pool's selected color.

## Other captures in this directory

Attempts are not silently conflated with the primary view. `view1-attempt3-visible.txt` (08:26:18Z) and the earlier timestamped frame series share the primary layout. `view1-attempt1-visible.txt`/`view1-attempt1-ansi.txt` (08:24:53Z) and `view1-attempt2-visible.txt` (08:26:05Z) show different placements: Auth left, Job queue right, Worker pool below the right branch. For example their Auth box is [28,23,6,4], queue [42,23,11,4], worker [41,31,13,4]. Attempt1 has Postgres [26,39,10,4], whereas attempt2 has it at [43,39,10,4]. All six node labels and the same six apparent named relationships remain traceable in these alternatives. They are saved alternate render evidence, not the basis for the primary coordinates/color table or a reason to infer invisible relationships.

## Blind-stage conclusion

The primary capture is a readable six-node, two-branch downward graph with six traceable labeled arrows, complete borders, clear label association, no observed crossings/shared junctions, and full fit at the captured 77×47 dimensions. Selection is visible in ANSI as whole-border gold/bold changes; the unselected CLI shares that gold hue. Dots move between timestamped samples and sometimes cover elbows; sparse sampling cannot uniquely establish motion direction or cadence. Natural 100% zoom is not explicitly shown. No expected-content correctness or full pass is claimed. This record is frozen for a later Stage B comparison.
