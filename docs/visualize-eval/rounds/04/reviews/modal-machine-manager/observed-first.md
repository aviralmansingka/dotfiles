# Blind observed-first record — modal-machine-manager — round 04

## Scope and evidence discipline

Stage A only. I read the four final JSON specs and their supplied captures, check outputs, and manifests. I did not read source, expected data, a rubric, dataset manifest, generation narrative, attempts, other cases, or earlier rounds. I did not run a viewer, fix anything, change models, or spawn agents. Analysis was offline over capture bytes, using `uv run --no-project` and temporary scripts outside the repository. Coordinates below are 1-based terminal `[column,row,width,height]`, measured at the pinned 77-column × 47-row viewport. Points are `(column,row)`. A graph label is one node-label or edge-label occurrence; controls/title are counted separately.

## Spec hash verification

`shasum -a 256` on the four final specs returned the following values, each identical to its evidence manifest:

| Spec | SHA-256 |
|---|---|
| v1-intake.json | e03bce6ff14e8b4f46b7723cfb9ff2fec3683ed300ba15e2f912e04015ac13d3 |
| v2-provision.json | eb7a63b3aa220ed7c1f55d2461840532f243d0534fff95e6895b9d3e139429b9 |
| v3-state.json | ddbedaf644c30f9890ec7d906af63631a038bd6471acd9b1ecee16dbddf29955 |
| v4-ops.json | b11a993ac703201aed3ac04f198ff2cbdab4b3319ecdccde0ce6bc90c30868fb |

## Common fit, border, and animation findings

- Each view visibly reports `77x47 @100%`. Each direct frame file begins exactly `viewport: 77x47 zoom: 1.00 natural`. Each check instead begins `viewport: unknown zoom: 1.00 natural`. Manifest `viewport_line`, `pane_cols`, and `pane_rect` are null; `pane_rows` is 47. The direct captures supply the explicit target dimensions that the manifests do not.
- The static text dumps have 46 lines after trailing blank-line removal. Their ANSI counterparts contain the full 77-cell background rows. The omitted final blank row is not clipped diagram content. No graph label, node side/corner, route endpoint, or control is clipped or requires pan/zoom in these captures. In v4 the SSH box begins at column 1 and the webapi box ends at column 76; both borders are complete.
- All 26 node occurrences have complete top/bottom/left/right sides and all four rounded corners (`╭ ╮ ╰ ╯`). Every node border is color-continuous within that occurrence. The tables below give normal-state RGB from ANSI, not an inference from text. In each selected ANSI capture every perimeter cell of every node is bold RGB (216,166,87). Thus selected coverage is 26/26 occurrences, with its own selected perimeter visible for each node, in four select-all frames. These frames do not prove exclusive one-node-at-a-time navigation.
- All 23 static arrows have a visible, intact head and can be traced source-to-target by geometry, independently of the four uncertain labels. There are no dashed links. The one crossing has a bridge glyph, not a branch. Multi-edge source/target boxes use separate ports; there is no shared bus junction.
- **Every route starts its frame-0 dot on the SECOND drawn route cell, not the first cell adjacent to the source border.** The origin/dot table for each view gives concrete coordinates. Therefore the checks' `origins: N/N routes start at their arrow origin` do not match the literal captured first-cell positions. All 23 routes have this observed origin offset.
- Each frame has exactly one dot on each route: totals 4, 6, 7, and 6 for the four views, throughout frames 0–20. No duplicate/missing-dot frame is visible. With one dot per route, within-route inter-dot spacing is not applicable; the different queue ports' simultaneous dots remain distinct.
- Motion is quantized: odd frames repeat the preceding even frame. Most 200ms moves advance one drawn cell, but 14 routes include a **two-cell** jump in 200ms where an earlier corner is skipped. This is not uniform 0.5 drawn cells per 100ms over the actual visible centerline. The per-route position-index sequences below show every sampled position, not a nominal-speed claim from the spec/check. Motion follows the arrow direction; short routes wrap back upstream.
- Seven routes put their dot on a corner, totaling 40 route-frame corner occupancies. Some first bends are skipped but later bends are occupied. No bridge or arrowhead occupancy appears in these captures. None of the 23 dots reaches its actual arrowhead in the observed samples, and no common arrival frame is visible. Constant-speed routes are not same-arrival routes, so the lack of synchronized arrival is an observation, not itself a same-arrival-policy failure.
- **Important evidence limit:** despite the task's description of “full cycles,” all four direct files contain only 21 frames, numbered 0–20, at 0–2000ms in 100ms steps. Eight short routes visibly repeat a cycle; 15 longer routes do not complete one. Thus bridge occupancy and later-corner behavior over a full long-route cycle are unproven. Even the completed short cycles do not place a dot on origin or arrowhead.
- The regular `*-frames.txt` and `*-frames.ansi` captures start with an unheaded partial frame-0 screen (36 lines before the frame-1 marker). Both then have markers 1–20. The direct files restore a full headed frame 0. ANSI formats are readable by SGR decoding; no supplied format needed for this judgment was unsupported.

