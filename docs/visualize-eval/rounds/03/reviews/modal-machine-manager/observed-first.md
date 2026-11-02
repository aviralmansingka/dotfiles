# Blind observations — round 03 / modal-machine-manager / stage A

This record was made before receiving expectations. I read only the four named final JSON specs and their supplied captures, manifests, and check output. I did not read a source, expected data, rubric, dataset manifest, other case, or earlier round; run a viewer; fix a candidate; or delegate. Coordinates below are 1-based terminal cells. Rectangles are `[column,row,width,height]`; points are `(column,row)`. Counts are occurrences across views, not deduplicated concepts. No expectation-based grade is assigned.

## Principal observation

The four 77×47 still/selected views are legible and fully contained. All 26 node occurrences have complete, color-continuous normal and selected borders. All 24 arrows can be traced in these views. There is one bridged crossing, in v4, and one visually uncertain edge-label owner, in v3.

**The motion captures do not visually establish the claimed origin-to-arrowhead cycle.** In the complete, explicitly numbered `checks/` sequences, frame 0 is present but the viewport is **80×24**, not 77×47. Some origins/routes are outside that viewport. The 20 routes whose dots can be located in those labeled frame-0 dumps start on the second edge cell, not the first cell adjacent to their source border. Three more such positions appear in the untimestamped truncated predecessors to pane frame 1; one route's frame-0 position is absent from both sources. Most decisively, **every route lacks a visible dot at frame 20**, and no dot visibly occupies an arrowhead in any supplied frame. The pane sequences show short-route dots disappearing earlier than long-route dots. Therefore visible synchronized arrowhead arrival is not demonstrated; it is contradicted if “reaches its arrowhead” requires a visible dot there.

## Fit and evidence provenance

| View | Measured ANSI still grid | Still header viewport token | `check.txt` viewport line | Check-reported extent | Visible/check crossings |
|---|---|---|---|---|---|
| v1 | 77 columns × 47 rows | `77x47 @100%` | `viewport: unknown zoom: 1.00 natural` | `extent=64x40 cells` | 0 / 0 |
| v2 | 77 columns × 47 rows | `77x47 @100%` | `viewport: unknown zoom: 1.00 natural` | `extent=40x41 cells` | 0 / 0 |
| v3 | 77 columns × 47 rows | `77x47 @100%` | `viewport: unknown zoom: 1.00 natural` | `extent=42x32 cells` | 0 / 0 |
| v4 | 77 columns × 47 rows | `77x47 @100%` | `viewport: unknown zoom: 1.00 natural` | `extent=69x23 cells` | 1 / 1 |

The still `.txt` files have 46 retained rows and a maximum retained line width of 76 because trailing whitespace is absent. The normal ANSI stills preserve 47 rows of 77 cells each. Thus 77×47 is measured from captured cells as well as stated in the header, not inferred from a spec. The manifests have `pane_cols: null`, `pane_rect: null`, `pane_rows: 47`, `viewport_line: null`, and `viewport_token: "77x47 @100%"`; an independent pane-rectangle measurement is missing. All four manifests report `cleanup: "confirmed_closed"`; I did not independently open or close panes.

No graph item in the 77×47 stills or numbered pane frames requires pan or zoom. No node, arrow, or graph label is clipped there. The controls occupy a separate lower-left area. All numbered pane frames 1–20 have the 77×47 header. Each pane frame capture has an untimestamped 36-line predecessor before `frame 1 at 100ms`; the first 11 screen lines and frame-0 marker/header are lost. I do not describe that predecessor as a complete timestamped frame 0.

Each `checks/vN-frames-full.txt` instead begins exactly `viewport: 80x24 zoom: 1.00 natural` and contains all 21 numbered frames, 0–20 at 100 ms increments. This is temporally complete evidence but not spatially complete evidence for the 77×47 graph. Its static geometry is translated relative to the stills by v1 `( +2, -12 )`, v2 `( +1, -12 )`, v3 `( +2, -11 )`, v4 `( +2, -12 )`, before header/controls/minimap overlays. These translations follow matching captured boxes, arrows, and labels, not a viewer run.

