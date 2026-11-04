# Blind observation: modal-machine-manager, round 08

Stage A only. I inspected only the supplied spec and capture files. Coordinates are 1-based [column,row,width,height] in the 83×51 `vN-text.txt` unless explicitly marked 77×47. They count terminal cells, not bytes. The viewer header and navigation legend are UI, not graph labels. This record distinguishes renderer reports from what I could independently establish.

## Identity and hashes

The manifest identifies `v1-request.json`, not the additional `v1-provision.json`, as the v1 final spec. SHA-256 from `shasum -a 256`:

- v1-request.json `5e19b2ed34593f0b3ab7979e751c3812c97bd064f6b5d17bb5f4f44297dca9e4` (matches v1 manifest)
- v2-dispatch.json `70f3c2ca0c7dda0db3b360770966ad968e2c0933e8eef8a6715f859c00277e9c`
- v3-boot.json `aff9f588faff84fd06f2449a93ff3fd0091c096cda0e294acc0f78abbc5964c4`
- v4-state-reconcile.json `df95ea2a9e36c9822a6fbb4b9971bc6c0a2a2d29f37bcac11e2d299d7037b89e`
- Additional v1-provision.json `91b17a435b3df2d6a3c3d1e409d30f617f0f407f23599508c0d91ac1b92db65a`; not counted as a final view.

## Visible labels

Node labels and edge labels follow, with damaged text explicitly transcribed rather than silently repaired. Region-title text is addressed under regions. Labels are one row high.

**v1 nodes:** control plane [36,9,13,1]; private gRPC [31,27,12,1]; webapi [48,27,6,1]; River queue [32,43,11,1]; Slack [48,43,5,1]. **Edges:** create/term [38,18,11,1]; enqueue [24,35,7,1]; reinstall [37,38,9,1]; confirm [41,40,7,1].

**v2 nodes:** River queue [9,26,11,1]; provider registry [36,18,17,1]; SSH + BMC [40,28,9,1]; `janitor─app` [38,23,11,1] (not the declared `janitor app`); humans + mmctl [38,33,14,1]; providers [67,20,9,1]; machines [68,31,8,1]; webapi [69,26,6,1]. **Edges:** provision [23,23,9,1]; diagnostics [23,25,11,1]; reimage [26,29,7,1]; http [56,32,4,1]; API [58,17,3,1]; run audit [52,27,9,1]; proposals [53,22,9,1]. The pinned 77×47 frame moves `reimage` to row 27, still beside the River queue→SSH + BMC corridor.

**v3 nodes:** River queue [44,17,11,1]; machines [31,17,8,1]; boot server [42,34,11,1]; S3 [58,34,2,1]; machine-agent [24,34,13,1]. **Edges:** iPXE req [33,32,8,1]; pull image [41,30,10,1]; diagnose [48,26,8,1]; on host [24,25,7,1]; visible `boot.ipxe─+─S3 args` [41,37,19,1], not the intact declared `boot.ipxe + S3 args`. The 77×47 capture puts pull image on row 28 and the damaged boot return label on row 35. Pull image is near the machines→S3 corridor; the damaged boot return label sits on/among the lower route/region glyphs, making ownership less clear.

**v4 nodes:** machine-agent [10,9,13,1]; private gRPC [28,9,12,1]; River queue [45,9,11,1]; reconcile loop [61,9,14,1]; providers [67,26,9,1]; public gRPC [9,26,11,1]; machines [45,43,8,1]; Postgres [32,43,8,1]. **Edges:** heartbeat [12,17,9,1]; state rows [15,39,10,1]; machine rows [30,25,12,1]; job rows [47,25,8,1]; gcore 1min [65,17,10,1]; cluster state [48,24,13,1]; allocate [52,39,8,1].

## Routes and ownership

All listed directions and intended endpoints below are checked against the specs; route traceability is a visual observation, not a claim that a reader can recover all endpoints from labels alone. Every route has a terminal arrowhead visible, but route/region overlaps make several traces difficult.

