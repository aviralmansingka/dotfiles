# Blind observation — modal-machine-manager, round 11

Stage A only. Sources: the four final specs identified by the capture manifests, the four evidence directories, and the four pinned 77×47 text captures. No source, expectations, rubric, dataset manifest, generation record, recorded drafts, or other case was read. Coordinates below are 1-based [column,row,width,height] in the 82×51 `vN-text.txt` captures. They refer to the label text, not its surrounding box. UI title and control legend are not graph labels.

## Spec identity

Independent `shasum -a 256`, each matching its own `evidence/vN/manifest.json`:

- v1 `specs/v1-provision-att3.json`: `aa6d9416fdd740b4135db3da97ddfef410214fa3ada5e64df09db0bc023e4fbb`
- v2 `specs/v2-boot-heartbeat.json`: `87e4f913e4ae812e17ddba23e19d06876451bd747872b21d4bb51141f2994073`
- v3 `specs/v3-ops-att3.json`: `546d31086c6330b0f2f837d9cb1ef3e32fb227aa855148a66bf7690fa03fa776`
- v4 `specs/v4-humans-reconcile-att2.json`: `5b650b5c7f6819bda43748e817d77bdfd7ff7a79864712685b9d1db5c177b77c`

## Labels

All node labels and edge labels in each final spec are present in the corresponding text capture. Entries are verbatim.

### v1 — 6 node labels, 5 edge labels

Nodes: `control plane` [36,6,13,1]; `private gRPC` [36,14,12,1]; `River jobs` [37,22,10,1]; `provider registry` [34,30,17,1]; `bare-metal providers` [32,38,20,1]; `bare-metal machines` [33,46,19,1].

Edges: `create / terminate / repair` [44,9,27,1]; `enqueue job` [44,17,11,1]; `provision job` [44,25,13,1]; `provider API` [44,33,12,1]; `allocate instance` [44,41,17,1].

### v2 — 7 node labels, 7 edge labels

Nodes: `boot server` [36,10,11,1]; `bare-metal machines` [32,18,19,1]; `machine-agent` [25,26,13,1]; `S3 object store` [43,26,15,1]; `public gRPC` [28,34,11,1]; `private gRPC` [44,34,12,1]; `Postgres` [38,42,8,1].

Edges: `iPXE request` [27,15,12,1]; `boot.ipxe + S3 args` [43,14,19,1]; `runs on host` [28,22,12,1]; `pull boot image` [35,24,15,1]; `register + heartbeat` [33,29,20,1]; `machine state` [35,37,13,1]; `machine rows` [52,37,12,1].

### v3 — 5 node labels, 4 edge labels

Nodes: `River jobs` [37,17,10,1]; `janitor app` [17,26,11,1]; `S3 object store` [33,26,15,1]; `SSH + BMC ops` [53,26,13,1]; `bare-metal machines` [32,34,19,1].

Edges: `diagnostic events` [23,24,17,1]; `diagnose uploads` [42,24,16,1]; `audit / verify reimage` [44,22,22,1]; `run machine-audit` [42,30,17,1]. `diagnostic events` visually sits between the janitor arrowhead and the S3 arrowhead, ending immediately alongside the latter. Its owner is ambiguous without following the left branch from River jobs; it can appear to label S3. Check reports one ambiguous owner.

### v4 — 8 node labels, 7 edge labels

Nodes: `janitor app` [17,13,11,1]; `reconcile loop` [33,13,14,1]; `humans + mmctl` [52,13,14,1]; `bare-metal providers` [24,22,20,1]; `webapi` [49,22,6,1]; `River jobs` [30,31,10,1]; `Slack` [45,31,5,1]; `Postgres` [38,39,8,1].

Edges: `http` [61,16,4,1]; `gcore sync, 1 min` [41,17,17,1]; `proposed actions` [17,19,16,1]; `reinstall / reprovision` [23,26,23,1]; `confirm + alerts` [54,26,16,1]; `job rows` [32,37,8,1]; `cluster state` [44,37,13,1]. `gcore sync, 1 min` is beside the right of two reconcile outputs, although its specified provider route is the left output; the nearby right output goes to Postgres. Ownership is ambiguous. Check reports one ambiguous owner.

## Directed routes and geometry

All 23 declared relations have a visible route and arrowhead in the still captures. Route tracing means following line glyphs, not assuming semantic correctness of labels. Unless marked otherwise, arrowheads are downward `▼` and endpoints can be traced; dynamic dots can temporarily replace route glyphs. All labels are present, but the two noted owners are not unambiguous.