Specific 80×24 limitations:

- v1: `Modal control plane`, `humans + mmctl`, and `bare-metal providers` are offscreen. `create/terminate/repair` and `http` are offscreen. The top incoming arrow near the right is also in the overflow-warning area. The bottom provider route is cut off after its initial cells. Only four of six frame-0 dots are visible.
- v2: `bare-metal providers` and `Postgres` are offscreen. `allocate instance`, `iPXE request`, and `machine state` are offscreen/under the header. The overflow warning replaces part of the boot-server top border. Only four of six frame-0 dots are visible.
- v3: `River job queue`, `S3 object store`, and `Slack` boxes are offscreen. The minimap cuts the webapi box and its label to the visible fragment `webapi s` at `[47,17,8,1]`. All seven frame-0 dots are visible, but source/target boxes are not all visible together.
- v4: all six node labels are visible. The controls replace the reconcile-to-Postgres route's lower-left bend/nearby horizontal cells, so that route is not fully traceable in this supplementary viewport. Its dot is hidden specifically at frames 13 and 14, although visible in the corresponding pane frames.
- The overflow warning in v1–v3 is `graph overflows · drag to pan` at `[51,2,29,1]`. It is absent in v4. Minimap blocks are not additional diagram nodes or labels.

The four `check.txt` files claim zero dot violations, complete origins, and all flows synchronized at 2000 ms. Those are program reports, not substitutes for captured-cell observations. They conflict with the visibly absent endpoint dots and the measured first-dot positions described here.

## Visible labels, boxes, and border colors

All node borders below have their entire top, bottom, left, and right sides and all four rounded corners present: `╭`, `╮`, `╰`, `╯`. In each row of these tables, every normal border cell has the listed single RGB foreground. No border cell changes to an edge color, background, or missing glyph. In the selected captures, **every border cell of every listed node is RGB `(216,166,87)` and bold**, including all corners. Thus selected-state coverage is v1 7/7, v2 6/6, v3 7/7, v4 6/6, total **26/26**. These are per-node captured border occurrences in select-all frames, not 26 independently interacted selection events.

### v1 — `specs/v1-attempt2.json`

| Node label, verbatim | Label rectangle | Box rectangle | Normal border RGB |
|---|---|---|---|
| `humans + mmctl` | `[54,8,14,1]` | `[53,7,16,4]` | `(216,166,87)` |
| `Modal control plane` | `[10,8,19,1]` | `[9,7,21,4]` | `(125,174,163)` |
| `webapi server` | `[54,16,13,1]` | `[53,15,15,4]` | `(147,194,183)` |
| `private gRPC` | `[10,16,12,1]` | `[9,15,14,4]` | `(211,134,155)` |
| `River job queue` | `[32,24,15,1]` | `[31,23,17,4]` | `(169,182,101)` |
| `provider registry` | `[32,32,17,1]` | `[31,31,19,4]` | `(125,160,184)` |
| `bare-metal providers` | `[32,40,20,1]` | `[31,39,22,4]` | `(151,184,206)` |

| Edge label, verbatim | Label rectangle | Arrow ID |
|---|---|---|
| `http` | `[56,12,4,1]` | v1.E1 |
| `create/terminate/repair` | `[12,12,23,1]` | v1.E2 |
| `reinstall/reprovision` | `[35,22,21,1]` | v1.E3 |
| `enqueue job` | `[16,20,11,1]` | v1.E4 |
| `provision job` | `[34,28,13,1]` | v1.E5 |
| `provider API` | `[34,36,12,1]` | v1.E6 |

### v2 — `specs/v2-attempt3.json`

| Node label, verbatim | Label rectangle | Box rectangle | Normal border RGB |
|---|---|---|---|
| `bare-metal providers` | `[21,6,20,1]` | `[20,5,22,4]` | `(216,166,87)` |
| `bare-metal machines` | `[22,16,19,1]` | `[21,14,21,5]` | `(125,174,163)` |
| `boot server` | `[47,16,11,1]` | `[46,14,13,5]` | `(147,194,183)` |
| `machine-agent` | `[25,24,13,1]` | `[24,23,15,4]` | `(99,151,141)` |
| `public gRPC` | `[26,33,11,1]` | `[25,32,13,4]` | `(211,134,155)` |
| `Postgres` | `[27,42,8,1]` | `[26,41,10,4]` | `(169,182,101)` |

