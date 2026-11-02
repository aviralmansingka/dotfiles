# Blind observation — gb300-rack-software, round 09, stage A

Scope: final specs, generation descriptions and captured evidence only. No expectations, source or rubric read. Coordinates below are **1-based [column,row,width,height] within pinned frame 0, with the app header as row 1**; graph labels only, excluding application chrome. The generator's coordinate descriptions count graph rows one higher than the actual frame when the header is row 1: in particular its junction called row 25 is actually row 24 in this convention. The cell is the same visible `┼` at column 45. Pinned header truncates in v2/v3; this is application chrome, not a graph label.

## Blind scorecard

| view | node occurrences | visible directed routes | node labels | edge/trunk labels | group names / visually distinct hue families | rank pins | bridges / touching bends | uncertain label owners | clipped graph items | selected border coverage | dot violations |
|---|---:|---:|---:|---:|---|---:|---|---:|---:|---|---:|
| v1 | 5 | 4 (1 edge + 3 trunk ends) | 5 | 2 | 2 / 1 blue | 0 | 0 / 0; 1 deliberate junction | 0 | 0 | 5/5 | 0 |
| v2 | 3 | 3 | 3 | 3 | 2 / 1 blue | 0 | 0 / 0 | 0 | 0 | 3/3 | 0 |
| v3 | 6 | 5 | 6 | 5 | 2 / 2 pink and teal | 0 | 0 / 0 | 0 | 0 | 6/6 | 0 |
| total occurrences | 14 | 12 | 14 | 10 | 6 declared group occurrences / 3 hues across views | 0 | 0 / 0; 1 junction | 0 | 0 | 14/14 | 0 |

The 14 occurrences include nv-rms twice; 13 distinct node labels. Spec/check edge count totals 9 ordinary edges plus a trunk with 3 ends; counting each end as a route yields 12. Labels total 24 diagram-label occurrences. Counts are not quality grades. No ranks are pinned in final specs; no pin claims appear in the generation view levers. Relative ranks seen are described below.

## Labels

v1: `nv-rms` [16,24,6,1]; `OOB LAN` [28,24,7,1]; `Compute BMC x18` [48,19,15,1]; `NVSwitch BMC` [50,24,12,1]; `Power shelf` [50,29,11,1]; `1/10/25G` [36,23,8,1]; `LAN client` [19,27,10,1].

v2: `nv-rms` [36,16,6,1]; `NVOS` [35,24,4,1]; `NMX-C/T` [36,32,7,1]; `NVUE/SSH/SFTP` [41,19,13,1]; `gRPC` [41,20,4,1]; `hosts` [39,27,5,1].

v3: `Kubernetes` [35,4,10,1]; `GPU Operator` [34,12,12,1]; `DCGM` [38,20,4,1]; `dcgm-exporter` [25,36,13,1]; `Driver+CUDA` [43,36,11,1]; `Fabric Mgr` [35,44,10,1]; `operator` [42,7,8,1]; `DaemonSet` [42,15,9,1]; `metrics` [29,32,7,1]; `NVML read` [42,28,9,1]; `same host` [50,39,9,1].

All 10 edge/trunk labels are readable. The v2 protocol labels sit in a common gutter rather than on their stems; their assignment is not self-evident from adjacency alone but is supported by their order and route tracing, and the check reports zero ambiguous owners. No label is counted uncertain. `1/10/25G` is immediately adjacent to the OOB box's top-right corner, but readable.

## Visible routes and shape

All listed arrows have visible arrowheads; routes can be traced, although the v2 gRPC detour needs careful tracing. No reciprocal box pair and no bidirectional arrows occur.

- v1, left-to-right: nv-rms → OOB LAN, right-pointing `▶`, `LAN client`. OOB LAN → Compute BMC x18, OOB LAN → NVSwitch BMC, OOB LAN → Power shelf: one horizontal bus leaves OOB, meets exactly one `┼` at [45,24], and has distinct up-then-right, straight-right, and down-then-right arms, each ending in its own `▶` at the respective box. The up and down arms share the vertical junction axis at the junction, as the bus's split, not a second crossing or an incidental bridge. `--check` reports one junction and warns `two edges share 1 cell(s), including ports; increase routing space`; the junction is structural here. There is no additional branch point. nv-rms is left, OOB and endpoints to its right, separated by space only; the client edge joins them. Widest fan 3.
- v2, top-to-bottom: nv-rms → NVOS via `NVUE/SSH/SFTP`, downward `▼`; nv-rms → NMX-C/T via `gRPC`, downward `▼`; NVOS → NMX-C/T via `hosts`, downward `▼`. The NMX-C/T node receives two separate arrowheads. The gRPC stem leaves the left port, bends left to column 32, travels down past both boxes, right under NMX-C/T to column 45, up on the right, and left to the second top arrowhead. In header-row-1 coordinates it spans rows 19–36, columns 32–45 (generator describes rows 20–37). The other controller stem reaches NVOS, and the hosts route bends separately into the adjacent NMX-C/T port. No fake junction, bridge or touching bend is visible. The long detour is traceable but visually costly. Widest fan 2.
- v3, top-to-bottom: Kubernetes → GPU Operator `operator`; GPU Operator → DCGM `DaemonSet`; DCGM → dcgm-exporter `metrics`; DCGM → Driver+CUDA `NVML read`; Driver+CUDA → Fabric Mgr `same host`; all end in downward `▼`. The two DCGM outgoing stems are separate, with bends into left and right boxes, not a shared junction. Widest fan 2. No OOB node or OOB→DCGM line is present in v3; no v3 node occurs in v1 or v2. Thus the boundary is represented by absence across separate views, rather than a visible border or explicit negative edge; absence alone does not label the nature of the separation.

