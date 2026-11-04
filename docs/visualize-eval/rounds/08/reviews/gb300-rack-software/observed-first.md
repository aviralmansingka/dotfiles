# Blind observation — gb300-rack-software, round 08, stage A

Scope: supplied final specs and captures only. No expectations, source, rubric, raw attempt logs, or other cases read. Coordinates below are 1-based `[column,row,width,height]` in the **83×51 pane text captures**, including their header row, not the pinned dumps. A label's width is its visible text width. UI header and control legend are not counted as diagram labels.

## Spec identity

`shasum -a 256` agrees with each evidence manifest:
- v1 `a4f507b39e37ec25c857c201c421026782aa114759bba5defdbb72363ad46893`
- v2 `32d6b034f4870d5ea3a5270d3e3590dace94e4b9d54f8586da2351699cbd102b`
- v3 `9b65a2818975fbaaab7454e04e242f7dc044e2707781a32e68ba1126c8690fb6`
- v4 `3761a61aff7058f0dc1b6aa5897be3e6d7113626cad7f0de7b1df72f31cd15b0`

All manifests identify binary SHA-256 `ea24593b0f80c1617573eef4766f2bacaaf4315a8133a65d5331e9daec1c1f30`, five frames, selected-state capture, and confirmed pane closure. Their pane column count and viewport_line are null, but viewport_token is `83x51 @100%`. The frame captures report `viewport: 83x51 zoom: 1.00 natural`; checks report `viewport: unknown zoom: 1.00 natural`. Pinned captures report `viewport: 77x47 zoom: 1.00 natural`. The pinned v3 UI header is clipped at `q qu`; no diagram node or edge appears clipped in either size. No claim about hidden offscreen content or pan access can be proved solely from screenshots, although all declared nodes and edge heads are visible. At 77×47 v4 is close to the lower edge and the controls overlay blank left margin, not diagram nodes.

## Visible labels and topology

### v1

Node labels: `nv-rms` [40,7,6,1]; `OOB LAN` [39,24,7,1]; `Compute BMC×18` [19,44,14,1]; `NVSwitch BMC` [38,44,12,1]; `Power shelf` [55,44,11,1]. Edge labels: `LAN client` [42,15,10,1]; `Redfish/HTTPS` [23,40,13,1]. Group text visible: `r▼ck hw` [54,42,7,1], visibly damaged by an arrowhead. The other declared group titles are not visible.

Arrows: nv-rms → OOB LAN downward, ▼ at [39,22], route traceable; OOB LAN → Compute BMC×18, NVSwitch BMC, Power shelf, downward heads [19,42], [38,42], [55,42]. The three destinations are visible, but their shared bus is not cleanly traceable as one split into three: the horizontal span has **one** junction glyph `┴` at [39,41], immediately beside **one** bridge glyph `⌒` at [38,41]; the middle destination arrow is directly under the bridge, and the right arrow overwrites the region title. The apparent left and right arms lie on the same line; the bridge makes the middle connection visually ambiguous rather than showing a second explicit branch junction. The check says verbatim `trunks: oob-bus from oob to bmc_c, 2 branches, 1 junctions` and `warning: two edges share 2 cell(s), including ports; increase routing space`. It reports `crossings: 1 bridges, 1 touching bends`; the bridge is visible at [38,41]; the touching location is not independently distinguishable from this congested bus without guessing. `Redfish/HTTPS` is placed over the left arm, so its application to the complete bus is not visually unambiguous; count one uncertain label owner. `LAN client` is clear. Long vertical trunk [39,26..41] is a conspicuous detour.

### v2

Node labels: `OOB LAN` [45,12,7,1]; `Compute BMC×18` [16,32,14,1]; `CDU ctlr` [35,32,8,1]; `PDUs` [48,32,4,1]; `Power shelf` [57,32,11,1]; `in-band net` [43,40,11,1]. Edge labels: `air-gapped` [33,21,10,1]; `Redfish/HTTPS` [54,22,13,1]. Group text: `rack hw` [17,30,7,1]; other group titles are not visible.

Five down arrows all originate at OOB LAN: Compute BMC×18 ▼[16,30], CDU ctlr ▼[35,30], PDUs ▼[48,30], Power shelf ▼[57,30], and in-band net ▼[43,38]. In-band route is dashed and crosses through the rack region; the four solid routes are close together at source. Routes are individually followable with care through two bridges `⌒` [45,28] and [45,29], but the tight bends make the middle paths visually congested. Check reports `crossings: 2 bridges, 1 touching bends`; the touching bend is not uniquely identifiable from the capture. Both label associations are locally readable: air-gapped is next to the dashed line and Redfish/HTTPS next to the rightmost line. Long horizontal detours feed the left rack nodes; the dashed path passes through the rack box.

### v3

Node labels: `nv-rms` [16,29,6,1]; `OOB LAN` [15,23,7,1]; `NVOS` [44,27,4,1]; `NMX-C/T` [62,26,7,1]; `NVSwitch BMC` [40,22,12,1]. Edge labels: `NVUE/SSH/SFTP` [26,27,13,1]; `NMX-C gRPC` [27,31,10,1]; `hosts` [51,26,5,1]; `power+serial` [24,22,12,1].

Four rightward arrows, heads intact: OOB LAN → NVSwitch BMC ▶[38,22], nv-rms → NVOS ▶[42,27], NVOS → NMX-C/T ▶[60,25], nv-rms → NMX-C/T ▶[60,27]. All four paths can be traced, and all four label owners are readable. No bridge or junction glyph and no visible crossing; check reports zero bridges and touching bends. The lower NMX-C route makes a long horizontal detour, separated from the hosts route.