| Edge label, verbatim | Label rectangle | Arrow ID |
|---|---|---|
| `allocate instance` | `[23,10,17,1]` | v2.E1 |
| `iPXE request` | `[37,13,12,1]` | v2.E2 |
| `boot.ipxe + S3 args` | `[35,19,19,1]` | v2.E3 |
| `runs on host` | `[24,20,12,1]` | v2.E4 |
| `register + heartbeat` | `[27,28,20,1]` | v2.E5 |
| `machine state` | `[28,37,13,1]` | v2.E6 |

### v3 — `specs/v3-attempt3.json`

| Node label, verbatim | Label rectangle | Box rectangle | Normal border RGB |
|---|---|---|---|
| `River job queue` | `[22,10,15,1]` | `[21,9,17,4]` | `(216,166,87)` |
| `SSH + BMC ops` | `[23,19,13,1]` | `[22,18,15,4]` | `(125,174,163)` |
| `janitor app` | `[46,19,11,1]` | `[45,18,13,4]` | `(228,184,111)` |
| `bare-metal machines` | `[20,28,19,1]` | `[19,27,21,4]` | `(147,194,183)` |
| `S3 object store` | `[22,37,15,1]` | `[21,36,17,4]` | `(211,134,155)` |
| `webapi server` | `[45,28,13,1]` | `[44,27,15,4]` | `(169,182,101)` |
| `Slack` | `[49,37,5,1]` | `[48,36,7,4]` | `(125,160,184)` |

| Edge label, verbatim | Label rectangle | Arrow ID / visual ownership |
|---|---|---|
| `audit + verify` | `[25,17,14,1]` | v3.E1 |
| `run machine-audit` | `[25,23,17,1]` | v3.E2 |
| `diagnose uploads` | `[25,34,16,1]` | Spec says v3.E3; visual owner uncertain |
| `boot image` | `[22,32,10,1]` | v3.E4 |
| `diagnostic events` | `[28,15,17,1]` | v3.E5 |
| `proposed actions` | `[29,24,16,1]` | v3.E6 |
| `confirm + alerts` | `[28,33,16,1]` | v3.E7 |

`diagnose uploads` starts immediately to the right of the *machine-to-S3* vertical at column 24, row 34; the queue-to-S3 route is instead at column 17 and turns through columns 17–22 on that row. A reader could reasonably attach this label to the neighboring machine-to-S3 arrow. I count one uncertain label owner, even though the JSON discloses its intended owner. `proposed actions` and `confirm + alerts` are left of the right-hand chain and close to other geometry, but remain more plausibly attached to that chain; I do not count them as additional uncertain owners. No graph label occupies a route cell.

### v4 — `specs/v4-attempt2.json`

| Node label, verbatim | Label rectangle | Box rectangle | Normal border RGB |
|---|---|---|---|
| `cluster reconcile loop` | `[6,15,22,1]` | `[5,14,24,4]` | `(216,166,87)` |
| `private gRPC` | `[60,15,12,1]` | `[59,14,14,4]` | `(125,174,163)` |
| `River job queue` | `[37,15,15,1]` | `[36,14,17,4]` | `(228,184,111)` |
| `public gRPC` | `[12,24,11,1]` | `[11,23,13,4]` | `(147,194,183)` |
| `bare-metal providers` | `[34,24,20,1]` | `[33,23,22,4]` | `(211,134,155)` |
| `Postgres` | `[13,33,8,1]` | `[12,32,10,4]` | `(169,182,101)` |

| Edge label, verbatim | Label rectangle | Arrow ID |
|---|---|---|
| `gcore sync, 1 min` | `[13,20,17,1]` | v4.E1 |
| `cluster state` | `[8,22,13,1]` | v4.E2 |
| `machine rows` | `[36,30,12,1]` | v4.E3 |
| `job rows` | `[20,28,8,1]` | v4.E4 |
| `machine state` | `[14,27,13,1]` | v4.E5 |

