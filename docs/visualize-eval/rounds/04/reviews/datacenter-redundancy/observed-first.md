# Datacenter redundancy — stage A blind observation

This record uses only the four final specs and their saved evidence captures, ANSI selected captures, checks, and manifests. No source, expectations, rubric, dataset manifest, earlier round, attempt logs, preflight logs, or probe candidates were read. No viewer was launched. This is an observation record, not an expectations-based score.

Coordinates are 1-based terminal cells, including the title row: rectangles are `[column,row,width,height]`; route vertices are `(column,row)`. Each table row is one occurrence, not a deduplicated concept. ANSI SGR was decoded to inspect every saved normal and selected cell. All four plain-text captures agree with their normal ANSI captures after stripping ANSI and trailing spaces. All four selected captures have exactly the same character geometry as the normal captures.

## Evidence integrity and limitations

Independently obtained with `shasum -a 256`:

| Final spec | SHA-256 | Matches its evidence manifest |
|---|---|---|
| specs/v1.json | f6d20a5ffb5ec6d4452a49df144762a7a102f0c6e284a97b4a4e7ea859818c67 | yes |
| specs/v2.json | 31050fecd83fd229ce45507503fa20878de66ca1c37d92590f4d4376f47d4ade | yes |
| specs/v3.json | e9333a549c32be67377ed247a4ffb080dd6c30a32c1d3902b6c7d281510ad65b | yes |
| specs/v4.json | 073654cac1f354f54b2841c5474b154aafda8984cab35cea2c2d1131ce169c49 | yes |

All five artifact hashes listed in each view's manifest match the corresponding files: bin.sha256, check.txt, text, normal ANSI, and selected ANSI. The manifests record binary SHA-256 `0da16d8d8ed46e2a25eb773fc71ecad4de9e310cd33e303a4c7fe77231ad95bc`. The executable was not run or independently rehashed. The manifests say `cleanup: confirmed_closed`; that is a saved assertion, not a new live-pane observation.

**There are no frame dumps in this bundle.** Each manifest has `frames: null`. Only one normal and one all-selected ANSI state per view, plus corresponding normal text, are available. These formats were readable. No supplied static capture was unreadable. Frame-by-frame motion, transient dots, direction of animation, speed, spacing, corner/bridge/arrowhead visits, first-frame origin, and synchronized arrival cannot be verified. No motion is expected from the four final specs, which explicitly set every edge's `dots` to zero, but the spec is not a substitute for missing time-series evidence.

## Fit and overall appearance

Every ANSI capture measures **77 columns × 47 rows**, all rows included, and every title says `77x47 @100%`. All diagram labels, arrowheads, borders, and visible routes fit in those saved grids. There is no observed clipped item or label hidden behind the control widget. Nothing visible requires pan or zoom to recover. This proves the saved view, not every possible interactive state.

The exact first line in every check is:

`viewport: unknown zoom: 1.00 natural`

Thus there is **no measured viewport dimension in the check itself**. All four manifests have `viewport_line: null`, `pane_cols: null`, and `pane_rect: null`, alongside `pane_rows: 47` and `viewport_token: "77x47 @100%"`. Capture dimensions and title establish the saved grid; the checks do not independently certify a physical pane rectangle.

| View | Nodes | Arrows | Node labels | Edge labels | Observed bridge glyphs | Reported touching bends | Reported extent | Reported near-minimal routes |
|---|---:|---:|---:|---:|---:|---:|---|---|
| v1 | 8 | 8 | 8 | 4 | 3 | 3 | 64x22 | 8/8 |
| v2 | 6 | 8 | 6 | 8 | 2 | 2 | 64x12 | 8/8 |
| v3 | 8 | 8 | 8 | 8 | 4 | 2 | 65x35 | 8/8 |
| v4 | 4 | 4 | 4 | 4 | 1 | 1 | 43x12 | 4/4 |

Checks report zero detours and zero shortened routes in every view. Most routes are compact orthogonal links. In v3, the left-hand links are conspicuously tall and circuitous in the ordinary visual sense: BL 1 → Spine 2 travels around the right side of Spine 2 and enters leftward; BL 2 → Spine 1 snakes through a long upper-left dogleg. Their coordinates below document this rather than taking `near-minimal` to mean visually direct. The large empty middle of v3 separates the left spine/BL subgraph from the right leaf/rack subgraph. No spine-to-leaf link is visible in v3; those links are drawn in v4. This is an observation about the views, not a statement about omitted source requirements.