### v4

Node labels: `Kubernetes` [37,7,10,1]; `GPU Operator` [36,15,12,1]; `DCGM (DaemonSet)` [34,23,16,1]; `dcgm-exporter :9400` [25,37,19,1]; `driver+CUDA` [49,37,11,1]; `Fabric Mgr (bundled)` [40,45,20,1]; `in-band net` [24,45,11,1]. Edge labels `metrics` [27,33,7,1] and `NVML` [40,33,4,1]. Region titles `cluster` [40,5,7,1] and `in-band` [25,43,7,1].

Six downward arrows, intact: Kubernetes → GPU Operator ▼[36,13]; GPU Operator → DCGM ▼[34,21]; DCGM → dcgm-exporter ▼[25,35] labeled metrics; DCGM → driver+CUDA ▼[49,35] labeled NVML; driver+CUDA → Fabric Mgr ▼[40,43]; dcgm-exporter → in-band net ▼[24,43]. The six paths are traceable and both labels are reasonably owned; the starting stubs of the first two paths visually run inside the node boxes. No bridge or junction glyph and no visible crossing; check reports zero bridges and touching bends.

## Regions, borders, selection

Node rectangles across all views have four visible corner glyphs and four sides, including the v1 bus targets; v4 internal route stubs intrude into otherwise closed node interiors. The supplied selected ANSI shows all 23 node occurrences highlighted simultaneously (5+6+5+7), in bold RGB 216,166,87, with differently colored edges and group strokes; it is not 23 separate selection captures. Thus selected-state coverage is 23/23 occurrences, but independent per-node interaction states are not supplied. Captures do not establish full color continuity on every individual cell of every node border; selected label-row border samples use the same highlight color on both sides, while route/region overlaps must not be inferred continuous merely from text.

The declared regions do **not** all render as complete titled rectangles with members inside. In v1 off-rack mgmt shows only a small empty border fragment to the right of nv-rms; OOB plant encloses OOB LAN but has no title and no corner glyphs; rack hw's visible partial rectangular frame surrounds only Power shelf, leaving Compute BMC×18 and NVSwitch BMC outside, and title is `r▼ck hw`. In v2 OOB plant and in-band show empty narrow fragments to the right of their nodes without titles; rack hw surrounds its four hardware nodes, with a title, but its corners are horizontal strokes rather than corner glyphs, and routes pierce top/bottom. In v4 cluster has a title and encloses both nodes imperfectly: the left side/corners are absent/overwritten and the GPU Operator partly abuts the right side; in-band encloses its node and has a title, but uses horizontal lines rather than corner glyphs and the arrow interrupts the top. ANSI shows region strokes in muted group colors, node borders in selected gold, and route strokes gray; these overlaps visibly disrupt any claim of uniformly colored complete region borders. With missing/fragmentary groups, stable sibling-region order is not established.

v1 check reports `pins: 5 pinned, 0 conflict(s)`; no `pins-conflict:` line appears in the supplied checks. v2 declares `minlen: 2` for the dashed in-band route: its destination appears one node row below the rack-hardware row, with the path continuing through the rack region, but rank-gap arithmetic cannot be verified from screenshots alone.

## Visible carried facts and evidence availability

`Compute BMC×18` explicitly shows count 18 in both v1 and v2; `CDU ctlr` and `PDUs` are visible in v2; `NVUE/SSH/SFTP` is visible in v3; `Redfish/HTTPS` is visible in v1 and v2, with the bus-wide ownership caveat in v1. These are visible strings, not proof of any additional semantic coverage. No separate generator ledger rows or family evidence line are present in the permitted spec/capture material searched; the requested family evidence line cannot be recorded verbatim without accessing excluded material. No verdict on family evidence.

All four views are static: each check reports zero flows, zero dot violations, 0/0 origins and arrivals; five captured frames at each viewport contain no flow-dot glyphs `●`, `•`, or `∙`. The `·` glyphs are UI header separators, not route dots. Motion spacing, direction, corner/bridge/arrowhead positions, synchronized arrival, and frame-0 origin are not applicable. No unsupported capture format encountered; ANSI and text are readable. Separate live viewport geometry and family line are missing from the permitted evidence.

## Blind scorecard

Counts are occurrences summed across views, not unique concepts. Diagram labels include node, edge and visible region-title text; header/legend excluded. Visible directed edges count the three trunk destinations separately, unlike the v1 header's one ordinary edge.

| View | Nodes | Directed edges | Node / edge / region labels | Visible bridges / junctions | Uncertain edge-label owners | Diagram items clipped | Selected occurrences | Dot violations |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| v1 | 5 | 4 | 5 / 2 / 1 | 1 / 1 | 1 | 0 | 5/5 | 0 |
| v2 | 6 | 5 | 6 / 2 / 1 | 2 / 0 | 0 | 0 | 6/6 | 0 |
| v3 | 5 | 4 | 5 / 4 / 0 | 0 / 0 | 0 | 0 | 5/5 | 0 |
| v4 | 7 | 6 | 7 / 2 / 2 | 0 / 0 | 0 | 0 | 7/7 | 0 |
| Total | 23 | 19 | 23 / 10 / 4 = 37 | 3 / 1 | 1 | 0 | 23/23 | 0 |

Reported touching bends: v1 1, v2 1, v3 0, v4 0; exact locations not independently established. v1 region-title damage is counted separately from clipping. Pinned v3 UI header has one clipped UI item.
