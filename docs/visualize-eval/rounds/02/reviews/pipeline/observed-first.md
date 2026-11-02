# Pipeline — round 02, stage A blind observation

## Scope and evidence

This record describes only the supplied final view `v1`. I read the stage-A contract, `pipeline/v1.json`, and these existing captures under `pipeline/evidence/v1/`:

- `v1-text.txt`: visible layout and text.
- `v1-ansi.ansi`: unselected cell colors and borders.
- `v1-selected.ansi`: selected cell colors and borders.
- `v1-frames.txt`: timestamped motion and measured viewport tokens.
- `v1-frames.ansi`: corresponding terminal transcript. The diagram frames in this file contain plain glyphs, not per-cell diagram color escapes; its shell prompts do have ANSI styling.

The spec was used only to identify intended animation and labels, not as proof of visibility or relationships. No source brief, expected relationships, rubric, dataset manifest, other case, or earlier-round result was read. No viewer was started and no capture was regenerated. No checker, validator, or generator claim is used as visual evidence. Coordinate and ANSI-style extraction below reads the supplied captures only.

## Coordinate convention and visible labels

Coordinates are 1-based `[column,row,width,height]`, relative to the view's top-left header cell, not the enclosing shell transcript. Positions are the same in the normal, selected, and five timestamped graph frames. Each label is one line. Spaces inside the following backticks are part of the label; surrounding border glyphs are not.

### Diagram labels: 10 total

| Kind | Verbatim label | Bounding box |
|---|---|---|
| Node | `CLI` | `[37,8,3,1]` |
| Node | `API gateway` | `[37,16,11,1]` |
| Node | `Job queue` | `[24,24,9,1]` |
| Node | `Auth` | `[50,24,4,1]` |
| Node | `Worker pool` | `[24,32,11,1]` |
| Node | `Postgres` | `[37,40,8,1]` |
| Edge | `enqueue` | `[28,20,7,1]` |
| Edge | `verify` | `[41,20,6,1]` |
| Edge | `write` | `[28,36,5,1]` |
| Edge | `read` | `[43,36,4,1]` |

All ten labels are legible and complete. There are no fused labels or fused words from adjacent labels. None has an uncertain owner: `enqueue` is above the leftward API-to-queue horizontal run; `verify` is above the rightward API-to-Auth run; `write` is above the Worker-to-Postgres run; `read` is above the Auth-to-Postgres run.

### View chrome: five additional text labels

These are not counted as graph labels or nodes in the scorecard.

| Verbatim label | Bounding box |
|---|---|
| `rataflow-view · 77x47 @100% · v1.json · 6 nodes · 6 edges · q quit` | `[2,1,66,1]` |
| `+ [+]` | `[4,42,5,1]` |
| `− [-]` | `[4,43,5,1]` |
| `⊡ [f]` | `[4,44,5,1]` |
| `□ [i]` | `[4,45,5,1]` |

The four controls occupy a separate complete control box `[2,41,9,6]`. The terminal command, prompt, viewport-report, and timestamp lines in `v1-frames.txt` are capture scaffolding, not diagram labels.

## Visible nodes and borders

Six node occurrences appear in the single final view. Each has a complete top, bottom, left side, right side, and all four rounded corners. Arrowheads sit immediately outside the destination border; route stems sit immediately outside the source border. No border is broken by an attachment or covered by a label.

The following RGB values come from the ANSI cell styles, not the plain text. Every perimeter cell of a given unselected node has the listed foreground color, including all corners and both side cells on both interior rows. All have background RGB `(40,40,40)`.

| Node | Full box `[column,row,width,height]` | Perimeter cells checked | Normal border RGB | Normal complete/color-continuous | Selected complete/color-continuous |
|---|---|---:|---|---|---|
| CLI | `[36,7,5,4]` | 14 | `(216,166,87)` | Yes / yes | Yes / yes |
| API gateway | `[36,15,13,4]` | 30 | `(125,174,163)` | Yes / yes | Yes / yes |
| Job queue | `[23,23,11,4]` | 26 | `(211,134,155)` | Yes / yes | Yes / yes |
| Auth | `[49,23,6,4]` | 16 | `(147,194,183)` | Yes / yes | Yes / yes |
| Worker pool | `[23,31,13,4]` | 30 | `(226,156,175)` | Yes / yes | Yes / yes |
| Postgres | `[36,39,10,4]` | 24 | `(169,182,101)` | Yes / yes | Yes / yes |

