# Stage A — blind observations: modal-machine-manager

This record uses only the four final candidate specs and their existing captures under `modal-machine-manager/evidence/v1` through `v4`. No source brief, expected relationships, rubric, manifest, other case, earlier round, generator narrative, or validator verdict was consulted. No viewer was launched. Coordinates below describe captured cells, not spec coordinates. The specs establish intended text only, not visibility or correctness.

## Measurement conventions and evidence limits

- All coordinates are 1-based. Label bounds are `[column,row,width,height]`, excluding surrounding padding. Box bounds include the border. A route point is `(column,row)`.
- Each base ANSI capture contains exactly **47 rows of 77 cells**. Every selected ANSI capture has the same dimensions. Text captures retain the same content but trim trailing spaces.
- Each view's recorded log contains the token **`viewport: 77x47 zoom: 1.00 natural`**. The visible header reports `77x47 @100%`.
- Read: all four `*-text.txt`, `*-ansi.ansi`, `*-selected.ansi`, `*-frames.txt`, and `*-frames.ansi` captures. The latter contain shell-colored preambles, but the five diagram frames themselves have **no ANSI foreground color data**. Thus timed-frame color continuity cannot be established. Base and selected ANSI captures do provide RGB foreground evidence for every node border.
- The selected capture is one all-selected diagram per view, not a series showing each node selected in isolation. Every node occurrence does have its complete selected border captured. This proves selected-border coverage, not isolated-selection behavior or selection transitions.
- No evidence file used here was unsupported or unreadable. No live interactivity, panning, zooming, dragging, or motion between the five sampled timestamps was tested.

## Compact blind scorecard

Counts are occurrences across the four views, not deduplicated concepts. A graph label is a node title or a rendered edge caption; headers and controls are counted separately. Crossings count distinct route intersections, including explicitly bridged ones. Uncertainty includes the two weaker proximity ambiguities documented below.

```json
{
  "case": "modal-machine-manager",
  "stage": "A",
  "views": 4,
  "visible_node_occurrences": 25,
  "visible_edges": 23,
  "visible_graph_labels": 47,
  "visible_node_labels": 25,
  "visible_edge_labels": 22,
  "visible_ui_labels": 20,
  "crossings": 2,
  "bridge_glyphs": 2,
  "explicit_route_junctions": 0,
  "uncertain_label_owners": 3,
  "fused_text_labels": 0,
  "clipped_items": 0,
  "intended_edge_labels_missing_from_diagram": 1,
  "selected_state_coverage": {"checked": 25, "total": 25},
  "complete_color_continuous_base_borders": 25,
  "complete_color_continuous_selected_borders": 25,
  "uncheckable_base_or_selected_node_borders": 0,
  "timestamped_frames_per_view": 5,
  "timestamps_ms": [0, 100, 200, 300, 400],
  "animated_routes_with_one_dot_in_every_frame": 23,
  "observed_dot_count_or_corner_bridge_junction_arrowhead_violations": 0,
  "routes_with_no_observable_dot_displacement": 4,
  "routes_with_two_position_alternating_samples": 4,
  "measured_viewport": "77x47",
  "viewport_token": "viewport: 77x47 zoom: 1.00 natural"
}
```

| View | Nodes | Arrows/routes | Graph labels | Crossings | Uncertain owners | Missing intended captions | Selected coverage |
|---|---:|---:|---:|---:|---:|---:|---:|
| v1 | 8 | 7 | 15 | 0 | 1 | 0 | 8/8 |
| v2 | 5 | 5 | 9 | 0 | 0 | 1 | 5/5 |
| v3 | 7 | 7 | 14 | 0 | 2 | 0 | 7/7 |
| v4 | 5 | 4 | 9 | 2 | 0 | 0 | 5/5 |

Zero geometric/count dot violations does **not** mean all routes visibly demonstrate smooth forward animation. Four routes have stationary sampled dots; four more alternate between two positions. These are recorded in full below, without inferring whether the effect is short-cycle wraparound or sampling aliasing.

## Every visible graph label and every node border

For every node row below, all four sides and all four corners are complete in the base ANSI capture, with one RGB foreground color around the entire perimeter. In the selected ANSI capture, the same perimeter glyphs remain complete and become uniformly **bold RGB `(216,166,87)`**. This includes source/target attachment cells: no route or arrowhead replaces a node border cell. A node already using that RGB in the base capture still changes to bold in the selected capture.

### v1 node occurrences

