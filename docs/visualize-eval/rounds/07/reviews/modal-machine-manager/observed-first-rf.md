# Stage A — blind React Flow observation: modal-machine-manager

Reviewer: independent Sol (`openai/gpt-6.1-sol`). Round 07. Stage A only.

## Scope and coordinate convention

Read only this case's `reactflow.html` and `capture.png`, plus the round-07 judge task. No rataflow bundles, round-05 verdicts, expectations, generator notes, or comparison records were read. HTML references to spec paths were not followed. The PNG was read as an image; enlarged crops derived solely from that PNG were also inspected.

Coordinates below use the **whole capture scaled to 856 × 2000**, origin top left, x rightward, y downward. To recover original PNG pixels (2618 × 6120), multiply x by 2618/856 and y by 6120/2000. Bounds and centers are approximate (about ±3 scaled pixels). `B(x1,y1;x2,y2)` denotes a bounding rectangle; label coordinates are centers. This is a coordinate convention, not a claim about browser viewport size or zoom.

## v1 — ingress + jobs + confirm

Canvas approximately B(16,54;736,512). All seven node rectangles are visible, with complete rounded colored borders and legible titles:

| Node | Bounds | Subflow |
|---|---|---|
| humans + mmctl | B(273,88;365,111) | humans |
| Slack | B(387,88;479,111) | humans |
| control plane | B(273,194;365,217) | control |
| webapi | B(387,194;479,217) | control |
| private gRPC | B(273,250;365,273) | control |
| River queue | B(335,356;427,379) | queue |
| Postgres | B(297,463;389,486) | state |

Subflows are titled, rounded, bordered, translucent boxes: HUMANS B(265,74;487,115), title near (285,74); CONTROL B(265,181;487,277), title (288,181); QUEUE B(327,343;435,383), title (348,343); STATE B(289,450;397,490), title (309,450). Every declared member is geometrically inside its corresponding box. The title background deliberately interrupts a short part of each subflow top border; this is not a missing node border.

| HTML owning edge | Label visible at | Screenshot placement / ownership |
|---|---|---|
| humans + mmctl → webapi | `http` (319,148) | On the source vertical just above the rightward elbow at y≈152; reasonably identifiable. |
| control plane → private gRPC | `create/terminate/repair` (319,234) | Between the two nodes inside CONTROL; clear. |
| webapi → River queue | `reinstall/reprov` (433,304) | Detached to the right of the route, whose vertical is x≈381 here. |
| private gRPC → River queue | `enqueue job` (319,316) | At source column, near the horizontal toward the queue; competes with the other outgoing label. |
| private gRPC → Postgres | `machine rows` (319,304) | Stacked above `enqueue job`, on the same source column; destination cannot be assigned from text position alone. |
| River queue → Postgres | `job rows` (381,417) | On queue column beside its elbow toward x≈343; clear enough. |
| webapi → Slack | `confirm/alerts` (433,316) | Below CONTROL although Slack is above; not located on a separate visible return route here. HTML resolves ownership. |

Crossings / shared routes / occlusion:
- x≈433, y≈111–194 is a coincident opposing-direction run: the web→webapi descent and webapi→Slack return use the same column; the horizontal from humans joins at (433,152). Arrowheads at the node tops exist, but there is no separate return lane.
- private gRPC outgoing routes share x≈319 below y≈273 and diverge around y≈314. `machine rows` and `enqueue job` mask that area. The queue route joins the x≈381 path around (381,314), with a shared final approach to River queue at y≈356.
- The private-gRPC→Postgres route passes horizontally at y≈368 from x≈319 to343 behind/into the left part of the River queue node, then descends x≈343 toward Postgres. This is route occlusion by a node, not an incomplete queue border.
- The queue→Postgres elbow around (343,413) joins the x≈343 descent, sharing the final approach to Postgres.
- No additional isolated, clearly separable X crossing is visible; the problematic intersections are coincident runs and T junctions, not clean crossovers.

Dots: four distinct yellow marks are visible, approximately (408,152), (319,310), (381,304), (343,425). Their edge identities are not all separable on shared runs. HTML declares all seven edges animated and creates exactly one SMIL circle per edge; the still does **not** show seven independently identifiable dots or prove movement/speed.

