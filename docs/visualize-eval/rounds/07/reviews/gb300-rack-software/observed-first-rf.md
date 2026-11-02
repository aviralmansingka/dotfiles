# Stage A — blind React Flow observation: gb300-rack-software

Reviewer: independent Sol (`openai/gpt-6.1-sol`). Round 07. Stage A only.

## Scope and coordinate convention

Read only this case's `reactflow.html` and `capture.png`, plus the round-07 judge task. No rataflow bundles, round-05 verdicts, undisclosed expectations, generator notes or comparison records were consulted. Spec-path strings in the HTML were not followed. PNG read as an image; enlarged crops derived only from that PNG were also inspected.

Coordinates use the **whole capture scaled to 744 × 2000**, origin at top left. Convert to original PNG pixels (2278 × 6120) using x × 2278/744 and y × 6120/2000. Positions are approximate, ±3 scaled pixels. `B(x1,y1;x2,y2)` is a rectangle; label coordinates are centers. This is not an assertion about physical browser viewport dimensions or numerical zoom.

## v1 — off-rack management / OOB plant / rack hardware

Canvas B(16,54;735,512). Five visible nodes, all fully rounded/bordered and readable:

| Node | Bounds | Subflow |
|---|---|---|
| nv-rms | B(62,273;193,305) | off-rack mgmt |
| OOB LAN | B(310,273;441,305) | OOB plant |
| Compute BMC | B(558,210;689,242) | rack hardware |
| NVSwitch BMC | B(558,273;689,305) | rack hardware |
| Power shelf | B(558,335;689,367) | rack hardware |

Subflows: OFF-RACK MGMT B(51,254;204,312), title (96,253); OOB PLANT B(299,254;452,312), title (338,253); RACK HARDWARE B(547,191;700,374), title (594,190). All rounded, bordered, tinted and titled; every declared member inside its own group box. Short gaps in group top borders are the title backgrounds, not missing node borders.

Labels:
- `client` nv-rms→OOB LAN at (252,289), on the horizontal between the boxes; ownership clear.
- `physical reach` OOB LAN→NVSwitch BMC at (499,289), on the middle horizontal arm toward NVSwitch BMC. It also visually sits over the common branching area, so the screenshot can read it as a label for all three hardware connections. HTML identifies its specific edge.
- OOB LAN→Compute BMC and OOB LAN→Power shelf have empty labels in HTML and no label boxes in the image.

Crossings / shared corridors:
- The three OOB outgoing paths share the source horizontal x≈441–499 at y≈289. A vertical runs x≈499 from y≈226 to351; upper and lower elbows at (499,226), (499,351) connect to Compute BMC and Power shelf. The center is under `physical reach` at (499,289).
- This is visually bus-like, with T junctions and shared source run rather than an independent X crossing. All three targets have visible rightward arrowheads at x≈555 and y≈226/289/351. No route crosses a node interior here.
- HTML records `trunk: oob_rail` on all three OOB edges and `branch: true` on the two unlabeled ones. It still renders three ordinary smooth-step edge paths; the LabeledEdge renderer does not branch on either property. The capture alone cannot establish separately owned bus geometry, because coincident independent edges look like a shared bus.

Animation: absent; no yellow dots. All four edges explicitly nonanimated in HTML.

## v2 — southbound APIs

Canvas B(16,540;735,998). Three nodes with complete colored rounded borders:

| Node | Bounds | Subflow |
|---|---|---|
| nv-rms (mgmt) | B(186,758;317,790) | off-rack mgmt |
| Compute BMC | B(434,727;565,759) | rack hardware |
| Power shelf | B(434,790;565,822) | rack hardware |

Subflows: OFF-RACK MGMT B(175,740;328,797), title (222,739); RACK HARDWARE B(423,708;576,829), title (473,707). Both titled/bordered/tinted; members completely inside.

Labels: `Redfish/HTTPS` nv-rms→Compute BMC at (375,766); `Redfish shelf` nv-rms→Power shelf at (375,783). Two readable labels stacked just above/below source height, not centered on their separate final horizontal arms. Branch geometry makes upper/lower intended ownership plausible, but their label boxes obscure the actual central junction. HTML confirms the owners.

Crossings/shared corridors: both edges share x≈317–375 at y≈774, then split along x≈375 to y≈743 and806; horizontal arms reach Compute BMC and Power shelf at those heights. Junction at (375,774), elbows (375,743), (375,806). No isolated X crossing; no node-interior occlusion. Two target arrowheads visible.

Animation: absent in image and disabled on both edges in HTML.

## v3 — NVSwitch tray software

Canvas B(16,1025;735,1483). Three readable nodes, all complete rounded borders:

| Node | Bounds | Subflow |
|---|---|---|
| nv-rms (mgmt) | B(310,1129;441,1161) | off-rack mgmt |
| NVOS (tray) | B(310,1281;441,1313) | NVSwitch tray |
| NMX-C/T | B(310,1360;441,1392) | NVSwitch tray |

Subflows: OFF-RACK MGMT B(299,1110;452,1168), title (345,1109); NVSWITCH TRAY B(299,1262;452,1398), title (345,1261). Both titled/bordered/tinted; all members inside. NMX-C/T is inside the tray box, not inside the NVOS node rectangle.

