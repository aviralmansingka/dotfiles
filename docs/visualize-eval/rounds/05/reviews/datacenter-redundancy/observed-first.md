# Blind observation — round 05, datacenter-redundancy, stage A

This record uses only the supplied final specs and capture bundles, including their check captures and manifests. No source, expectations, rubric, other case, earlier round, raw attempt logs, code, or new viewer session was consulted. No generator identity is used in this judgment. Coordinates describe observations, not inferred layout from the specs.

## Evidence identity

`shasum -a 256` of the three final specs:

- `v1-wan-mux-core.json`: `3adbbf099facfc60bc6ed88c5def5acef81c71d3cb589e476ddbf053ee341a58`
- `v2-fw-border-spine.json`: `89e36227a0ac6e618fc1ca99bac7883df1972f299ffa80cfbf158c81918c7970`
- `v3-fabric-leaves-racks.json`: `fcc12c64f14b41645f5fba4fbe960cb0693c8e756441d9bfd70de63172ffde2b`

All three match their evidence manifests. Every artifact hash listed in those manifests also matches the supplied file. The manifests identify one binary SHA-256, `b1ab9f2e78af11c2f2b005eea083a999079d184bf550e8d0b6d9c51867f22404`; I did not execute that binary.

## Coordinate convention

All coordinates below are 1-based terminal cells, with the application's header at row 1; frame markers, viewport annotations, shell prompts, and command echoes are outside the rendered screen. Label rectangles are `[column,row,width,height]`. A point is `(column,row)`.

Unless explicitly marked otherwise, coordinates refer to the native 83×51 captures. **Every graph label, border, arrowhead, bend, and bridge in the pinned 77×47 captures has the same shape translated by (-3,-2).** Thus the tables specify both capture sizes exactly, without repeating their entries. This translation was checked against captured node labels and routes; it is not an assumed scale operation. The toolbar does not follow that translation: it moves up four rows, without moving horizontally. All views remain at 100%.

## First reading / principal findings

- Three distinct views show 22 node occurrences (18 distinct box names) and 28 directed independent links. All 28 have one intact right-facing `▶` arrowhead and can be followed end to end using the bridge convention. All 14 receiving-box occurrences have two separate arrowheads, not a merged shared trunk.
- The visible bridge counts are exactly 1, 3, and 2. Each accompanies a redundant 2-by-2 fan between adjacent layers, not a gratuitous route loop. Each also sits beside one pair of touching/adjacent opposing bends. These are compact and require deliberate visual tracing; there is no explicit connection dot or junction tee.
- Five edge-label occurrences have uncertain individual owners: both middle `x-connect` labels in v1, the `active` label immediately against a dashed bend in v2, and the two middle `ECMP` labels in v2. The captured check output's claim of zero ambiguous owners is not persuasive for these actual placements. The repeated words remain legible; the issue is association, not lost text.
- Four v2 links visibly use dashed straight segments. Their eight corner glyphs, both bridge glyphs on dashed routes, and arrowheads do not carry a dashed appearance. The short final bend-to-arrow portions of the two bent standby links look solid in isolation. The long dashed portions and literal `standby?` text still distinguish the links overall.
- No palette-overwritten border cells were found in the ordinary or selected ANSI stills. Every node has four complete sides and four complete corners, with a single foreground color around its perimeter. Selected coverage is 22/22, through the supplied all-selected stills.
- **Forbidden flowing dots: zero `●` glyphs across every supplied text/ANSI capture, including all native and pinned frames. Zero critical dot violations.**
- No graph label, node, route, or arrowhead is clipped. The fixed header is truncated in some captures, especially at 77 columns; this is UI clipping, not graph clipping.

## Every graph label, verbatim

### v1 — node and edge labels

| Label | Rectangle | Observed association |
|---|---|---|
| ISP A | [23,11,5,1] | node |
| ISP B | [23,21,5,1] | node |
| ISP C | [23,31,5,1] | node |
| ISP D | [23,41,5,1] | node |
| MUX 1 | [39,17,5,1] | node |
| MUX 2 | [39,37,5,1] | node |
| Core 1 | [55,17,6,1] | node |
| Core 2 | [55,37,6,1] | node |
| x-connect | [45,15,9,1] | clearly above MUX 1 → Core 1 |
| x-connect | [40,21,9,1] | uncertain between the two diagonal links |
| x-connect | [40,28,9,1] | uncertain between the two diagonal links |
| x-connect | [45,39,9,1] | clearly below MUX 2 → Core 2 |