## Common visible UI labels

Each view has these verbatim control labels: `+ [+]` [4,42,5,1], `− [-]` [4,43,5,1], `⊡ [f]` [4,44,5,1], `□ [i]` [4,45,5,1]. The control box is [2,41,9,6], complete with square corners and continuous RGB (168,153,104) perimeter. Its labels are not graph nodes or edge labels. The per-view title is included below.

## Table conventions

Node IDs in tables are only shorthand for the verbatim node labels listed in that view. Border bounds include the perimeter. “Origin” is the first drawn cell just outside the source's border; “frame-0 dot” is measured directly. Route length counts visible centerline cells including origin and head. Bends list all turning cells; `⌒` is the crossing cell, not an extra branch. Every arrow in the following tables is whole-route traceable; its listed head is present in the static and all captured animation frames.

For motion, sequences give the 0-based visible route-cell index at **frames 0,2,4,6,8,10,12,14,16,18,20**. Each intervening odd frame repeats the previous even frame, so this fully specifies all 21 sampled positions. Index 0 is the literal first drawn origin, and index `cells−1` is the arrowhead. Index sequences are not rescaled to the nominal speed.

## v1-intake

Title: `rataflow-view · 77x47 @100% · v1-intake.json · 5 nodes · 4 edges · q quit` [2,1,73,1].

### Every visible graph label

| Label (verbatim) | Bounds |
|---|---|
| `humans + mmctl` | [48, 16, 14, 1] |
| `control plane` | [16, 16, 13, 1] |
| `webapi` | [48, 24, 6, 1] |
| `private gRPC` | [16, 24, 12, 1] |
| `River queue` | [32, 32, 11, 1] |
| `http` | [50, 20, 4, 1] |
| `create/term/repair` | [18, 20, 18, 1] |
| `enqueue job` | [19, 28, 11, 1] |
| `reinstall/reprov` | [32, 28, 16, 1] |

### Every node border and selected-state evidence

Every row below has all four sides and four corners complete, normal color continuous, and its whole selected border captured bold RGB (216,166,87).

| ID = source/target box label | Border bounds | Normal border RGB |
|---|---|---|
| web = `humans + mmctl` | [47, 15, 16, 4] | (216, 166, 87) |
| cp = `control plane` | [15, 15, 15, 4] | (125, 174, 163) |
| wapi = `webapi` | [47, 23, 8, 4] | (147, 194, 183) |
| pgrpc = `private gRPC` | [15, 23, 14, 4] | (211, 134, 155) |
| q = `River queue` | [31, 31, 13, 4] | (99, 151, 141) |

### Every visible arrow, endpoint, and bend

| Source → target | Visible edge label | First drawn origin | Head position, direction/state | Cells | All bends / bridge cells in source-to-target order |
|---|---|---|---|---|---|
| web → wapi | `http` | (48, 19) | (48, 22) ▼ down, intact | 4 | none |
| cp → pgrpc | `create/term/repair` | (16, 19) | (16, 22) ▼ down, intact | 4 | none |
| wapi → q | `reinstall/reprov` | (48, 27) | (34, 30) ▼ down, intact | 18 | ╯ (48, 29); ╭ (34, 29) |
| pgrpc → q | `enqueue job` | (16, 27) | (32, 30) ▼ down, intact | 20 | ╰ (16, 29); ╮ (32, 29) |

### Ownership, crossings, branches, and fit

`reinstall/reprov` at [32,28,16,1] is above the rightward private-gRPC-to-queue run as well as beside the webapi-to-queue downstroke. Its last cell touches the latter visually; its first cells also sit immediately above the former. Owner uncertain between these two incoming queue routes, despite the spec assigning webapi → queue.