- v1: control plane→private gRPC down, ▼, traceable; private gRPC→River queue down, ▼, traceable but intersects the jobs title; webapi→River queue down/left, ▼, traceable but overlaps the jobs title; webapi→Slack down, ▼, traceable. `create/term` occupies columns 38–48 on row 18 while its own line is at column 36 and the other vertical line is at column 45, within its span: owner is not strictly closer by geometry. It also appears close to the apparent control-plane/webapi vertical stroke, although that stroke is region border, making the association visually confusing.
- v2: River queue→provider registry right/up, ▶; River queue→SSH + BMC right, ▶; River queue→janitor app right/up, ▶; humans + mmctl→webapi right/up, ▶; provider registry→providers right, ▶; SSH + BMC→machines right/down, ▶; janitor app→webapi right/down, ▶. These can be followed with care, but the region border and overlapping janitor text interfere. `diagnostics` at row 25 spans columns 23–33, between the nearby horizontal provision and reimage routes at rows 23 and 27; the text is not a reliably exclusive cue to its own bent route. The 77×47 `reimage` remains visibly next to the bottom outgoing queue route.
- v3: machines→boot server down, ▼; boot server→machines left/up, ▶; machines→S3 down/right, ▼; River queue→S3 down/right, ▼; machines→machine-agent down/left, ▼. Traceability is reduced by the closely packed machine outputs and the shared-looking S3 approach. `iPXE req` [33,32,8,1] lies between the routes leaving machines at columns 31, 33 and 35 and reaching other destinations; its text is not strictly closer to only its own route. The return label is visibly cut by line glyphs, and the route runs along the plant region border.
- v4: machine-agent→public gRPC down, ▼; public gRPC→Postgres down/right, ▼; private gRPC→Postgres down/right, ▼; River queue→Postgres down/left, ▼; reconcile loop→providers down, ▼; reconcile loop→Postgres down/left, ▼; providers→machines down/left, ▼. The arrows are individually followable with care across two bridges; label owners are comparatively clear.

The check reports one ambiguous owner each in v1, v2 and v3, zero in v4; it does not identify the individual label. The candidate examples above are independent visible geometry, not an assertion that the checker named those exact labels. In particular some closely spaced routes cannot be assigned unambiguously from static text alone.

## Crossings, borders, regions, selection

v1 check: `crossings: 0 bridges, 0 touching bends`; no bridge glyph seen, but `──▼j▼bs ───────` visibly replaces two letters of the jobs title with arrowheads. v2: `crossings: 1 bridges, 0 touching bends`; one `⌒` at the machines approach, plus apparent touching of the `janitor─app` text and the ops boundary. v3: `crossings: 0 bridges, 0 touching bends`; no bridge, but multiple adjacent vertical routes and the two adjacent S3 heads look branch-like; the lower region line overwrites the boot return label. v4: `crossings: 2 bridges, 0 touching bends`; two `⌒` glyphs on the Postgres approach. The route lines also visually merge with numerous rectangular region borders. No declared trunk is reported in any check.

Rounded node boxes appear four rows high. Most have recognizable four sides and corners, but route ports overwrite parts of borders; v2 janitor's interior label is crossed; other node outlines are visually mixed with region outlines. The v3 boot return route touches its left border. Selected ANSI contains the selected gold RGB 216,166,87 on node borders: five v1, eight v2, five v3 and eight v4 node occurrences are captured together in `--select-all`, 26/26 occurrences. This is one simultaneous selected-state capture per view, not 26 individual interactive selection captures. Border intersections and overwritten cells prevent me from affirming complete, color-continuous individual borders everywhere. Nonselected group colors are present in ANSI, but color alone does not establish closed, correctly enclosing regions.

Declared family evidence lines from checks, verbatim, with no family verdict:

`groups: control(3) jobs(1) humans(1)`
`groups: jobs(1) providers(2) ops(2) humans(1) plant(1) control(1)`
`groups: jobs(1) plant(3) state(1)`
`groups: plant(2) control(3) jobs(1) providers(1) state(1)`

The actual group outlines are not clean independent titled regions. v1 jobs title is visibly damaged, control/humans titles are absent. v2 providers, ops, jobs, plant, humans titles appear but several regions are empty or detached from their labeled nodes; control title absent. v3 plant title appears around parts of several boxes; jobs and state titles absent. v4 plant and control titles appear; multiple boxes and borders cross or escape those outlines; jobs, providers and state titles absent. A stable sibling order and correct member enclosure cannot be established.

## Fit, pins and phase order