Both middle `x-connect` strings finish at column 48, immediately left of the same ascending route in column 49. The descending route is in column 51. Neither string has a leader to the right-hand route; one cannot uniquely allocate the two occurrences from proximity. The spec giving both routes the same word does not repair their individual visual ownership.

### v2 — node and edge labels

| Label | Rectangle | Observed association |
|---|---|---|
| Core 1 | [12,21,6,1] | node |
| Core 2 | [12,31,6,1] | node |
| FW2 | [30,21,3,1] | upper firewall node |
| FW1 | [30,31,3,1] | lower firewall node |
| BL 1 | [48,21,4,1] | node |
| BL 2 | [48,31,4,1] | node |
| Spine 2 | [66,21,7,1] | upper spine node |
| Spine 1 | [66,31,7,1] | lower spine node |
| standby? | [19,19,8,1] | Core 1 → FW2 |
| standby? | [15,27,8,1] | Core 2 → FW2, beside dashed column 24 |
| active | [28,26,6,1] | Core 1 → FW1, beside solid column 26 |
| active | [20,33,6,1] | Core 2 → FW1 |
| standby? | [36,19,8,1] | FW2 → BL 1 |
| standby? | [34,23,8,1] | FW2 → BL 2, beside dashed column 42 |
| active | [36,29,6,1] | uncertain: abuts standby bend at (42,29); intended solid rising route is column 44 |
| active | [37,33,6,1] | FW1 → BL 2 |
| ECMP | [56,19,4,1] | BL 1 → Spine 2 |
| ECMP | [55,23,4,1] | uncertain between the diagonal links at the bridge cluster |
| ECMP | [54,29,4,1] | uncertain allocation with the other middle ECMP occurrence |
| ECMP | [56,33,4,1] | BL 2 → Spine 1 |

The `active` at [36,29,6,1] ends at column 41 and is immediately followed by the dashed route's solid-looking `╰` at (42,29). Its actual solid-route candidate is two columns farther right, at column 44. This is a particularly misleading local owner cue.

Both middle `ECMP` strings lie left of the ascending route in column 60. The one on row 23 is beside its bridge-bearing horizontal part; the one on row 29 is beside its vertical part. The descending route is in column 62. A reader can follow the routes but cannot confidently assign one repeated label to each diagonal. The upper middle occurrence could also be read as a label below the outgoing top-row route; that alternative is why I mark association uncertain rather than text absent.

### v3 — node and edge labels

| Label | Rectangle | Observed association |
|---|---|---|
| Spine 1 | [21,21,7,1] | node |
| Spine 2 | [21,31,7,1] | node |
| Leaf 1 | [39,21,6,1] | node |
| Leaf 2 | [39,31,6,1] | node |
| Rack 2 | [57,21,6,1] | upper rack node |
| Rack 1 | [57,31,6,1] | lower rack node |
| ECMP | [31,19,4,1] | Spine 1 → Leaf 1 |
| ECMP | [37,26,4,1] | Spine 1 → Leaf 2, right of column 35 |
| ECMP | [28,27,4,1] | Spine 2 → Leaf 1, left of column 33 |
| ECMP | [31,33,4,1] | Spine 2 → Leaf 2 |
| dual | [48,19,4,1] | Leaf 1 → Rack 2 |
| dual | [55,26,4,1] | Leaf 1 → Rack 1, right of column 53 |
| dual | [46,27,4,1] | Leaf 2 → Rack 2, left of column 51 |
| dual | [48,33,4,1] | Leaf 2 → Rack 1 |

Unlike v1 and v2's spine fan, v3 puts the middle labels on opposite outside flanks of the two parallel vertical corridors. All eight edge labels have reasonably clear individual owners.

### Application labels and other visible text

The following strings include their initial space as shown; each header rectangle starts at column 1. Their visible trailing text is recorded exactly, not reconstructed from the filename or another view.