The two incoming queue arrows end at separate columns 32 and 34. They do not join before the box. No crossing, touching bend, bridge, junction, or apparent shared run is visible.

Captured viewport: 77×47 at 100%, all diagram content visible. Measured occupied graph bounds (excluding UI) are [15,15,48,20], columns 15–62, rows 15–34. Check extent: `52x24 cells`; check crossings: `0 bridges, 0 touching bends`; check route assessment: `4/4 near-minimal, 0 detours, 0 shortened`. The visually counted bridge/touching totals agree with the check. Natural extent is reported, not substituted for the measured capture bounds. No unexplained detour or clipped region is visible; all turning geometry is enumerated above.

### Route-by-route captured motion

| Route | Frame-0 dot (origin above is one cell earlier) | Even-frame route indices, frames 0…20 | Observed corner occupancy (frame numbers at coordinates) |
|---|---|---|---|
| web → wapi | (48, 20) | 1,2,1,2,1,2,1,2,1,2,1 | none in sampled interval |
| cp → pgrpc | (16, 20) | 1,2,1,2,1,2,1,2,1,2,1 | none in sampled interval |
| wapi → q | (48, 28) | 1,3,4,5,6,7,8,9,10,11,12 | none in sampled interval |
| pgrpc → q | (16, 28) | 1,3,4,5,6,7,8,9,10,11,12 | none in sampled interval |

Dots per frame: 4 total, exactly 1 on each route in every frame. Dot direction follows each arrow, including the initially leftward boot return in v2 (its later upward/rightward turns are statically traceable but not reached during the sampled motion interval); no opposite-direction jump is seen except deliberate wrap to the beginning of a short route. Zero dots on any bridge or arrowhead in frames 0–20. The per-view observed origin-offset count is 4/4, independent of the check's `origins` assertion.

## v2-provision

Title: `rataflow-view · 77x47 @100% · v2-provision.json · 6 nodes · 6 edges · q quit` [2,1,76,1].

### Every visible graph label

| Label (verbatim) | Bounds |
|---|---|
| `River queue` | [13, 7, 11, 1] |
| `provider registry` | [10, 15, 17, 1] |
| `bare-metal providers` | [8, 23, 20, 1] |
| `bare-metal machines` | [9, 31, 19, 1] |
| `boot server` | [34, 40, 11, 1] |
| `S3 object store` | [55, 40, 15, 1] |
| `provision job` | [15, 11, 13, 1] |
| `provider API` | [12, 19, 12, 1] |
| `allocate instance` | [10, 27, 17, 1] |
| `iPXE request` | [15, 38, 12, 1] |
| `boot.ipxe + S3 args` | [10, 39, 19, 1] |
| `pull boot image` | [26, 34, 15, 1] |

### Every node border and selected-state evidence

Every row below has all four sides and four corners complete, normal color continuous, and its whole selected border captured bold RGB (216,166,87).

| ID = source/target box label | Border bounds | Normal border RGB |
|---|---|---|
| q = `River queue` | [12, 6, 13, 4] | (216, 166, 87) |
| reg = `provider registry` | [9, 14, 19, 4] | (125, 174, 163) |
| prov = `bare-metal providers` | [7, 22, 22, 4] | (147, 194, 183) |
| mch = `bare-metal machines` | [8, 30, 21, 4] | (211, 134, 155) |
| boot = `boot server` | [33, 39, 13, 4] | (169, 182, 101) |
| s3 = `S3 object store` | [54, 39, 17, 4] | (125, 160, 184) |

### Every visible arrow, endpoint, and bend

| Source → target | Visible edge label | First drawn origin | Head position, direction/state | Cells | All bends / bridge cells in source-to-target order |
|---|---|---|---|---|---|
| q → reg | `provision job` | (13, 10) | (10, 13) ▼ down, intact | 7 | ╯ (13, 12); ╭ (10, 12) |
| reg → prov | `provider API` | (10, 18) | (8, 21) ▼ down, intact | 6 | ╯ (10, 20); ╭ (8, 20) |
| prov → mch | `allocate instance` | (8, 26) | (9, 29) ▼ down, intact | 5 | ╰ (8, 28); ╮ (9, 28) |
| mch → boot | `iPXE request` | (9, 34) | (34, 38) ▼ down, intact | 30 | ╰ (9, 37); ╮ (34, 37) |
| mch → s3 | `pull boot image` | (11, 34) | (55, 38) ▼ down, intact | 49 | ╰ (11, 35); ╮ (55, 35) |
| boot → mch | `boot.ipxe + S3 args` | (32, 40) | (7, 31) ▶ right, intact | 37 | ╰ (6, 40); ╭ (6, 31) |