### Presentation labels, not graph labels

Each still has one header at `[2,1,75,1]`, verbatim:

- v1: `rataflow-view · 77x47 @100% · v1-attempt2.json · 7 nodes · 6 edges · q quit`
- v2: `rataflow-view · 77x47 @100% · v2-attempt3.json · 6 nodes · 6 edges · q quit`
- v3: `rataflow-view · 77x47 @100% · v3-attempt3.json · 7 nodes · 7 edges · q quit`
- v4: `rataflow-view · 77x47 @100% · v4-attempt2.json · 6 nodes · 5 edges · q quit`

Each still also has `+ [+]` at `[4,42,5,1]`, `− [-]` at `[4,43,5,1]`, `⊡ [f]` at `[4,44,5,1]`, and `□ [i]` at `[4,45,5,1]`. Their enclosing square-cornered control border is `[2,41,9,6]`, complete and uniformly RGB `(168,153,104)` in normal and selected stills. These are not diagram nodes. The supplementary 80×24 frames retain these four control labels at rows 19, 20, 21, 22, respectively; their control box is `[2,18,9,6]`. Supplementary headers substitute `80x24` for `77x47`, without changing the other header text or its width.

## Every visible arrow and route geometry

All coordinates in this section refer to the 77×47 views. A path list starts at the first edge cell outside the source border, lists every turn, and ends at the arrowhead immediately before the target border. Straight segments between listed points are visible throughout. All 24 paths are traceable without guessing their source or target box in the 77×47 view, notwithstanding the one ambiguous *label* owner. All arrowheads are present, correctly oriented, and separate from the target's intact border. All paths are solid, muted RGB `(124,111,100)` between highlighted dots; no dashed arrow is visible. There are 22 `▼`, one `▶`, and one `◀` arrowheads.

### v1

| Arrow | Source box → target box | Travel | Complete path, including all bends and arrowhead |
|---|---|---|---|
| E1 | `humans + mmctl` → `webapi server` | down; `▼` | `(54,11) → (54,14)` |
| E2 | `Modal control plane` → `private gRPC` | down; `▼` | `(10,11) → (10,14)` |
| E3 | `webapi server` → `River job queue` | down, left, down; `▼` | `(54,19) → (54,21) → (34,21) → (34,22)` |
| E4 | `private gRPC` → `River job queue` | down, right, down; `▼` | `(10,19) → (10,21) → (32,21) → (32,22)` |
| E5 | `River job queue` → `provider registry` | down; `▼` | `(32,27) → (32,30)` |
| E6 | `provider registry` → `bare-metal providers` | down; `▼` | `(32,35) → (32,38)` |

Every bend glyph: `(10,21) ╰`, `(32,21) ╮`, `(34,21) ╭`, `(54,21) ╯`. The two inward turns at columns 32 and 34 are separated by column 33, not touching or joined. Two distinct arrows enter the queue at `(32,22)` and `(34,22)`; this is convergence on one box, not a shared edge or junction. No crossing, bridge glyph, shared run, or in-route branch is visible.

### v2

| Arrow | Source box → target box | Travel | Complete path |
|---|---|---|---|
| E1 | `bare-metal providers` → `bare-metal machines` | down, right, down; `▼` | `(21,9) → (21,12) → (22,12) → (22,13)` |
| E2 | `bare-metal machines` → `boot server` | right; `▶` | `(42,15) → (45,15)` |
| E3 | `boot server` → `bare-metal machines` | left; `◀` | `(45,17) → (42,17)` |
| E4 | `bare-metal machines` → `machine-agent` | down, right, down; `▼` | `(22,19) → (22,21) → (25,21) → (25,22)` |
| E5 | `machine-agent` → `public gRPC` | down, right, down; `▼` | `(25,27) → (25,30) → (26,30) → (26,31)` |
| E6 | `public gRPC` → `Postgres` | down, right, down; `▼` | `(26,36) → (26,39) → (27,39) → (27,40)` |

