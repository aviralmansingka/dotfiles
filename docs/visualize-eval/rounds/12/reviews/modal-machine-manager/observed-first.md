# Blind observation — modal-machine-manager, round 12, stage A

Scope: final specs, generation.json, captured check/text/ANSI/selected/frames and manifests. No source, expectations, rubric, prior round or new viewer session. Coordinates below are 1-based [column,row,width,height] in the pinned 77×47 frame 0, excluding the two capture metadata lines. Node entries are label text, not box dimensions. Edge entries are label text. Frame header and bottom-left zoom/help controls are UI, not graph labels; header is truncated at the right in the pinned dump (`q q`), but the graph is not clipped.

## Visible labels

### v1 nodes (11)
- `Modal control plane` [18,5,19,1]
- `humans + mmctl` [42,5,14,1]
- `private gRPC` [22,13,12,1]
- `webapi server` [39,13,13,1]
- `River job queue` [14,22,15,1]
- `public gRPC` [34,22,11,1]
- `reconcile loop` [50,22,14,1]
- `provider registry` [17,34,17,1]
- `S3` [39,34,2,1]
- `Postgres` [46,34,8,1]
- `bare-metal providers` [27,42,20,1]

### v1 edge labels (12)
- `create/term/repair` [29,8,18,1]; `http` [51,8,4,1]
- `enqueue job` [30,16,11,1]; `reinstall/reprovision` [47,16,21,1]
- `provision job` [12,32,13,1]; `provider API` [23,40,12,1]
- `machine rows` [32,29,12,1]; `job rows` [40,26,8,1]
- `diag uploads` [27,32,12,1]; `gcore sync, 1 min` [59,25,17,1]
- `cluster state` [59,28,13,1]; `machine state` [42,25,13,1]

### v2 nodes (11)
- `boot server` [22,5,11,1]; `River job queue` [38,5,15,1]
- `janitor app` [12,15,11,1]; `SSH + BMC ops` [28,15,13,1]; `bare-metal providers` [46,15,20,1]
- `webapi server` [19,25,13,1]; `bare-metal machines` [37,25,19,1]
- `Slack` [22,34,5,1]; `machine-agent` [32,34,13,1]; `S3` [50,34,2,1]
- `public gRPC` [32,42,11,1]

### v2 edge labels (11)
- `boot.ipxe+S3 args` [26,22,17,1]; `iPXE request` [13,29,12,1]
- `audit/verify reimage` [35,13,20,1]; `run machine-audit` [35,19,17,1]
- `diagnostic events` [10,10,17,1]; `proposals` [16,23,9,1]
- `confirm + alerts` [17,37,16,1]; `allocate inst` [49,23,13,1]
- `pull boot image` [49,30,15,1]; `runs on host` [39,37,12,1]; `reg + heartbeat` [39,39,15,1]

## Routes and readability

All edges have a visible single arrowhead. Below, direction is overall relative to source (routes may bend); traceability is my reading of the captured geometry, not a claim that label placement independently identifies every route. `▼` points down; `▶` points right. The round trip uses separate ports and separate routes, not a double-ended arrow.

### v1 (12)
- Modal control plane → private gRPC, down ▼, traceable.
- humans + mmctl → webapi server, down ▼, traceable.
- private gRPC → River job queue, down-left ▼, traceable.
- webapi server → River job queue, down-left ▼, traceable across bridge.
- River job queue → provider registry, down-right ▼, traceable.
- provider registry → bare-metal providers, down-right ▼, traceable.
- private gRPC → Postgres, down-right ▼, traceable with close following through bridges.
- River job queue → Postgres, down-right ▼, traceable with close following through bridges.
- River job queue → S3, down-right ▼, traceable.
- reconcile loop → bare-metal providers, down-left ▼, traceable with close following past the state fan.
- reconcile loop → Postgres, down-left ▼, traceable with close following.
- public gRPC → Postgres, down-right ▼, traceable with close following.