| Verbatim node title | Title bounds | Box bounds | Base border RGB |
|---|---|---|---|
| `humans + mmctl` | [20,4,14,1] | [19,3,16,4] | (216,166,87) |
| `Modal control plane` | [43,4,19,1] | [42,3,21,4] | (125,174,163) |
| `webapi server` | [21,12,13,1] | [20,11,15,4] | (147,194,183) |
| `private gRPC` | [47,12,12,1] | [46,11,14,4] | (99,151,141) |
| `River job queue` | [20,20,15,1] | [19,19,17,4] | (211,134,155) |
| `provider registry` | [19,28,17,1] | [18,27,19,4] | (169,182,101) |
| `bare-metal providers` | [17,36,20,1] | [16,35,22,4] | (189,201,124) |
| `bare-metal machines` | [18,44,19,1] | [17,43,21,4] | (125,160,184) |

### v1 edge captions

| Verbatim caption | Bounds | Visible association |
|---|---|---|
| `http` | [22,8,4,1] | Beside humans → webapi vertical segment. |
| `create/term/repair` | [24,7,18,1] | Probably Modal control plane → private gRPC: its right end is one blank cell before that route. Weaker ambiguity: it spans the gap from the humans route and sits immediately above `http`; no leader marks the owner. |
| `reinstall/reprov` | [23,15,16,1] | Beside webapi → River vertical segment. |
| `enqueue job` | [30,16,11,1] | Above private gRPC → River horizontal return segment. |
| `provision job` | [22,24,13,1] | Beside River → provider registry. |
| `provider API` | [21,32,12,1] | Beside provider registry → bare-metal providers. |
| `allocate instance` | [19,40,17,1] | Beside bare-metal providers → bare-metal machines. |

### v2 node occurrences

| Verbatim node title | Title bounds | Box bounds | Base border RGB |
|---|---|---|---|
| `bare-metal machines` | [20,11,19,1] | [19,10,21,4] | (216,166,87) |
| `boot server` | [24,20,11,1] | [23,19,13,4] | (125,174,163) |
| `machine-agent` | [45,20,13,1] | [44,19,15,4] | (228,184,111) |
| `public gRPC` | [24,28,11,1] | [23,27,13,4] | (211,134,155) |
| `Postgres` | [26,36,8,1] | [25,35,10,4] | (169,182,101) |

### v2 edge captions

| Verbatim caption | Bounds | Visible association |
|---|---|---|
| `iPXE request` | [22,16,12,1] | Beside machines → boot server vertical segment. |
| `runs on host` | [27,14,12,1] | Above machines → machine-agent horizontal segment. |
| `register+heartbeat` | [26,24,18,1] | Above machine-agent → public gRPC horizontal return segment. |
| `machine state` | [26,32,13,1] | Beside public gRPC → Postgres. |

The boot server → machines return route is visible but has **no caption in the diagram**. The spec intends `boot.ipxe+S3`; the captured log also emits `warning: edge e1 label "boot.ipxe+S3" had no clear cell; shorten it or add routing space` (wrapped across two log lines). That warning is not counted as a diagram label. No diagram coordinates can be assigned to the missing caption. This is an omission, not an observed viewport-edge clipping event.

### v3 node occurrences

| Verbatim node title | Title bounds | Box bounds | Base border RGB |
|---|---|---|---|
| `River job queue` | [22,10,15,1] | [21,9,17,4] | (216,166,87) |
| `SSH + BMC ops` | [23,19,13,1] | [22,18,15,4] | (125,174,163) |
| `janitor app` | [46,19,11,1] | [45,18,13,4] | (147,194,183) |
| `bare-metal machines` | [20,28,19,1] | [19,27,21,4] | (169,182,101) |
| `webapi server` | [45,28,13,1] | [44,27,15,4] | (125,160,184) |
| `S3 object store` | [22,37,15,1] | [21,36,17,4] | (211,134,155) |
| `Slack` | [49,37,5,1] | [48,36,7,4] | (231,138,78) |

### v3 edge captions