| HTML owner | Label | Center | Observation |
|---|---|---|---|
| nv-rms → NVOS | NVUE REST | (375,1206) | Upper label on common vertical approach. |
| nv-rms → NMX-C/T | gRPC | (375,1223) | Lower label on that same approach, above NVOS rather than on a separate bypass. |
| NVOS → NMX-C/T | hosts | (375,1336) | On visible vertical between tray nodes. |

Crossings / shared routes / occlusion:
- All routes lie on x≈375. nv-rms→NVOS and nv-rms→NMX-C/T coincide between y≈1161–1281. `NVUE REST` and `gRPC` stack on this shared section; they are both legible but do not uniquely identify separate paths.
- The direct nv-rms→NMX-C/T route passes behind the NVOS rectangle B(310,1281;441,1313), then coincides with NVOS→NMX-C/T from y≈1313–1360. Thus the screenshot reads strongly as a two-step chain, despite HTML declaring a direct gRPC edge as well.
- Arrowhead above NVOS visible near (375,1278); the arrowhead above NMX-C/T near (375,1357) is shared/coincident for two incoming routes. There is no separate lateral bypass and no independent X crossing.
- NVOS border remains complete; the edge is hidden by the node, not the reverse.

Animation: absent, no yellow dots; all three HTML edges nonanimated.

## v4 — in-band compute stack

Canvas B(16,1511;735,1969). Six visible nodes, each a complete rounded bordered rectangle:

| Node | Bounds | Subflow |
|---|---|---|
| Kubernetes | B(315,1549;436,1579) | in-band cluster |
| GPU Operator | B(315,1622;436,1653) | in-band cluster |
| DCGM (host) | B(315,1765;436,1795) | compute host |
| dcgm-exporter | B(239,1838;361,1868) | compute host |
| Driver+CUDA | B(390,1838;512,1868) | compute host |
| Fabric Mgr | B(390,1911;512,1941) | compute host |

Subflows: IN-BAND CLUSTER B(304,1532;447,1659), title (352,1531); COMPUTE HOST B(229,1747;522,1947), title (269,1746). Both fully titled/bordered/tinted; all members inside. No node text spills across a border.

| HTML owner | Label | Center | Observation |
|---|---|---|---|
| Kubernetes → GPU Operator | hosts | (375,1601) | Clear internal vertical. |
| GPU Operator → DCGM | DaemonSet | (375,1703) | Clear inter-box vertical. |
| DCGM → dcgm-exporter | serves :9400 | (338,1817) | Left horizontal branch, between source column and exporter column. |
| DCGM → Driver+CUDA | reads NVML | (414,1817) | Right horizontal branch. |
| Driver+CUDA → Fabric Mgr | unconfirmed | (451,1889) | Centered on visibly dashed vertical. |

Crossings/shared corridors: DCGM's two outgoing paths share a short x≈375 vertical from y≈1795 to1817, then split left/right along y≈1817 to x≈300 and451. Junction at (375,1817), elbows (300,1817), (451,1817). No isolated X crossing or node-interior route occlusion. Dashed Driver+CUDA→Fabric Mgr stays on x≈451 between y≈1868 and1911; its arrowhead is visible at the lower target. Ownership of all five labels is visually clear in this panel.

Animation: absent, no yellow dots; all five HTML edges nonanimated. Dashes indicate the declared unconfirmed edge, not motion.

## Fit, borders, attribution, and blind scorecard

Each of the four graphs fits its own captured canvas at the shown zoom without graph pan: all 17 node instances and 9 subflow boxes are visible, with graph extents away from the canvas edge. Full-page capture is not proof that all four canvases fit at once in a physical browser viewport. Some edges are hidden inside nodes in v3 despite spatial fit.

All node borders are complete, unclipped and unoccluded. Group-title backgrounds intentionally interrupt short spans of the group top borders. React Flow attribution badges occupy approximately B(691,501;735,511), B(691,987;735,997), B(691,1472;735,1482), B(691,1958;735,1968); no graph is underneath. These are noted and discounted as chrome.

Stage-A-only provisional scorecard (not a paired verdict; no undisclosed expectations applied):

| Aspect | Blind assessment |
|---|---|
| Structural inventory / rendered fidelity to HTML | All 17 nodes, 9 groups and 12 nonempty label instances visible. HTML has 14 edges. v3's direct gRPC link is not visually independent of the NVOS chain; v1's trunk metadata does not receive distinct rendering behavior. |
| Arrow traceability / label ownership | Deficient overall: v3's direct route is occluded by NVOS and shares the hosts edge; v1/v2 have common approaches and gutter stacks. v4 is clear. |
| Layout fit | Pass per individual canvas; no graph pan required for node/group extent. |
| Grouping | Pass: explicit group boxes/titles, all members inside. Tray grouping is distinct from NVOS hosting. |
| Node borders | Pass: all complete, no canvas clipping. |
| Animation evidence | Absent: zero yellow dots observed, all 14 edges nonanimated in HTML. |
| Workflow evidence | Not assessed in Stage A; commands, attempts and determinism evidence deliberately not read. |

Record to be frozen by SHA-256 immediately after writing. No comparison or overall green/red verdict performed.