### Ownership, crossings, branches, and fit

`boot.ipxe + S3 args` at [10,39,19,1] sits between the machine-to-boot run at row 37 and the reverse return at row 40. It is nearer the reverse row-40 route, so that is the stronger reading, but neither run has a label leader; ownership remains insufficiently explicit in this close parallel pair. The spec assigns boot → machines. The feedback loop around column 6 is conspicuous but traceable, not an extra branch.

The adjacent corners (8,28) and (9,28) belong to the same provider → machine route, not a collision of two edges. Two outgoing machine ports lead to boot and S3; the return from boot enters the machine left side through a right-pointing head at (7,31). No crossing, inter-route touching bend, bridge, or junction is visible.

Captured viewport: 77×47 at 100%, all diagram content visible. Measured occupied graph bounds (excluding UI) are [6,6,65,37], columns 6–70, rows 6–42. Check extent: `65x38 cells`; check crossings: `0 bridges, 0 touching bends`; check route assessment: `6/6 near-minimal, 0 detours, 1 shortened`. The visually counted bridge/touching totals agree with the check. Natural extent is reported, not substituted for the measured capture bounds. No unexplained detour or clipped region is visible; all turning geometry is enumerated above.

### Route-by-route captured motion

| Route | Frame-0 dot (origin above is one cell earlier) | Even-frame route indices, frames 0…20 | Observed corner occupancy (frame numbers at coordinates) |
|---|---|---|---|
| q → reg | (13, 11) | 1,3,4,5,1,3,4,5,1,3,4 | ╭ (10, 12): frames [6, 7, 14, 15] |
| reg → prov | (10, 19) | 1,3,4,1,3,4,1,3,4,1,3 | ╭ (8, 20): frames [4, 5, 10, 11, 16, 17] |
| prov → mch | (8, 27) | 1,3,1,3,1,3,1,3,1,3,1 | ╮ (9, 28): frames [2, 3, 6, 7, 10, 11, 14, 15, 18, 19] |
| mch → boot | (9, 35) | 1,2,4,5,6,7,8,9,10,11,12 | none in sampled interval |
| mch → s3 | (11, 35) | 1,2,3,4,5,6,7,8,9,10,11 | ╰ (11, 35): frames [0, 1] |
| boot → mch | (31, 40) | 1,2,3,4,5,6,7,8,9,10,11 | none in sampled interval |

Dots per frame: 6 total, exactly 1 on each route in every frame. Dot direction follows each arrow, including the initially leftward boot return in v2 (its later upward/rightward turns are statically traceable but not reached during the sampled motion interval); no opposite-direction jump is seen except deliberate wrap to the beginning of a short route. Zero dots on any bridge or arrowhead in frames 0–20. The per-view observed origin-offset count is 6/6, independent of the check's `origins` assertion.

## v3-state

Title: `rataflow-view · 77x47 @100% · v3-state.json · 8 nodes · 7 edges · q quit` [2,1,72,1].

### Every visible graph label

| Label (verbatim) | Bounds |
|---|---|
| `bare-metal machines` | [8, 6, 19, 1] |
| `machine-agent` | [11, 14, 13, 1] |
| `public gRPC` | [12, 22, 11, 1] |
| `private gRPC` | [33, 22, 12, 1] |
| `River queue` | [34, 14, 11, 1] |
| `reconcile loop` | [54, 22, 14, 1] |
| `Postgres` | [35, 42, 8, 1] |
| `bare-metal providers` | [51, 42, 20, 1] |
| `runs on host` | [10, 10, 12, 1] |
| `register + heartbeat` | [13, 18, 20, 1] |
| `machine state` | [17, 38, 13, 1] |
| `machine rows` | [35, 29, 12, 1] |
| `job rows` | [21, 28, 8, 1] |
| `cluster state` | [41, 31, 13, 1] |
| `gcore sync, 1 min` | [53, 40, 17, 1] |

### Every node border and selected-state evidence

Every row below has all four sides and four corners complete, normal color continuous, and its whole selected border captured bold RGB (216,166,87).