| Capture | Header, verbatim | Rectangle |
|---|---|---|
| v1 native | ` rataflow-view · 83x51 @100% · v1-wan-mux-core.json · 8 nodes · 8 edges · q quit` | [1,1,80,1] |
| v2 native | ` rataflow-view · 83x51 @100% · v2-fw-border-spine.json · 8 nodes · 12 edges · q qui` | [1,1,83,1] |
| v3 native | ` rataflow-view · 83x51 @100% · v3-fabric-leaves-racks.json · 6 nodes · 8 edges · q` | [1,1,82,1] |
| v1 pinned | ` rataflow-view · 77x47 @100% · v1-wan-mux-core.json · 8 nodes · 8 edges · q q` | [1,1,77,1] |
| v2 pinned | ` rataflow-view · 77x47 @100% · v2-fw-border-spine.json · 8 nodes · 12 edges ·` | [1,1,77,1] |
| v3 pinned | ` rataflow-view · 77x47 @100% · v3-fabric-leaves-racks.json · 6 nodes · 8 edge` | [1,1,77,1] |

Each native view has `+ [+]` [4,46,5,1], `− [-]` [4,47,5,1], `⊡ [f]` [4,48,5,1], and `□ [i]` [4,49,5,1]. Their pinned rectangles are [4,42,5,1], [4,43,5,1], [4,44,5,1], and [4,45,5,1]. These have clear toolbar ownership. The enclosing toolbar border is [2,45,9,6] native and [2,41,9,6] pinned, complete in both.

Frame labels `frame 0 at 0ms` through `frame 4 at 400ms`, viewport lines, and echoed shell commands are capture annotations, not labels over the graph. They are excluded from graph-label counts.

## Every visible arrow and its full route

The chains below start at the first route cell outside the source's right border and finish at the arrowhead immediately left of the target's left border. Successive points are connected orthogonally. A bridge may replace the visible glyph on the other route's vertical column; the chain follows the normal over/under convention. **Every row has a present, intact `▶`, rightward final direction, and end-to-end traceability without choosing a branch.** Tracing requires attention at the six bridge clusters, but there is no missing arrow or shared segment that forces a choice. All links are independent, not declared buses.

### v1 — 8 arrows

| Source → target | Visible route chain | Style |
|---|---|---|
| ISP A → MUX 1 | (29,11) → (36,11) → (36,16) → (37,16) | solid |
| ISP B → MUX 1 | (29,21) → (36,21) → (36,18) → (37,18) | solid |
| ISP C → MUX 2 | (29,31) → (36,31) → (36,36) → (37,36) | solid |
| ISP D → MUX 2 | (29,41) → (36,41) → (36,38) → (37,38) | solid |
| MUX 1 → Core 1 | (45,16) → (53,16) | solid |
| MUX 1 → Core 2 | (45,18) → (51,18) → (51,36) → (53,36) | solid; under bridge at (51,19) |
| MUX 2 → Core 1 | (45,36) → (49,36) → (49,19) → (52,19) → (52,18) → (53,18) | solid; bridge at (51,19) |
| MUX 2 → Core 2 | (45,38) → (53,38) | solid |

Receiving-box arrowhead pairs: MUX 1 (37,16)/(37,18); MUX 2 (37,36)/(37,38); Core 1 (53,16)/(53,18); Core 2 (53,36)/(53,38).

### v2 — 12 arrows

| Source → target | Visible route chain | Style |
|---|---|---|
| Core 1 → FW1 | (19,22) → (26,22) → (26,30) → (28,30) | solid; under bridge at (26,23) |
| Core 2 → FW1 | (19,32) → (28,32) | solid |
| Core 1 → FW2 | (19,20) → (28,20) | dashed |
| Core 2 → FW2 | (19,30) → (24,30) → (24,23) → (27,23) → (27,22) → (28,22) | dashed straights, solid-looking corners/bridge |
| FW1 → BL 1 | (34,30) → (44,30) → (44,22) → (46,22) | solid; under bridge at (44,29) |
| FW1 → BL 2 | (34,32) → (46,32) | solid |
| FW2 → BL 1 | (34,20) → (46,20) | dashed |
| FW2 → BL 2 | (34,22) → (42,22) → (42,29) → (45,29) → (45,30) → (46,30) | dashed straights, solid-looking corners/bridge |
| BL 1 → Spine 1 | (53,22) → (62,22) → (62,30) → (64,30) | solid; under bridge at (62,23) |
| BL 1 → Spine 2 | (53,20) → (64,20) | solid |
| BL 2 → Spine 1 | (53,32) → (64,32) | solid |
| BL 2 → Spine 2 | (53,30) → (60,30) → (60,23) → (63,23) → (63,22) → (64,22) | solid; bridge at (62,23) |

