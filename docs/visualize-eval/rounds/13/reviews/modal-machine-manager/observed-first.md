# Blind observation — modal-machine-manager, stage A

Evidence convention: coordinates below are 1-based `[column,row,width,height]` in **frame 0 of `canvas-300x70-frames.txt`**, counting the first terminal display row after `frame 0 at 0ms` as row 1. They are not the check's zero-based canvas coordinates. Each text label occupies one row. Whole-canvas text is readable; color and selected-border claims require ANSI, which is only available for the small visible band. The frame files contain more than the one frame displayed here. I did not open the source, expected data, brief, rubric, or triage block.

## Request and provisioning path

Canvas diagram, origin (0,3), extent 260×11. 10 nodes, 10 arrows/routes, 10 animated. Title `Request and provisioning path` [27,4,29,1]. Description `Humans and the control plane enter through webapi and private gRPC, enqueue River jobs, and provision bare metal down to the iPXE boot.` [27,5,135,1]. Neither is clipped in the whole capture; the description is clipped at 77 columns. Content agrees with the title and description.

Node label coordinates: `control plane` [29,9,13,1]; `humans + mmctl` [28,14,14,1]; `private gRPC` [71,9,12,1]; `webapi server` [70,14,13,1]; `River job queue` [109,12,15,1]; `provider registry` [142,11,17,1]; `bare-metal providers` [176,8,20,1]; `bare-metal machines` [220,12,19,1]; `boot server` [181,14,11,1]; `S3 object store` [259,11,15,1].

The following route table gives every visible edge label and its position, and the traced source and destination. Arrows have visible pointed heads at the stated destination; routes are traceable in the full frame without guessing. All run generally rightwards except the machines→boot request, which points left. Bends are ordinary corners, not shared junctions. No bridge or touching bend is visible; arrows attach to distinct box ports. Label owner uncertainty: none found, including the two opposed boot routes and the adjacent `provider API` label.

| Label; position | Source → destination |
|---|---|
| `create/terminate/repair` [45,8,23,1] | control plane → private gRPC |
| `http` [53,13,4,1] | humans + mmctl → webapi server |
| `reinstall/reprovision` [85,13,21,1] | webapi server → River job queue |
| `enqueue job` [90,8,11,1] | private gRPC → River job queue |
| `provision job` [126,11,13,1] | River job queue → provider registry |
| `provider API` [160,10,12,1] | provider registry → bare-metal providers |
| `allocate instance` [199,9,17,1] | bare-metal providers → bare-metal machines |
| `iPXE request` [203,11,12,1] | bare-metal machines → boot server, leftward |
| `boot.ipxe + S3 args` [196,16,19,1] | boot server → bare-metal machines, rightward |
| `pull boot image` [241,11,15,1] | bare-metal machines → S3 object store |

Near misses: check reports zero margin cells and zero unrelated-node passes for the entire canvas; I did not find a contradictory pass in this capture. No specific near-miss cell exists to quote. Group tags: control (pink family), humans (teal), hardware (orange), state (olive); no group outline/title. ANSI proves only the leftmost portion of this diagram, not the right-hand hardware and state occurrences. No rank pins declared. Complete boxes and corners are visible in the wide text frame; continuous color is independently verifiable only for the small ANSI band. Four request node occurrences have complete selected-color borders in the small-band selection capture; the other six are outside it.

Structural observations: 10/10, widest visible outgoing fan two (machines), one antiparallel box pair (machines and boot), queue receives two separate arrows. The initial two entry chains merge at the queue. Ordering looks like a left-to-right sequence with a return and a side pull. Labels mainly contain actions, protocols and payloads rather than addresses.

## Heartbeat and machine state

Canvas diagram, origin (0,19), extent 118×15. 6 nodes, 5 arrows/routes, 4 animated, one static. Title `Heartbeat and machine state` [27,20,27,1]. Description `The fastest path: each host's machine-agent registers and heartbeats over public gRPC. Public gRPC, private gRPC and the queue each write their own Postgres rows.` [27,21,162,1]. Both are complete in whole-canvas evidence; description is clipped in the target viewport. Description agrees with the drawn connections.

Node labels: `bare-metal machines` [28,29,19,1]; `machine-agent` [64,29,13,1]; `public gRPC` [104,24,11,1]; `private gRPC` [104,29,12,1]; `River job queue` [102,34,15,1]; `Postgres` [135,30,8,1].

| Label; position | Source → destination |
|---|---|
| `runs on host` [49,28,12,1] | bare-metal machines → machine-agent; static |
| `register + heartbeat` [79,28,20,1] | machine-agent → public gRPC |
| `machine state` [118,25,13,1] | public gRPC → Postgres |
| `machine rows` [118,28,12,1] | private gRPC → Postgres |
| `job rows` [121,33,8,1] | River job queue → Postgres |

