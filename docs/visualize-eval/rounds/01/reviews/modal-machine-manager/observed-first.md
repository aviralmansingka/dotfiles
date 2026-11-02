# ASTRA blind Stage A — modal-machine-manager, round01

## Scope and evidence boundary

Observed-first review of final raw evidence only. Read the four `captures/v*.unselected.txt`, `.selected.txt`, `.unselected.ansi`, `.selected.ansi`, `.dimensions.txt` sets and all twenty `frames/v*.frame{1,2,3,4,5}.txt` files. Did not read source/specifications, header JSON, command transcripts, README conclusions, checks, reports, prior rounds, renderer code, or generator helpers. An independent temporary Python parser decoded ANSI SGR foreground/background/bold state and compared cells, borders, and successive frames; it ran through `uv`.

All locations below are **1-based [column,row,width,height]**. Node bounds include the border. For every node table entry, its label starts one column right and one row down from the listed bounds, has height 1, and has width equal to the literal label length; this specifies the exact location of every node label without duplicating the table. `Source` locations are the first visible edge cell outside a box, not a claim about hidden attachment logic. An arrow location always denotes the actual visible arrowhead.

Dimensions files report 47 rows × 77 columns. Their UTC timestamps are:

| View | Timestamp |
|---|---|
| v1-provisioning | 2026-11-02T08:29:44Z |
| v2-boot-image | 2026-11-02T08:29:54Z |
| v3-state-writes | 2026-11-02T08:30:04Z |
| v4-ops-diagnostics | 2026-11-02T08:30:15Z |

Every decoded ANSI capture has exactly 47 rows of 77 cells. Plain captures omit trailing blank padding. No separate frame timestamp log was found in the inspected evidence locations. Frame numbering establishes an ordered sample, not a measured playback rate. The requested natural100% scale is not independently displayed in these captures; the evidence establishes cell fit, not a numerical zoom setting.

## Shared visual observations

- Background is RGB(40,40,40). Node and edge text is light cream, RGB(235,219,178). Ordinary edges and arrowheads are muted RGB(124,111,100). Flow dots are gold RGB(216,166,87).
- All 27 displayed node boxes have intact top, bottom, left, and right borders and all four rounded corners. Each complete border has exactly one foreground color in each capture. Selection changes the **whole border**, including the four corners and any corner-as-handle region, to bold gold RGB(216,166,87). There are no separately drawn handle glyphs to assess beyond these corners. Text stays cream: “uniform color” describes the border, not every cell of the node.
- Selected nodes: v1 Control plane; v2 machine-agent; v3 machine-agent; v4 janitor app. Selection is visible in ANSI, not as a changed box shape in plain text. No mixed-color side or corner was found.
- Nodes have one text row and one blank interior row. No label truncation is visible inside any node. All displayed graph boxes, arrowheads, and edge labels fit inside the canvas. v1 comes closest to the bottom: its final node ends on row 46 with row 47 blank.
- The shared lower-left control panel is [2,41,9,6]. Its four text rows show `+ [+]`, `− [-]`, `⊡ [f]`, `□ [i]` in [4,42,5,1], [4,43,5,1], [4,44,5,1], [4,45,5,1]. It does not overlap a graph path or node.
- Row 1 contains application/view filenames and counts, then incomplete help text. The displayed headers are `rataflow-view · v1-provisioning.json · 9 nodes · 8 edges · 5 flows · drag pa`, `rataflow-view · v2-boot-image.json · 4 nodes · 4 edges · 1 flows · drag pan`, `rataflow-view · v3-state-writes.json · 7 nodes · 6 edges · 2 flows · drag pa`, and `rataflow-view · v4-ops-diagnostics.json · 7 nodes · 6 edges · 0 flows · drag`. These are visible UI claims, not independently accepted semantic totals. Header/help is cropped at the right edge; graph labels are not.
- There are no explicit group enclosures, swimlane names, legends, or titled conceptual clusters. Vertical ranks and related border hues suggest stages/layers. Colors do not identify an invariant domain across views: Bare-metal machines is orange in v1, gold in v2/v3, and pink in v4. Selection also temporarily overrides a rank's hue.

## v1-provisioning

### Nodes, borders, and displayed grouping