Every bend glyph: `(21,12) ╰`, `(22,12) ╮`, `(22,21) ╰`, `(25,21) ╮`, `(25,30) ╰`, `(26,30) ╮`, `(26,39) ╰`, `(27,39) ╮`. The adjacent corner pairs in rows 12, 30, and 39 are intentional one-cell horizontal steps *within a single route*, not two touching unrelated routes. The two machine/boot arrows occupy distinct rows, 15 and 17, with opposite heads and no shared cells. There is no crossing, bridge, or in-route junction. The machines box has two incoming and two outgoing arrows on distinct ports; it is not an accidental branch in one stroke.

### v3

| Arrow | Source box → target box | Travel | Complete path |
|---|---|---|---|
| E1 | `River job queue` → `SSH + BMC ops` | down, left, down; `▼` | `(24,13) → (24,16) → (23,16) → (23,17)` |
| E2 | `SSH + BMC ops` → `bare-metal machines` | down, left, down; `▼` | `(23,22) → (23,25) → (20,25) → (20,26)` |
| E3 | `River job queue` → `S3 object store` | down, left, down, right, down; `▼` | `(22,13) → (22,15) → (17,15) → (17,34) → (22,34) → (22,35)` |
| E4 | `bare-metal machines` → `S3 object store` | down, right, down; `▼` | `(20,31) → (20,33) → (24,33) → (24,35)` |
| E5 | `River job queue` → `janitor app` | down, right, down; `▼` | `(26,13) → (26,16) → (46,16) → (46,17)` |
| E6 | `janitor app` → `webapi server` | down, left, down; `▼` | `(46,22) → (46,25) → (45,25) → (45,26)` |
| E7 | `webapi server` → `Slack` | down, right, down; `▼` | `(45,31) → (45,34) → (49,34) → (49,35)` |

Every bend glyph: `(17,15) ╭`, `(22,15) ╯`, `(23,16) ╭`, `(24,16) ╯`, `(26,16) ╰`, `(46,16) ╮`, `(20,25) ╭`, `(23,25) ╯`, `(45,25) ╭`, `(46,25) ╯`, `(20,33) ╰`, `(24,33) ╮`, `(17,34) ╰`, `(22,34) ╮`, `(45,34) ╰`, `(49,34) ╮`. Adjacent bends at columns 23/24 in row 16 and 45/46 in row 25 belong to their respective one-cell horizontal steps. None is a touch between unrelated routes.

The queue visibly fans out from three separate bottom ports at columns 22, 24, 26. The S3 box has two separate incoming arrowheads at columns 22 and 24, row 35. There is no shared bus, crossing, bridge glyph, shared run, or actual in-route junction. The two S3 routes are geometrically separable even though `diagnose uploads` is visually attached to the wrong neighborhood.

### v4

| Arrow | Source box → target box | Travel | Complete path |
|---|---|---|---|
| E1 | `cluster reconcile loop` → `bare-metal providers` | down, right, down; `▼` | `(8,18) → (8,21) → (34,21) → (34,22)` |
| E2 | `cluster reconcile loop` → `Postgres` | down, right, down; `▼` | `(6,18) → (6,30) → (13,30) → (13,31)` |
| E3 | `private gRPC` → `Postgres` | down, left, up, left, down; `▼` | `(60,18) → (60,31) → (23,31) → (23,30) → (19,30) → (19,31)` |
| E4 | `River job queue` → `Postgres` | down, left, down, left, down; `▼` | `(37,18) → (37,20) → (31,20) → (31,29) → (17,29) → (17,31)` |
| E5 | `public gRPC` → `Postgres` | down, right, down; `▼` | `(12,27) → (12,29) → (15,29) → (15,31)` |

Every bend glyph: `(31,20) ╭`, `(37,20) ╯`, `(8,21) ╰`, `(34,21) ╮`, `(12,29) ╰`, `(15,29) ╮`, `(17,29) ╭`, `(31,29) ╯`, `(6,30) ╰`, `(13,30) ╮`, `(19,30) ╭`, `(23,30) ╮`, `(23,31) ╰`, `(60,31) ╯`.