All arrows point generally right, with distinct destination ports; each complete route and pointed head is visible and traceable. No ambiguous owners, bridge, junction, crossing or touching bend observed. Zero near-miss routes are reported; no contradictory near miss identified in the capture. Control pink, hardware orange and state olive are declared; no drawn group border/title. ANSI covers only the leftward hardware boxes in this section, so the rightward colors cannot be independently established from this band. No rank pins declared. Complete box geometry appears in the wide text frame; color continuity is provable only where ANSI is present. Two heartbeat occurrences have selected-color borders in the visible small-band capture; four lie outside it.

Structural observations: 6/5; maximum out-degree one; no opposite pair; Postgres receives three distinct arrows. Three entry components converge on Postgres, with one entry chain containing three nodes. Phase-like left-to-right order; labels include protocol/action and row qualifiers, with little identifier density.

## Slow ops path and reconcile loop

Canvas diagram, origin (0,39), extent 132×25. 10 nodes, 8 arrows/routes, all animated. Title `Slow ops path and reconcile loop` [27,40,32,1]. Description `Queued work beside the fast path: SSH audits, diagnostics to the janitor, its proposals through webapi to Slack, and the one-minute gcore cluster sync.` [27,41,151,1]. Whole-canvas evidence shows both complete. At 77×47 the title remains readable but the description is clipped and overwritten by the minimap; in the actual 68×44 pane the legend overwrites the title and description. The described audit, diagnostic, proposal, Slack and sync paths are present; although the node/title say reconcile loop, the diagram shows no closed loop. It does not itself draw the fast path, consistent with the wording 'beside'.

Node labels: `River job queue` [29,52,15,1]; `cluster reconcile` [28,59,17,1]; `SSH + BMC ops` [74,54,13,1]; `janitor app` [75,44,11,1]; `S3 object store` [73,49,15,1]; `bare-metal machines` [112,57,19,1]; `bare-metal providers` [70,64,20,1]; `webapi server` [115,52,13,1]; `Postgres` [76,59,8,1]; `Slack` [152,54,5,1].

| Label; position | Source → destination |
|---|---|
| `audit/verify reimage` [48,55,20,1] | River job queue → SSH + BMC ops |
| `run machine-audit` [90,53,17,1] | SSH + BMC ops → bare-metal machines |
| `diagnostic events` [52,45,17,1] | River job queue → janitor app |
| `proposed actions` [91,45,16,1] | janitor app → webapi server |
| `confirm + alerts` [131,51,16,1] | webapi server → Slack |
| `diagnose uploads` [49,51,16,1] | River job queue → S3 object store |
| `gcore sync, 1 min` [48,61,17,1] | cluster reconcile → bare-metal providers |
| `cluster state` [52,57,13,1] | cluster reconcile → Postgres |

All point generally right with visible arrowheads and traceable complete routes; bends are distinct and there are no bridges, junctions, crossings or touching bends visible. No uncertain label owners. Check reports zero near-miss routes; I found no contradiction. Control, humans, hardware, state and ops are declared; group boxes/titles do not appear. Ops color family and color continuity cannot be established from the provided text-only whole-band capture; no ops nodes are visible in color in the pane ANSI. No pins declared. Full box sides/corners appear in wide text. Selected-color border evidence: 0/10; the wide select-all is plain text, not color proof.

Structural observations: 10/8; widest fan three from queue, reconcile has fan two. There is no antiparallel pair and no node receives two arrows. The queue and reconcile portions are disconnected in this individual surface; repeated components connect concepts across diagrams only by identity, not drawn cross-section edges. Qualifiers include SSH/BMC, audit, gcore, and one-minute cadence; the paths read left-to-right, but no closed cycle is drawn.

## Canvas-wide observations and scorecard

`check.txt` states:

```text
viewport: unknown zoom: 1.00 natural
ok: nodes=26 edges=23 flows=22 direction=lr theme=gruvbox
canvas: 3 diagrams on one canvas, drawn whole at 100%
diagram request "Request and provisioning path" at 0,3: extent=260x11 nodes=10 edges=10 routes=10
  description: Humans and the control plane enter through webapi and private gRPC, enqueue River jobs, and provision bare metal down to the iPXE boot.
diagram heartbeat "Heartbeat and machine state" at 0,19: extent=118x15 nodes=6 edges=5 routes=5
  description: The fastest path: each host's machine-agent registers and heartbeats over public gRPC. Public gRPC, private gRPC and the queue each write their own Postgres rows.
diagram ops "Slow ops path and reconcile loop" at 0,39: extent=132x25 nodes=10 edges=8 routes=8
  description: Queued work beside the fast path: SSH audits, diagnostics to the janitor, its proposals through webapi to Slack, and the one-minute gcore cluster sync.
extent=260x64 cells (whole canvas)
crossings: 0 bridges, 0 touching bends
near-misses: 0 cell(s) inside the 2-cell margin of a node the route does not serve (0 on trunk buses)
passes-near-unrelated-node: 0
labels: 23/23 placed, 0 leader-ticked, 0 on route, 0 skipped, 0 ambiguous owners
groups: control(10) humans(2) hardware(7) state(4) ops(3)
dots: 22 single-dot routes, 0 periodic routes, 0 violations, 22 constant at 0.5c/step, 0 same-arrival at 2000ms
dot hues: 13 by source, 9 by destination, 0 shared-hue pair(s) (source-only 5, destination-only 5)
origins: 22/22 routes start at their arrow origin
arrivals: 0/0 same-arrival routes show their dot at the arrowhead on the final step
```

