# Blind observation — modal-machine-manager, round 10

Stage A only. Coordinates below are **1-based [column,row,width,height]** within frame 0 of the 77×47 pinned capture, including the viewer header as row 1; they are not file line numbers. Labels listed are actual visible text. The separate 82×51 pane capture has different coordinates. A spec is evidence of intent, not proof of rendering.

## Spec identity

Independent `shasum -a 256` on the four final specs, matching `generation.json`:

- `specs/v1.json`: `c84e1609aefa9b1f45f877e8b71bd2bde85194752f57992d7405e99acdb6648b`
- `specs/v2.json`: `7245373d5e38442bb46357e00d7095640ff0c6e3629999725f58c74abdc707e3`
- `specs/v3.json`: `a7bab030e711df85db0c37717cb5876652b09bc78aa4ede63981eefc38609958`
- `specs/v4.json`: `717d2f6900382b26b540fb325de478bc01377d6dbecaba230891d6485e1101fe`

## Visible labels, locations, routes

Every listed edge has a visible, correctly oriented arrowhead and a separately traceable route in frame 0. Direction below is the arrow direction, not necessarily the direction in which the label reads. The short labels abut some routes or arrowheads; I could identify their owners by tracing, although v2's two opposing boot routes need care. No label owner is conclusively uncertain.

### v1 — 6 nodes, 5 edges

Node labels: `humans + mmctl` [23,15,14,1]; `control plane` [42,15,13,1]; `webapi server` [24,23,13,1]; `private gRPC` [42,23,12,1]; `River queue` [39,32,11,1]; `Slack` [29,32,5,1].

- control plane → private gRPC, down: `create/terminate/repair` [50,18,23,1].
- humans + mmctl → webapi server, down: `http` [32,18,4,1].
- private gRPC → River queue, down/left: `enqueue job` [49,27,11,1].
- webapi server → River queue, down/right: `reinstall/repro` [32,27,15,1].
- webapi server → Slack, down/right: `confirm+alerts` [14,27,14,1].

### v2 — 6 nodes, 6 edges

Node labels: `River queue` [34,11,11,1]; `reconcile loop` [43,19,14,1]; `provider registry` [21,19,17,1]; `bare-metal providers` [21,27,20,1]; `bare-metal machines` [30,36,19,1]; `boot server` [46,27,11,1].

- River queue → provider registry, down/left: `provision job` [41,14,13,1].
- provider registry → bare-metal providers, down: `provider API` [31,22,12,1].
- reconcile loop → bare-metal providers, down/left: `gcore sync 1min` [52,22,15,1].
- bare-metal providers → bare-metal machines, down/right: `allocate instance` [13,31,17,1].
- bare-metal machines → boot server, up/right: `iPXE request` [38,30,12,1], upward arrowhead.
- boot server → bare-metal machines, down/left: `boot.ipxe + S3 args` [42,34,19,1], downward arrowhead.

The opposing lines have distinct ports and corridors. Contrary to the generator's asserted five-rank page order, the actual capture puts boot server *above* machines, alongside providers. The return and request are legible, but packed close together.

### v3 — 7 nodes, 6 edges

Node labels: `bare-metal machines` [30,11,19,1]; `machine-agent` [33,19,13,1]; `public gRPC` [8,27,11,1]; `private gRPC` [24,27,12,1]; `River queue` [41,27,11,1]; `reconcile loop` [57,27,14,1]; `Postgres` [36,37,8,1].

- bare-metal machines → machine-agent, down: `runs on host` [41,14,12,1].
- machine-agent → public gRPC, down/left: `register+heartbeat` [41,22,18,1].
- public gRPC → Postgres, down/right: `machine state` [15,30,13,1].
- private gRPC → Postgres, down/right: `machine rows` [32,30,12,1].
- River queue → Postgres, down/left: `job rows` [48,30,8,1].
- reconcile loop → Postgres, down/left: **`cluster stat`** [66,30,12,1] at 77 columns; final `e` of intended `cluster state` is clipped. The 82×51 pane text shows the complete label. This is one clipped item despite `--check` saying all labels placed and the generator claiming no clipping.