## Border and selection conventions

For **each of the 26 node occurrences listed below**, all four sides and all four rounded corners are present, with no arrow, route, or label replacing a border cell. Each perimeter is color-continuous in normal ANSI. The box rectangles specify the complete corners and sides: top-left `╭`, top-right `╮`, bottom-left `╰`, bottom-right `╯`, horizontal `─`, and vertical `│`. There is no split-color border.

Each of those same 26 perimeters is fully captured in its own selected state in the all-selected ANSI capture: bold SGR 1, RGB `(216,166,87)` / `#d8a657`, continuously around its entire border. Selected coverage is therefore **26/26 occurrences**, not just a single selected node. The files capture simultaneous selection, not separate interactive selection histories. Normal gold borders that share the selection hue still visibly change to bold in the selected capture.

## v1 — carriers, MUXes, and cores

### Every diagram label and border

| Label, verbatim | Label rectangle | Box rectangle | Normal border RGB / hex |
|---|---|---|---|
| ISP A | [9,16,5,1] | [8,15,7,4] | 216,166,87 / #d8a657 |
| ISP B | [9,22,5,1] | [8,21,7,4] | 228,184,111 / #e4b86f |
| ISP C | [9,27,5,1] | [8,26,7,4] | 200,147,68 / #c89344 |
| ISP D | [9,32,5,1] | [8,31,7,4] | 239,202,138 / #efca8a |
| MUX 1 | [22,16,5,1] | [21,14,7,5] | 125,174,163 / #7daea3 |
| MUX 2 | [22,22,5,1] | [21,20,7,5] | 147,194,183 / #93c2b7 |
| Core 1 | [64,16,6,1] | [63,14,8,5] | 211,134,155 / #d3869b |
| Core 2 | [64,22,6,1] | [63,20,8,5] | 226,156,175 / #e29caf |
| x-connect | [41,14,9,1] | — | MUX 1 → Core 1 |
| x-connect | [40,18,9,1] | — | MUX 1 → Core 2 |
| x-connect | [39,20,9,1] | — | MUX 2 → Core 1 |
| x-connect | [41,24,9,1] | — | MUX 2 → Core 2 |

All four `x-connect` labels have a distinguishable adjacent horizontal run. No uncertain owner counted here.

### Every visible arrow and route

Vertices include the first cell outside the source box, every bend, and the final arrowhead. Straight segments connect consecutive vertices. All eight routes are solid, end in intact `▶`, and can be followed separately using the bridge convention. No source-side arrowhead is visible.

| Source → target | Route vertices, in source-to-target order | Final direction/head |
|---|---|---|
| ISP A → MUX 1 | (15,16) → (19,16) → (19,15) → (20,15) | right, ▶ |
| ISP B → MUX 1 | (15,22) → (18,22) → (18,17) → (20,17) | right, ▶ |
| ISP C → MUX 2 | (15,27) → (17,27) → (17,21) → (20,21) | right, ▶ |
| ISP D → MUX 2 | (15,32) → (19,32) → (19,23) → (20,23) | right, ▶ |
| MUX 1 → Core 1 | (28,15) → (62,15) | right, ▶ |
| MUX 1 → Core 2 | (28,17) → (60,17) → (60,21) → (62,21) | right, ▶ |
| MUX 2 → Core 1 | (28,21) → (58,21) → (58,18) → (61,18) → (61,17) → (62,17) | right, ▶ |
| MUX 2 → Core 2 | (28,23) → (62,23) | right, ▶ |

### Crossings, touching bends, and apparent branches

The three actual `⌒` cells are **(18,21), (17,22), (60,18)**, matching the reported three bridges.