| Literal node label | Bounds | Unselected border RGB |
|---|---|---|
| Humans + mmctl | [19,3,16,4] | 216,166,87 |
| Control plane | [45,3,15,4] | 228,184,111 |
| webapi server | [20,11,15,4] | 125,174,163 |
| private gRPC | [46,11,14,4] | 147,194,183 |
| River job queue | [19,19,17,4] | 211,134,155 |
| Provider registry | [18,27,19,4] | 169,182,101 |
| Reconcile loop | [45,27,16,4] | 189,201,124 |
| Bare-metal providers | [16,35,22,4] | 125,160,184 |
| Bare-metal machines | [42,43,21,4] | 231,138,78 |

Reader-visible organization: two gold entry nodes, two aqua service nodes, a pink queue, two green participants, a blue provider node, and an orange machine node. This looks like a top-down provisioning chain with two convergences. These are inferred visual stages, not named groups.

### Directed paths and edge labels

| Visible source → target | Source | Arrow | Label and location | Route observations |
|---|---|---|---|---|
| Humans + mmctl → webapi server | [20,7,1,1] | ▼ [21,10,1,1] | `http` [22,7,4,1] | Short downward dogleg on row 9. |
| Control plane → private gRPC | [46,7,1,1] | ▼ [47,10,1,1] | `create/terminate` [29,8,16,1] | Label is immediately left of the vertical stem; row-9 dogleg. |
| webapi server → River job queue | [21,15,1,1] | ▼ [20,18,1,1] | `reinstall` [23,16,9,1] | Small leftward dogleg on row 17. |
| private gRPC → River job queue | [47,15,1,1] | ▼ [22,18,1,1] | `enqueue job` [30,18,11,1] | Leftward run [22,17,26,1], ending at a separate queue port. |
| River job queue → Provider registry | [20,23,1,1] | ▼ [19,26,1,1] | `provision job` [22,24,13,1] | Down then short left turn on row 25. |
| Provider registry → Bare-metal providers | [19,31,1,1] | ▼ [17,34,1,1] | `provider API` [21,31,12,1] | Left turn [17,32,3,1], then down. |
| Reconcile loop → Bare-metal providers | [46,31,1,1] | ▼ [19,34,1,1] | `gcore sync 1m` [27,32,13,1] | Leftward run [19,33,28,1], independent of registry path. |
| Bare-metal providers → Bare-metal machines | [17,39,1,1] | ▼ [43,42,1,1] | `allocate` [26,40,8,1] | Rightward run [17,41,27,1], then down. |

All eight source/target relationships can be traced in the raw samples. Queue convergence uses two distinct arrowheads separated by one blank column; provider convergence does likewise. No false branch, shared run, or crossing is visible. Dots occasionally replace elbow characters, but the other samples expose those elbows. The graph occupies [16,3,47,44], separate from the control panel.

### Motion evidence

Dots change on five distinct routes: Control plane → private gRPC; private gRPC → queue; queue → registry; registry → providers; providers → machines. For example, along row 17 the four-dot train is at columns 25/32/39/46 in frame 1, 24/31/38/45 in frame 2, and 22/29/36/43 in frame 3: clear leftward progress toward the queue. Along row 41 it is at 18/25/32/39, then 19/26/33/40, then 21/28/35/42: rightward progress toward machines. These changes are in [22,17,26,1] and [17,41,27,1]. The short routes show phase changes in [46,8,2,2], [19,24,2,2], and [17,32,3,2]; their exact speed is not measurable from untimed sparse frames. No node, label, or arrowhead moves.

## v2-boot-image

### Nodes, borders, and displayed grouping

| Literal node label | Bounds | Unselected border RGB |
|---|---|---|
| Bare-metal machines | [9,18,21,4] | 216,166,87 |
| Boot server | [13,27,13,4] | 125,174,163 |
| S3 object store | [34,27,17,4] | 147,194,183 |
| machine-agent | [55,27,15,4] | 99,151,141 |

One gold node sits above a row of three aqua nodes. The reader sees a machine branching to boot, storage, and agent-related destinations, with a separate return loop from boot. No explicit domain/group names exist.

### Directed paths and edge labels

| Visible source → target | Source | Arrow | Label and location | Route observations |
|---|---|---|---|---|
| Bare-metal machines → Boot server | [10,22,1,1] | ▼ [14,26,1,1] | `iPXE request` [16,25,12,1] | Vertical stem and rightward dogleg [10,25,5,1]. |
| Bare-metal machines → S3 object store | [12,22,1,1] | ▼ [35,26,1,1] | `pull image` [18,24,10,1] | Row-24 horizontal run is interrupted by its own label, then resumes toward column 35. Association is clear from the uniquely aligned row. |
| Bare-metal machines → machine-agent | [14,22,1,1] | ▼ [56,26,1,1] | `runs on host` [29,22,12,1] | Wide run [14,23,43,1], then down at column 56. |
| Boot server → Bare-metal machines | [12,28,1,1] | ▶ [8,19,1,1] | **No visible label; meaning unknown.** | Leaves Boot server's left side, runs left across row 28 to column 7, up column 7, then right toward the machine's left side. |