### v4 — 6 nodes, 6 edges

Node labels: `River queue` [34,15,11,1]; `SSH + BMC ops` [23,24,13,1]; `janitor app` [41,24,11,1]; `bare-metal machines` [11,33,19,1]; `webapi server` [35,33,13,1]; `S3 object store` [53,33,15,1].

- River queue → SSH + BMC ops, down/left: `audit / verify` [23,20,14,1].
- River queue → janitor app, down/right: `diagnostics` [35,22,11,1].
- SSH + BMC ops → bare-metal machines, down/left: `run audit` [21,31,9,1].
- River queue → S3 object store, down/right: `diag uploads` [44,19,12,1].
- bare-metal machines → S3 object store, right: `pull image` [36,36,10,1]. It leaves the machine's right side, drops below webapi, passes under it, and rises into S3's left side with ▶. The label is readable and the route can be traced, though the detour under an intervening box is not a straight short hop.
- janitor app → webapi server, down/left: `proposals` [42,31,9,1].

## Shape, connectivity and crossings

Across views there are 25 node occurrences (6/6/7/6), 17 distinct named components, 23 distinct drawn edge occurrences (5/6/6/6), and 48 graph-label occurrences (25 node + 23 edge; one edge label clipped at 77 columns). Repeated nodes connect the four separately displayed worlds conceptually; there are no drawn inter-view connectors. Each individual view is connected if direction is ignored. Widest single-view fan-out is three from River queue in v4; webapi has two in v1. Across the views River queue has five outgoing routes to provider registry, SSH/BMC, janitor, S3 and Postgres. River queue in v1, providers and machines in v2, Postgres in v3, and S3 in v4 have multiple incoming arrowheads. Postgres has four. One pair, machines and boot server, has two opposing edges, one each way. There are no genuinely disjoint islands in an individual view.

The layout reads down through request intake, provisioning and machine-agent/state paths, with side sources and convergence; v4 is queue → operations → targets. The label vocabulary is moderately dense with roles, protocols, action lists, one 1-minute qualifier and abbreviations; there are no IPs or port identifiers. There are no explicit source-named tier label lines or tier hue bands. The visible colored node borders are group hues, not named tier separators.

Each `check.txt` reports `crossings: 0 bridges, 0 touching bends`; I see no crossing glyphs, bridge glyphs, touching bends, shared junctions or actual route branches in frame 0. Close approaches include the v1 queue fan-in, v2's opposing boot corridors, v3's four sink routes, and v4's three separate queue output ports; these can look like branches but remain distinct. Individual orthogonal turns are visible on every routed detour. `routes:` is absent as expected.

## Group hue, order, ranks and borders

ANSI `vN-ansi.ansi` shows five declared hue families across the views: humans teal (v1 humans RGB 115,206,183 and Slack 153,219,203); control pink (e.g. v1 control plane 206,115,138, private gRPC 193,78,106, webapi 219,153,170, queue 231,187,198); metal purple (v2 registry 206,115,206, providers 219,153,219, machines 193,78,193, boot 231,187,231); state teal (v3 Postgres and v4 S3 115,206,183); ops orange (v4 SSH 206,161,115, janitor 219,186,153). Humans and state reuse teal across separate views; these are five declared groups but not five uniquely distinguishable hues globally. Per-node shade is not stable across views: e.g. queue changes pink shade, machines changes purple shade. Sibling shades are differentiated inside each view, but no consistent global sibling ordering can be established from these changing member sets. No group container, title or border is drawn, as required. Every node box has four complete sides and four corners in the captured ordinary view; ANSI foreground on observed sides/corners follows its node's hue. No missing box border is apparent. Selection capture shows all 25 occurrences with amber RGB 216,166,87 borders simultaneously; it does **not** independently capture each node alone. Thus select-all coverage is 25/25, independent single-selection evidence is 0/25.