- (18,21): ISP B → MUX 1 vertical crosses ISP C → MUX 2 horizontal.
- (17,22): ISP C → MUX 2 vertical crosses ISP B → MUX 1 horizontal. These two crossings sit in one extremely tight 2×2 twist: (17,21)=`╭`, (18,21)=`⌒`, (17,22)=`⌒`, (18,22)=`╯`. It can initially look like a joined turn, but the bridges and independent continuations distinguish the two routes.
- (60,18): MUX 1 → Core 2 vertical crosses MUX 2 → Core 1 horizontal. The nearby bend cluster has (60,17)=`╮`, (61,17)=`╭`, (58,18)=`╭`, and (61,18)=`╯`. The consecutive bends at (60,17)/(61,17) are visually touching. The vertical and horizontal continuation remain separately recoverable.

The check reports three touching bends. The two compact carrier contacts and one core contact are visible in the neighborhoods above; the record preserves exact cells rather than asserting an undocumented checker definition for each contact. Every other bend is enumerated by the route table, including the single-row ISP A jog at (19,16)/(19,15). No `┼`, `├`, `┤`, `┬`, or `┴` is visible in graph routes. No actual shared bus or branching junction can be established from these crossings.

## v2 — cores, firewalls, border leaves

### Every diagram label and border

| Label, verbatim | Label rectangle | Box rectangle | Normal border RGB / hex |
|---|---|---|---|
| Core 1 | [9,21,6,1] | [8,19,8,5] | 216,166,87 / #d8a657 |
| Core 2 | [9,27,6,1] | [8,25,8,5] | 228,184,111 / #e4b86f |
| FW1 | [47,21,3,1] | [46,19,5,5] | 125,174,163 / #7daea3 |
| FW2 | [47,27,3,1] | [46,25,5,5] | 147,194,183 / #93c2b7 |
| BL 1 | [66,21,4,1] | [65,19,6,5] | 211,134,155 / #d3869b |
| BL 2 | [66,27,4,1] | [65,25,6,5] | 226,156,175 / #e29caf |
| active | [27,19,6,1] | — | Core 1 → FW1 |
| active | [26,25,6,1] | — | Core 2 → FW1 |
| standby | [25,23,7,1] | — | Core 1 → FW2 |
| standby | [27,29,7,1] | — | Core 2 → FW2 |
| active | [54,19,6,1] | — | FW1 → BL 1 |
| active | [53,23,6,1] | — | FW1 → BL 2 |
| standby | [52,25,7,1] | — | FW2 → BL 1 |
| standby | [54,29,7,1] | — | FW2 → BL 2 |

**All eight repeated `active`/`standby` labels have clear owners in this saved view.** Each lies above or below a distinct horizontal run. They are not just labels on FW1/FW2 as whole boxes. The four standby routes are visibly dashed (`╌` and `╎`, with half-line turn glyphs); the four active routes are solid. The route color stays muted. Dashed styles add a tracing burden at the crowded corners but do not merge the routes.

### Every visible arrow and route

All eight end in intact `▶` pointing right. The dashed corner entries below describe geometric turns even where rendered as half-line glyphs rather than round corners.

| Source → target | Style | Route vertices, in source-to-target order | Whole route traceable |
|---|---|---|---|
| Core 1 → FW1 | solid | (16,20) → (45,20) | yes |
| Core 2 → FW1 | solid | (16,26) → (43,26) → (43,22) → (45,22) | yes |
| Core 1 → FW2 | dashed | (16,22) → (41,22) → (41,25) → (44,25) → (44,26) → (45,26) | yes, interpreting dash turns |
| Core 2 → FW2 | dashed | (16,28) → (45,28) | yes |
| FW1 → BL 1 | solid | (51,20) → (64,20) | yes |
| FW1 → BL 2 | solid | (51,22) → (62,22) → (62,26) → (64,26) | yes |
| FW2 → BL 1 | dashed | (51,26) → (60,26) → (60,23) → (63,23) → (63,22) → (64,22) | yes, interpreting dash turns |
| FW2 → BL 2 | dashed | (51,28) → (64,28) | yes |

### Crossings, touching bends, and apparent branches

The two `⌒` cells are **(43,25), (62,23)**, matching the reported two bridges:

- (43,25): Core 2 → FW1 vertical crosses Core 1 → FW2 dashed horizontal. The tight contact includes (43,26)=`╯`, (44,26)=`╶`, and (44,25)=`╷`. The two arrowheads at (45,22) and (45,26) go to different firewall boxes, not a split at the crossing.
- (62,23): FW1 → BL 2 vertical crosses FW2 → BL 1 dashed horizontal. The tight contact includes (62,22)=`╮`, (63,22)=`╶`, and (63,23)=`╵`. The arrowheads at (64,22) and (64,26) go to different BL boxes.

These are the two compact touching-turn neighborhoods corresponding to the check's two touching bends. Other dashed turn glyphs are (41,22)=`╷`, (41,25)=`╶`, (60,26)=`╵`, and (60,23)=`╶`; all turns are covered in the route table. No graph junction glyph or true shared route segment is visible. The apparent branches in the compact crossover neighborhoods resolve into separate solid and dashed links.

## v3 — spine/BL links and leaf/rack links

### Every diagram label and border

| Label, verbatim | Label rectangle | Box rectangle | Normal border RGB / hex |
|---|---|---|---|
| Spine 1 | [9,10,7,1] | [8,8,9,5] | 216,166,87 / #d8a657 |
| Spine 2 | [26,9,7,1] | [25,8,9,4] | 228,184,111 / #e4b86f |
| BL 1 | [11,29,4,1] | [10,28,6,4] | 125,174,163 / #7daea3 |
| BL 2 | [28,30,4,1] | [27,28,6,5] | 147,194,183 / #93c2b7 |
| Leaf 1 | [47,29,6,1] | [46,28,8,4] | 211,134,155 / #d3869b |
| Leaf 2 | [63,29,6,1] | [62,28,8,4] | 226,156,175 / #e29caf |
| Rack 1 | [47,39,6,1] | [46,38,8,4] | 169,182,101 / #a9b665 |
| Rack 2 | [63,39,6,1] | [62,38,8,4] | 189,201,124 / #bdc97c |
| ECMP | [8,20,4,1] | — | BL 1 → Spine 1, adjacent to the long left route |
| ECMP | [12,21,4,1] | — | BL 2 → Spine 1, adjacent to the vertical at column 17 |
| ECMP | [26,21,4,1] | — | BL 1 → Spine 2, beside the vertical at column 24 |
| ECMP | [17,12,4,1] | — | likely BL 2 → Spine 2; owner visually uncertain, see below |
| dual | [42,34,4,1] | — | Leaf 1 → Rack 1 |
| dual | [54,32,4,1] | — | Leaf 2 → Rack 1 |
| dual | [54,36,4,1] | — | Leaf 1 → Rack 2 |
| dual | [67,34,4,1] | — | Leaf 2 → Rack 2 |

**One label owner is counted uncertain:** `ECMP` at [17,12,4,1]. It begins immediately after Spine 1's bottom-right border cell (16,12), so visually it is glued to that box's bottom border. Its likely route is the vertical at column 22 (BL 2 → Spine 2), two columns beyond the end of the label. However, the BL 2 → Spine 1 dogleg runs at row 14 below this label and turns at column 17; the label itself supplies no leader or route break to establish ownership. The likely one-to-one assignment is recoverable from the other labels, but that is weaker than unambiguous local ownership. The check claims `0 ambiguous owners`; this reader-level concern is not erased by that claim. The other three `ECMP` labels and the four `dual` labels have identifiable adjacent runs.

### Every visible arrow and route

All routes are solid. Four arrows from BL nodes go generally upward toward spines but enter side ports; all four leaf/rack arrows enter downward. No route reverses its declared source and target in the capture.

| Source → target | Route vertices, in source-to-target order | Final direction/head | Whole route traceable |
|---|---|---|---|
| BL 1 → Spine 1 | (9,29) → (5,29) → (5,9) → (7,9) | right, ▶ | yes |
| BL 1 → Spine 2 | (16,29) → (24,29) → (24,13) → (35,13) → (35,9) → (34,9) | left, ◀ | yes, conspicuous wraparound |
| BL 2 → Spine 1 | (26,29) → (25,29) → (25,27) → (17,27) → (17,14) → (6,14) → (6,11) → (7,11) | right, ▶ | yes, conspicuous long dogleg |
| BL 2 → Spine 2 | (26,31) → (22,31) → (22,9) → (24,9) | right, ▶ | yes |
| Leaf 1 → Rack 1 | (47,32) → (47,37) | down, ▼ | yes |
| Leaf 2 → Rack 1 | (63,32) → (63,34) → (62,34) → (62,33) → (50,33) → (50,36) → (49,36) → (49,37) | down, ▼ | yes, multi-turn crossover |
| Leaf 1 → Rack 2 | (49,32) → (49,35) → (63,35) → (63,37) | down, ▼ | yes |
| Leaf 2 → Rack 2 | (65,32) → (65,37) | down, ▼ | yes |