- v1: control plane → private gRPC (down, animated); private gRPC → River jobs (down, static); River jobs → provider registry (down, animated); provider registry → bare-metal providers (down, static); bare-metal providers → bare-metal machines (down, animated). Five distinct runs and arrowheads; vertical phase sequence is very clear. No bridges or touching bends reported or apparent.
- v2: bare-metal machines → boot server (up `▲`, animated); boot server → bare-metal machines (down, animated); bare-metal machines → machine-agent (down/left, static); bare-metal machines → S3 object store (down/right, animated); machine-agent → public gRPC (down, animated); public gRPC → Postgres (down/right, animated); private gRPC → Postgres (down/left, animated). The boot pair has two separate adjacent oppositely directed paths. Postgres receives two separate arrowheads. No bridges or touching bends reported or apparent. Bidirectional boot movement is a local exception to an otherwise downward page progression.
- v3: River jobs → janitor app (down/left, animated, label owner uncertain); River jobs → S3 object store (down, animated); River jobs → SSH + BMC ops (down/right, animated); SSH + BMC ops → bare-metal machines (down/left, animated). Three separate outgoing ports, no drawn shared trunk or junction. No bridges or touching bends reported or apparent. Although the left branch itself can be followed, its text assignment takes interpretation.
- v4: humans + mmctl → webapi (down/left, animated); janitor app → webapi (down/right, animated); reconcile loop → bare-metal providers (down/left, animated, label owner uncertain); reconcile loop → Postgres (down/right, animated); webapi → River jobs (down/left, animated); webapi → Slack (down/left, animated); River jobs → Postgres (down/right, animated). Webapi and Postgres each receive two separate arrowheads. Three visible `⌒` bridges: the janitor horizontal route over both reconcile vertical routes, and the webapi-to-River horizontal route over the reconcile-to-Postgres vertical route. Three touching bends reported; densely adjacent bends/ports and bridges make local tracing slower; no shared trunk or semantic junction is drawn. The ambiguity means this view is not wholly traceable *with label assignment* without inference, despite traceable endpoints.

The visible structures are 6/5, 7/7, 5/4, 8/7 nodes/edges per view, 26 node occurrences and 23 edge occurrences total. The widest fan is three from River jobs in v3. There is one reciprocal box pair (machines/boot in v2), consisting of two directed edges. Convergence occurs at Postgres in v2, and webapi and Postgres in v4. Each individual view is connected as an undirected graph; across views recurring boxes act as the visual joins, but there are no drawn cross-view connectors. Labels contain technical identifiers, operations, qualifiers and timing rather than prose; label density is greatest around v3's fan and v4's reconciling routes. Most routes progress top to bottom; a reverse boot request and left/right branches are visible deviations. This is a visual observation, not a family grade.

The generator's verbatim `family:` / `evidence:` classification and its location are not present in the captures or final specs read for stage A. The generation record was not read because this stage is restricted to captures and specs. Thus no classification line or rank-pin claim is invented here. No final spec declares a rank pin; observed ranks follow the box rows above. No visible named tier markings or group titles.

## Borders, groups and selection

All 26 node occurrences have four complete rounded corners and four complete sides in the still captures; no clipped node border is visible. ANSI shows each unselected node border uses one continuous RGB shade, while node text is light neutral. The selected-state captures are one `--select-all` image each, not 26 separately selected frames: all 6/6 + 7/7 + 5/5 + 8/8 borders show the selected accent RGB (216,166,87), so 26/26 occurrences are covered simultaneously, not individually. This is not evidence of exclusive single-node selection behavior.

Group membership is a tag; there are no surrounding group boxes, borders, titles, or enclosing bands. Group hues are relative to the palette of each view, not globally fixed. Representative border RGBs observed in ANSI:

- v1 control pink: control plane (206,115,138), private gRPC (219,153,170), River jobs (193,78,106); providers magenta: registry (206,115,206), providers (219,153,219); machines teal (115,206,183).
- v2 machines teal (115,206,183), (153,219,203), (78,193,164); control pink (206,115,138), (219,153,170); state magenta (206,115,206), (219,153,219).
- v3 control pink (206,115,138); state magenta (206,115,206); ops orange (206,161,115), (219,186,153); machines teal (115,206,183).
- v4 humans teal (115,206,183); ops orange (206,161,115), (219,186,153); control pink (206,115,138), (219,153,170), (193,78,106); providers magenta (206,115,206); state purple (138,115,206). Thus e.g. machines and humans reuse teal in different views; provider and state reuse magenta in different views. Six group names across views, with five color families at most in one view.