There is exactly one visible crossing: **`(31,21) ⌒`**, where the horizontal reconcile-to-provider route passes across the vertical queue-to-Postgres route. The hump denotes a bridge, not a T-junction or shared branch. The vertical route continues immediately above and below. The two arrows remain traceable through the crossing. No other crossing or touching unrelated bend is visible. The reconcile box has two outgoing ports at columns 6 and 8. Postgres has four distinct incoming heads at `(13,31)`, `(15,31)`, `(17,31)`, `(19,31)`, not one merged stroke. The unusual private-gRPC approach includes a short upward step at column 23; its final arrow still points down into Postgres.

## Motion — captured dots, not program assertions

Frame number `n` means `n × 100 ms`. I inspected all 21 frames of each supplied complete `checks/` dump and all numbered pane frames 1–20, including their dot coordinates. Per-route positions below use the 77×47 coordinate system so they can be compared directly with the route tables. Full-dump dots are registered by the geometry translation above. `D` means the position is directly visible in the **labeled** full frame 0. `T` means it appears only in the truncated, untimestamped predecessor before pane frame 1, consistent with frame 0 but not independently timestamped. `?` means frame-0 position is unavailable. `none` means no dot is visible on the route in that numbered 77×47 frame, not merely absent because of a supplementary crop.

### Per-route dot counts and endpoint behavior

For every nonempty frame range listed below, the route has exactly one visible dot. For every `none` range, it has zero. No route ever has two dots in a supplied frame. For frame 0, the position's evidence code controls whether that count is directly established. The first edge cell and arrowhead are in the route tables above.

| Route | Frame-0 position/evidence | Numbered pane frames with one dot | Numbered pane frames with none | Last visible dot: frame / coordinate | Arrowhead ever visibly occupied? |
|---|---|---|---|---|---|
| v1.E1 | `(54,12)` T | 1–14 | 15–20 | 14 / `(54,13)` | no |
| v1.E2 | `(10,12)` T | 1–14 | 15–20 | 14 / `(10,13)` | no |
| v1.E3 | `(54,20)` D | 1–19 | 20 | 19 / `(35,21)` | no |
| v1.E4 | `(10,20)` D | 1–19 | 20 | 19 / `(31,21)` | no |
| v1.E5 | `(32,28)` D | 1–14 | 15–20 | 14 / `(32,29)` | no |
| v1.E6 | `(32,36)` D | 1–14 | 15–20 | 14 / `(32,37)` | no |
| v2.E1 | `?` | 1–14 | 15–20 | 14 / `(21,11)` | no |
| v2.E2 | `(43,15)` D | 1–14 | 15–20 | 14 / `(44,15)` | no |
| v2.E3 | `(44,17)` D | 1–14 | 15–20 | 14 / `(43,17)` | no |
| v2.E4 | `(22,20)` D | 1–16 | 17–20 | 16 / `(24,21)` | no |
| v2.E5 | `(25,28)` D | 1–14 | 15–20 | 14 / `(25,29)` | no |
| v2.E6 | `(26,37)` T | 1–14 | 15–20 | 14 / `(26,38)` | no |
| v3.E1 | `(24,14)` D | 1–14 | 15–20 | 14 / `(24,15)` | no |
| v3.E2 | `(23,23)` D | 1–17 | 18–20 | 17 / `(21,25)` | no |
| v3.E3 | `(22,14)` D | 1–19 | 20 | 19 / `(21,34)` | no |
| v3.E4 | `(20,32)` D | 1–17 | 18–20 | 17 / `(24,34)` | no |
| v3.E5 | `(26,14)` D | 1–19 | 20 | 19 / `(45,16)` | no |
| v3.E6 | `(46,23)` D | 1–14 | 15–20 | 14 / `(46,24)` | no |
| v3.E7 | `(45,32)` D | 1–17 | 18–20 | 17 / `(48,34)` | no |
| v4.E1 | `(8,19)` D | 1–19 | 20 | 19 / `(33,21)` | no |
| v4.E2 | `(6,19)` D | 1–19 | 20 | 19 / `(12,30)` | no |
| v4.E3 | `(60,19)` D | 1–19 | 20 | 19 / `(22,30)` | no |
| v4.E4 | `(37,19)` D | 1–19 | 20 | 19 / `(17,30)` | no |
| v4.E5 | `(12,28)` D | 1–17 | 18–20 | 17 / `(15,30)` | no |

