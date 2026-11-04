# Blind observation: gb300-rack-software, round 11

Stage A only. I did not read source, expected data, rubric, or other cases, and did not run a viewer. Coordinates below are **1-based [column,row,width,height]**, measured in frame 0 of the relevant `pinned/*-77x47.txt`; row 1 is the app header, not the `viewport:` or `frame` metadata. Labels are literal. Graph labels and node labels are counted separately; repeated labels count per occurrence. `evidence/v*/` supplies 82×51 text, ANSI, selected-state and five-frame captures; their coordinates differ from the pinned canvas.

## Frozen spec hashes, independently recomputed with shasum -a 256

- `specs/v1-planes-a3.json`: `48cfb550e6962dfb3cf881a68a19fca334e3c1204540ec109ad451ef84f7655a`
- `specs/v2-oob-bus-a2.json`: `547d5093bca388160f0178d052fc8852a2001107ef55e75b4be8414b05554893`
- `specs/v3-rms-api-a2.json`: `4073104f3df2eb619ad1c4fdcc8b5ff3f86eba8e4b60d14ece9330f7a3e214bc`
- `specs/v4-inband-a1.json`: `6c202043bccfe22b5d89a0a9d811444a2b1c287e699b43dfca9fbbab7b087de8`

## Labels, routes and visible structure

### v1

Node labels: `Kubernetes` [33,7,10,1]; `nv-rms` [48,7,6,1]; `GPU Operator` [32,15,12,1]; `OOB LAN` [49,15,7,1]; `DCGM` [11,25,4,1]; `Compute BMC x18` [20,25,15,1]; `NVSwitch BMC` [40,25,12,1]; `Power shelf` [57,25,11,1]; `Driver+CUDA` [34,33,11,1]; `NVOS` [50,33,4,1]; `Fabric Mgr` [33,41,10,1]; `NMX-C/T` [48,41,7,1]. Edge/trunk labels: `in-band` [40,10,7,1]; `client` [53,10,6,1]; `DaemonSet` [40,18,9,1]; `reach` [56,23,5,1]; `reads NVML` [15,28,10,1]; `same host` [41,36,9,1]; `hosts` [54,36,5,1].

Six separate edges, all with visible arrowheads and traceable routes: nv-rms → OOB LAN, Kubernetes → GPU Operator, GPU Operator → DCGM, DCGM → Driver+CUDA, Driver+CUDA → Fabric Mgr, NVOS → NMX-C/T. All progress generally downward. One additional shared OOB LAN trunk has four arrowheaded destinations: NVSwitch BMC downward, Compute BMC x18 leftward, Power shelf upward, NVOS downward. Its source is the OOB LAN; paths are traceable via the shared corridor, not independent unshared edges. Junction glyphs `┤` [52,21], `├` [54,29], `┴` [52,30] are three actual tap/branch points, not one physical split. No bridge or touching bend observed. One may follow the trunk with care through the return routes. The device row occupies both horizontal bands: DCGM is left of the three bus devices; the two major spines elsewhere sit side by side. No graphic edge joins the in-band chain to the management/bus chain.

### v2

Node labels: `nv-rms` [40,11,6,1]; `OOB LAN` [40,19,7,1]; `Compute BMC x18` [15,29,15,1]; `NVSwitch BMC` [35,29,12,1]; `Power shelf` [52,29,11,1]; `NVOS` [41,37,4,1]. Edge/trunk labels: `client on LAN` [45,14,13,1]; `reach` [44,32,5,1].

One separate arrowheaded and traceable edge nv-rms → OOB LAN, downward. One additional shared trunk starts at OOB LAN and visibly reaches NVSwitch BMC down, Compute BMC x18 left, Power shelf up, and NVOS down, each with an arrowhead; follow the shared path to distinguish destinations. Junctions `┤` [43,25], `├` [49,33], `┴` [43,34] show three taps. No bridges or touching bends. This is not a single junction despite the single outgoing bus corridor. No return arrows.

### v3

Node labels: `Compute BMC x18` [35,19,15,1]; `NVOS` [41,24,4,1]; `nv-rms` [11,26,6,1]; `NMX-C/T` [60,26,7,1]; `Power shelf` [37,29,11,1]. Edge labels: first `Redfish/HTTPS` [19,22,13,1]; `NVUE REST/SSH` [33,22,13,1]; `hosts` [49,23,5,1]; second `Redfish/HTTPS` [20,30,13,1]; `NMX-C gRPC` [40,32,10,1]. These are independent pixel measurements, not the generator's 0-based coordinates.

Five separate traceable, rightward arrowheaded routes: nv-rms → Compute BMC x18 (upper Redfish/HTTPS); nv-rms → Power shelf (lower Redfish/HTTPS); nv-rms → NVOS (NVUE REST/SSH); nv-rms → NMX-C/T (NMX-C gRPC); NVOS → NMX-C/T (hosts). NMX-C/T receives two independent arrowheads. There is a `⌒` bridge [33,29] at the crossing of the horizontal Power shelf route and the vertical NMX-C/T fan route. No touching bend or actual junction at that bridge. The bridge preserves route distinction, but tracing is less immediate. No reciprocal pair.