| ID = source/target box label | Border bounds | Normal border RGB |
|---|---|---|
| mch = `bare-metal machines` | [7, 5, 21, 4] | (216, 166, 87) |
| agent = `machine-agent` | [10, 13, 15, 4] | (228, 184, 111) |
| pub = `public gRPC` | [11, 21, 13, 4] | (125, 174, 163) |
| pgrpc = `private gRPC` | [32, 21, 14, 4] | (147, 194, 183) |
| q = `River queue` | [33, 13, 13, 4] | (211, 134, 155) |
| rec = `reconcile loop` | [53, 21, 16, 4] | (226, 156, 175) |
| db = `Postgres` | [34, 41, 10, 4] | (169, 182, 101) |
| prov = `bare-metal providers` | [50, 41, 22, 4] | (125, 160, 184) |

### Every visible arrow, endpoint, and bend

| Source → target | Visible edge label | First drawn origin | Head position, direction/state | Cells | All bends / bridge cells in source-to-target order |
|---|---|---|---|---|---|
| mch → agent | `runs on host` | (8, 9) | (11, 12) ▼ down, intact | 7 | ╰ (8, 11); ╮ (11, 11) |
| agent → pub | `register + heartbeat` | (11, 17) | (12, 20) ▼ down, intact | 5 | ╰ (11, 19); ╮ (12, 19) |
| pub → db | `machine state` | (12, 25) | (35, 40) ▼ down, intact | 39 | ╰ (12, 39); ╮ (35, 39) |
| pgrpc → db | `machine rows` | (33, 25) | (37, 40) ▼ down, intact | 20 | ╰ (33, 36); ╮ (37, 36); ⌒ (37, 38) |
| q → db | `job rows` | (34, 17) | (39, 40) ▼ down, intact | 37 | ╯ (34, 19); ╭ (30, 19); ╰ (30, 38); ⌒ (37, 38); ╮ (39, 38) |
| rec → db | `cluster state` | (54, 25) | (41, 40) ▼ down, intact | 29 | ╯ (54, 38); ╭ (41, 38) |
| rec → prov | `gcore sync, 1 min` | (56, 25) | (51, 40) ▼ down, intact | 21 | ╯ (56, 39); ╭ (51, 39) |

### Ownership, crossings, branches, and fit

`machine state` at [17,38,13,1] ends immediately before the queue-route bend at (30,38). The intended public-gRPC run is below it at row 39. Thus the label can name the queue corridor instead. Other database labels are legible: `job rows` beside column 30, `machine rows` beside column 33, and `cluster state` beside column 54. One bridge glyph `⌒` at (37,38) crosses the queue horizontal run over the private-gRPC vertical run. Neither arrow has a head at this crossing; it is not a junction. Following the private-gRPC vertical through the bridge requires attention but does not require choosing a branch. The check describes q → db as 41 cells versus a 29-cell straight stair and calls the excess forced; the actual captured centerline has 37 drawn cells (36 unit moves). The check is explicitly natural/unknown-viewport, so its length is not a measured 77x47 path length.

The adjacent corners (11,19) and (12,19) belong to the same agent → public-gRPC edge. Four separate database arrowheads at columns 35, 37, 39, and 41 enter its top; no pre-box merge exists. Reconcile has independent ports at columns 54 and 56. Aside from the bridge at (37,38), no crossing, inter-route touching bend, or junction is visible.

Captured viewport: 77×47 at 100%, all diagram content visible. Measured occupied graph bounds (excluding UI) are [7,5,65,40], columns 7–71, rows 5–44. Check extent: `66x41 cells`; check crossings: `1 bridges, 0 touching bends`; check route assessment: `7/7 near-minimal, 0 detours, 1 forced, 0 shortened`. The visually counted bridge/touching totals agree with the check. Natural extent is reported, not substituted for the measured capture bounds. No unexplained detour or clipped region is visible; all turning geometry is enumerated above.

### Route-by-route captured motion

| Route | Frame-0 dot (origin above is one cell earlier) | Even-frame route indices, frames 0…20 | Observed corner occupancy (frame numbers at coordinates) |
|---|---|---|---|
| mch → agent | (8, 10) | 1,3,4,5,1,3,4,5,1,3,4 | ╮ (11, 11): frames [6, 7, 14, 15] |
| agent → pub | (11, 18) | 1,3,1,3,1,3,1,3,1,3,1 | ╮ (12, 19): frames [2, 3, 6, 7, 10, 11, 14, 15, 18, 19] |
| pub → db | (12, 26) | 1,2,3,4,5,6,7,8,9,10,11 | none in sampled interval |
| pgrpc → db | (33, 26) | 1,2,3,4,5,6,7,8,9,10,12 | none in sampled interval |
| q → db | (34, 18) | 1,3,4,5,7,8,9,10,11,12,13 | none in sampled interval |
| rec → db | (54, 26) | 1,2,3,4,5,6,7,8,9,10,11 | none in sampled interval |
| rec → prov | (56, 26) | 1,2,3,4,5,6,7,8,9,10,11 | none in sampled interval |