For the 20 D positions, the initial dot is one route cell beyond the first cell adjacent to the source border. For example v4.E1's source bottom is row 17, the first edge cell is `(8,18)`, and the frame-0 dot is `(8,19)`. This is two cells beyond the source border, not directly at its outgoing start. The three T positions exhibit the same offset. The v2.E1 initial position cannot be established from a labeled frame 0: its whole allocation route is above the 80×24 viewport, and the pane predecessor starts after that dot's row. I do not infer it from the spec or from frame 1.

### Per-frame totals

These lists explicitly give frames **1 through 20**, in order, from the full-fit pane captures:

- v1: `[6,6,6,6,6,6,6,6,6,6,6,6,6,6,2,2,2,2,2,0]`
- v2: `[6,6,6,6,6,6,6,6,6,6,6,6,6,6,1,1,0,0,0,0]`
- v3: `[7,7,7,7,7,7,7,7,7,7,7,7,7,7,5,5,5,2,2,0]`
- v4: `[5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,4,4,0]`

For completeness, the **80×24 full-dump visible totals**, frames **0 through 20**, are:

- v1: `[4,4,4,4,4,3,3,3,3,3,3,3,3,3,3,2,2,2,2,2,0]`
- v2: `[4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,1,1,0,0,0,0]`
- v3: `[7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,5,5,5,2,2,0]`
- v4: `[5,5,5,5,5,5,5,5,5,5,5,5,5,4,4,5,5,5,4,4,0]`

Supplementary totals are lower because of clipping/overlays and cannot be treated as evidence of global dot deletion. The pane totals do establish true visible disappearance in the full-fit views.

### Spacing, direction, turns, bridges, and timing

- There is never periodic multi-dot spacing: every visible route has at most one dot. Independent routes keep distinct ports; no two dots occupy the same cell.
- All observed dot motion advances in source-to-target order on the polylines listed above; no reversal or movement onto another route is visible. This includes the rightward and leftward machine/boot pair in v2 and the short upward approach segment in v4.E3.
- Motion is quantized, with repeated positions and jumps rather than one cell per 100 ms everywhere. Examples: v1.E1 stays at `(54,12)` for frames 0–4 (frame 0 only T evidence), then `(54,13)` for frames 5–14; v2.E4 has `(22,20)` for 0–3, `(23,21)` for 4–9, `(24,21)` for 10–16. The longest v4 paths jump up to four route cells between supplied visible frames.
- No dot is visible on a corner, bridge, or arrowhead in any supplied numbered frame. Dots jump over corner cells. At the v4 bridge, the horizontal dot is `(30,21)` at frame 18 and `(33,21)` at frame 19, skipping `(31,21) ⌒`; the vertical route moves from `(32,20)` at frame 4 to `(31,23)` at frame 5, also skipping the bridge cell.
- Dots disappear at different times: v1 short routes have none from 1500 ms while its long queue inputs continue through 1900 ms; v2 routes stop at 1500 or 1700 ms; v3 routes stop at 1500, 1800, or 2000 ms; v4 the public-gRPC dot stops at 1800 ms while other dots remain through 1900 ms.
- At frame 20 / 2000 ms, all four complete dumps and all four pane sequences show arrowheads but **zero `●` dots**. No visible arrowhead-arrival frame exists for any route. Common disappearance by 2000 ms is not visible common arrival at arrowheads.

Across numbered pane frames 1–20 there are 480 route-frame opportunities (24 routes × 20). Exactly 390 have one visible dot, 90 have none, and zero have more than one. Missing-dot route-frame counts by view are 26, 34, 23, 7. Every one of the 24 routes has a visible-dot-count violation at least at frame 20. These counts are not summed with origin or endpoint failures: they overlap on the same routes.

## Tool-usable blind scorecard

