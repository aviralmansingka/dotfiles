# Blind observation: C4 retry v2 — stage A

I inspected the final spec, check, actual pane capture, selected ANSI, whole-canvas frames, audit and manifest. I did not open the brief, expectations, source, rubric or triage. Positions below are 1-based [column,row,width,height] in frame 0 of the 260×90 capture (including its status row and four-column canvas offset), not spec coordinates. The frame capture is synthetic 260×90, not the actual pane.

## L1 — system context

Title `L1 · System context — the machine manager` [5,10,41,1]; description `One double-bordered manager box; providers (BM = bare metal) and machines stay outside it, S3 and Slack beyond. Two arrows run between manager and machines, one each way.` [5,11,168,1]. Both are complete in the large capture; the real 68×44 pane clips the description and graph. Check origin (0,5), extent 112×21.

Six node occurrences, seven directed edges/routes and seven edge labels. The `machine manager` is the only double-bordered node; it visually identifies the parent expanded by both following sections. Complete boxes are visible in the full frame. The groups are humans (humans + mmctl) and external (providers, S3, Slack, machines); manager has no group. The actual pane ANSI shows humans green RGB 115,206,115; providers green 183,206,115; S3 pale green 203,219,153; Slack olive green 164,193,78; manager neutral 235,219,178. These are related green variants, not identical colors. Normal complete human and manager border segments have consistent hue. No colored group outline or group title appears.

Routes and labels, each `[column,row,width,1]`, arrows in declared source → destination order (some routes bend or point left/up despite lr layout):
- humans + mmctl → machine manager: `http` [21,22,4,1], head points right.
- machine manager → providers: `provider API` [49,18,12,1], right.
- machine manager → S3: `diagnose` [49,22,8,1], right. This is a shortened label; pixels do not say what is diagnosed or where it goes beyond S3.
- machine manager → Slack: `confirm + alerts` [43,29,16,1], right, bridge at [61,27].
- machine manager → machines: `boot, audit` [75,31,11,1], right.
- machines → machine manager: `iPXE, heartbeat` [21,17,15,1], down at manager.
- providers → machines: `allocate instance` [82,18,17,1], right.

The manager↔machines pair is bidirectional. Machines receives two routes. Manager fans out to four destinations. The Slack route bridges the manager→machines route; the routes remain separate and the crossing does not imply a branch. Arrowheads appear intact; long and crossing paths require careful tracing. No unintended near-node contact is reported.

Four animated routes: humans→manager, manager→providers, manager→machines, machines→manager. Check reports no dot violation globally. Their color matches cannot all be established per route from the clipped ANSI; it shows a green humans→manager dot and green manager→providers dot, and a teal manager→machines dot, with muted route lines. The whole frame 0 shows dots at route starts, including the incoming machines route at the right. See canvas motion limitations.

## L2a — request, provisioning and boot

Title `L2 · Containers — request, provisioning and boot` [5,36,48,1]; description `Dotted box = the manager's own containers; the caller, providers (BM) and machines stay outside it. Actions become a River job, a provider allocation, then a boot.` [5,37,159,1]. Complete in large capture. Check origin (0,31), extent 253×20.

12 nodes, 14 routes/edge labels. The dotted enclosure encloses exactly webapi server, control plane, private gRPC, River queue, reconcile loop, provider registry and Postgres. Humans + mmctl, providers, S3, machines and boot server are outside. Thus the description's claim that it marks the manager's own containers is incomplete/misleading if boot server is also a manager service: the pixels show it outside with the external systems, not a second containment level. The visible frame supports membership by node position, not merely spec declaration. The enclosure is 131×16 at canvas (23,31). Its boundary overwrites a character in `gcore sync, 1 min`, seen as `gcore sync, 1·min`; the check nevertheless counts the label placed.

Routes and captured labels:
- humans + mmctl → webapi: `http` [22,45,4,1].
- control plane → private gRPC: `create/terminate/repair` [47,48,23,1].
- private gRPC → River queue: `enqueue job` [91,46,11,1].
- webapi → River queue: `reinstall/reprovision` [80,41,21,1].
- River queue → provider registry: `provision job` [123,41,13,1].
- provider registry → providers: `provider API` [159,42,12,1].
- providers → machines: `allocate instance` [191,43,17,1].
- machines → boot server: `iPXE request` [227,45,12,1].
- boot server → machines: `boot.ipxe + S3 args` [225,50,19,1].
- machines → S3: `pull boot image` [194,49,15,1].
- private gRPC → Postgres: `machine rows` [116,55,12,1].
- River queue → Postgres: `job rows` [125,45,8,1].
- reconcile loop → providers: `gcore sync, 1·min` [145,53,17,1] as rendered; intended string per spec `gcore sync, 1 min`.
- reconcile loop → Postgres: `cluster state` [123,53,13,1].