Receiving-box arrowhead pairs: FW2 (28,20)/(28,22); FW1 (28,30)/(28,32); BL 1 (46,20)/(46,22); BL 2 (46,30)/(46,32); Spine 2 (64,20)/(64,22); Spine 1 (64,30)/(64,32).

### v3 — 8 arrows

| Source → target | Visible route chain | Style |
|---|---|---|
| Spine 1 → Leaf 1 | (29,20) → (37,20) | solid |
| Spine 1 → Leaf 2 | (29,22) → (35,22) → (35,30) → (37,30) | solid; under bridge at (35,23) |
| Spine 2 → Leaf 1 | (29,30) → (33,30) → (33,23) → (36,23) → (36,22) → (37,22) | solid; bridge at (35,23) |
| Spine 2 → Leaf 2 | (29,32) → (37,32) | solid |
| Leaf 1 → Rack 1 | (46,22) → (53,22) → (53,30) → (55,30) | solid; under bridge at (53,23) |
| Leaf 1 → Rack 2 | (46,20) → (55,20) | solid |
| Leaf 2 → Rack 1 | (46,32) → (55,32) | solid |
| Leaf 2 → Rack 2 | (46,30) → (51,30) → (51,23) → (54,23) → (54,22) → (55,22) | solid; bridge at (53,23) |

Receiving-box arrowhead pairs: Leaf 1 (37,20)/(37,22); Leaf 2 (37,30)/(37,32); Rack 2 (55,20)/(55,22); Rack 1 (55,30)/(55,32).

## Crossings, touching bends, branches, and necessity

| View | Bridge cell | Crossing routes | Touching/adjacent opposing bends |
|---|---|---|---|
| v1 | (51,19) `⌒` | MUX 2 → Core 1 over MUX 1 → Core 2 | (51,18) `╮` / (52,18) `╭` |
| v2 | (26,23) `⌒` | Core 2 → FW2 over Core 1 → FW1 | (26,22) `╮` / (27,22) `╭` |
| v2 | (44,29) `⌒` | FW2 → BL 2 over FW1 → BL 1 | (44,30) `╯` / (45,30) `╰` |
| v2 | (62,23) `⌒` | BL 2 → Spine 2 over BL 1 → Spine 1 | (62,22) `╮` / (63,22) `╭` |
| v3 | (35,23) `⌒` | Spine 2 → Leaf 1 over Spine 1 → Leaf 2 | (35,22) `╮` / (36,22) `╭` |
| v3 | (53,23) `⌒` | Leaf 2 → Rack 2 over Leaf 1 → Rack 1 | (53,22) `╮` / (54,22) `╭` |

These are all the bridge glyphs and all six reported touching-bend locations visible in the captures. Other bends are enumerated in the route chains, including the short two-bend jog into each upper receiving box. No `┼`, tee, explicit junction, shared independent-link run, or genuine branch appears. Each cluster could momentarily look like an apparent branch because opposing rounded bends are side by side and use the same muted color, but the port orientation and `⌒` let the reader resolve it as two routes.

All six crossings are fan-forced **within the displayed left-to-right, two-row, local inter-layer corridor arrangement**: both source boxes independently reach both target boxes, so the two cross-row connections exchange vertical order. None is an avoidable self-crossing or an extra crossing of the same pair. This is not a claim of graph-theoretic nonplanarity: a 2-by-2 fan is planar, and exterior routing around a layer or a different layout could avoid the bridge. Thus the bridges are justified by this compact layered layout, not absolutely unavoidable under every possible drawing. The touching-bend compression is a separate readability cost; it is not logically required by redundancy.

Pinned bridge cells are respectively v1 (48,17); v2 (23,21), (41,27), (59,21); v3 (32,21), (50,21). The same (-3,-2) translation gives every touching bend above.

## Dashed standby reading

Four standby routes have visibly broken `╌` / `╎` straight runs. The two straight standby links have no route corners. The two bent standby links have these eight ordinary rounded corner cells:

- Core 2 → FW2: (24,30) `╯`, (24,23) `╭`, (27,23) `╯`, (27,22) `╭`.
- FW2 → BL 2: (42,22) `╮`, (42,29) `╰`, (45,29) `╮`, (45,30) `╰`.

The two dashed-route bridge glyphs are (26,23) and (44,29). Their ANSI foreground is the same muted RGB (124,111,100) as solid routes, and the sampled corners/bridges have no distinguishing SGR attribute. Their literal glyphs are not broken/dashed. In particular, the terminal pieces (27,22) `╭` → (28,22) `▶` and (45,30) `╰` → (46,30) `▶` contain no dashed straight cell. A reader looking only at either final approach cannot distinguish standby from active. Long dashed approaches and the `standby?` labels preserve the overall style distinction, but not continuously through every bend/endpoint. This is a visible limitation, not a missing route and not a flowing-dot violation.

## Borders and palette audit

All rectangles below have intact upper/lower horizontal sides, intact left/right vertical sides, and the expected four corners `╭`/`╮`/`╰`/`╯`. For rectangle [x,y,w,h], those corners are (x,y), (x+w−1,y), (x,y+h−1), and (x+w−1,y+h−1). The border-cell counts include all four corners. ANSI stills establish color; plain text alone was not used to claim continuity.

| View | Node | Border rectangle | Border cells | Normal foreground RGB |
|---|---|---|---:|---|
| v1 | ISP A | [22,10,7,4] | 18 | (211,134,155) |
| v1 | ISP B | [22,20,7,4] | 18 | (226,156,175) |
| v1 | ISP C | [22,30,7,4] | 18 | (187,108,131) |
| v1 | ISP D | [22,40,7,4] | 18 | (238,180,196) |
| v1 | MUX 1 | [38,15,7,5] | 20 | (125,160,184) |
| v1 | MUX 2 | [38,35,7,5] | 20 | (151,184,206) |
| v1 | Core 1 | [54,15,8,5] | 22 | (169,182,101) |
| v1 | Core 2 | [54,35,8,5] | 22 | (189,201,124) |
| v2 | Core 1 | [11,19,8,5] | 22 | (169,182,101) |
| v2 | Core 2 | [11,29,8,5] | 22 | (189,201,124) |
| v2 | FW2 | [29,19,5,5] | 16 | (147,194,183) |
| v2 | FW1 | [29,29,5,5] | 16 | (125,174,163) |
| v2 | BL 1 | [47,19,6,5] | 18 | (216,166,87) |
| v2 | BL 2 | [47,29,6,5] | 18 | (228,184,111) |
| v2 | Spine 2 | [65,19,9,5] | 24 | (147,194,183) |
| v2 | Spine 1 | [65,29,9,5] | 24 | (125,174,163) |
| v3 | Spine 1 | [20,19,9,5] | 24 | (125,174,163) |
| v3 | Spine 2 | [20,29,9,5] | 24 | (147,194,183) |
| v3 | Leaf 1 | [38,19,8,5] | 22 | (125,174,163) |
| v3 | Leaf 2 | [38,29,8,5] | 22 | (147,194,183) |
| v3 | Rack 2 | [56,19,8,5] | 22 | (226,156,175) |
| v3 | Rack 1 | [56,29,8,5] | 22 | (211,134,155) |

There are 448 node-perimeter cells across the native views. No perimeter has a foreground outlier, an overwritten corner, or a missing border glyph. Every perimeter background is RGB (40,40,40). Every ordinary node perimeter is non-bold. The three selected ANSI stills show every one of those same perimeters in RGB (216,166,87), bold, with no color outlier. Coverage: v1 8/8, v2 8/8, v3 6/6, total 22/22. This is simultaneous all-selected evidence, not a recording of 22 separate interactive selection operations.

Palette caveat distinct from overwritten borders: in v3 the spine and rack-leaf layers reuse the same teal RGB pair, so hue alone does not separate those named groups. In v2 the firewall and spine layers likewise reuse the teal pair. BL 1's ordinary border RGB matches the selection hue, although selected stills also add bold. Those are palette collisions, not evidence of a route repainting a border.

## Motion / forbidden-dot audit

Every `.txt` and `.ansi` file under the supplied evidence directories was scanned for U+25CF `●`, including ordinary, selected, check, native-frame, alternate 77×47-frame, and pinned-frame files. Every count was zero. Both 77×47 copies for each view are byte-identical.