Three bottom source stems are separate, not a shared branching line. The return loop is outside them at column 7, with a right-pointing arrow distinct from the three downward arrows. No false junction or crossing is visible. `pull image` overlays a segment rather than sitting in separate whitespace; there is nevertheless a single aligned candidate path and visible continuation on each side. Graph bounds are [7,18,63,13]. Large top/bottom margins remain.

### Motion evidence

Only the iPXE-request route has moving dots. Frame coordinates are: frame 1 [10,25,1,1] and [14,25,1,1]; frame 2 [11,25,1,1]; frame 3 [10,24,1,1] and [13,25,1,1]; frame 4 repeats frame 1; frame 5 [10,23,1,1] and [12,25,1,1]. The horizontal sequence is consistent with rightward travel and repetition, with dots also present on its vertical stem. The return loop is static in these samples. Cadence/smoothness cannot be inferred from this frame set.

## v3-state-writes

### Nodes, borders, and displayed grouping

| Literal node label | Bounds | Unselected border RGB |
|---|---|---|
| Bare-metal machines | [8,10,21,4] | 216,166,87 |
| machine-agent | [11,18,15,4] | 125,174,163 |
| private gRPC | [35,18,14,4] | 147,194,183 |
| public gRPC | [12,26,13,4] | 211,134,155 |
| River job queue | [33,26,17,4] | 226,156,175 |
| Reconcile loop | [54,26,16,4] | 187,108,131 |
| Postgres | [14,35,10,4] | 169,182,101 |

The reader sees a gold machine node, two aqua nodes, a row of three pink nodes, and a small green database. Four separate downward arrowheads converge on the database. Colors/ranks imply stages, not named groups. Graph bounds are [8,10,62,29].

### Directed paths, missing continuity, and label association

| Visible source → target | Source | Arrow | Label evidence | Route observations |
|---|---|---|---|---|
| Bare-metal machines → machine-agent | [9,14,1,1] | ▼ [12,17,1,1] | `runs on host` [11,14,12,1] | Clear row-16 dogleg. |
| machine-agent → public gRPC | [12,22,1,1] | ▼ [13,25,1,1] | `register+hb` [14,22,11,1] | Clear short dogleg on row 24. |
| public gRPC → Postgres | [13,30,1,1] | ▼ [15,34,1,1] | **No unambiguous label on this individual path.** | Down column 13 and across row 33 to column 15. |
| River job queue → Postgres | [34,30,1,1] | ▼ [17,34,1,1] | `job rows` [36,30,8,1] | Left along row 31 and down at column 17; bridge glyph at [26,31,1,1]. |
| Reconcile loop → Postgres | [55,30,1,1] | ▼ [21,34,1,1] | `cluster state` [32,32,13,1] | Leftward run [21,33,35,1], then down. |
| private gRPC → **unknown strictly continuous target** | [36,22,1,1] | Candidate ▼ [19,34,1,1] | `machine rows` [20,30,12,1] is in the affected corridor; individual-edge association is uncertain. | Visible stem runs down to row 24, left to column 26, and down through row 29. The next cells are interrupted by text and the crossing glyph. A lower continuation at [26,32,1,1] turns left to column 19, then ends at Postgres. This strongly suggests private gRPC → Postgres but is not an uninterrupted trace. |

**Local ambiguity retained:** `machine rows` is horizontally positioned across column 26 on row 30, covering the projected private-gRPC vertical path. On row 31, [26,31,1,1] is `⌒` in the queue's horizontal run, not a conventional connected junction. This suggests a non-joining crossover above the lower private-path continuation. The critical region is [17,29,18,5]. There is no visible T-junction, and I do not count a queue/private branch. However, the label interruption plus crossover means the private edge's fully continuous source-to-target identity remains uncertain under a strict raw-only reading. `machine rows` could be read as attached to that private route or as a nearby database-write annotation; it does not uniquely label the public-gRPC route. No expected meaning is supplied to resolve this.

The four database arrowheads are [15,34,1,1], [17,34,1,1], [19,34,1,1], [21,34,1,1]. They are visibly separate; the issue is upstream continuity/association, not missing target arrowheads or overlapping database ports.

### Motion and capture mismatch