Arrowheads are present, with directions following the routes, including a left-pointing head at machines from boot. Machines↔boot is bidirectional. Postgres receives three separate routes; River queue and providers each receive two. Greatest out-degree is two. Two bridge glyphs appear at [141,50] and [137,52], among Postgres-bound routes; these three crossing routes are static. The geometry creates no intended branch at a bridge. The enclosure crossing at its bottom for reconcile→providers is perpendicular, though the border masks the adjacent label. The other crossings at its sides are also transverse, not parallel runs on the dotted edge. Check reports no near misses. Animated: control plane→private gRPC, providers→machines, machines→boot, boot→machines. Group tags are humans, control, async, hostops, state, external; only the left side is colored in the supplied ANSI viewport: control webapi pink RGB 219,153,170 and control plane pink RGB 206,115,138. Whole-canvas capture is plain text; no full-frame ANSI proves the other groups' hues or all border continuity. Boxes and corners are complete in the large capture; the small pane's controls and overlay obscure part of this diagram.

## L2b — heartbeat, audits and diagnostics

Title `L2 · Containers — heartbeat, audits and diagnostics` [5,61,52,1]; description `Dotted box = the manager's own containers; machines (BM), S3 and Slack stay outside it. Agent heartbeat, audit and diagnose jobs, janitor proposals and Slack alerts.` [5,62,161,1]. Complete in large capture. Check origin (0,56), extent 189×18.

10 nodes, nine routes/edge labels. The 140×14 dotted enclosure at canvas (22,56) visibly wraps machine-agent, public gRPC, SSH + BMC ops, River queue, janitor app, webapi server and Postgres only; machines, S3 and Slack sit outside. Its dots overwrite one character of `confirm + alerts`, displayed as `confirm + al·rts` [153,74,16,1]. The queue→S3 route leaves downward through the bottom enclosure boundary, perpendicular to it. Machine→agent and SSH→machine cross the left side perpendicularly; webapi→Slack crosses the right side perpendicularly. These are crossings, not edge-parallel runs. The view contains complete node boxes and heads in the large frame; no per-node ANSI border evidence is available for this section.

Routes and labels:
- River queue → SSH + BMC ops: `audit/verify reimage` [44,74,20,1], left.
- SSH + BMC ops → machines: `run machine-audit` [8,71,17,1], left.
- machines → machine-agent: `runs on host` [35,66,12,1], right.
- machine-agent → public gRPC: `register + heartbeat` [78,67,20,1], right, animated.
- public gRPC → Postgres: `machine state` [136,66,13,1], right.
- River queue → janitor: `diagnostic events` [80,72,17,1], right.
- janitor → webapi: `proposed actions` [114,72,16,1], right.
- webapi → Slack: `confirm + al·rts` [153,74,16,1] as captured; intended `confirm + alerts`.
- River queue → S3: `diagnose uploads` [34,78,16,1], up.

Queue fans out to three; no reciprocal pair and no node receives two routes. There are no visible bridge glyphs in this section. Hues for async, hostops, control, state, ops and external cannot be independently established from the clipped pane ANSI. Check reports no near misses; routes can be traced with care, but dotted boundary cells mask the crossing segments.

## Canvas scorecard and limits

| Surface | Nodes | Edges/routes | Edge labels | Visible bridges | Animated routes | Pinned nodes | Near misses reported | Dot violations reported |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| L1 | 6 | 7 | 7 | 1 | 4 | 6 | 0 | 0 global |
| L2a | 12 | 14 | 14, one occluded | 2 | 4 | 12 | 0 | 0 global |
| L2b | 10 | 9 | 9, one occluded | 0 | 1 | 10 | 0 | 0 global |
| Total | 28 | 30 | 30, two occluded | 3 visible; check says 4 | 9 | 28 | 0 | 0 |

