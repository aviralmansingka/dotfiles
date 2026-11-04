# Round 07 convergence: gb300-rack-software

Blind record: [observed-first-rf.md](observed-first-rf.md), SHA-256 `1ff049f9be3dee983209910525ed3fc2d81656cecdf2e48649aae36cb71ba31a`, `saved_before_expected_reveal: true`; rehashed unchanged. Generator `viz-rf07` / `fireworks/accounts/fireworks/routers/deepseek-flash-latest`; reviewer `openai/gpt-6.1-sol`.

## Coordinates and evidence

`R(x,y)` denotes the native 83×51 round-05 screen `evidence/vN/vN-text.txt`, one-based column x and one-based screen row y; `P` denotes audited 77×47 pinned coordinates. `F(x,y)` is the whole PNG scaled to 744×2000 (original PNG pixels: x × 2278/744, y × 3.06); F positions approximate ±3. Blind record contains complete per-node/group bounds, all labels and attribution locations. ANSI and selected captures show R colors/borders, pinned dumps resolve target bus and bridge, source documents define the required one-split rail.

## View-by-view geometric divergences

- v1 both left-to-right. R nv-rms (9,26), OOB (38,26), Compute BMC (68,18), NVSwitch BMC (69,26), Power shelf (68,34). F nv-rms (128,289), OOB (375,289), hardware (623,226/289/351). F OFF-RACK MGMT B(51,254;204,312), OOB PLANT B(299,254;452,312), RACK HARDWARE B(547,191;700,374); R has node hue families only, no surrounding boxes/titles. All F members are within their explicitly titled boxes; all node borders intact.
- v2 R rms (27,27), compute (56,21), shelf (56,31). F rms (252,774), compute (499,743), shelf (499,806). F OFF-RACK MGMT B(175,740;328,797), RACK HARDWARE B(423,708;576,829) vs R hue-only. R gives RMS separate right-side ports R(33,26) and R(33,28); F shares source at (317,774) and splits at F(375,774). R upper/lower approaches are independent; F overlaps source corridor and label boxes cover the junction.
- v3 R rms (48,18), NVOS (32,26), NMX (46,34), separate x positions; F rms (375,1145), NVOS (375,1297), NMX (375,1376), all centered vertically. F OFF-RACK MGMT B(299,1110;452,1168), NVSWITCH TRAY B(299,1262;452,1398). R NVOS and NMX are related by color and `hosts`, no group box. R has a distinct bypass and an avoidable bridge (native R(43,23), pinned P(40,21)); F collapses all three paths onto x375, and direct gRPC runs behind NVOS B(310,1281;441,1313), then shares hosts segment y1313–1360. A missing F bridge is not improved traceability: gRPC's independent route is physically hidden and target heads coincide.
- v4 R Kubernetes (40,10), GPU Operator (42,18), DCGM (40,26), Driver+CUDA (25,34), exporter (56,34), Fabric Mgr (25,42); F Kubernetes (375,1564), GPU Operator (375,1638), DCGM (375,1780), exporter (300,1853), Driver+CUDA (451,1853), Fabric Mgr (451,1926): lower branch order reverses. F IN-BAND CLUSTER B(304,1532;447,1659) and COMPUTE HOST B(229,1747;522,1947) explicitly frame residency; R hue-only. R DCGM uses distinct lower ports around (36,28)/(38,28), F same bottom center (375,1795) until the split at (375,1817).

## Every label / attachment

R references are `P` target locations from the prior result where available; others specify observed native `R` row/region, not invented exact ownership. F points are screenshot centers. F HTML supplies edge identity when shared geometries cannot.