Dots change only along machine-agent → public gRPC and public gRPC → Postgres. Frame 1 has dots [12,23,1,1], [13,24,1,1], [13,33,1,1]; frame 2 has [12,24,1,1], [13,31,1,1], [14,33,1,1]; frame 3 has [12,24,1,1], [13,33,1,1]; frame 4 has [12,23,1,1], [13,24,1,1], [13,31,1,1], [14,33,1,1]; frame 5 repeats frame 1. Thus motion/phase change is visible in [12,23,2,2] and [13,31,3,3], but these short repeating samples do not establish a reliable speed.

Unlike the other seven plain/ANSI capture pairs, **v3 unselected text and ANSI represent different dot phases**. Differing cells are [12,23,1,1], [12,24,1,1], [13,24,1,1], [13,32,1,1], [13,33,1,1], [15,33,1,1]. Each difference is dot-versus-underlying-edge; labels, boxes, crossing, and arrowheads agree. This does not repair the machine-rows ambiguity. Selected text and ANSI agree.

## v4-ops-diagnostics

### Nodes, borders, and displayed grouping

| Literal node label | Bounds | Unselected border RGB |
|---|---|---|
| River job queue | [12,10,17,4] | 216,166,87 |
| SSH + BMC ops | [13,19,15,4] | 125,174,163 |
| S3 object store | [35,19,17,4] | 147,194,183 |
| janitor app | [56,19,13,4] | 99,151,141 |
| Bare-metal machines | [10,27,21,4] | 211,134,155 |
| webapi server | [36,27,15,4] | 226,156,175 |
| Slack | [17,35,7,4] | 169,182,101 |

The visible layout is a gold queue above three aqua destinations; two pink downstream nodes follow, and a green Slack node is last. It reads as an operational fan-out with a machine-operation branch and an application/notification chain. No group labels or enclosure boundaries are displayed.

### Directed paths and edge labels

| Visible source → target | Source | Arrow | Label and location | Route observations |
|---|---|---|---|---|
| River job queue → SSH + BMC ops | [13,14,1,1] | ▼ [14,18,1,1] | `audit/reimage` [16,17,13,1] | Short row-17 dogleg. |
| River job queue → S3 object store | [15,14,1,1] | ▼ [36,18,1,1] | `upload diags` [19,16,12,1] | Row-16 horizontal run is interrupted by its own label, then resumes to the target stem. |
| River job queue → janitor app | [17,14,1,1] | ▼ [57,18,1,1] | `diag events` [32,14,11,1] | Long horizontal run [17,15,41,1]. |
| SSH + BMC ops → Bare-metal machines | [14,23,1,1] | ▼ [11,26,1,1] | `machine-audit` [16,24,13,1] | Leftward dogleg [11,25,4,1]. |
| janitor app → webapi server | [57,23,1,1] | ▼ [37,26,1,1] | `propose action` [40,24,14,1] | Leftward run [37,25,21,1]. |
| webapi server → Slack | [37,31,1,1] | ▼ [18,34,1,1] | `confirm/alerts` [21,32,14,1] | Leftward run [18,33,20,1]. |

The three queue source stems remain distinct. No crossing, shared run, or false branch is visible. `upload diags` overlays the single horizontal path at row 16, but its direction and association remain readable from the two aligned ends and unique target stem. All six arrows point downward and all six source/target relationships are recoverable. Graph bounds are [10,10,59,29].

### Motion evidence

All five raw frames are identical. There are no flow dots anywhere in them. The displayed header also says `0 flows`, but the independent observation is simply a static five-frame sequence. No claim about intended animation is possible at this stage.

## Blind summary and unresolved items

The four views show 27 complete node boxes, legible labels, intact uniformly colored borders, and clean selected-border treatment. All diagram content fits in 77×47 cells; only header help is cropped. Most routes are readable from separate source stems to explicit arrowheads. v1 and v4 give clear multi-input/fan-out layouts; v2 includes a clearly directed but unlabeled boot return loop.

The principal blind-reading uncertainty is v3's `machine rows` annotation over a vertical corridor, immediately above a non-joining-looking crossing. The partial private-gRPC-to-database route is recorded as a candidate, **not promoted to a certain link**, and that label's individual-edge association remains unknown. Inline labels also replace horizontal edge cells in v2/v4, though those paths retain unique aligned continuations. The evidence shows moving gold-dot phases in v1/v2/v3, a static v4, and one text/ANSI phase mismatch in v3. Timing, smoothness, intended conceptual groups, missing expected semantics, and source/spec compliance are not established by this blind stage. No pass/fail verdict is issued.