The check says `crossings: 4 bridges, 0 touching bends`; only three bridge glyphs are visible in frame 0. Do not equate the reported fourth with a visible bridge. Check says `labels: 30/30 placed, 0 leader-ticked, 0 on route, 0 skipped, 0 ambiguous owners`; owner uncertainty is zero by check, but two labels are visibly overwritten by enclosure dots, a defect not reflected in the check. No node labels are clipped in the whole-canvas frame. In the real 68×44 pane, the right side and lower canvas are clipped, L1 description is truncated, and L2a is partially hidden by controls/overlay; pan is needed. There is no overflow banner in that capture. The 260×90 capture shows the entire 253×74 canvas at 100%, with three distinct titles and descriptions and no diagram-to-diagram overlap. The check says `viewport: unknown zoom: 1.00 natural`, `canvas: 3 diagrams on one canvas, drawn whole at 100%`, `extent=253x74 cells (whole canvas)`; the frame capture says `viewport: 260x90 zoom: 1.00 natural`. Manifest has 68×44 viewport token and `confirmed_closed`; it does not give actual pane columns separately.

Direction is uniformly `lr` in the only direction field, no diagram overrides; arrows can point left/up for feedback paths. Five enclosure entrances are reported by check; from the full capture they cross sides/bottom perpendicularly. No route visibly follows the dotted border, although enclosure dots replace some route cells, so there is no independent machine-readable count of run-alongs in the check. The two L2 boxes are separate diagrams, not one containing enclosure; the renderer's single enclosure level is not conveyed as a C4 model limitation by pixels alone. L2a's outside boot server and the abbreviated L1 `diagnose` need explanation. Three crossing routes in L2a carry no dots and ship static.

Pins: all 28 are declared through layers, `pins: 28 pinned, 0 conflict(s)`; observed horizontal rank sequence follows the spec: L1 web | mm | prov/s3/slack | mch; L2a web | cp/wapi | pgrpc | q/rec | reg/db | prov/s3 | mch | boot; L2b s3/mch | ssh | q/agent | pub/jan | wapi | db | slack. Group membership check: `humans(2) external(10) control(5) async(4) hostops(3) state(2) ops(1)`. No tier labels beyond section titles, no group outlines or titles. Hue families and their cross-diagram stability are not provable for all tags: full canvas has no ANSI, and the actual ANSI contains only portions of L1 and L2a. The selected ANSI demonstrates complete bold selected borders for humans, manager and webapi (3/28), plus partial providers, S3 and control plane; no complete selected-state evidence exists for the remaining occurrences. The manifest's select-all flag is not equivalent to a full-canvas selected capture.

Motion check: `dots: 9 single-dot routes, 0 periodic routes, 0 violations, 9 constant at 0.5c/step, 0 same-arrival at 2000ms`; `dot hues: 8 by source, 1 by destination, 0 shared-hue pair(s) (source-only 1, destination-only 2)`; `origins: 9/9 routes start at their arrow origin`; `arrivals: 0/0 same-arrival routes show their dot at the arrowhead on the final step`. Whole-frame audit reports 60 frames, 100 ms steps, exactly nine dots per frame, all nine steady at 0.5 cells/frame and all equal-distance windows pass. Single dots have no intra-route spacing requirement; no common-arrival claim applies. The audit does not independently enumerate corner/bridge/label/arrowhead occupancy or colors for each timestamp; check's no-violation and color claims are reported, not independently proven from full-canvas ANSI. Actual pane ANSI captures only some dot and border colors. The large text frames support motion and origin evidence but cannot prove hue, all border color continuity, or each individual timestamp's route color match.

Structural summary: three vertically stacked, titled, spatially separate graphs; within each graph paths join its nodes, rather than a visible inter-diagram connector. L1 manager fan-out four and one reciprocal pair; L2a maximum fan-out two and one reciprocal pair; L2b maximum fan-out three and no reciprocal pair. Multiple arrows converge at machines in L1, queue/providers/Postgres in L2a, but not in L2b. Labels contain many implementation identifiers, qualifiers and abbreviations; the L2a ordering reads like request→queue→provider→machine→boot while L2b is a related operational slice, not another clearly marked phase. No separate classification line was inspected; this record does not infer one. No unsupported artifact prevented reading text or ANSI, but full-canvas color and fully selected-state evidence are missing.