### Crossings, touching bends, and apparent branches

The four `⌒` cells are **(22,27), (24,27), (22,29), (50,35)**, matching the reported four bridges:

- (22,27): BL 2 → Spine 2 vertical crosses BL 2 → Spine 1 horizontal.
- (24,27): BL 1 → Spine 2 vertical crosses BL 2 → Spine 1 horizontal.
- (22,29): BL 2 → Spine 2 vertical crosses BL 1 → Spine 2 horizontal.
- (50,35): Leaf 2 → Rack 1 vertical crosses Leaf 1 → Rack 2 horizontal.

Two conspicuous touching-bend neighborhoods are visible, consistent with the check's two touching bends:

- At row 29, (24,29)=`╯` is immediately beside (25,29)=`╰`, between BL 1's right-side route and BL 2's left-side route. Above this, the two bridges at (22,27)/(24,27) share a crowded horizontal strip ending at (25,27)=`╮`. It can look like a shared spine bus on a quick scan, but the bridge continuations and separate ports disambiguate it.
- In the leaf/rack crossover, (62,34)=`╰` touches (63,34)=`╯`. Nearby (49,35)=`╰`, (50,35)=`⌒`, (49,36)=`╭`, and (50,36)=`╯` make another compact turn/crossing cluster. The separate Rack 1 heads at (47,37)/(49,37) and Rack 2 heads at (63,37)/(65,37) are intact and visibly distinct.

All remaining bends, including (35,13)/(35,9) around Spine 2 and (6,14)/(17,14)/(17,27) in the large left dogleg, are enumerated in the route table. No graph T-junction or four-way junction glyph is visible. The two links entering each rack do not collapse to one drawn trunk.

## v4 — spine-to-leaf mesh

### Every diagram label and border

| Label, verbatim | Label rectangle | Box rectangle | Normal border RGB / hex |
|---|---|---|---|
| Spine 1 | [19,21,7,1] | [18,19,9,5] | 216,166,87 / #d8a657 |
| Spine 2 | [19,27,7,1] | [18,25,9,5] | 228,184,111 / #e4b86f |
| Leaf 1 | [53,21,6,1] | [52,19,8,5] | 125,174,163 / #7daea3 |
| Leaf 2 | [53,27,6,1] | [52,25,8,5] | 147,194,183 / #93c2b7 |
| ECMP | [37,19,4,1] | — | Spine 1 → Leaf 1 |
| ECMP | [36,23,4,1] | — | Spine 1 → Leaf 2 |
| ECMP | [35,25,4,1] | — | Spine 2 → Leaf 1 |
| ECMP | [37,29,4,1] | — | Spine 2 → Leaf 2 |

All four `ECMP` owners are distinguishable by their adjacent horizontal runs.

### Every visible arrow and route

All four are solid, separately traceable with the bridge convention, and end in intact rightward `▶`.

| Source → target | Route vertices, in source-to-target order |
|---|---|
| Spine 1 → Leaf 1 | (27,20) → (51,20) |
| Spine 1 → Leaf 2 | (27,22) → (49,22) → (49,26) → (51,26) |
| Spine 2 → Leaf 1 | (27,26) → (47,26) → (47,23) → (50,23) → (50,22) → (51,22) |
| Spine 2 → Leaf 2 | (27,28) → (51,28) |

### Crossings, touching bends, and apparent branches