All 140 perimeter cells in the normal view and all 140 corresponding selected-view cells are present and nonblank. The selected capture gives every node a bold RGB `(216,166,87)` perimeter throughout. CLI's hue is already that RGB in the normal capture; its selected distinction in the ANSI evidence is boldness, not a hue change. Thus selected-state coverage is **6/6 node occurrences**; **0/6** lack their own captured selected border. This is one simultaneous all-selected capture, not six separate individual-selection sessions. Complete sides, corners, and normal/selected color continuity can be checked for **6/6**, and cannot be checked for **0/6**.

Visible node and edge labels use RGB `(235,219,178)`. Normal routes and arrowheads use muted RGB `(124,111,100)`; dots use RGB `(216,166,87)`. The selected capture preserves muted routes while making all selected borders bold gold. The timestamped frames do not provide diagram ANSI color evidence, so color continuity over time cannot be separately verified from those frames.

## Arrow-by-arrow trace

The coordinates below list the first route cell outside the source, each bend, and the final arrowhead cell. Node-border extents are listed above. All six routes are whole and followable without guessing. Every destination has a visible downward `▼` immediately above its top border.

| Source → target | Visible route waypoints `(column,row)` | Direction and arrowhead | Whole route traceable? |
|---|---|---|---|
| CLI → API gateway | `(37,11)` → `(37,14)` | Straight down; `▼` at `(37,14)` | Yes |
| API gateway → Job queue | `(37,19)` → `(37,21)` → `(24,21)` → `(24,22)` | Down, left, down; `▼` at `(24,22)` | Yes |
| API gateway → Auth | `(39,19)` → `(39,21)` → `(50,21)` → `(50,22)` | Down, right, down; `▼` at `(50,22)` | Yes |
| Job queue → Worker pool | `(24,27)` → `(24,30)` | Straight down; `▼` at `(24,30)` | Yes |
| Worker pool → Postgres | `(24,35)` → `(24,37)` → `(37,37)` → `(37,38)` | Down, right, down; `▼` at `(37,38)` | Yes |
| Auth → Postgres | `(50,27)` → `(50,37)` → `(39,37)` → `(39,38)` | Down, left, down; `▼` at `(39,38)` | Yes |

### Crossings, bends, junctions, and apparent branches

- **0 crossings**, **0 bridge glyphs**, **0 touching bends between routes**, **0 shared route cells/runs**, and **0 route-level junctions** are visible.
- Eight ordinary bends are visible: `(37,21)` `╯`, `(24,21)` `╭`, `(39,21)` `╰`, `(50,21)` `╮`, `(24,37)` `╰`, `(37,37)` `╮`, `(50,37)` `╯`, and `(39,37)` `╭`.
- API gateway has an apparent node-level two-way fan-out: two separate downward stems at columns 37 and 39, with blank column 38 between them. This is not a fork in one shared route.
- Postgres has an apparent node-level two-way fan-in: separate arrowheads at columns 37 and 39, again with blank column 38 between them. There is no merging route or junction before the box.
- The two route bends nearest API gateway, and the two bends nearest Postgres, remain separated by that blank column. They do not touch.
- Auth's long downward route at column 50 passes well to the right of Worker pool, whose right border is column 35. It does not enter or touch that box.

## Motion observed in the supplied five frames

The timestamps are exactly `0`, `200`, `400`, `600`, and `800 ms`. Each entry below is the single visible dot's `(column,row)`. Every route has **one dot in every sampled frame**: 30 route/frame observations, six dots per frame. Single-dot routes have no within-route inter-dot spacing to measure.

| Animated route | 0 ms | 200 ms | 400 ms | 600 ms | 800 ms |
|---|---|---|---|---|---|
| CLI → API gateway | `(37,12)` | `(37,13)` | `(37,12)` | `(37,13)` | `(37,12)` |
| API gateway → Job queue | `(37,20)` | `(36,21)` | `(35,21)` | `(34,21)` | `(33,21)` |
| API gateway → Auth | `(39,20)` | `(40,21)` | `(41,21)` | `(42,21)` | `(43,21)` |
| Job queue → Worker pool | `(24,28)` | `(24,29)` | `(24,28)` | `(24,29)` | `(24,28)` |
| Worker pool → Postgres | `(24,36)` | `(25,37)` | `(26,37)` | `(27,37)` | `(28,37)` |
| Auth → Postgres | `(50,28)` | `(50,29)` | `(50,30)` | `(50,31)` | `(50,32)` |