## v2 — provisioning chain

Canvas B(16,540;736,998). Seven visible nodes, each with complete rounded borders:

| Node | Bounds | Subflow |
|---|---|---|
| River queue | B(236,575;341,602) | queue |
| reconcile loop | B(405,575;510,602) | control |
| prov registry | B(242,698;347,724) | providers |
| metal providers | B(242,760;347,787) | providers |
| Postgres | B(411,729;516,756) | state |
| machines | B(242,882;347,908) | machines |
| boot server | B(242,945;347,971) | machines |

Subflows: QUEUE B(227,560;350,606), title (247,560); CONTROL B(396,560;519,606), title (421,560); PROVIDERS B(234,682;357,791), title (261,682); STATE B(402,714;525,760), title (422,714); MACHINES B(234,867;357,976), title (263,867). All titled, bordered, tinted; all members inside.

| HTML owning edge | Label center | Observation |
|---|---|---|
| River queue → prov registry | `provision job` (289,644) | Above the source-to-registry descent; slight x shift between source and target. |
| reconcile loop → metal providers | `gcore sync 1m` (457,638) | Stacked at source x, although its leftward route runs at y≈681. |
| reconcile loop → Postgres | `cluster state` (457,651) | Below previous label, near the same source column; ownership requires tracing the split/HTML. |
| prov registry → metal providers | `provider API` (295,742) | Clear internal vertical edge. |
| metal providers → machines | `alloc instance` (295,829) | Clear vertical edge between boxes. |
| machines → boot server | `iPXE request` — not separately legible | HTML declares this label; it is covered at approximately (295,926). |
| boot server → machines | `boot.ipxe + S3 args` (295,926) | This is the readable label over the same position as the preceding label. Visually the visible arrow below it points down into boot server, despite this label belonging to the reverse edge. |

Crossings / shared routes / occlusion:
- Around (295,681), the leftward reconcile→providers run meets the queue→registry column. The independent routes then coincide on the providers column; the reconcile→metal-providers route passes behind prov registry B(242,698;347,724), and the final descent is also the registry→providers edge.
- The reciprocal machines/boot pair collapses to the same x≈295 column. A downward arrow is visible above boot server at (295,944); a short tail extends below boot server to y≈984. There is no independently readable upward return lane. Both edge labels occupy approximately (295,926), leaving one unreadable.
- No additional isolated X crossover observed; coincident runs and node occlusion dominate.

Dots: three distinct marks visible near (295,666), (463,704), (295,876). HTML declares seven animated edges, one SMIL circle each. The still cannot establish seven separately visible dots or movement.

## v3 — host agent and state

Canvas B(16,1025;736,1483). Six nodes with complete rounded borders:

| Node | Bounds | Subflow |
|---|---|---|
| machines | B(301,1064;425,1094) | machines |
| machine-agent | B(301,1138;425,1168) | machines |
| River queue | B(256,1282;380,1312) | queue |
| public gRPC | B(448,1282;571,1312) | control |
| S3 store | B(180,1425;304,1455) | state |
| Postgres | B(333,1425;457,1455) | state |

Subflows: MACHINES B(290,1046;435,1174), title (324,1046); QUEUE B(245,1264;391,1318), title (268,1264); CONTROL B(437,1264;582,1318), title (468,1264); STATE B(170,1407;467,1462), title (194,1407). All titled, bordered and tinted; all declared members sit inside.

| HTML owning edge | Label center | Observation |
|---|---|---|
| machines → machine-agent | `runs on host` (363,1116) | Clear internal descent. |
| machines → S3 store | `pull boot img` (363,1211) | Below the entire MACHINES box, not beside the source node. |
| machine-agent → public gRPC | `register+hb` (363,1227) | Stacked below preceding label near shared source column; rightward arm at y≈1225 leads to public gRPC. |
| River queue → S3 store | `diag uploads` (319,1363) | Near elbow to x≈242; clear text, shared final route. |
| public gRPC → Postgres | `machine state` (510,1363) | Near elbow left to x≈395; clear. |