### v4

Node labels: `Kubernetes` [35,8,10,1]; `GPU Operator` [34,16,12,1]; `DCGM` [38,24,4,1]; `dcgm-exporter` [25,32,13,1]; `Driver+CUDA` [43,32,11,1]; `Fabric Mgr` [35,40,10,1]. Edge labels: `in-band` [42,11,7,1]; `DaemonSet` [42,19,9,1]; `serves :9400` [42,27,12,1]; `reads NVML` [38,30,10,1]; `same host` [50,35,9,1].

Five separate arrows, all heads present, routes traceable: Kubernetes → GPU Operator, GPU Operator → DCGM, DCGM → dcgm-exporter (left branch), DCGM → Driver+CUDA (right branch), Driver+CUDA → Fabric Mgr. They progress generally down; the DCGM fan uses two distinct ports and bends, not a shared junction. No crossing or touching bend. **Label-owner caveat:** `serves :9400` sits just to the right of the right-hand initial port, visually adjacent to the Driver+CUDA route although the declared edge is the leftward exporter route; `reads NVML` sits on the right side near its target. The checker reports 0 ambiguous owners, but I count `serves :9400` as one visually uncertain/misleading owner without consulting the spec. The routes themselves remain traceable.

## Color, borders, groups, ranks and selection

All 29 node occurrences have four complete sides and all four rounded corners in the text capture. I inspected each border cell in the regular ANSI captures; each complete node border has one continuous foreground RGB, including its corners. Group membership uses hue families with per-member shade variation, **not** painted group boxes, borders or titles. Node labels themselves share the cream foreground; the group signal is node-border hue, not a named tier line. There are no separate source-named tier markings visible.

- v1 groups: mgmt `nv-rms` pink/purple (206,115,206); oob `OOB LAN` yellow-green (183,206,115); bmc `Compute BMC x18`, `NVSwitch BMC`, `Power shelf` blue shades (115,161,206 / 153,186,219 / 78,135,193); nvsw `NVOS`, `NMX-C/T` purple shades (138,115,206 / 170,153,219); k8s `Kubernetes`, `GPU Operator` tan shades (206,161,115 / 219,186,153); host `DCGM`, `Driver+CUDA`, `Fabric Mgr` teal shades (115,206,183 / 153,219,203 / 78,193,164).
- v2: mgmt tan, oob yellow-green, bmc blue, nvsw pink/purple. BMC left-to-right order remains Compute, NVSwitch, Power. Singletons have no sibling order to test.
- v3: mgmt tan, bmc blue, nvsw pink/purple. BMC appears Compute above Power; nvsw appears NVOS left of NMX-C/T. These are consistent with the relative orders in v1/v2 where comparable.
- v4: k8s pink shades, host teal shades; host order is DCGM above the exporter/driver row, then Fabric Mgr. The shared Driver+CUDA/Fabric Mgr ordering agrees with v1. Group identity is not color-stable **across views**: e.g. mgmt is purple in v1 and tan in v2/v3, and k8s is tan in v1 and pink in v4. Within each view siblings share a hue family.

Pins: v1 declares five ranks: 1 nv-rms/Kubernetes, 2 OOB LAN/GPU Operator, 3 Compute BMC x18/NVSwitch BMC/Power shelf/DCGM, 4 NVOS/Driver+CUDA, 5 NMX-C/T/Fabric Mgr. The capture shows precisely those rows, though row 3 spans both bands; checker: 12 pinned, 0 conflicts. v2 declares four ranks: 1 nv-rms, 2 OOB LAN, 3 Compute BMC x18/NVSwitch BMC/Power shelf, 4 NVOS; all appear on those rows; 6 pinned, 0 conflicts. v3/v4 declare no rank pins; actual v3 columns form nv-rms, the three targets Compute/NVOS/Power, then NMX-C/T, and v4 rows form Kubernetes, GPU Operator, DCGM, exporter/driver, Fabric Mgr.

Selection: the separate `v*-selected.ansi` captures use bold gold selected strokes for **all nodes at once**, not individual one-node-at-a-time frames. Selected border coverage by occurrence is 12/12, 6/6, 5/5, 6/6 = 29/29, but evidence does not independently demonstrate keyboard selection of each node in isolation. Regular borders are not gold; each selected capture visibly changes every border.

## Motion and fit

All four checks report 0 flows, 0 single-dot routes, 0 periodic routes, 0 dot violations, and 0/0 origins and arrivals. Five captured frames per view at 0, 100, 200, 300 and 400 ms show no animated route/dot. Spacing, direction, corner/bridge/arrowhead placement, true-origin and synchronized-arrival tests are not applicable; no motion is demonstrated. There is no basis to infer animation from specs.