Dots per frame: 7 total, exactly 1 on each route in every frame. Dot direction follows each arrow, including the initially leftward boot return in v2 (its later upward/rightward turns are statically traceable but not reached during the sampled motion interval); no opposite-direction jump is seen except deliberate wrap to the beginning of a short route. Zero dots on any bridge or arrowhead in frames 0–20. The per-view observed origin-offset count is 7/7, independent of the check's `origins` assertion.

## v4-ops

Title: `rataflow-view · 77x47 @100% · v4-ops.json · 7 nodes · 6 edges · q quit` [2,1,70,1].

### Every visible graph label

| Label (verbatim) | Bounds |
|---|---|
| `River queue` | [25, 7, 11, 1] |
| `SSH + BMC ops` | [2, 25, 13, 1] |
| `S3 object store` | [23, 25, 15, 1] |
| `janitor app` | [46, 25, 11, 1] |
| `bare-metal machines` | [21, 33, 19, 1] |
| `webapi server` | [63, 33, 13, 1] |
| `Slack` | [67, 41, 5, 1] |
| `audit/verify reimage` | [4, 20, 20, 1] |
| `run machine-audit` | [3, 29, 17, 1] |
| `diagnose uploads` | [6, 22, 16, 1] |
| `diagnostic events` | [29, 23, 17, 1] |
| `proposed actions` | [46, 31, 16, 1] |
| `confirm + alerts` | [50, 39, 16, 1] |

### Every node border and selected-state evidence

Every row below has all four sides and four corners complete, normal color continuous, and its whole selected border captured bold RGB (216,166,87).

| ID = source/target box label | Border bounds | Normal border RGB |
|---|---|---|
| q = `River queue` | [24, 6, 13, 4] | (216, 166, 87) |
| ssh = `SSH + BMC ops` | [1, 24, 15, 4] | (125, 174, 163) |
| s3 = `S3 object store` | [22, 24, 17, 4] | (211, 134, 155) |
| jan = `janitor app` | [45, 24, 13, 4] | (228, 184, 111) |
| mch = `bare-metal machines` | [20, 32, 21, 4] | (169, 182, 101) |
| wapi = `webapi server` | [62, 32, 15, 4] | (200, 147, 68) |
| slack = `Slack` | [66, 40, 7, 4] | (125, 160, 184) |

### Every visible arrow, endpoint, and bend

| Source → target | Visible edge label | First drawn origin | Head position, direction/state | Cells | All bends / bridge cells in source-to-target order |
|---|---|---|---|---|---|
| q → ssh | `audit/verify reimage` | (25, 10) | (2, 23) ▼ down, intact | 37 | ╯ (25, 21); ╭ (2, 21) |
| q → s3 | `diagnose uploads` | (27, 10) | (23, 23) ▼ down, intact | 18 | ╯ (27, 22); ╭ (23, 22) |
| q → jan | `diagnostic events` | (29, 10) | (46, 23) ▼ down, intact | 31 | ╰ (29, 22); ╮ (46, 22) |
| ssh → mch | `run machine-audit` | (2, 28) | (21, 31) ▼ down, intact | 23 | ╰ (2, 30); ╮ (21, 30) |
| jan → wapi | `proposed actions` | (46, 28) | (63, 31) ▼ down, intact | 21 | ╰ (46, 30); ╮ (63, 30) |
| wapi → slack | `confirm + alerts` | (63, 36) | (67, 39) ▼ down, intact | 8 | ╰ (63, 38); ╮ (67, 38) |

### Ownership, crossings, branches, and fit

`diagnose uploads` at [6,22,16,1] sits immediately below the sibling queue → SSH horizontal run at row 21; its own S3 route bends at (23,22), just to its right. A reader can assign this label to the SSH route. The spec instead assigns queue → S3. Queue fan-out is three independent ports at columns 25, 27, and 29, not one line that branches.