| Verbatim caption | Bounds | Visible association |
|---|---|---|
| `diagnostic events` | [28,15,17,1] | Above River → janitor horizontal segment. |
| `audit + reimage` | [25,17,15,1] | Probably River → SSH: directly right of its downward arrow. Weaker ambiguity: also immediately below the River → janitor horizontal segment, rather than being isolated beside the SSH approach. |
| `machine-audit` | [25,23,13,1] | Beside SSH → machines vertical segment. |
| `proposed actions` | [29,24,16,1] | Left of janitor → webapi vertical segment. |
| `confirm + alerts` | [28,32,16,1] | Left of webapi → Slack dashed segment. |
| `pull boot image` | [26,33,15,1] | Beside machines → S3 vertical segment. |
| `diagnose uploads` | [25,34,16,1] | **Strong ownership problem:** starts immediately against the machines → S3 vertical segment at (24,34), directly below that route's `pull boot image` caption. The outer River → S3 route instead turns at (22,34), separated from the label by the other route. A reader can readily assign both captions to machines → S3; the spec's intended assignment to River → S3 is not visually proven. |

At timestamp 400ms, the machines → S3 dot is at (24,34), immediately followed by `diagnose uploads` with no blank cell. This is dot-to-text adjacency, not two fused text labels. There are **no instances of two text labels touching without a separator** in the four diagrams.

### v4 node occurrences

| Verbatim node title | Title bounds | Box bounds | Base border RGB |
|---|---|---|---|
| `private gRPC` | [8,19,12,1] | [7,18,14,4] | (216,166,87) |
| `River job queue` | [8,25,15,1] | [7,24,17,4] | (125,174,163) |
| `cluster reconcile loop` | [8,31,22,1] | [7,29,24,5] | (147,194,183) |
| `Postgres` | [51,19,8,1] | [50,16,10,7] | (211,134,155) |
| `bare-metal providers` | [51,25,20,1] | [50,24,22,4] | (169,182,101) |

### v4 edge captions

| Verbatim caption | Bounds | Visible association |
|---|---|---|
| `machine rows` | [28,18,12,1] | Above private gRPC → Postgres horizontal segment. |
| `job rows` | [31,24,8,1] | Above River → Postgres horizontal segment. |
| `cluster state` | [32,29,13,1] | Above cluster reconcile loop → Postgres horizontal segment; ends immediately beside its vertical route at column 45. |
| `gcore sync 1min` | [32,31,15,1] | Above cluster reconcile loop → bare-metal providers horizontal segment. |

### UI labels, verbatim

Each view has the same four controls at the same positions: `+ [+]` [4,42,5,1], `− [-]` [4,43,5,1], `⊡ [f]` [4,44,5,1], `□ [i]` [4,45,5,1]. They sit inside the separate control panel [2,41,9,6]. All four panel borders are complete, uniformly RGB (168,153,104), in both base and selected captures. They are not graph nodes.

Each header occupies [2,1,66,1], with foreground RGB (102,92,84):

- v1: `rataflow-view · 77x47 @100% · v1.json · 8 nodes · 7 edges · q quit`
- v2: `rataflow-view · 77x47 @100% · v2.json · 5 nodes · 5 edges · q quit`
- v3: `rataflow-view · 77x47 @100% · v3.json · 7 nodes · 7 edges · q quit`
- v4: `rataflow-view · 77x47 @100% · v4.json · 5 nodes · 4 edges · q quit`

The shell prompt and launch commands in the frame logs are not diagram labels. Their line wrapping is not diagram clipping.

## Every visible arrow, route, bend, crossing, and apparent branch

The route IDs below are observation-local. All 23 routes have a visible arrowhead. All can be followed geometrically using their turn glyphs; the caption ambiguities above are separate from endpoint tracing. Dense touching-bend areas are explicitly noted rather than silently treated as junctions. Border attachment cells stay intact; the first route cell starts immediately outside the box.

### v1 arrows

| ID | Source → target | Followed route outside boxes; all turns listed | Arrowhead | Traceability |
|---|---|---|---|---|
| 1a | humans + mmctl → webapi server | (20,7) down to (20,9), right to (21,9), down | `▼` (21,10) | Complete; tiny two-corner jog. |
| 1b | Modal control plane → private gRPC | (43,7) down to (43,9), right to (47,9), down | `▼` (47,10) | Complete. |
| 1c | webapi server → River job queue | (21,15) down to (21,17), left to (20,17), down | `▼` (20,18) | Complete but adjacent to 1d at the bend cluster. |
| 1d | private gRPC → River job queue | (47,15) down to (47,17), left to (22,17), down | `▼` (22,18) | Complete; independent target port two columns right of 1c. |
| 1e | River job queue → provider registry | (20,23) down to (20,25), left to (19,25), down | `▼` (19,26) | Complete. |
| 1f | provider registry → bare-metal providers | (19,31) down to (19,33), left to (17,33), down | `▼` (17,34) | Complete. |
| 1g | bare-metal providers → bare-metal machines | (17,39) down to (17,41), right to (18,41), down | `▼` (18,42) | Complete. |

