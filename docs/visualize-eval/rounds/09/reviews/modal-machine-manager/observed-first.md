# Blind observation — modal-machine-manager, round 09

Stage A only. I read the four final specs and their supplied text/ANSI, selected, frames, pinned-viewport and check captures. I did not consult expectations, source, generation records, manifests, or other cases. The user supplied the group contract and the disclosed omissions below; these are not independently established from an expectations file.

## Identity and spec hashes

SHA-256, computed with `shasum -a 256` (no manifest comparison yet):

- v1 `d8a1e3cdf9f77e399520ed50ffe052b7b9fad2deb235a463db8827d1e7f1346c`
- v2 `897bcf4ba297df20f16f212ad7570ed763f5cd9939f6ef8f0cfde613b617c584`
- v3 `6a1999c597baa91296eb704b9972fb80ce789baae0375e6adb1f067503eab9d0`
- v4 `e60fb2db477c2c6baa2863723a58ed9336c9c7110b526cd2633b0d7014746833`

The request reports the generator's classification as `family: lifecycle-machines`, with evidence described as one queue to five phases, one-dot-per-line correction, and a secondary mesh recipe for the handshake. I cannot quote the complete `family: … / evidence: …` line or give its source-file location: it is not present in the permitted final specs or captures I inspected. The request reports coverage 16/17 components and 20/23 relations, and flags `web`, `web→wapi`, `pgrpc→db`, `pub→db` as absent. I have not independently checked those counts against expectations.

## Coordinate convention and labels

Coordinates below are `[column,row,width,height]`, 1-based, on each **82×51 `vN-text.txt` capture**, including its status line. They describe visible glyphs, not the node border. This matters: v2 is clipped even there; the 77×47 pinned captures have a different viewport origin. The zoom control and status text are interface chrome, not graph labels.

- v1 nodes: `control plane` [36,6,13,1]; `private gRPC` [36,14,12,1]; `River job queue` [35,22,15,1]; `provider registry` [34,30,17,1]; `bare-metal providers` [32,38,20,1]; `bare-metal machines` [33,46,19,1]. Edges: `create/terminate/repair` [44,9,23,1]; `enqueue job` [44,17,11,1]; `provision job` [44,25,13,1]; `provider API` [44,33,12,1]; `allocate instance` [44,41,17,1].
- v2 nodes: `bare-metal machines` [22,27,19,1]; `River job queue` [46,27,15,1]; `machine-agent` [25,50,13,1]; `boot server` is above the viewport, and `S3 object store` is truncated to `S3 object stor` [43,50,14,1] in this capture. Edges: `iPXE request` [45,16,12,1]; `boot.ipxe + S3 args` [17,14,19,1]; `pull boot image` [26,44,15,1]; `runs on host` [12,48,12,1]; `diagnose uploads` [29,35,16,1]. At 77×47, the first part of `runs on host` is under the control overlay, and neither bottom node label nor the boot-server label is visible.
- v3 nodes: `machine-agent` [16,12,13,1]; `River job queue` [34,12,15,1]; `reconcile loop` [54,12,14,1]; `public gRPC` [8,39,11,1]; `SSH + BMC ops` [24,39,13,1]; `Postgres` [42,39,8,1]; `bare-metal providers` [55,39,20,1]. Edges: `audit / reimage` [19,25,15,1]; `job rows` [38,25,8,1]; `cluster state` [41,26,13,1]; `gcore sync, 1 min` [58,25,17,1]. `register + heartbeat` is not drawn; check says 4/5 placed and names that skipped label. At 77×47 the provider's body and label are occluded by the large overlay even though its top border is visible.
- v4 nodes: `webapi server` [36,7,13,1]; `River job queue` [25,16,15,1]; `janitor app` [26,25,11,1]; `SSH + BMC ops` [46,25,13,1]; `Slack` [28,45,5,1]; `bare-metal machines` [38,45,19,1]. Edges: `reinstall/reprovision` [44,10,21,1]; `diagnostic events` [34,19,17,1]; `proposed actions` [46,20,16,1]; `confirm + alerts` [24,30,16,1]; `machine-audit` [48,35,13,1].

Ownership: v1 labels are clearly associated by proximity and dedicated slots. In v3, `audit / reimage` sits between the agent line and the queue line and `cluster state` sits between neighboring lines: following the paths or consulting the spec is needed to settle ownership, despite the check reporting zero ambiguous owners. In v4 the two upper webapi routes run very close together, and `reinstall/reprovision` is far from the queue-directed port; the intended owner is less immediate. v2's labels are near long parallel segments; clipping makes endpoint ownership uncertain. These are perceptual observations, not additional check-reported ambiguity.