No crossing, inter-route touching bend, bridge, junction, or shared-run branch is visible. The three queue arrows stay separate through their bends and destinations.

Captured viewport: 77×47 at 100%, all diagram content visible. Measured occupied graph bounds (excluding UI) are [1,6,76,38], columns 1–76, rows 6–43. Check extent: `77x39 cells`; check crossings: `0 bridges, 0 touching bends`; check route assessment: `6/6 near-minimal, 0 detours, 0 shortened`. The visually counted bridge/touching totals agree with the check. Natural extent is reported, not substituted for the measured capture bounds. No unexplained detour or clipped region is visible; all turning geometry is enumerated above.

### Route-by-route captured motion

| Route | Frame-0 dot (origin above is one cell earlier) | Even-frame route indices, frames 0…20 | Observed corner occupancy (frame numbers at coordinates) |
|---|---|---|---|
| q → ssh | (25, 11) | 1,2,3,4,5,6,7,8,9,10,12 | none in sampled interval |
| q → s3 | (27, 11) | 1,2,3,4,5,6,7,8,9,10,11 | none in sampled interval |
| q → jan | (29, 11) | 1,2,3,4,5,6,7,8,9,10,11 | none in sampled interval |
| ssh → mch | (2, 29) | 1,3,4,5,6,7,8,9,10,11,12 | none in sampled interval |
| jan → wapi | (46, 29) | 1,3,4,5,6,7,8,9,10,11,12 | none in sampled interval |
| wapi → slack | (63, 37) | 1,3,4,5,6,1,3,4,5,6,1 | ╮ (67, 38): frames [8, 9, 18, 19] |

Dots per frame: 6 total, exactly 1 on each route in every frame. Dot direction follows each arrow, including the initially leftward boot return in v2 (its later upward/rightward turns are statically traceable but not reached during the sampled motion interval); no opposite-direction jump is seen except deliberate wrap to the beginning of a short route. Zero dots on any bridge or arrowhead in frames 0–20. The per-view observed origin-offset count is 6/6, independent of the check's `origins` assertion.

## Blind scorecard (tool-usable JSON)

Counts are **occurrences across the four views**, not deduplicated semantic objects. Graph labels = node labels + edge labels. Visible UI labels count one title plus four controls per view. Crossings count a bridge once; `visible_bridge_glyphs` is a characterization of that same crossing, not another crossing. “Dot violations” below report independently observed failure categories; overlapping categories must not be summed. The union counts routes with at least one observed origin, visible-grid-speed, or corner problem. A route's absence from later full-cycle evidence is missing evidence, not a clean pass. No numeric rubric-derived quality score is assigned before seeing the rubric.