No crossings, bridges, or explicit route junctions. Tight adjacent corner pairs occur at (20,9)/(21,9), (20,17)/(21,17), (19,25)/(20,25), and (17,41)/(18,41); these are each within one route. At row 17, the corners at columns 20, 21, and 22 form a no-blank-cell cluster across two routes. In particular, (21,17) `╯` and (22,17) `╭` belong to different edges. This can initially look like a shared turn/merge, but the glyph directions and separate arrowheads at columns 20 and 22 permit tracing without choosing an undocumented branch. Both incoming routes terminate on the River box, not on one another.

### v2 arrows

| ID | Source → target | Followed route outside boxes; all turns listed | Arrowhead | Traceability |
|---|---|---|---|---|
| 2a | bare-metal machines → boot server | (20,14) down to (20,17), right to (24,17), down | `▼` (24,18) | Complete. |
| 2b | boot server → bare-metal machines | (22,20) left to (17,20), up to (17,11), right | `▶` (18,11) | Complete return loop; caption absent. |
| 2c | bare-metal machines → machine-agent | (22,14) down to (22,15), right to (45,15), down | `▼` (45,18) | Complete. |
| 2d | machine-agent → public gRPC | (45,23) down to (45,25), left to (24,25), down | `▼` (24,26) | Complete. |
| 2e | public gRPC → Postgres | (24,31) down to (24,33), right to (26,33), down | `▼` (26,34) | Complete. |

No crossings, bridge glyphs, touching inter-edge bends, or explicit junctions. The two exits from the machines box use distinct bottom ports (columns 20 and 22); they do not split from a common visible trunk. The left-hand loop returns into the machines box, rather than merging with either bottom exit.

### v3 arrows

| ID | Source → target | Followed route outside boxes; all turns listed | Arrowhead | Traceability |
|---|---|---|---|---|
| 3a | River job queue → SSH + BMC ops | (24,13) down to (24,16), left to (23,16), down | `▼` (23,17) | Complete; tiny adjacent-corner jog. |
| 3b | River job queue → S3 object store | (22,13) down to (22,15), left to (17,15), down to (17,34), right to (22,34), down | `▼` (22,35) | Complete outer route. Its caption is not securely associated. |
| 3c | River job queue → janitor app | (26,13) down to (26,16), right to (46,16), down | `▼` (46,17) | Complete. |
| 3d | SSH + BMC ops → bare-metal machines | (23,22) down to (23,25), left to (20,25), down | `▼` (20,26) | Complete. |
| 3e | bare-metal machines → S3 object store | (20,31) down to (20,32), right to (24,32), down | `▼` (24,35) | Complete; two captions appear beside its final vertical leg. |
| 3f | janitor app → webapi server | (46,22) down to (46,25), left to (45,25), down | `▼` (45,26) | Complete; tiny adjacent-corner jog. |
| 3g | webapi server → Slack | (45,31) down to (45,34), right to (49,34), down | `▼` (49,35) | Complete dashed route, using `╎` and `╌`; corners and arrowhead remain solid. |

No crossings, bridge glyphs, or explicit route junctions. Adjacent-corner pairs (23,16)/(24,16) and (45,25)/(46,25) are within their respective routes. The three departures under River use separate columns 22, 24, 26; none is a visible bus splitting at a junction. The two arrows entering S3 at columns 22 and 24 remain separate, with one blank column between their arrowheads. At row 34, the River route's corner (22,34) and machines route's vertical (24,34) have a blank column between them; no actual join is shown. The caption immediately to the right of (24,34) creates an ownership problem, not an actual graph branch.

### v4 arrows

| ID | Source → target | Followed route outside boxes; all turns listed | Arrowhead | Traceability |
|---|---|---|---|---|
| 4a | private gRPC → Postgres | (21,19) right to (47,19), up to (47,17), right | `▶` (49,17) | Complete; closely abuts 4b near (47,19). |
| 4b | River job queue → Postgres | (24,25) right to (47,25), up to (47,20), right to (48,20), up to (48,19), right | `▶` (49,19) | Followable with careful reading of two bridges and the one-cell stair. |
| 4c | cluster reconcile loop → Postgres | (31,30) right to (45,30), up to (45,21), right | `▶` (49,21) | Followable across two bridges with 4b. |
| 4d | cluster reconcile loop → bare-metal providers | (31,32) right to (48,32), up to (48,25), right | `▶` (49,25) | Complete; closely abuts 4b near (47,25). |