Text/ANSI captures show 83×51 @100%; fixed motion captures start `viewport: 77x47 zoom: 1.00 natural`. Each `check.txt` says `viewport: unknown zoom: 1.00 natural`, with extents respectively 41×40, 71×28, 52×24, 76×40. These are check extents, not proof that region/route collisions are absent. At 83×51 no node label is offscreen; v2 janitor label and v3 boot-return label are corrupted, and region titles are missing or overwritten. Navigation legend overlaps the v4 bottom region line. I did not establish that pan/zoom is needed for the shown nodes; absence of such need for all content is not proved by these captures.

Checks report pins 5/0 conflicts, 8/0, 5/0, 8/0, respectively, and no `pins-conflict:` line. v1 has control plane above private gRPC/webapi above queue/Slack. v2 is left-to-right, queue then registry/SSH/janitor/humans then providers/machines/webapi, rather than top-to-bottom. v3 machines and queue are above boot server/S3/machine-agent; boot server→machines is a long return loop, so the whole boot/state sequence is not top-to-bottom. v4 agent/private gRPC/queue/reconcile above public gRPC/providers above Postgres/machines. No final spec declares `minlen`, so there is no declared minlen gap to verify. v3's boot return loop runs left and around the plant boundary; v4 database routes make long detours with bridges.

## Motion: independent coordinate checks

Pinned 77×47 captures contain 71 frames at 100 ms increments. Every captured frame has 4, 7, 5, 7 dots in v1–v4 respectively, one per declared route in aggregate; periodic spacing is inapplicable to single-dot routes. The following are all dots, ordered by their coordinates, at frame 0 → frame 10:

- v1: (33,11)→(33,16), (28,29)→(28,34), (45,29)→(45,34), (47,29)→(47,34).
- v2: (52,16)→(57,16), (49,21)→(54,21), (19,22)→(24,22), (19,24)→(24,24), (19,26)→(24,26), (48,26)→(53,26), (51,31)→(56,31).
- v3: (28,19)→(28,24), (30,19)→(30,24), (32,19)→(32,24), (41,19)→(41,24), (36,32)→(34,36). The last follows the bent return route: five cells along the route, not straight-line distance.
- v4: (7,11)→(7,16), (25,11)→(25,16), (42,11)→(42,16), (58,11)→(58,16), (60,11)→(60,16), (6,28)→(6,33), (64,28)→(64,33).

Thus these snapshots show five route cells per ten steps for each route, consistent with the claimed 0.5 cells/step over that interval; they do not alone prove uniformity of every intermediate movement for every route. Direction follows the arrow from source to target. At frame 0 the first ordinary route cell after a source border is one cell earlier than the dots on the straight routes: for example v1 control-plane port first cell (33,10), dot (33,11); v2 queue→registry first cell (18,22), dot (19,22); v3 machines first cells (28,18), (30,18), (32,18), dots at row 19; v4 agent first cell (7,10), dot (7,11). This is a concrete one-cell-late origin defect, contrary to the `origins: ... routes start at their arrow origin` check report. The v3 return-path dot at (36,32) also occupies a cell seen as a `╭` in another frame; comparison of all 71 frames against their underlying glyphs found no other corner, bridge, or arrowhead positions under visible dots. The aggregate observed corner event is at least one; a complete per-route special-cell and arrowhead-arrival audit is not established. Constant-speed routes need not arrive simultaneously; the reports say 0 same-arrival routes, and the captures do not demonstrate simultaneous arrival.

## Blind scorecard and evidence limits

Per-view: nodes 5/8/5/8; declared and visibly headed edges 4/7/5/7; node+edge label occurrences 9/15/10/15 = 49 (two damaged: v2 janitor, v3 boot return); reported bridges 0/1/0/2 = 3; reported uncertain owners 1/1/1/0 = 3; selected occurrences 5/8/5/8 = 26/26. No node is visibly offscreen in the 83×51 captures; at least two graph text labels are glyph-overwritten and multiple region titles are absent/damaged. No unsupported or missing supplied file format prevented reading; plain text and ANSI were readable, though the static captures do not prove all individual border continuity, full route timing, or the exact renderer's internal ambiguous-label identity. The origin-coordinate sample independently establishes at least four one-cell-late route origins, despite the checker reporting zero dot violations; the observed v3 corner position is an additional special-cell event. It would be unsound to convert the sample into a precise total count for all 23 origins without tracing each source port.