### v2 (11)
- boot server → bare-metal machines, down-right ▼, traceable with close following.
- bare-metal machines → boot server, left then up and right ▶, traceable with close following across bridge; noticeably against the general top-to-bottom order.
- River job queue → SSH + BMC ops, down-left ▼, traceable.
- SSH + BMC ops → bare-metal machines, down-right ▼, traceable.
- River job queue → janitor app, down-left ▼, traceable across bridge.
- janitor app → webapi server, down-right ▼, traceable.
- webapi server → Slack, down-left ▼, traceable across bridge.
- bare-metal providers → bare-metal machines, down-left ▼, traceable.
- bare-metal machines → S3, down-right ▼, traceable.
- bare-metal machines → machine-agent, down-left ▼, traceable.
- machine-agent → public gRPC, down ▼, traceable.

The check reports zero ambiguous owners in both views. As a reader I have four *visually uncertain* label owners in v2 without checking spec: `diagnostic events` sits alongside the long request line rather than its own queue route; `iPXE request` sits alongside the Slack-bound vertical and near its crossing of the request route; `runs on host` sits by the machine-agent's outgoing line rather than its incoming line; `confirm + alerts` sits below Slack rather than directly beside its incoming line. The spec resolves all four. This is a separate subjective observation, not the check's geometric ambiguity metric. No v1 label owner remains uncertain after tracing, though the four database writer labels and bridges require care.

## Crossings and apparent junctions

`⌒` bridge glyphs, pinned frame-0 coordinates (column,row): v1 (31,19), (31,27), (39,27), (46,28), (46,30), (56,31); v2 (27,11), (25,30). They represent overpasses, not junctions. Check reports v1 6 bridges and 4 touching bends; v2 2 bridges and 2 touching bends. The dense bend contacts around v1 database writers and v2 machine fan are visible, but I cannot uniquely enumerate all touching-bend pairs from the glyphs alone. No actual multi-edge branching junction is declared or visibly marked; apparent branching arises from adjacent independent ports at the queue, machines, reconcile loop and crossings. In v1 four separate arrowheads converge on Postgres, two on providers and two on the queue; v2 three converge on machines. Touching routes and bridges require tracing; no shared trunk is declared.

## Groups, ranks, borders

Normal ANSI evidence, per-node border RGB (all four sides and corners complete and uniformly colored):
- v1 control pink: Modal control plane (206,115,138), private gRPC (193,78,106), public gRPC (219,153,170), webapi server (231,187,198). humans teal: humans + mmctl (115,206,183). ops orange: River job queue (206,161,115), reconcile loop (219,186,153). fleet magenta: provider registry (206,115,206), bare-metal providers (219,153,219). state violet: Postgres (138,115,206), S3 (170,153,219).
- v2 ops orange: River job queue (206,161,115), SSH + BMC ops (219,186,153), janitor app (193,135,78). fleet magenta: bare-metal providers (206,115,206), bare-metal machines (219,153,219), machine-agent (193,78,193). control pink: webapi server (206,115,138), public gRPC (219,153,170). state violet: boot server (138,115,206), S3 (170,153,219). humans teal: Slack (115,206,183).

Five hue families in each view. Members occupy different ranks, not a stable contiguous sibling ordering; the same nodes' group shading is not consistent across views (e.g. webapi server). No group enclosure, border or group title. No tier lines or tier hue bands are visible. `generation.json` explicitly says no layers/rank pins; final specs contain none. Thus 0 declared pins, and there is no pin placement to verify. Actual visible top-to-bottom ranks: v1 {control plane, humans}, {private gRPC, webapi}, {queue, public gRPC, reconcile}, {registry, S3, Postgres}, {providers}; v2 {boot server, queue}, {janitor, SSH ops, providers}, {webapi, machines}, {Slack, machine-agent, S3}, {public gRPC}.

ANSI `selected` captures show all 11/11 boxes per view with all sides and corners continuous selected gold (216,166,87): 22/22 occurrences. This is a simultaneous select-all capture, not 22 separate single-selection captures. Pinned text select-all says 11 selected for each; plain text cannot itself establish color.