Exactly **two route crossings**, each visibly marked by `⌒`:

1. **(45,25):** horizontal 4b crosses vertical 4c. The bridge glyph carries the horizontal route; 4c resumes vertically above/below it.
2. **(47,21):** horizontal 4c crosses vertical 4b. Again the horizontal route has the bridge glyph; 4b resumes vertically above/below it.

There is no explicit `┼`, T-junction, shared bus, or branch dot. Nevertheless the same-color routes are visually dense:

- At row 19, (47,19) `╯` belongs to 4a immediately beside (48,19) `╭` belonging to 4b, then 4b's arrow at (49,19). There is no blank cell between these routes' bends. This is a possible apparent merge until the turn directions are read.
- At row 20, (47,20) `╭` and (48,20) `╯` are 4b's own adjacent turns. Together with row 19 they form a very tight stair below the 4a bend.
- The bridge at (47,21) lies immediately below 4b's corner at (47,20); this is a crossing adjacent to a bend, not a new junction.
- At row 25, 4b's (47,25) `╯` is immediately beside 4d's (48,25) `╭`, then 4d's arrow at (49,25). This is another possible apparent merge until the turn directions are read.

All three Postgres entries terminate at distinct left-border rows 17, 19, and 21. The two cluster-loop exits use distinct right-border rows 30 and 32, rather than sharing a route trunk.

## ANSI colors and border-check coverage

All base graph text is RGB (235,219,178) over background (40,40,40). Base route lines, corners, bridges and arrowheads use muted RGB (124,111,100). Base dots use RGB (216,166,87). The selected captures retain readable labels and muted routes while all node perimeters use bold RGB (216,166,87). The node tables above document each base hue, rather than inferring colors from grouping in the specs.

- Base borders checkable: **25/25**; complete sides/corners and a single uninterrupted perimeter color: **25/25**; uncheckable: **0**.
- Selected borders checkable: **25/25**; same complete glyphs with uninterrupted bold accent color: **25/25**; uncheckable: **0**.
- Selected-state node occurrence coverage: **25/25**, in all-selected captures. Individual-only selection frames: **not supplied**.
- Timed motion-frame border colors: **not checkable for any of the 25 node occurrences at those timestamps**, because the diagram portions of `*-frames.ansi` contain plain text, not colored cells. This does not negate the independently checkable base/selected snapshots.

## Motion — every animated route, every supplied timestamp

Each coordinate sequence below is ordered **0ms, 100ms, 200ms, 300ms, 400ms**. In every view, **each route has exactly one visible dot in each of the five frames**. Thus per-frame view totals are v1: 7/7/7/7/7; v2: 5/5/5/5/5; v3: 7/7/7/7/7; v4: 4/4/4/4/4, for 115 route-dot observations overall. There is no same-route inter-dot spacing to measure, because no route has a second dot.

### v1 dot positions

| Route | Dot positions at the five timestamps | Visible cadence/direction |
|---|---|---|
| 1a humans → webapi | (20,8), (20,8), (20,8), (20,8), (20,8) | No sampled displacement; direction/speed cannot be established from these frames. |
| 1b Modal → private gRPC | (43,8), (44,9), (45,9), (46,9), (43,8) | Forward down/right across available straight cells; wrap between 300 and 400ms. Roughly one eligible cell per sample, with a skipped corner. |
| 1c webapi → River | (21,16), (21,16), (21,16), (21,16), (21,16) | No sampled displacement. |
| 1d private gRPC → River | (47,16), (46,17), (45,17), (44,17), (43,17) | Forward down/left, then one horizontal cell per 100ms. |
| 1e River → registry | (20,24), (20,24), (20,24), (20,24), (20,24) | No sampled displacement. |
| 1f registry → providers | (19,32), (18,33), (19,32), (18,33), (19,32) | Two-position alternation across a corner-skipping jog; full directional cycle cannot be disambiguated at this sample rate. |
| 1g providers → machines | (17,40), (17,40), (17,40), (17,40), (17,40) | No sampled displacement. |

The stationary routes account for all four no-displacement routes in the scorecard. They retain visible dots but do not visibly demonstrate travel in the supplied sequence.