No bridge glyph or touching bend seen in any view; check agrees 0/0. Ordinary route bends are visible, including the v1 two bus-arm bends, v2 long perimeter detour and hosts elbow, and v3 fan and chain elbows. These bends are not connections between unrelated routes. The graphical tiers are left-to-right 1→1→3 in v1, top-to-bottom 1→1→1 in v2, and 1→1→1→2→1 in v3. No explicit tier titles or tier hue bands appear. Across views the recurring nv-rms name anchors v1 to v2; v3 is disjoint. The chain-like vertical order looks sequential, not an explicitly numbered phase sequence. Labels are concise names and protocol/role qualifiers, with one count (`x18`) and one link-rate identifier; no large identifier inventory is displayed.

## Groups, borders, selection

Group membership is logical; no surrounding group box, border, or title is drawn, correctly for this round. From normal ANSI border RGBs:

- v1 `off-rack mgmt`: nv-rms blue (125,160,184); `OOB hardware`: OOB LAN (125,160,184), Compute BMC x18 (151,184,206), NVSwitch BMC (98,132,156), Power shelf (176,205,224), all blue. The two groups cannot be distinguished by hue alone; group membership needs spatial/contextual inference. Endpoint sibling order top-to-bottom is Compute, NVSwitch, Power.
- v2 `off-rack mgmt`: nv-rms blue (125,160,184); `NVSwitch sw`: NVOS blue (125,160,184), NMX-C/T blue (151,184,206). Again the families coincide. NVOS precedes NMX-C/T vertically.
- v3 `in-band ctrl`: Kubernetes pink (211,134,155), GPU Operator pink (226,156,175); `compute host`: DCGM teal (125,174,163), dcgm-exporter (147,194,183), Driver+CUDA (99,151,141), Fabric Mgr (168,211,200). The fan siblings appear exporter left, driver right; other members lie on sequential ranks. Each capture has one stable placement; static frames do not establish ordering under alternative layouts.

Each of the 14 occurrence boxes has all four sides and four rounded corners in the text capture; inspection of ANSI shows matching continuous per-node border color on the normal capture, including corners and sides. The select-all capture shows the border of every occurrence in bold amber (216,166,87): 5/5 + 3/3 + 6/6. It is a simultaneous select-all capture, not separate single-node selection trials. No group outline is present.

## Fit, motion and evidence limitations

The three `check.txt` files say `viewport: unknown zoom: 1.00 natural`. The pinned dumps each say `viewport: 77x47 zoom: 1.00 natural`; all graph content fits without a graph overflow banner, clipping, panning or zooming. The v3 lower border is at the final screen row; chrome header text is truncated at the right in v2/v3. Live capture headers report 82×51 at 100%, not 77×47; generation reports the same and manifests record 51 rows and header token, not a measured pane rectangle. Extents reported: 49×14, 32×22, 36×44 respectively.

Each live capture contains five frames, 100 ms apart; the first 51 screen lines of all five match within each view. The three pinned frames also match byte-for-byte within each view. There are zero visible moving dots and checks report zero dot violations, zero single-dot and periodic routes. Origin, spacing, direction, corners/bridges/arrowhead occupancy and synchronized arrivals are not applicable; checks report origins 0/0 and arrivals 0/0. No `routes:` line is expected.

Generator discloses that raw stdout/stderr for log line 8 were overwritten after a probe label was reused; the corresponding first-run bytes are unavailable. Validators report that line's stdout and stderr hash mismatches. This is a records limitation, not an inference about graph geometry. v1 validator also reports the shared-cell warning; v2/v3 do not. Pinned fit passes validator output. No captured format was unsupported. Requested `specs/` paths do not exist in the listed bundle; the final spec files are at the case root and were hashed there. I did not inspect the rejected candidates, probe records or raw attempt logs in stage A.

## Generator classification, verbatim

Location `generation.md`, “Step 0 — family first”:

> family: placement-planes
> evidence: the rack software lives in weakly-connected worlds joined by one named bus — the OOB LAN is
>           "a separate physical Ethernet network ... usually air-gapped from the data plane" whose every
>           BMC hangs off it, while DCGM's whole job is in-band and "the only relationship to OOB is
>           negative" (source lines 271/277).

This is the generator's statement, not an independent source verification.

## Final spec SHA-256

- `v1-oob-plane.json`: `5b95958275d1241b5fcd693eaf4d90c6a3f53b9bf4808a776fbef564b6947aee`
- `v2-nvswitch-plane.json`: `6b75ed623d4b6e38c22443109dc769a0f7d64cb4c8cfaaabe81e7002b2397a25`
- `v3-inband-compute-plane.json`: `bf459786a799941c86e4b07a708b38bcbe22add714bb880ce5b80c5d8595c130`