| Edge | R label and location | F label at | Divergence |
|---|---|---|---|
| v1 rms→OOB | `client`, R row25 near x20 | (252,289) | Both readable; F group gutter. |
| v1 OOB named trunk | `physical reach`, P(43,23) on shared stem P(41–57,24) | (499,289), on OOB→NVSwitch edge | F label is an individual edge's label though visually over the common junction. |
| v1 trunk branches compute/NVSwitch/power | unlabeled branches P x57 up to y16, x56 down to y32, middle to x59 | no separate labels; branches at F(499,226)/(499,351), middle (499,289) | All three targets visible; semantics of a true bus differ below. |
| v2 rms→compute | `Redfish/HTTPS` R row25 near x35 | (375,766) | F stack above shared outgoing route. |
| v2 rms→shelf | `Redfish shelf` P(33,27) | (375,783) | Both omit shelf HTTPS; F stack below shared route, endpoints inferred from geometry/HTML. |
| v3 rms→NVOS | `NVUE REST` P(30,20) | (375,1206) | R separate path via bridge P(40,21); F stack on common column. Both omit SSH/SFTP. |
| v3 rms→NMX | `gRPC` P(42,24) | (375,1223) | F direct edge hidden through NVOS and overlaps `hosts`. |
| v3 NVOS→NMX | `hosts` P(30,28) | (375,1336) | F appears as only visible line below NVOS even though direct gRPC also runs there. |
| v4 Kubernetes→GPU operator | `hosts`, R row14 | (375,1601) | Both direct; F midpoint inside cluster. |
| v4 GPU operator→DCGM | `DaemonSet`, R row22 | (375,1703) | Both readable. |
| v4 DCGM→exporter | `serves :9400`, P(35,30) | (338,1817) | R exporter right, F left; both labels attach server wording to DCGM→exporter, not explicitly to exporter role. |
| v4 DCGM→driver | `reads NVML`, R row30 | (414,1817) | R left, F right; both legible. |
| v4 driver→Fabric Mgr | `unconfirmed`, P(20,37) | (451,1889) | Dashed on both; unsupported relationship remains qualified, not verified. |

## Named OOB bus versus coincident edges

The source requires one OOB outgoing trunk and **exactly one split spot**, not merely three independent arrows touching. R spec explicitly declares a trunk; the target dump has one stem P(41,24) to two adjacent taps P(56,24) and P(57,24), then separate branches. It is truly one bus but fails exactly-once topology because there are **two** split cells. F HTML declares three edge objects, all using the ordinary LabeledEdge component, with `trunk` and `branch` metadata never used to construct a shared trunk. The three paths overlap at x441–499 y289 and appear to meet at F(499,289), with upper/lower verticals. This visual coincidence is not an owned bus primitive or verified one-split connection; `physical reach` is owned by the primary OOB→NVSwitch path. F does not satisfy the named-bus contract just because the stroke resembles one junction. Conversely generator notes say 'no shared run': visually the run **does overlap**; the code-level lack of a shared bus is distinct.

## Other differences and inherited omissions

- R v3 route bridge R(43,23) / P(40,21) separates true gRPC and NVUE paths (though crossed source-port order is avoidable); F has no isolated crossing, but hides gRPC under NVOS and uses common node ports. F v2 source-fan junction F(375,774) and v4 F(375,1817) similarly merge independent source approaches; R uses distinct ports. No other isolated X crossings visible.
- F and R both omit compute-tray count 18, CDU/PDU OOB coverage, shelf HTTPS and NVOS SSH/SFTP, and fail to establish exporter as :9400 server. The dashed Driver+CUDA→Fabric Manager relationship is explicitly unconfirmed in both, not evidence of a verified dependency. Both omit prohibited OOB→DCGM and paid-only components. F named boxes improve off-rack/tray/host residency but do not recover missing facts.
- Animation is source-backed optional/N/A; R frames and F still/code show no yellow dots. No dot origin or speed divergence applies. No animated-zero demand is invented for this case.
- F all four node/group extents fit their own 1100×700 canvases at capture zoom, so adapted F fit passes notwithstanding overlay and semantic failures; R delivered fit fail includes an avoidable bridge. R normal and selected borders are complete at live 83×51 but target color/selection was blocked; F screenshot proves complete normal node borders, no selected state claimed because selection disabled. F badges at (691,501), (691,987), (691,1472), (691,1958) are attribution chrome; R has header/palette chrome.
- `notes.md` correctly records three edge objects and missing trunk rendering, but calls v2 label ownership clean despite overlap, claims no shared run despite superposed paths, and does not mention v3's occlusion. `attempts.md` asserts all labels visible, true here but not universally across the other case. Reload digest `799123879` is narrative, not two raw measurement outputs. `commands.txt` lists exact steps but lacks preserved outputs, statuses, browser-close proof and timestamped screenshots, so workflow is blocked; no nondeterminism is inferred.