## Routes and apparent structure

The 24 node occurrences and 20 declared routes are across four separate views, not one continuously displayed graph. Listed below are the specs' endpoints and the capture-visible arrowheads. A complete route means both endpoints and its full line can be followed in the indicated capture.

- v1: control plane → private gRPC ↓; private gRPC → River job queue ↓; River job queue → provider registry ↓; provider registry → bare-metal providers ↓; bare-metal providers → bare-metal machines ↓. All five arrowheads visible and routes traceable. This is a single narrow, top-to-bottom chain, fan width 1.
- v2: machines → boot server ↑ (`iPXE request`); boot server → machines ↓ (`boot.ipxe + S3 args`); machines → S3 ↓; machines → machine-agent ↓; queue → S3 ↓. The paired handshake routes are parallel, opposite directions, in one view, but the boot box and its incoming arrowhead are above the captured viewport; the down return head is visible. The two lower downward heads are visible near the bottom, but target labels/parts of boxes are clipped; the queue-to-S3 and machine-to-S3 converge on separate ports. Full endpoint-to-endpoint tracing is not possible in the 77×47 capture without panning; neither direction of the handshake can be fully verified there. The machine has fan-out 3; this is the only reciprocal pair, two opposing routes. The queue and machines are connected through the shared S3 target.
- v3: machine-agent → public gRPC ↓ (unlabeled); queue → Postgres ↓; queue → SSH + BMC ops ↓; reconcile loop → Postgres ↓; reconcile loop → bare-metal providers ↓. All five arrowheads visible at 82×51 and paths are traceable; the first route's action is not visible. Postgres receives two distinct arrowheads. Fan width 2; queue and reconcile are connected through Postgres, while the agent/public-gRPC pair is a separate world. At 77×47, the overlay obscures the provider label/body.
- v4: webapi → queue ↓; queue → janitor ↓; janitor → webapi ↑/left-pointing at webapi; webapi → Slack ↓; SSH + BMC ops → machines ↓. All five arrowheads visible and lines traceable, although the two webapi outbound paths make close adjacent bends. The three directed edges form a readable loop after tracing its long return up the right; there is no reciprocal pair. Fan width 2. SSH/machines is a separate world, not joined to the loop in this view.

Across views, the visible top-down chain says enqueue → provision → allocate. The separate boot view supplies iPXE, image pull, and agent; the skipped label prevents a reader from seeing `heartbeat` in v3, and there is no visible public-gRPC → Postgres route. Thus the requested full enqueue → provision → allocate → iPXE → image pull → heartbeat → state-write recipe is not readable as a continuous, explicitly labeled top-to-bottom sequence in the captures. Labels contain compact identifiers, operation lists and qualifiers (`boot.ipxe + S3 args`, `gcore sync, 1 min`, etc.), not long prose.

## Crossings, groups, borders, ranks

All four `check.txt` files report `crossings: 0 bridges, 0 touching bends`; I see no bridge glyph or actual junction in these captures. Routes approach closely at v3's bottom paired Postgres arrows and v4's upper webapi bends, and v4's split-looking upper geometry can initially suggest a branch, but they are separate routes, not a drawn junction. No group boxes, borders or titles surround members, as required by this round. No source-named tier label lines or tier bands are visible.

ANSI node-border colors are grouped hue families, though distinct tags can collide in hue: control pink RGB (211,134,155), (226,156,175), (187,108,131); provision teal (125,174,163), (147,194,183); hosts green (169,182,101), (189,201,124); ops green (169,182,101), (189,201,124); state green (169,182,101); humans orange (231,138,78). Thus green does not uniquely identify the hosts, ops and state tags. In each capture sibling shades are stable within the visible ordering; the order of members is not a global fixed semantic order across views. V2 boot-server and S3 borders are only partly visible, so their complete color continuity cannot be independently confirmed.

All fully visible node boxes in v1, v3 and v4 show four sides and four rounded corners; their unselected ANSI borders have continuous per-node color, with connection ports drawn outside. In v2 machine and queue are complete; boot, machine-agent and S3 have clipped sides/corners in the 82×51 evidence. Selected ANSI paints simultaneously selected visible node borders gold (216,166,87): v1 6/6, v2 4/5 at least partially visible (boot bottom border also gold, giving 5/5 partially visible), v3 7/7, v4 6/6. This is a select-all capture, not individual selected-state captures; fully verifiable selected borders are 21/24 node occurrences, with the three clipped v2 nodes not fully verifiable. It does not establish individually selected screenshots for any occurrence.