### v2 dot positions

| Route | Dot positions at the five timestamps | Visible cadence/direction |
|---|---|---|
| 2a machines → boot | (20,15), (20,16), (21,17), (22,17), (23,17) | Down, then right; approximately one eligible straight cell per 100ms, skipping corner (20,17). |
| 2b boot → machines | (21,20), (20,20), (19,20), (18,20), (17,19) | Left, then up; approximately one eligible straight cell per 100ms, skipping corner (17,20). |
| 2c machines → agent | (23,15), (24,15), (25,15), (26,15), (27,15) | Right, exactly one cell per 100ms in this segment. |
| 2d agent → public | (45,24), (44,25), (43,25), (42,25), (41,25) | Down, then left; one eligible cell per sample, skipping corner (45,25). |
| 2e public → Postgres | (24,32), (25,33), (24,32), (25,33), (24,32) | Two-position alternation; continuous directional flow cannot be established at this sample rate. |

### v3 dot positions

| Route | Dot positions at the five timestamps | Visible cadence/direction |
|---|---|---|
| 3a River → SSH | (24,14), (24,15), (24,14), (24,15), (24,14) | Two-position alternation on the vertical approach; wrap or aliasing cannot be distinguished from the samples. |
| 3b River → S3 | (22,14), (21,15), (20,15), (19,15), (18,15) | Down, then left, skipping corner (22,15); one eligible cell per sample. |
| 3c River → janitor | (26,14), (26,15), (27,16), (28,16), (29,16) | Down, then right, skipping corner (26,16); one eligible cell per sample. |
| 3d SSH → machines | (23,23), (23,24), (22,25), (21,25), (23,23) | Down, then left, skipping corner (23,25); returns to initial sample after 300ms. |
| 3e machines → S3 | (21,32), (22,32), (23,32), (24,33), (24,34) | Right, then down, skipping corner (24,32); one eligible cell per sample. |
| 3f janitor → webapi | (46,23), (46,24), (46,23), (46,24), (46,23) | Two-position alternation; continuous directional flow cannot be established at this sample rate. |
| 3g webapi → Slack | (45,32), (45,33), (46,34), (47,34), (48,34) | Down, then right, skipping corner (45,34); one eligible cell per sample on the dashed route. |

### v4 dot positions

| Route | Dot positions at the five timestamps | Visible cadence/direction |
|---|---|---|
| 4a private → Postgres | (22,19), (23,19), (24,19), (25,19), (26,19) | Right, one cell per 100ms. |
| 4b River → Postgres | (25,25), (26,25), (27,25), (28,25), (29,25) | Right, one cell per 100ms. |
| 4c cluster loop → Postgres | (32,30), (33,30), (34,30), (35,30), (36,30) | Right, one cell per 100ms. |
| 4d cluster loop → providers | (32,32), (33,32), (34,32), (35,32), (36,32) | Right, one cell per 100ms. |

None of the 115 sampled dots occupies a corner, bridge, explicit junction, arrowhead, or node border. No route has zero or multiple visible dots in any supplied frame. The v4 dots never reach either bridge during the 400ms recording, so these frames do **not** prove how a dot traverses a bridge later. Likewise, no inference is made about unsampled phases or real-time rendering between timestamps.

## Fit and omissions

- All four views fit within the recorded **77 columns × 47 rows at 100% / zoom 1.00 natural**. No visible node title, rendered caption, arrowhead, border, control, or header is cut off at the captured viewport boundary.
- Diagram extents, excluding header/controls: v1 columns 16–62, rows 3–46; v2 columns 17–58, rows 10–38; v3 columns 17–58, rows 9–39; v4 columns 7–71, rows 16–33. Every visible item in these extents is reachable directly in its supplied view; no pan or zoom is needed to inspect that view.
- The four views are separate captures. This evidence does not show one combined overview of every concept and relationship, nor prove navigation between views.
- One intended edge caption, `boot.ipxe+S3`, is absent from the diagram. It is not counted among the 47 visible graph labels, and the renderer's warning is not substituted for visible content.
- The uncertain `diagnose uploads` caption remains fully readable but is visually adjacent to the other S3-bound route. This is an ownership defect, not clipped text.
- Color continuity is proven for base and selected still captures only. Timed-frame color data and individually isolated selection captures are missing, as detailed above.

This is the saved pre-expectation observation record. Its SHA-256 is reported separately after saving; the file is not to be modified after hashing.