The sole `⌒` is **(49,23)**, where Spine 1 → Leaf 2 vertical crosses Spine 2 → Leaf 1 horizontal. This matches the reported one bridge. (49,22)=`╮` touches (50,22)=`╭`; the latter descends to (50,23)=`╯`, directly beside the bridge. This is the single tight touching-bend neighborhood, matching the reported one touching bend. It can look like a compact switchback rather than two independent links, but no route is actually merged. Every bend is in the table. There is no true junction or branch glyph.

## All non-diagram visible labels and borders

These are recorded separately so diagram label counts do not silently include controls. Each exact title below has rectangle **[2,1,66,1]**:

- v1: `rataflow-view · 77x47 @100% · v1.json · 8 nodes · 8 edges · q quit`
- v2: `rataflow-view · 77x47 @100% · v2.json · 6 nodes · 8 edges · q quit`
- v3: `rataflow-view · 77x47 @100% · v3.json · 8 nodes · 8 edges · q quit`
- v4: `rataflow-view · 77x47 @100% · v4.json · 4 nodes · 4 edges · q quit`

Every view also has these four exact labels:

| UI label, verbatim | Rectangle in each view |
|---|---|
| + [+] | [4,42,5,1] |
| − [-] | [4,43,5,1] |
| ⊡ [f] | [4,44,5,1] |
| □ [i] | [4,45,5,1] |

The control widget has a complete rectangular border [2,41,9,6], using `┌`, `┐`, `└`, `┘`, `─`, and `│`, in every view. It is not a graph node. Its position does not intersect v3's rack boxes, whose lower sides occupy row 41 farther right. The control border is continuous in ANSI, in muted RGB `(124,111,100)` / `#7c6f64`; it is unchanged by all-selected captures.

## Hue continuity across views

Within each view, members of each declared group share a hue family with lighter/darker member variants. Across views, **group hue is not stable**. This is verified from normal ANSI perimeters, not merely from the absence of a color field in the specs:

| Repeated group / nodes | First observed hue family | Later observed hue family | Stable? |
|---|---|---|---|
| core / Core 1, Core 2 | v1 pink #d3869b / #e29caf | v2 gold #d8a657 / #e4b86f | no |
| edge / BL 1, BL 2 | v2 pink #d3869b / #e29caf | v3 teal #7daea3 / #93c2b7 | no |
| spine / Spine 1, Spine 2 | v3 gold #d8a657 / #e4b86f | v4 same gold pair | yes |
| leaf / Leaf 1, Leaf 2 | v3 pink #d3869b / #e29caf | v4 teal #7daea3 / #93c2b7 | no |

Thus three of four repeated group identities change hue family. Gold changes semantic role from carrier to core to spine; teal changes from aggregation to firewall to edge to leaf; pink changes from core to edge to leaf. A viewer cannot use hue alone as a durable cross-view concept key. The specs name groups but have no explicit color field. Selected views intentionally make every node border bold gold, so they do not provide group hue stability either. Normal route and arrowhead strokes remain muted, not group-colored.

## Independent-link and motion conclusions

- There are **28 separately drawn links** across the four views: 8 + 8 + 8 + 4. The route tables recover each source and target from visible ports, bends, bridges, and heads. There is no observed shared run or declared bus drawing. All 28 have a visible intact target arrowhead; none is clipped or headless.
- Separate traceability is qualified: the compact carrier twist in v1, dashed half-line corners in v2, long upper-side entrance around Spine 2 in v3, and compact mesh turns in v4 require following the renderer's bridge/dash conventions carefully. Apparent branches exist at those neighborhoods, but no visible actual junction merges links. The uncertain v3 `ECMP` label does not prevent tracing the underlying route.
- A literal scan of **all 12 supplied visual captures** (four text, four normal ANSI, four selected ANSI) finds **zero `●` glyphs**, with zero in every file individually. This case forbids dots, so there is **no observed critical dot violation**. Checks likewise say `flows=0`, zero single-dot routes, zero periodic routes, zero dot violations, and 0/0 origins and arrivals.
- Frame evidence is absent. Zero observed dots is a static-capture finding only; it does not demonstrate temporal absence during uncaptured frames. Animated-route timing and synchronization are not applicable to the specified static links and cannot be independently tested from this bundle.

## Tool-usable blind scorecard