| Surface | nodes | edges/routes | edge labels | animated | bridges/touching bends | uncertain owners | reported near-miss routes | selected-border color proved |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Request | 10 | 10/10 | 10 | 10 | 0/0 | 0 | 0 | 4/10 |
| Heartbeat | 6 | 5/5 | 5 | 4 | 0/0 | 0 | 0 | 2/6 |
| Ops | 10 | 8/8 | 8 | 8 | 0/0 | 0 | 0 | 0/10 |
| Canvas | 26 occurrences | 23/23 | 23 | 22 | 0/0 | 0 | 0 | 6/26 |

Counts are for the whole-canvas capture, not what fits in one small viewport. Whole capture: no diagram content clipping or diagram-on-diagram overlap; separate horizontal rules and titles identify sections. At 77×47 all three names are initially visible but descriptions and many nodes/edges are clipped or overwritten; pan is necessary, and the 260-wide request is about 3.4 viewport widths. The 68×44 capture also clips the ops title under the left controls. The top status line reports `canvas 260x64`; it is an overflow indicator, not a separate warning banner. The pinned viewport says `viewport: 77x47 zoom: 1.00 natural`; wide capture says `viewport: 300x70 zoom: 1.00 natural`. The small pane token is 68×44; its manifest has no viewport line. Check has no `routes:` line, as expected. The small controls and minimap overwrite canvas cells; the 300×70 controls occupy the blank left margin. No pan-interaction recording was provided; panning is stated by the check/records, not directly demonstrated in a captured pan sequence.

The ANSI sample contains pink, teal, orange, olive and violet RGB families, but the violet's assignment to ops and all cross-diagram group-family consistency cannot be established from visible colored ops borders: the large captures are text only. Declared tags repeat across diagrams, and the records claim consistent colors, but a change cannot be ruled out from the captured colored band. Within the colored band, visible node borders have complete sides/corners and consistent colors per box. No tier marking or group enclosure is visible; sibling-order stability across unseen color sections is unverified. No rank pins or layer pins are declared, so no pinned ranks to compare. Text select-all cannot prove border color on the 20 remaining nodes. The original pane frames contain only 66–87; pinned and full captures carry 0–87.

Motion: full-frame audit reports one dot on each of 22 routes in each of 88 frames at 100 ms, steady 0.500 cells/frame, equal distance (77 ten-frame windows, zero spread), and check reports 0 violations and 22/22 origins. The sole static route is machines→machine-agent. The frame-0 full text shows the dots at their outgoing ends. This is constant-rate rather than same-arrival mode, so simultaneous arrival is not demonstrated or required by the check; route lengths vary 38–42 cells. The text frames cannot prove individual dot colors. The small ANSI band supports some colored dots, but does not provide whole-canvas per-route dot/source/destination hues. Thus the 13 source / 9 destination and zero shared pairs are check claims, not independently verified route-by-route; likewise I have not independently enumerated every dot's corner, arrowhead, label, or junction occupancy at every timestamp. The audit proves rate and count, not all these occupancy properties. No claim of comprehensive per-route color or frame-by-frame violation verification is made.

Across all surfaces, widest per-surface outgoing fan is three, one antiparallel pair exists, and queue and Postgres are destinations of multiple routes. Separate diagram worlds are visually joined by repeated names, not arrows. Identifier/address density is low, with action and protocol qualifiers; left-to-right ordered stages are visible. These are neutral observations, not family grading.

Generator classification in `generation.json`: `family: lifecycle-machines`; `evidence: One River job queue state fans to 5 destinations (provider registry, Postgres, SSH+BMC ops, janitor, S3) and the source marks every transition live ('keep on dot alive per line'), so one dot per line.` This is the generator's statement, not a blind finding about unseen source.

Evidence limitations: no unsupported format prevented reading. Wide selected-state and colored per-diagram/per-dot evidence are missing; the original pane frames are truncated, and no captured pan operation establishes interactivity. Independent exact per-frame positions and dot hues for every route were not exhaustively audited. The mechanized check and audit are quoted separately from direct observation. No expectations or triage were used to assign scores.