Crossings / shared routes / occlusion:
- machines→S3 descends at x≈363 through the machine-agent rectangle (node hides route), sharing the column used by machines→agent and the source region of agent→public gRPC. A rightward arm toward public gRPC leaves around (363,1225); the S3 route continues toward y≈1260 then turns left.
- The leftward S3 arm near y≈1260 crosses/masks the QUEUE-title region before turning down x≈242, just outside the queue box.
- River queue→S3 joins that x≈242 descent around (242,1368); final approach to S3 is shared.
- public-gRPC→Postgres uses a separate elbow at (395,1368). No further isolated X crossing visible.

Dots: four yellow marks visible near (488,1225), (311,1369) partly behind the `diag uploads` label, (242,1414), (395,1411). HTML has five animated edges, one SMIL circle each; not all five are independently visible in the still.

## v4 — bounded autonomy

Canvas B(16,1511;736,1969). Five visible nodes with complete rounded borders:

| Node | Bounds | Subflow |
|---|---|---|
| River queue | B(311,1578;441,1610) | queue |
| SSH + BMC ops | B(230,1730;360,1762) | ops |
| janitor | B(392,1730;522,1762) | ops |
| machines | B(210,1882;340,1914) | machines |
| webapi | B(412,1882;542,1914) | control |

Subflows: QUEUE B(300,1559;453,1616), title (326,1559); OPS B(219,1710;534,1768), title (239,1710); MACHINES B(199,1863;351,1920), title (234,1863); CONTROL B(401,1863;554,1920), title (434,1863). All titled/bordered/tinted, all members inside.

Labels: `audit reimage` queue→SSH at (376,1655); `diag events` queue→janitor at (376,1672); `machine-audit` SSH→machines at (295,1816); `propose actions` janitor→webapi at (457,1816). The first pair is vertically stacked at a common source, with a horizontal split at y≈1670 from x≈295 to457; neither label sits on a uniquely separate branch. HTML resolves the left/right ownership. The last two are individually clear, with small lateral elbows below their labels.

Shared route: queue outgoing column x≈376, y≈1610–1670, then a common horizontal split with elbows (295,1670), (457,1670). No isolated X crossing. The two downward output legs remain separate. No yellow dots visible anywhere in this panel. HTML nevertheless declares all four edges animated and creates one circle per edge. A single still cannot tell whether dots are hidden at this instant or why; visible animation is unproven here.

## Fit, borders, chrome, and blind scorecard

Every view's node and group extents fit its own captured canvas without graph pan. Full-page capture includes all four views vertically; this does not prove all four were simultaneously visible in a physical browser window. Routes can be hidden by nodes even while their overall extents fit. No node outline is missing, clipped by canvas, or visibly broken. Group-title top-border interruptions are intentional. React Flow attribution badges occupy approximately B(691,501;736,511), B(691,987;736,997), B(691,1472;736,1482), B(691,1958;736,1968). They do not cover graph content and are discounted as chrome.

Provisional Stage-A-only scorecard (not a paired verdict; no undisclosed acceptance expectations used):

| Aspect | Blind assessment |
|---|---|
| Structural inventory / visible semantic fidelity to HTML | All 25 node instances and 17 group boxes visible. 22 of 23 edge labels separately readable; `iPXE request` is occluded. Rendered edge distinctions are not fully preserved. |
| Arrow traceability and label ownership | Deficient: coincident opposing edges in v1/v2, routes through intermediate nodes, and gutter label stacks; v2 boot-response label visually sits over a downward approach. |
| Layout fit | Pass per individual captured canvas; no graph pan needed for node/group extent. |
| Grouping | Pass: titled boxes contain all members; queue and machines share a blue family but box titles disambiguate. |
| Node borders | Pass: complete visible rectangles, no clipping. |
| Animation evidence | HTML: 23 animated edges, one circle each. Still: 4/3/4/0 distinguishable dot marks for v1/v2/v3/v4. Motion and one-visible-dot-per-edge are not proven. |
| Workflow evidence | Not assessed in Stage A; commands/attempts/determinism artifacts deliberately not read. |

This record is the blind observation, to be frozen by SHA-256 after writing. No comparison or overall green/red grading was performed.