```json
{
  "round": 4,
  "case": "modal-machine-manager",
  "stage": "A",
  "views": {
    "v1-intake": {
      "visible_nodes": 5,
      "visible_edges": 4,
      "visible_graph_labels": 9,
      "visible_ui_labels": 5,
      "visible_crossings": 0,
      "visible_bridge_glyphs": 0,
      "touching_bends_between_routes": 0,
      "junctions": 0,
      "uncertain_label_owners": 1,
      "clipped_items": 0,
      "selected_node_occurrences": 5,
      "node_occurrences": 5,
      "animated_routes": 4,
      "dot_count_violation_routes": 0,
      "dot_origin_violation_routes": 4,
      "dot_uniform_grid_advance_violation_routes": 2,
      "dot_corner_occupancy_routes": 0,
      "dot_corner_route_frames": 0,
      "dot_bridge_occupancy_routes_observed": 0,
      "dot_arrowhead_occupancy_routes_observed": 0,
      "dot_violation_routes_union": 4,
      "routes_with_observed_cycle_repeat": 2,
      "routes_without_full_cycle_evidence": 2
    },
    "v2-provision": {
      "visible_nodes": 6,
      "visible_edges": 6,
      "visible_graph_labels": 12,
      "visible_ui_labels": 5,
      "visible_crossings": 0,
      "visible_bridge_glyphs": 0,
      "touching_bends_between_routes": 0,
      "junctions": 0,
      "uncertain_label_owners": 1,
      "clipped_items": 0,
      "selected_node_occurrences": 6,
      "node_occurrences": 6,
      "animated_routes": 6,
      "dot_count_violation_routes": 0,
      "dot_origin_violation_routes": 6,
      "dot_uniform_grid_advance_violation_routes": 4,
      "dot_corner_occupancy_routes": 4,
      "dot_corner_route_frames": 22,
      "dot_bridge_occupancy_routes_observed": 0,
      "dot_arrowhead_occupancy_routes_observed": 0,
      "dot_violation_routes_union": 6,
      "routes_with_observed_cycle_repeat": 3,
      "routes_without_full_cycle_evidence": 3
    },
    "v3-state": {
      "visible_nodes": 8,
      "visible_edges": 7,
      "visible_graph_labels": 15,
      "visible_ui_labels": 5,
      "visible_crossings": 1,
      "visible_bridge_glyphs": 1,
      "touching_bends_between_routes": 0,
      "junctions": 0,
      "uncertain_label_owners": 1,
      "clipped_items": 0,
      "selected_node_occurrences": 8,
      "node_occurrences": 8,
      "animated_routes": 7,
      "dot_count_violation_routes": 0,
      "dot_origin_violation_routes": 7,
      "dot_uniform_grid_advance_violation_routes": 4,
      "dot_corner_occupancy_routes": 2,
      "dot_corner_route_frames": 14,
      "dot_bridge_occupancy_routes_observed": 0,
      "dot_arrowhead_occupancy_routes_observed": 0,
      "dot_violation_routes_union": 7,
      "routes_with_observed_cycle_repeat": 2,
      "routes_without_full_cycle_evidence": 5
    },
    "v4-ops": {
      "visible_nodes": 7,
      "visible_edges": 6,
      "visible_graph_labels": 13,
      "visible_ui_labels": 5,
      "visible_crossings": 0,
      "visible_bridge_glyphs": 0,
      "touching_bends_between_routes": 0,
      "junctions": 0,
      "uncertain_label_owners": 1,
      "clipped_items": 0,
      "selected_node_occurrences": 7,
      "node_occurrences": 7,
      "animated_routes": 6,
      "dot_count_violation_routes": 0,
      "dot_origin_violation_routes": 6,
      "dot_uniform_grid_advance_violation_routes": 4,
      "dot_corner_occupancy_routes": 1,
      "dot_corner_route_frames": 4,
      "dot_bridge_occupancy_routes_observed": 0,
      "dot_arrowhead_occupancy_routes_observed": 0,
      "dot_violation_routes_union": 6,
      "routes_with_observed_cycle_repeat": 1,
      "routes_without_full_cycle_evidence": 5
    }
  },
  "totals": {
    "visible_nodes": 26,
    "visible_edges": 23,
    "visible_graph_labels": 49,
    "visible_ui_labels": 20,
    "visible_crossings": 1,
    "visible_bridge_glyphs": 1,
    "touching_bends_between_routes": 0,
    "junctions": 0,
    "uncertain_label_owners": 4,
    "clipped_items": 0,
    "selected_node_occurrences": 26,
    "node_occurrences": 26,
    "animated_routes": 23,
    "dot_count_violation_routes": 0,
    "dot_origin_violation_routes": 23,
    "dot_uniform_grid_advance_violation_routes": 14,
    "dot_corner_occupancy_routes": 7,
    "dot_corner_route_frames": 40,
    "dot_bridge_occupancy_routes_observed": 0,
    "dot_arrowhead_occupancy_routes_observed": 0,
    "dot_violation_routes_union": 23,
    "routes_with_observed_cycle_repeat": 8,
    "routes_without_full_cycle_evidence": 15,
    "visible_labels_including_ui": 69
  }
}
```

## Missing / limited evidence

- Full-cycle captures for 15 long routes are absent: the supplied direct files stop at 2000ms. Their full-cycle bridge, later-corner, and wrap behavior cannot be judged.
- Initial regular pane frame 0 is partial/unheaded in both text and ANSI frame pairs; the direct frame-0 text remedies positions, but not missing first-screen ANSI time alignment. Static ANSI and selected ANSI still fully show normal/selected border colors.
- Manifest pane rectangle/column measurement and literal viewport line are null. The direct captured `viewport:` line and title provide 77×47 target evidence instead.
- No exclusive individual-node selection sequence is supplied; all 26 selected borders are nonetheless visible in select-all frames.
- No required capture was wholly unreadable, and no required static spec/capture/check/manifest file was missing. Unread generation/attempt material was deliberately excluded, not treated as unavailable capture evidence.

This is the saved stage-A observation record. It is to remain unchanged after hashing and after any later disclosure of expectations.