Only v4 declares pins: `[[q], [bmc, jan], [mch, wapi, s3]]`, matching all six actual ranks: queue top; SSH/BMC and janitor middle; machines, webapi and S3 bottom. `check.txt` says six pinned, zero conflicts. v1–v3 have no declared pins. In v3 the observed rank is machines / machine-agent / public gRPC + private gRPC + River queue + reconcile loop / Postgres, not the top-rank placement claimed in the generator's recipe capture.

## Motion and evidence limitations

All 23 specs declare `flow: true`, `dots: 1`. Direct counts over every pinned frame: v1 5 dots in each of 52 frames, v2 6 in each of 52, v3 6 in each of 78, v4 6 in each of 90. Thus there is one visible dot per route in frame 0 and counts remain constant; the counts alone do not prove correct traversal. Frame 0 dots sit just outside their origins, including the machine→boot up-going route and the v4 side port; no route is intentionally static. Dots are single, so intra-route spacing between dots is not applicable. The captures show independent cycling, not a common simultaneous arrival. Dots do cover ordinary bends (e.g. v4 frame 4); a comprehensive corner/arrowhead exclusion audit for all routes is not established here. No bridges exist to occupy. Exact arrowhead occupancy and separate arrival times for every edge are not established from the text alone; the check's `arrivals: 0/0` covers only same-arrival routes and does not prove all arrive.

**Verified defect:** in pinned v1, using [column,row], both first-hop dots are at (29,18), (48,18) in frames 0, 4, 20, and at (29,19), (48,19) in frames 2, 10, 30, 51. They repeatedly move backward to the first cell instead of reaching the bends and arrowheads. The loop repeats over the capture, breaking directional traversal and constant-rate progress despite `check.txt` claiming five constant routes and zero violations. Other v1 dots visibly travel along longer routes. At least **two route-motion violations** are directly established; do not interpret this as a count of all possible violations. v2's short provider API dot also cycles over a very short visible span, so frame count alone is not a full-lap proof. v3's short runs-on-host likewise returns early in the shown frames; precise complete-route behavior of remaining short links requires further measurement, not an inference from `--check`. v4 sampled frames show the image dot moving along the detour and other dots independently advancing.

Pane-frame captures are truncated scrollback, not a complete 52/52/78/90-frame record; pinned dumps supply those frame counts. I did not establish independent single-node selected borders, every dot's arrowhead encounter, or a complete corner-by-corner color audit beyond the saved ANSI observations. No evidence format was wholly unreadable.

## Fit and classification statement

Pinned viewport line in every dump: `viewport: 77x47 zoom: 1.00 natural`; pane text header: `82x51 @100%`. Check extents v1 63×21, v2 64×29, v3 73×30, v4 70×24, but the extent does not protect the v3 edge-label last character from clipping at 77 columns. At 82×51 the v3 label is complete. No other clipping is apparent in frame 0; no evidence establishes that panning/zooming restores the clipped character without changing layout.

Generator statement, verbatim, location `generation.json`, `step0_classification.family`, `.evidence` and `.secondary_recipe`:

> family: lifecycle-machines
>
> evidence: one queue fans to five phase destinations (provider registry, SSH ops, S3, janitor, Postgres) and the source gives an ordered machine life - provisioning -> boot -> heartbeat -> reconcile - with every transition live, which the human's last correction renders as exactly one dot per line.
>
> secondary_recipe: service-meshes' anti-parallel rule applied to machines <-> boot server (iPXE request and boot.ipxe + S3 args response): both directions are drawn in v2 as two separate edges with distinct labels and ports, never merged into one bidirectional arrow

This is a transcription of the generator's claim, not an independent classification or verification of unseen source content.

## Blind scorecard

```json
{"views":4,"visible_node_occurrences":25,"distinct_nodes":17,"visible_edges":23,"visible_graph_labels":48,"edge_labels":23,"group_declarations":5,"visually_distinct_hues":4,"pinned_nodes":6,"pin_conflicts":0,"bridges":0,"touching_bends":0,"uncertain_label_owners":0,"clipped_items_77x47":1,"selected_all_coverage":"25/25","independent_selected_coverage":"0/25","dots_per_frame":"5,6,6,6","confirmed_motion_violating_routes_at_least":2}
```