All pinned files start `viewport: 77x47 zoom: 1.00 natural`; graph extents from check files: v1 59×38, v2 50×30, v3 69×16, v4 36×36. Each 82×51 evidence capture header states 100%. The graph labels, nodes and routes fit the 77×47 canvas with no clipped graph items, hidden graph items, pan or zoom required. The 77-column app header itself is clipped at its right edge in v1–v3 (e.g. `q qui`); that is chrome, not a graph label. Palette is visible at lower left, clear of graph content. `--check` reports 0 bridges/0 touching bends in v1, v2 and v4, and 1 bridge/0 touching bends in v3, matching the observations above. Check output has `viewport: unknown` because it is a non-pane check; it does not establish pane geometry. Manifests have null pane-rectangle fields, so 82×51 is the viewer's captured header rather than independent pane-layout measurement. No `routes:` line is expected.

## Generator's own classification, deviations and omissions

Verbatim from `generation.md`, “Step 0 — family (named before the ledger)”:

```text
family: placement-planes
evidence: the OOB LAN is "a SEPARATE PHYSICAL ETHERNET NETWORK ... usually air-gapped
          from the data plane" that drops to every BMC, while the in-band software
          (GPU Operator -> DCGM -> driver/Fabric Manager) has no relation to it —
          the source forbids the only edge that would join them ("never draw
          OOB -> DCGM"), so the rack is two weakly-connected worlds plus one bus.
```

This is the generator's claimed classification and source interpretation, not independently checked against the withheld source. Its documented departures (`generation.md`, “Deviations from the plane pattern”) include the device row spanning the two column bands because the three bus branches share a rank, independent detailed views due to overcrowding in a merged draft, separate API and bus views, three engine trunk junctions rather than one, shortened trunk label `reach`, one ordinary edge because trunk-only specs are rejected, and rank pins to control the bus. The visible three junctions and the mixed row corroborate those particular departures; source/engine-causation and earlier-draft measurements are generator claims.

`generation.md`, “Deliberate drops”, discloses **CDU controller and PDUs are omitted** as additional OOB endpoints, citing the one-trunk/one-split constraint and a three-branch design. That is an explicit coverage gap, not evidence of full endpoint coverage. The recorded explanation exposes a real trade-off between a simple shared split and complete endpoint representation; a multi-view solution is not proved impossible by the final captures. The generator also discloses omitting the OOB payload list and LAN details, and states other exclusions and caveats; their source necessity cannot be checked blind. v3's bridge and the three tap junctions are disclosed, not silently hidden.

## Neutral structural summary and blind scorecard

| view | visible nodes | separate edges | trunk routes in addition | edge/trunk label occurrences | hue families | pinned nodes/ranks | bridges/touching bends | uncertain owners (visual / checker) | clipped graph items | selected node occurrences | dot violations |
|---|---:|---:|---:|---:|---:|---|---|---|---:|---|---:|
| v1 | 12 | 6 | 1 trunk, 4 arrowheaded endpoints | 7 | 6 | 12 / 5 | 0 / 0 | 0 / 0 | 0 | 12/12 | 0 |
| v2 | 6 | 1 | 1 trunk, 4 arrowheaded endpoints | 2 | 4 | 6 / 4 | 0 / 0 | 0 / 0 | 0 | 6/6 | 0 |
| v3 | 5 | 5 | 0 | 5 | 3 | 0 / 0 | 1 / 0 | 0 / 0 | 0 | 5/5 | 0 |
| v4 | 6 | 5 | 0 | 5 | 2 | 0 / 0 | 0 / 0 | 1 / 0 | 0 | 6/6 | 0 |
| total occurrences | 29 | 17 | 2 trunks, 8 endpoint occurrences | 19 | 6 distinct group names | 18 / 9 | 1 / 0 | 1 / 0 | 0 | 29/29 | 0 |

Total node-plus-edge/trunk text labels = 48 occurrences. Counts are per-view occurrences, not deduplicated concepts; ordinary-edge totals follow renderer reporting and do not add the trunk to that count. Widest outgoing fan is four destinations from OOB LAN in v1/v2 (the one bus), or four separate routes from nv-rms in v3; v4 has a two-route fan at DCGM. No box pair has arrows in both directions in any view. Only v3 visibly has a node receiving arrowheads from two separate ordinary routes: NMX-C/T. v1 has two disconnected drawn components, one bus-management and one host-software, shown adjacent but not connected; the other views each have one drawn component. Labels contain named components, protocol qualifiers, a count x18 and a port :9400; v3 has the highest concentration of protocol labels. Downward sequences resemble ordered layers of deployment or dependency rather than explicitly numbered phases; v3 is a horizontal fan plus a target-to-target relation. This is an observation, not a family verdict or grade.

Evidence limitations: individual selection interaction is not captured; true pane geometry is not independently established by a pane-layout record; motion tests are vacuous for static views. All supplied text and ANSI formats inspected were readable. No source-based correctness or completeness judgment is made at this blind stage.