- CLI-to-API and queue-to-Worker alternate between two straight interior cells at the 200 ms sample cadence. Their 0→200 ms movements are downward, toward their arrowheads. The subsequent upward position reset repeats every 400 ms. These captures alone cannot distinguish wraparound from apparent back-and-forth motion between those two cells; no smooth full traversal is evidenced.
- API-to-queue moves down/left around the first bend, then one column left per 200 ms; API-to-Auth moves down/right around its first bend, then one column right per 200 ms. Both progress along the visible route in the source-to-target sense. The first sampled transition spans two Manhattan cells because the corner cell is not shown carrying the dot.
- Worker-to-Postgres moves down/right around the initial bend, then one column right per 200 ms, likewise skipping the corner in the sampled positions.
- Auth-to-Postgres moves one row downward per 200 ms in this interval. The supplied interval does not reach its lower bend or destination.
- **No sampled dot is on any of the eight corners, any arrowhead, any bridge, or any junction.** There are no bridges or route-level junctions to test. No sampled dot is missing or duplicated on a route. The normal and selected still captures also each visibly contain six dots on straight route cells, not on corners or arrowheads.
- **Observed dot violations: 0.** This is a bounded statement about the supplied frames, not proof of every unsampled instant or a full cycle on the longer routes. Instantaneous speed, intermediate cells, and behavior beyond 800 ms are not available.

## Fit and evidence limitations

The measured report in `v1-frames.txt` is, verbatim:

`viewport: 77x47 zoom: 1.00 natural`

It appears after the normal run, the selected run, and the frame command. The header independently says `77x47 @100%`. Both normal and selected ANSI captures contain **47 rows, each 77 character cells wide**. The plain text capture trims trailing spaces and the final blank row: it has 46 lines, with a maximum retained line length of 67 characters. That trimming is not evidence of clipped graph content.

The graph itself is contained in columns 23–54 and rows 7–42. The control box ends on row 46. All labels, all six boxes, all routes, all arrowheads, and all controls are inside the captured viewport. **0 clipped items** are observed; nothing visible needs pan or zoom. This statement concerns the supplied final view, not hypothetical undisclosed content. No required capture is missing or unreadable. Motion-frame color data is absent as noted above; the normal and selected ANSI stills supply color evidence for all node occurrences.

## Tool-usable blind scorecard

Counts describe the single final view; selected and animated captures are evidence states of the same six occurrences, not additional final views. Graph-label count excludes chrome.

```json
{
  "case": "pipeline",
  "round": "02",
  "stage": "A",
  "final_views": 1,
  "visible_nodes": 6,
  "visible_edges": 6,
  "visible_arrowheads": 6,
  "fully_traceable_edges": 6,
  "visible_labels": 10,
  "visible_node_labels": 6,
  "visible_edge_labels": 4,
  "visible_chrome_labels": 5,
  "crossings": 0,
  "bridges": 0,
  "touching_bends": 0,
  "ordinary_bends": 8,
  "route_junctions": 0,
  "node_level_fan_outs": 1,
  "node_level_fan_ins": 1,
  "uncertain_label_owners": 0,
  "fused_labels": 0,
  "clipped_items": 0,
  "normal_complete_color_continuous_borders": 6,
  "uncheckable_node_borders": 0,
  "selected_state_coverage": {"checked": 6, "total": 6},
  "animated_routes": 6,
  "sampled_frames": 5,
  "sampled_route_frame_observations": 30,
  "dots_per_route_per_sample": 1,
  "observed_dot_violations": 0,
  "motion_caveat": "Short routes visibly reset between two interior cells; wrap versus reversal is not resolved by these samples. Longer routes are not shown for a full cycle. Diagram color escapes are absent in the timestamped transcript.",
  "measured_viewport": {"columns": 77, "rows": 47, "zoom": 1.0},
  "viewport_token": "viewport: 77x47 zoom: 1.00 natural",
  "requires_pan_or_zoom": false,
  "missing_or_unreadable_capture_files": []
}
```

This stage-A record is finalized before receipt of any stage-B expectations. Its SHA-256 is reported separately; this file will not be modified after hashing.