Only v4 spec declares rank pins: rank 1 webapi; rank 2 queue; rank 3 janitor and SSH; rank 4 machines and Slack. Capture shows precisely these four horizontal tiers, with Slack left of machines. Check says `layers=4 (6 pinned, within-rank order automatic)` and `pins: 6 pinned, 0 conflict(s)`. Generation record was excluded by the stage-A-only constraint; no independent claim about what it says is made.

## Fit and motion

Checks report `viewport: unknown zoom: 1.00 natural`; extents v1 48×44, v2 52×53, v3 80×31, v4 54×42. Pinned files report `viewport: 77x47 zoom: 1.00 natural`. V1 and v4 fit with all graph labels and boxes visible; v2 and v3 explicitly show `graph overflows · drag to pan` at pinned capture lines 4/52/100 and 5/53/101 respectively. At v2 a reader initially gets the middle of the drawing, not the boot server nor bottom labels; UI controls also cover the beginning of `runs on host`. At v3 the body of the provider is under the overlay. Panning is offered but a successful pan capture is not supplied, so recovery of every obscured item is not independently demonstrated.

All specs declare one flowing dot per route. Each check claims 5 single-dot routes, 0 violations, 5 constant at 0.5c/step, and 5/5 origins. In pinned frame 0 the visible dot coordinates, 1-based viewport coordinates including the status line, are:

- v1 (33,7), (33,15), (32,23), (31,31), (29,39): each is the first cell outside its source border.
- v2 (34,2), (40,25), (20,28), (22,28), (44,28): four can be associated with the machine/queue ports; the first is at the top edge and its boot-server source border is clipped, so its origin cannot be independently verified from this viewport. The others sit on the first cell outside their source border.
- v3 (14,13), (32,13), (34,13), (52,13), (54,13): first cell outside each source border.
- v4 (33,8), (35,8), (22,17), (35,23), (43,26): first cell outside each source border, including the janitor's right-side outgoing port.

The `frames.txt` files start with an unlabelled tail of an earlier frame and provide labeled frames 2–20 at 200–2000 ms; the pinned files provide frames 0–2. There is one dot per route in the visible portions, but clipping precludes independently counting every dot on every v2 frame. The 2-second capture does not cover a full lap of the longest long vertical/loop routes: at 0.5 cell per 100 ms, at most about ten cells are traversed, far less than the long paths. Some short v1 routes can reach their arrowheads within the sample, while long ones cannot reach them in the same frame. There is no same-arrival declaration. Because dots overwrite route glyphs and the animated captures do not expose underlying cell classification, I cannot reliably certify every corner/arrowhead occupancy or count frame-by-frame violations independently; the check's zero is a reported result, not a completed visual proof. One dot per route makes inter-dot spacing within a route inapplicable.

## Blind scorecard

| Measure | v1 | v2 | v3 | v4 |
|---|---:|---:|---:|---:|
| Declared node occurrences | 6 | 5 | 7 | 6 |
| Fully visible node labels, 82×51 | 6 | 3 | 7 | 6 |
| Declared routes | 5 | 5 | 5 | 5 |
| Edge labels visible in full, 82×51 | 5 | 5 | 4 | 5 |
| Group tags / distinguishable hues | 3 / 3 | 4 / 3 or fewer visible | 5 / 3 | 4 / 3 |
| Rank pins / observed tiers | 0 / — | 0 / — | 0 / — | 6 / 4 |
| Check bridges / touching bends | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Clearly/perceptually uncertain label owners | 0 | multiple, clipping | 2 potentially | 1 potentially |
| Pinned-viewport graph labels clipped/hidden | 0 | ≥3 node labels and 1 edge label partial | 1 node label | 0 |
| Fully visible selected borders / occurrences | 6/6 | 2/5 | 7/7 | 6/6 |
| Check dot violations | 0 | 0 | 0 | 0 |

Evidence limitations: no unsupported file format prevented inspection. ANSI was decoded as color escape sequences. The complete classification line/location, independent individual selection captures, a full longest-route motion lap, complete v2 geometry and evidence of successful panning were not available under the permitted stage-A capture/spec scope.