Within each view, grouped siblings use related hues. Geometric sibling order is not an invariant: for instance v2 machines are boot above machines above machine-agent, whereas v1 has a single machines member; v4 control members occupy three successive ranks. Stable sibling order across different compositions is not established.

## Motion

The pinned files each contain frames 0–47 at 100 ms spacing. Independent counts of `●` in every pinned frame are exactly 3, 6, 4, 7 respectively: 20 animated routes and three static routes by spec. One visible dot per declared animated route is consistent with the totals, but equal totals alone do not prove route-by-route identity through every crossing. A single dot has no inter-dot spacing on its own route. The checks claim 0 dot violations, 0.5 cells/step and 20/20 origins, but the following visible defect contradicts interpreting that as useful end-to-end movement.

In v1 pinned capture, coordinates here are (row,column): the control-plane route dot in frames 0–3 is (7,39), (7,39), (8,39), (8,39); River → registry is (23,38), (23,38), (24,38), (24,38); providers → machines is (39,38), (39,38), (40,38), (40,38). All three repeat those two cells over the full 48 frames, returning to origin instead of proceeding around the bend and reaching the target. The supplied (7,38) example is not the first v1 route in this pinned capture: it is one column to the left of my measured (7,39); the second and third routes are at column 38. This is visible oscillation, not directional flow to the arrowhead. It affects 3 routes, even though the mechanical checker reports zero violations.

For v2–v4, initial dots appear immediately at the source ends, then move along route cells; for example v4 frames 0–3 start at (14,20), (14,36), (14,38), (14,56), (23,48), (23,50), (32,32), repeating in frame 1 and moving one row down in frames 2–3. Dots move at half a cell per sampled frame and wrap asynchronously on routes of unequal length; they do not all arrive at arrowheads in the same frame. Some dots overlay bends and, in v4, travel through crossing areas, making the underlying glyph briefly unavailable; the supplied still capture preserves the three bridge glyphs. A complete per-route corner/bridge/arrowhead occupancy audit is not established solely by counting dots: no claim of zero such events is made. On the three short v1 animated routes the dot never reaches its arrowhead during the 48 frames. All 20 frame-0 origins are asserted by check and consistent with the displayed initial positions, but full individual path-cell verification for the complex crossings is not independently established here.

## Fit and diagnostics

Manifest pane dimensions are 82×51; titles show `82x51 @100%`. `check.txt` says `viewport: unknown zoom: 1.00 natural` for every view; no explicit measured viewport line was captured in those manifests. Pinned captures explicitly say `viewport: 77x47 zoom: 1.00 natural` and contain 48 frames each. At 77×47 all node boxes, edge labels, routes and legend fit without pan or zoom in the observed pinned frames; v4's title is truncated at `7 ed`, which is UI chrome rather than graph content. The 82×51 v4 title also truncates after `·`. No graph item is clipped. Natural extents by check are v1 52×44, v2 41×36, v3 63×21, v4 62×30. Checks report bridges/touching bends respectively 0/0, 0/0, 0/0, 3/3; visible bridges agree. Their two ambiguous-owner warnings are consistent with the text observations above. There is no `routes:` line, as expected.

## Blind scorecard

- Nodes: 26 occurrences, by view 6/7/5/8; unique source component coverage cannot be established without source expectations.
- Edges: 23 visible declared occurrences, 5/7/4/7; all arrowheads present in stills; label ownership uncertain on two.
- Labels: 49 graph-label occurrences (26 node + 23 edge), 11/14/9/15 by view; zero missing from final specs.
- Groups: six names total, 3/3/4/5 in views; hue families per view 3/3/4/5; no group enclosures.
- Rank pins: zero declared in final specs; generator claim not inspected.
- Bridges: 0/0/0/3; touching bends check: 0/0/0/3.
- Uncertain edge-label owners: 0/0/1/1.
- Clipped graph items: 0; UI titles truncated in v4.
- Selected border coverage: 26/26 simultaneous occurrences; individually isolated selections not provided.
- Dots: 20 animated routes, 3 intended static; checker 0 violations, independent visible end-to-end movement defect on 3 short v1 routes; full corner/bridge occupancy audit unverified.
- Unreadable evidence: none of the text/spec/ANSI formats was inherently unreadable. Generator classification, draft rationale, expected identity/coverage, and rank-pin claims are unavailable under the stage-A source restriction; no inference substituted.