Counts refer to the final four views once each; repeated ANSI/text/selected representations are not additional node/edge occurrences. `labels` counts node and route labels only. `all_visible_label_occurrences` additionally includes one whole title and four controls per view. `uncertain_label_owners` is an independent reader assessment, distinct from the checks' zero-ambiguity claim. Touching-bend numbers are the check's reported counts with observed neighborhoods documented above; there is no attempt to reverse-engineer its contact-counting algorithm.

```json
{
  "case": "datacenter-redundancy",
  "round": "04",
  "stage": "A",
  "blind": true,
  "views": {
    "v1": {"columns":77,"rows":47,"visible_nodes":8,"visible_edges":8,"node_labels":8,"edge_labels":4,"labels":12,"ui_labels":5,"observed_bridge_crossings":3,"reported_touching_bends":3,"uncertain_label_owners":0,"clipped_items":0,"selected_nodes":8,"node_occurrences":8,"dot_glyphs_in_all_three_captures":0,"dot_violations_observed":0,"frame_evidence_present":false,"routes_traceable_with_rendering_conventions":8},
    "v2": {"columns":77,"rows":47,"visible_nodes":6,"visible_edges":8,"node_labels":6,"edge_labels":8,"labels":14,"ui_labels":5,"observed_bridge_crossings":2,"reported_touching_bends":2,"uncertain_label_owners":0,"uncertain_active_standby_owners":0,"clipped_items":0,"selected_nodes":6,"node_occurrences":6,"dot_glyphs_in_all_three_captures":0,"dot_violations_observed":0,"frame_evidence_present":false,"routes_traceable_with_rendering_conventions":8},
    "v3": {"columns":77,"rows":47,"visible_nodes":8,"visible_edges":8,"node_labels":8,"edge_labels":8,"labels":16,"ui_labels":5,"observed_bridge_crossings":4,"reported_touching_bends":2,"uncertain_label_owners":1,"clipped_items":0,"selected_nodes":8,"node_occurrences":8,"dot_glyphs_in_all_three_captures":0,"dot_violations_observed":0,"frame_evidence_present":false,"routes_traceable_with_rendering_conventions":8},
    "v4": {"columns":77,"rows":47,"visible_nodes":4,"visible_edges":4,"node_labels":4,"edge_labels":4,"labels":8,"ui_labels":5,"observed_bridge_crossings":1,"reported_touching_bends":1,"uncertain_label_owners":0,"clipped_items":0,"selected_nodes":4,"node_occurrences":4,"dot_glyphs_in_all_three_captures":0,"dot_violations_observed":0,"frame_evidence_present":false,"routes_traceable_with_rendering_conventions":4}
  },
  "totals": {
    "visible_node_occurrences":26,
    "unique_node_labels":18,
    "visible_edges":28,
    "visible_intact_arrowheads":28,
    "node_labels":26,
    "edge_labels":24,
    "labels":50,
    "ui_labels":20,
    "all_visible_label_occurrences":70,
    "observed_bridge_crossings":10,
    "reported_touching_bends":8,
    "visible_true_graph_junction_glyphs":0,
    "observed_shared_route_runs":0,
    "uncertain_label_owners":1,
    "uncertain_active_standby_owners":0,
    "clipped_items":0,
    "complete_color_continuous_node_borders":26,
    "selected_state_coverage":{"captured":26,"total":26},
    "visual_capture_files_scanned_for_dots":12,
    "dot_glyphs":0,
    "dot_violations_observed":0,
    "dot_absence_verified_over_time":false,
    "frame_evidence_views":0,
    "routes_traceable_with_rendering_conventions":28,
    "repeated_groups_with_changed_hue_family":3,
    "repeated_groups_compared":4,
    "unreadable_supplied_static_captures":0
  },
  "missing_evidence":["Frame dumps for v1, v2, v3, v4","Measured physical pane columns/rectangle and non-null check viewport dimensions"],
  "uncertain_owner_details":[{"view":"v3","label":"ECMP","rectangle":[17,12,4,1],"likely_owner":"BL 2 -> Spine 2","reason":"Directly abuts Spine 1 bottom border and is near another route dogleg; no leader establishes ownership."}]
}
```

This file is the immutable stage-A record. Its SHA-256 is reported separately after the initial save; no expectations have been used.