`labels` means node-label plus edge-label occurrences, excluding presentation chrome. `clipped_items` refers to the primary 77×47 views, not the explicitly deficient supplementary 80×24 dumps. `dot_violating_routes` means routes with any full-fit numbered frame containing zero or multiple visible dots. `visible_arrowhead_arrivals` requires an actually visible dot at the arrowhead, not an assertion in check output.

```json
{
  "stage": "A",
  "case": "modal-machine-manager",
  "views": {
    "v1": {"visible_nodes": 7, "visible_edges": 6, "labels": 13, "crossings": 0, "uncertain_label_owners": 0, "clipped_items": 0, "selected_captured": 7, "selected_total": 7, "dot_violating_routes": 6, "missing_dot_route_frames_1_20": 26},
    "v2": {"visible_nodes": 6, "visible_edges": 6, "labels": 12, "crossings": 0, "uncertain_label_owners": 0, "clipped_items": 0, "selected_captured": 6, "selected_total": 6, "dot_violating_routes": 6, "missing_dot_route_frames_1_20": 34},
    "v3": {"visible_nodes": 7, "visible_edges": 7, "labels": 14, "crossings": 0, "uncertain_label_owners": 1, "clipped_items": 0, "selected_captured": 7, "selected_total": 7, "dot_violating_routes": 7, "missing_dot_route_frames_1_20": 23},
    "v4": {"visible_nodes": 6, "visible_edges": 5, "labels": 11, "crossings": 1, "uncertain_label_owners": 0, "clipped_items": 0, "selected_captured": 6, "selected_total": 6, "dot_violating_routes": 5, "missing_dot_route_frames_1_20": 7}
  },
  "total": {
    "visible_nodes": 26,
    "visible_edges": 24,
    "labels": 50,
    "node_labels": 26,
    "edge_labels": 24,
    "presentation_labels": 20,
    "crossings": 1,
    "bridge_glyphs": 1,
    "in_route_junctions": 0,
    "shared_route_runs": 0,
    "unrelated_touching_bends": 0,
    "uncertain_label_owners": 1,
    "labels_on_route_cells": 0,
    "clipped_items": 0,
    "complete_color_continuous_normal_borders": 26,
    "complete_color_continuous_selected_borders": 26,
    "selected_state_coverage": {"captured": 26, "total": 26},
    "animated_routes": 24,
    "dot_violating_routes": 24,
    "route_frames_assessed_1_20": 480,
    "single_dot_route_frames_1_20": 390,
    "missing_dot_route_frames_1_20": 90,
    "multiple_dot_route_frames_1_20": 0,
    "frame0_origins_directly_assessable": 20,
    "frame0_observed_origin_offsets": 20,
    "frame0_confirmed_true_origin_starts": 0,
    "frame0_tail_only_additional_offset_positions": 3,
    "frame0_positions_missing_entirely": 1,
    "visible_arrowhead_arrivals": 0,
    "routes_without_visible_dot_at_frame20": 24,
    "dots_observed_on_corners": 0,
    "dots_observed_on_bridges": 0,
    "dots_observed_on_arrowheads": 0,
    "synchronized_visible_arrowhead_arrival_demonstrated": false
  },
  "primary_viewport": [77, 47],
  "complete_numbered_motion_dump_viewport": [80, 24],
  "missing_evidence": [
    "Complete timestamped 77x47 frame 0 for each view",
    "Any frame-0 dot position for v2 allocate instance",
    "Independent pane rectangle/column measurement (manifest values null)",
    "Visible dot arrival at each arrowhead"
  ],
  "unreadable_files": []
}
```

## Evidence accessibility and limits

The four named final specs; all normal text/ANSI, selected ANSI, pane text/ANSI frame captures; all four full-cycle text dumps; and their manifest/check metadata were readable. No unsupported format or missing named file prevented reading. ANSI frame captures include trailing shell-prompt material after the renderer output; it is not graph content. Normal/selected ANSI, rather than plain text, establishes the border colors above. The supplementary frame dumps' viewport/crop and the pane frame-0 truncation are evidence limitations, not repaired or extrapolated away here.

This is the saved stage-A blind record. Its SHA-256 is reported separately so this file need not be changed after saving.