## Motion and fit

Check reports 12/12 and 11/11 single-dot routes, no periodic routes, 0 dot violations, constant 0.5 cells/step and 12/12 and 11/11 origins correct. In both 120-frame pinned laps (100 ms increments), every frame has exactly 12 or 11 visible dots respectively. At frame 0 the dots occur at the corresponding route origins, including the left-side machine request port. Each route has one dot, so inter-dot spacing per route is not applicable. Sampled captured positions replace only straight `─` or `│` glyphs; no displayed dot masks a corner, bridge or arrowhead in these frames. These captures do not independently prove whether an internal animation step passes over such a cell while retaining its glyph. The check says 0 same-arrival routes and its `0/0` arrivals result is not evidence of synchronized arrival; no evidence establishes that all dots reach arrowheads in the same frame. Motion is directed along each source→target route; the request travels up in overall page coordinates. Individual route-by-route velocity and complete traversal cannot be independently established merely from the count and check line; the lap captures are available for detailed tracking.

Pinned viewport line for both: `viewport: 77x47 zoom: 1.00 natural`. Check extent v1 68×41, v2 65×41; check viewport is `unknown`, not 77×47. Live pane text/header and manifests report 83×51 at 100%. All graph labels, boxes, routes and controls appear within pinned viewport; no graph item is visibly clipped or requires pan/zoom. The header's right end is clipped as noted above. No `routes:` line exists; that is expected.

## Neutral structure

Each view shows 11 node occurrences, 12 and 11 directed edges respectively; 22 occurrences, 17 distinct label names and 23 drawn edge occurrences across both. In v1 the widest outgoing fan is the queue, 3; in v2 machines have 3 outgoing routes. At least queue, Postgres, providers and machines receive multiple distinct routes. v2 has one pair of boxes linked in both directions, with two separate directed edges; v1 has none. Each view's graph is connected by its drawn routes, rather than disjoint worlds; the views share five repeated node names (queue, providers, webapi, S3, public gRPC), not drawn inter-view links. Labels contain compact operational verbs, acronyms and a few qualifiers, including `1 min`, iPXE and S3; several abbreviated labels require context. A rough request→queue→registry→provider downward progression appears in v1 and operations→machine→agent progression in v2, but the boot request reverses direction and the fan/state routes cross that progression.

Generator's classification, verbatim, from `generation.json` `step0_classification`:
- `family: lifecycle-machines`
- `evidence: one machine node (bare-metal machines / machine-agent) and one work queue each fan to 5 phase transitions (agent register+heartbeat, iPXE request, pull boot image, runs on host, run machine-audit / q enqueue, reinstall, audit, diagnose, diagnostic events), and the source marks every transition live ('add slow dots flowing through it'), so one dot per line.`

## Blind scorecard

| Metric | v1 | v2 | total |
|---|---:|---:|---:|
| Visible nodes (occurrences) | 11 | 11 | 22 |
| Visible edges | 12 | 11 | 23 |
| Node / edge labels | 11 / 12 | 11 / 11 | 22 / 23 |
| Group hue families | 5 | 5 | 5 distinct |
| Declared rank pins | 0 | 0 | 0 |
| Bridges / touching bends (check) | 6 / 4 | 2 / 2 | 8 / 6 |
| Uncertain label owners, subjective / check | 0 / 0 | 4 / 0 | 4 / 0 |
| Clipped graph items | 0 | 0 | 0 |
| Selected-state border coverage, simultaneous | 11/11 | 11/11 | 22/22 |
| Dot violations (check) | 0 | 0 | 0 |

Evidence not readable at all: none among the inspected permitted files. Limitations: a simultaneous selected state does not prove individual selection behavior; exact touching-bend pairs and internal dot passage through corners/arrowheads are not established by the text capture. The task's captain-provided provenance note says the worker resumed after a provider 429, and captain probes captured the worker's specs without authoring them; that note is not independent proof of coverage or a reason to discount the captures. This stage does not compare against hidden source or expected data.