Each view has five native frames at 0, 100, 200, 300, and 400 ms, and five pinned frames at those same times. The duplicate text/ANSI motion exports are not independent animations. For each view and each time, zero dots are visible. Graph glyphs are stable across all five frames; native exports also have shell transcript material before/after the frame region, which is not extra graph content.

There are no animated routes in the visible evidence. Dot spacing, direction, origin-at-frame-0, corner/bridge/arrowhead occupation, and same-frame arrival are therefore not applicable rather than successful animation tests. Zero dots ever occupy any corner, bridge, or arrowhead because there are no dots anywhere. The specs' `dots: 0` values agree with, but do not replace, this capture observation.

## Fit, reported diagnostics, and limitations

| View | Native viewport | Pinned viewport | Captured check extent | Visible graph bounding box, native | Visible graph bounding box, pinned |
|---|---|---|---|---|---|
| v1 | 83×51 at 100% | 77×47 at 100% | 45×39 | [22,10,40,34] | [19,8,40,34] |
| v2 | 83×51 at 100% | 77×47 at 100% | 68×20 | [11,19,63,15] | [8,17,63,15] |
| v3 | 83×51 at 100% | 77×47 at 100% | 49×20 | [20,19,44,15] | [17,17,44,15] |

The ordinary and selected ANSI stills explicitly contain 51 rows of 83 cells; plain text strips trailing empty cells/rows. The pinned frames declare 77×47 and end visibly at toolbar row 46, with the remaining empty row not printed. Native motion captures report `viewport: 83x51 zoom: 1.00 natural`; pinned dumps report `viewport: 77x47 zoom: 1.00 natural`. The standalone check files instead say `viewport: unknown zoom: 1.00 natural`. Each manifest has a null pane rectangle and null pane column count, a pane-row value of 51, and an 83×51 viewport token. Accordingly, the screen sizes are supported by the captured buffer/header and viewport lines, not independent pane-rectangle metadata.

All graph content is visible on one screen at both sizes. No pan, zoom, hidden continuation, or clipped receiving box is required. The tall first view almost reaches the toolbar's top row at pinned size, but the toolbar occupies columns 2–10 and the lowest ISP box occupies columns 19–25, so there is no overlap.

The check captures report crossings of 1 bridge/1 touching bend, 3/3, and 2/2; the visible evidence agrees exactly. They report 4/4, 12/12, and 8/8 edge labels placed with zero skipped and zero route-cell labels. All 24 strings are visible. Their claimed zero ambiguous owners conflicts with the five association concerns documented above.

There is no `routes: N/M near-minimal` line in any supplied check capture, so that reported diagnostic cannot be compared. The observed chains have no U-turns or loops: they are monotone in each coordinate between endpoints. Some use four bends rather than two, to separate ports and approach a bridge, but those are not visible length-backtracking detours. The long first-view diagonals travel between rows 18 and 36 because the MUX/core pairs are far apart; that makes the links visually long, not demonstrably nonminimal for their endpoint coordinates.

Native v2's header truncates `quit` to `qui`; native v3 ends at `q`. All pinned headers truncate at the strings recorded above. Count these as one clipped UI header item per affected view/size (native 2, pinned 3), not lost graph labels. The graph-clipped-item count is zero in every view.

### Missing or limited evidence

- No supplied file format was unreadable. No expected data was sought.
- Pinned 77×47 frames are plain text only: color continuity and selected-state colors cannot independently be verified at pinned size.
- Files named `v*-frames.ansi` contain no SGR color sequences inside any of the five frame screens. They support glyph stability and absence of dots, not per-frame color continuity. Ordinary and selected ANSI stills do preserve explicit RGB and bold evidence.
- Pane column/rectangle metadata are missing; screen dimensions are evidenced as described above.
- No near-minimal-route diagnostic is present. No unsupported claim about that absent report is made.
- The five frames cover only 0–400 ms. This suffices to observe zero dots in all supplied samples, not to prove behavior at unsampled times.

## Tool-usable blind scorecard

Counts refer to final-view occurrences, not repeated screenshots of the same view. `visible_labels` includes node and edge labels, not UI. `clipped_items` means graph items; UI-header clipping is separated. Ambiguous ownership is a blind reader judgment, not copied from `--check`. No numerical rubric score is invented before stage B.

```json
{
  "stage": "A",
  "case": "datacenter-redundancy",
  "spec_hashes_verified": true,
  "manifest_artifact_hashes_verified": true,
  "views": [
    {
      "view": "v1",
      "visible_nodes": 8,
      "visible_edges": 8,
      "traceable_edges": 8,
      "visible_node_labels": 8,
      "visible_edge_labels": 4,
      "visible_labels": 12,
      "arrowheads": 8,
      "receiving_boxes_with_two_arrowheads": 4,
      "crossings": 1,
      "touching_bends": 1,
      "actual_junctions": 0,
      "uncertain_label_owners": 2,
      "uncertain_label_rectangles": [[40,21,9,1],[40,28,9,1]],
      "clipped_items": 0,
      "clipped_ui_headers_native": 0,
      "clipped_ui_headers_pinned": 1,
      "selected_state_coverage": {"captured": 8, "total": 8},
      "palette_overwritten_border_cells": 0,
      "dot_glyphs_all_captures": 0,
      "dot_violations": 0
    },
    {
      "view": "v2",
      "visible_nodes": 8,
      "visible_edges": 12,
      "traceable_edges": 12,
      "visible_node_labels": 8,
      "visible_edge_labels": 12,
      "visible_labels": 20,
      "arrowheads": 12,
      "receiving_boxes_with_two_arrowheads": 6,
      "crossings": 3,
      "touching_bends": 3,
      "actual_junctions": 0,
      "uncertain_label_owners": 3,
      "uncertain_label_rectangles": [[36,29,6,1],[55,23,4,1],[54,29,4,1]],
      "clipped_items": 0,
      "clipped_ui_headers_native": 1,
      "clipped_ui_headers_pinned": 1,
      "selected_state_coverage": {"captured": 8, "total": 8},
      "palette_overwritten_border_cells": 0,
      "dashed_routes": 4,
      "solid_looking_dashed_route_corners": 8,
      "solid_looking_dashed_route_bridges": 2,
      "dashed_routes_with_solid_looking_terminal_bend_arrow_pair": 2,
      "dot_glyphs_all_captures": 0,
      "dot_violations": 0
    },
    {
      "view": "v3",
      "visible_nodes": 6,
      "visible_edges": 8,
      "traceable_edges": 8,
      "visible_node_labels": 6,
      "visible_edge_labels": 8,
      "visible_labels": 14,
      "arrowheads": 8,
      "receiving_boxes_with_two_arrowheads": 4,
      "crossings": 2,
      "touching_bends": 2,
      "actual_junctions": 0,
      "uncertain_label_owners": 0,
      "uncertain_label_rectangles": [],
      "clipped_items": 0,
      "clipped_ui_headers_native": 1,
      "clipped_ui_headers_pinned": 1,
      "selected_state_coverage": {"captured": 6, "total": 6},
      "palette_overwritten_border_cells": 0,
      "dot_glyphs_all_captures": 0,
      "dot_violations": 0
    }
  ],
  "totals": {
    "visible_nodes": 22,
    "distinct_node_names": 18,
    "visible_edges": 28,
    "traceable_edges": 28,
    "visible_node_labels": 22,
    "visible_edge_labels": 24,
    "visible_labels": 46,
    "arrowheads": 28,
    "receiving_boxes_with_two_arrowheads": 14,
    "crossings": 6,
    "touching_bends": 6,
    "actual_junctions": 0,
    "uncertain_label_owners": 5,
    "clipped_items": 0,
    "clipped_ui_headers_native": 2,
    "clipped_ui_headers_pinned": 3,
    "selected_state_coverage": {"captured": 22, "total": 22},
    "palette_overwritten_border_cells": 0,
    "dot_glyphs_all_captures": 0,
    "dot_violations": 0,
    "critical_dot_violations": 0
  },
  "unreadable_evidence": [],
  "missing_evidence": [
    "pinned-size ANSI color and selected-state captures",
    "per-frame SGR colors inside nominal ANSI motion files",
    "non-null pane rectangle and pane column metadata",
    "routes N/M near-minimal diagnostic"
  ]
}
```

This file is the saved stage-A blind record. Its SHA-256 is reported separately after saving; the record is not revised after hashing.
