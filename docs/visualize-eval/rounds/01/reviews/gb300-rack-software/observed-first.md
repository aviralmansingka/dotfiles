# ASTRA blind Stage A — gb300-rack-software, round 01

## Evidence boundary and method

This is an observation record, not a full rubric review or a pass/fail decision. Intended topology, semantic correctness, and completeness against a source remain unknown.

I inspected only these final capture contents under `docs/visualize-eval/rounds/01/gb300-rack-software/captures/`:

- `v1-a4-unselected.txt`, `v1-a4-unselected.ansi`, `v1-a4-selected.txt`, `v1-a4-selected.ansi`.
- `v2-a2-unselected.txt`, `v2-a2-unselected.ansi`, `v2-a2-selected.txt`, `v2-a2-selected.ansi`.
- `v3-a3-unselected.txt`, `v3-a3-unselected.ansi`, `v3-a3-selected.txt`, `v3-a3-selected.ansi`.
- `v4-a2-unselected.txt`, `v4-a2-unselected.ansi`, `v4-a2-selected.txt`, `v4-a2-selected.ansi`.
- Permitted size evidence: `dims-probe.txt` and `dims-probe-raw.txt`.

A directory listing exposed filenames but no excluded file contents were opened. No specs, source briefs, generation/check reports, renderer implementation, earlier captures/rounds, expected data, or supplied color audits/helpers were read. No pane/session operations or agents were used. My independent `/tmp/gb300-blind-captures.py`, run with `uv run --no-project`, decoded SGR foreground/background/bold attributes into cells and compared selected/unselected states and TXT/ANSI geometry.

Coordinates below are **1-based `[column,row,width,height]`**, measured from the whole capture, including header row 1. Route waypoints `(column,row)` denote actual line cells; intervening orthogonal cells follow the drawn line. Route bounding rectangles do not imply that all cells inside them are occupied. Geometry applies to both state files for the named view unless stated otherwise.

## Shared observations

- `dims-probe-raw.txt` contains `47 77`; the visible `stty size` transcript in `dims-probe.txt` agrees. Independently, all eight ANSI files decode to **47 rows, each 77 cells**.
- TXT files have 46 lines: after stripping ANSI and trailing spaces, rows 1–46 match exactly. ANSI row 47 is entirely blank. Selected and unselected TXT content is identical in each view.
- The diagrams fit within the captured grid, with complete node borders and legible node labels. No node text ellipsis, cropped node border, or diagram/controls overlap is visible. This establishes fit **in these captures**; a numerical `100%` zoom readout is not visible, so natural-100% scale cannot independently be certified from the captures alone.
- Each node uses a complete rounded rectangular outline. Edges meet the outside of intact outlines: source border glyphs are not replaced with tee-shaped junctions. Downward arrows sit one row above the target's top outline; rightward arrows sit one column before the target's left outline. No arrowheads point back toward sources.
- All visible graph edge glyphs, including arrowheads, use muted brown-gray `#7c6f64`. All node names and edge text use cream `#ebdbb2`. Background is `#282828`. No flow dots appear in either state; each header visibly reports `0 flows`. Motion cannot be assessed from still captures.
- Selection only changes one node's complete border to **bold amber `#d8a657`**. The selected node's label, geometry, background, incident lines, and arrows stay unchanged. No separate selection/resize/drag handle glyphs appear, inside or outside the selected rectangle. The rounded corners remain rounded corners. Unselected root nodes already use that same amber hue, without bold; hue alone therefore does not uniquely identify selection.
- No labeled group enclosure, host enclosure, legend, or residency key appears in any view. Color families and arrangement suggest visual levels/sibling groups, not independently verifiable deployment boundaries.
- Controls occupy `[2,41,9,6]`, with a complete square-corner border `#a89968`. Cream labels are `+ [+]` at `[4,42,5,1]`, `− [-]` at `[4,43,5,1]`, `⊡ [f]` at `[4,44,5,1]`, and `□ [i]` at `[4,45,5,1]`.
- Header foreground is `#665c54`. Visible header strings and bounds are recorded below; JSON filenames are merely visible title text, not inspected files. Headers show only a partial help/status line (v3 ends at `drag`, v4 at a trailing separator); no hidden suffix is inferred.

## View 1 — v1-a4

Evidence: `v1-a4-unselected.txt/.ansi` and `v1-a4-selected.txt/.ansi` (the four individually listed files above).

Header `[2,1,75,1]`: `rataflow-view · v1-a4-rail-lr.json · 5 nodes · 4 edges · 0 flows · drag pan`.

Graph-and-edge-label extent: `[5,16,68,17]`. Five node boxes and four directed paths are visibly recoverable.

### Nodes and colors

| Visible name | Complete box | Name text | Unselected border | Selected-file border |
|---|---|---|---|---|
| nv-rms | `[5,18,8,4]` | `[6,19,6,1]` | amber `#d8a657` | unchanged |
| OOB LAN | `[29,16,9,7]` | `[30,19,7,1]` | teal `#7daea3` | unchanged |
| Compute BMC | `[59,18,13,4]` | `[60,19,11,1]` | pink `#d3869b` | bold amber `#d8a657`, all 30 border cells |
| NVSwitch BMC | `[59,24,14,4]` | `[60,25,12,1]` | light pink `#e29caf` | unchanged |
| Power shelf | `[59,29,13,4]` | `[60,30,11,1]` | dark pink `#bb6c83` | unchanged |

### Directed paths and text

| Visibly traced source → target | Route bounds | Source stem; route waypoints; target arrow | Visible label |
|---|---|---|---|
| nv-rms → OOB LAN | `[13,17,16,3]` | stem `[13,19,1,1]`; `(13,19)→(27,19)→(27,17)→(28,17)`; `▶` `[28,17,1,1]` | `client` `[17,18,6,1]`, directly above source horizontal run |
| OOB LAN → Compute BMC | `[38,17,21,3]` | stem `[38,17,1,1]`; `(38,17)→(57,17)→(57,19)→(58,19)`; `▶` `[58,19,1,1]` | `power serial` `[41,16,12,1]`, above this upper run |
| OOB LAN → NVSwitch BMC | `[38,19,21,7]` | stem `[38,19,1,1]`; `(38,19)→(56,19)→(56,25)→(58,25)`; `▶` `[58,25,1,1]` | `power serial` `[41,18,12,1]`, above this middle run |
| OOB LAN → Power shelf | `[38,21,21,10]` | stem `[38,21,1,1]`; `(38,21)→(54,21)→(54,30)→(58,30)`; `▶` `[58,30,1,1]` | `power serial` `[40,20,12,1]`, above this lower run |

### Junctions, grouping, and fit

- OOB LAN is a tall explicit intermediate node, with one incoming path and three distinct outgoing stems. This is node-mediated fan-out, **not** a shared edge trunk. The vertical destination corridors are distinct columns 57, 56, and 54. No shared line cells or genuine crossing is visible.
- The tightest spot is `[56,19,3,1]`, showing `╮╰▶`: the middle path turns down at column 56 immediately beside the upper path turning right at column 57. These adjacent corners can look merged at a glance, but their directional strokes do not join. No tee or crossing connects them.
- The right column aligns three pink-family endpoint nodes. OOB LAN is a different-colored, larger middle node; nv-rms is the amber left root. The image suggests a shared OOB access point and peer destinations. It does **not** show a containing rack/host boundary or a shared physical wire among the three separate outgoing paths.
- Complete rightmost border is at column 72 and lowest node border at row 32, leaving space before pane limits and controls.

## View 2 — v2-a2

Evidence: `v2-a2-unselected.txt/.ansi` and `v2-a2-selected.txt/.ansi`.

Header `[2,1,75,1]`: `rataflow-view · v2-a2-rms-api.json · 4 nodes · 3 edges · 0 flows · drag pan`.

Graph-and-edge-label extent: `[19,18,40,13]`. Four node boxes and three directed paths are visibly recoverable.

### Nodes and colors

| Visible name | Complete box | Name text | Unselected border | Selected-file border |
|---|---|---|---|---|
| nv-rms | `[22,18,8,4]` | `[23,19,6,1]` | amber `#d8a657` | unchanged |
| Compute BMC | `[19,27,13,4]` | `[20,28,11,1]` | teal `#7daea3` | bold amber `#d8a657`, all 30 border cells |
| Power shelf | `[36,27,13,4]` | `[37,28,11,1]` | light teal `#93c2b7` | unchanged |
| NVOS | `[53,27,6,4]` | `[54,28,4,1]` | dark teal `#63978d` | unchanged |

### Directed paths

| Visibly traced source → target | Route bounds | Source stem; route waypoints; target arrow |
|---|---|---|
| nv-rms → Compute BMC | `[20,22,4,5]` | stem `[23,22,1,1]`; `(23,22)→(23,25)→(20,25)→(20,26)`; `▼` `[20,26,1,1]` |
| nv-rms → Power shelf | `[25,22,13,5]` | stem `[25,22,1,1]`; `(25,22)→(25,25)→(37,25)→(37,26)`; `▼` `[37,26,1,1]` |
| nv-rms → NVOS | `[27,22,28,5]` | stem `[27,22,1,1]`; `(27,22)→(27,23)→(54,23)→(54,26)`; `▼` `[54,26,1,1]` |

### Edge-label association

- `NVUE REST` `[36,22,9,1]` sits directly above the long route to NVOS: association is clear.
- `Redfish` `[28,24,7,1]` sits directly above the horizontal route to Power shelf: that visual association is strong.
- A second `Redfish` `[25,26,7,1]` sits **below that same Power shelf horizontal route**, between the Compute BMC arrow at column 20 and Power shelf arrow at column 37. It is right of the Compute route's entire horizontal segment (columns 20–23). The capture does not uniquely attach this second label to Compute BMC. It can be read as a duplicate label on the Power shelf route. Its unique edge assignment remains **ambiguous**, rather than being assigned by elimination or label meaning.

### Junctions, grouping, and fit

- Three independent stems leave nv-rms at columns 23, 25, and 27. There is no common vertical stem followed by a tee; no shared trunk, crossing, or false tee is drawn.
- The Compute and Power routes' bends at row 25 are separated by blank column 24. The two `Redfish` labels create association uncertainty, not line-topology uncertainty.
- Three teal-family nodes occupy the same lower row under one amber source. This suggests peer endpoints. There is no explicit host or physical-device grouping boundary and no indicated relation among those peers.
- All borders end by column 58, row 30; ample empty area remains.

## View 3 — v3-a3

Evidence: `v3-a3-unselected.txt/.ansi` and `v3-a3-selected.txt/.ansi`.

Header `[2,1,75,1]`: `rataflow-view · v3-a3-nvswitch-lr.json · 4 nodes · 3 edges · 0 flows · drag`.

Graph-and-edge-label extent: `[6,20,67,10]`. Four node boxes and three directed paths are visibly recoverable.

### Nodes and colors

| Visible name | Complete box | Name text | Unselected border | Selected-file border |
|---|---|---|---|---|
| OOB LAN | `[6,20,9,5]` | `[7,22,7,1]` | amber `#d8a657` | unchanged |
| NVSwitch BMC | `[36,21,14,4]` | `[37,22,12,1]` | teal `#7daea3` | bold amber `#d8a657`, all 32 border cells |
| NVOS | `[36,26,6,4]` | `[37,27,4,1]` | light teal `#93c2b7` | unchanged |
| NMX-C/T | `[64,21,9,4]` | `[65,22,7,1]` | pink `#d3869b` | unchanged |

### Directed paths and text

| Visibly traced source → target | Route bounds | Source stem; route waypoints; target arrow | Visible label |
|---|---|---|---|
| OOB LAN → NVSwitch BMC | `[15,21,21,2]` | stem `[15,21,1,1]`; `(15,21)→(34,21)→(34,22)→(35,22)`; `▶` `[35,22,1,1]` | `power serial` `[18,20,12,1]`, above upper run |
| OOB LAN → NVOS | `[15,23,21,5]` | stem `[15,23,1,1]`; `(15,23)→(33,23)→(33,27)→(35,27)`; `▶` `[35,27,1,1]` | `reach hist.` `[19,22,11,1]`, above lower run |
| NVOS → NMX-C/T | `[42,22,22,6]` | stem `[42,27,1,1]`; `(42,27)→(62,27)→(62,22)→(63,22)`; `▶` `[63,22,1,1]` | `NMX-C gRPC` `[47,26,10,1]`, above source horizontal run |

### Junctions, grouping, and fit

- OOB LAN has two separate right-side stems. The upper destination is NVSwitch BMC; the lower destination is NVOS. Only NVOS visibly sends the route to NMX-C/T. No NVSwitch BMC → NVOS or NVSwitch BMC → NMX-C/T link is visible; neither is inferred.
- At the upper/lower split, the upper route's turn `[34,22,1,1]` and lower route's turn `[33,23,1,1]` are diagonal neighbors, not a shared junction. No lines cross or share a run.
- Label placement is recoverable: `reach hist.` lies between the two horizontal paths but immediately above the lower one, consistent with the other above-run labels. The abbreviated text remains exactly `reach hist.`; its expanded meaning is unknown.
- The middle teal nodes align at the left edge but have no enclosing chassis or host outline. Their similar colors suggest a common visual level, not proven co-residency. NMX-C/T is one node with that literal combined label; no separate C and T nodes or residency distinction is drawn.
- Rightmost outline is column 72, bottom outline row 29. The wide layout remains wholly inside the 77-column capture.

## View 4 — v4-a2

Evidence: `v4-a2-unselected.txt/.ansi` and `v4-a2-selected.txt/.ansi`.

Header `[2,1,76,1]`: `rataflow-view · v4-a2-inband.json · 6 nodes · 5 edges · 0 flows · drag pan ·`.

Graph-and-edge-label extent: `[21,7,36,36]`. Six node boxes and five directed paths are visibly recoverable.

### Nodes and colors

| Visible name | Complete box | Name text | Unselected border | Selected-file border |
|---|---|---|---|---|
| Kubernetes | `[23,7,12,4]` | `[24,8,10,1]` | amber `#d8a657` | unchanged |
| GPU Operator | `[22,15,14,4]` | `[23,16,12,1]` | teal `#7daea3` | unchanged |
| DCGM | `[26,23,6,4]` | `[27,24,4,1]` | pink `#d3869b` | bold amber `#d8a657`, all 16 border cells |
| dcgm-exporter | `[21,31,15,4]` | `[22,32,13,1]` | green `#a9b665` | unchanged |
| Driver+CUDA | `[44,31,13,4]` | `[45,32,11,1]` | light green `#bdc97c` | unchanged |
| Fabric Mgr | `[23,39,12,4]` | `[24,40,10,1]` | blue `#7da0b8` | unchanged |

### Directed paths

| Visibly traced source → target | Route bounds | Source stem; route waypoints; target arrow |
|---|---|---|
| Kubernetes → GPU Operator | `[23,11,2,4]` | stem `[24,11,1,1]`; `(24,11)→(24,13)→(23,13)→(23,14)`; `▼` `[23,14,1,1]` |
| GPU Operator → DCGM | `[23,19,5,4]` | stem `[23,19,1,1]`; `(23,19)→(23,21)→(27,21)→(27,22)`; `▼` `[27,22,1,1]` |
| DCGM → dcgm-exporter | `[22,27,6,4]` | stem `[27,27,1,1]`; `(27,27)→(27,29)→(22,29)→(22,30)`; `▼` `[22,30,1,1]` |
| DCGM → Driver+CUDA | `[29,27,17,4]` | stem `[29,27,1,1]`; `(29,27)→(29,29)→(45,29)→(45,30)`; `▼` `[45,30,1,1]` |
| Driver+CUDA → Fabric Mgr | `[24,35,22,4]` | stem `[45,35,1,1]`; `(45,35)→(45,37)→(24,37)→(24,38)`; `▼` `[24,38,1,1]` |

### Edge-label association

- `hosts` `[26,12,5,1]` is beside the Kubernetes → GPU Operator stem; clear association.
- `DaemonSet` `[25,19,9,1]` is beside the GPU Operator → DCGM stem; clear association.
- `reads NVML` `[32,28,10,1]` is directly above the DCGM → Driver+CUDA horizontal run; clear visual association.
- `serves :9400` `[29,30,12,1]` is **directly below the same rightward run**, starting at its left bend column 29. It lies entirely to the right of the dcgm-exporter route's horizontal segment (columns 22–27), and between its arrow at column 22 and the Driver+CUDA arrow at column 45. Geometry does not uniquely attach this label to dcgm-exporter. It can instead read as another annotation on the Driver+CUDA route. Its unique edge association is **ambiguous**; label semantics are not used to repair that ambiguity.
- `same host` `[31,36,9,1]` is immediately above the horizontal Driver+CUDA → Fabric Mgr run; clear association to that drawn pair.

### Junctions, grouping, residency, and fit

- DCGM has two independent downward source stems, at columns 27 and 29, separated by a blank column. They bend outward at row 29. There is no common trunk/tee and no crossing.
- The route leaving Driver+CUDA continues below the peer row and then left to Fabric Mgr. It does not touch dcgm-exporter. Although Fabric Mgr is vertically close to dcgm-exporter, the actual visible source is Driver+CUDA, not dcgm-exporter.
- The top chain and green peer row suggest hierarchical levels. `hosts` states a relationship between Kubernetes and GPU Operator, but there is no containing Kubernetes boundary. `same host` explicitly suggests Driver+CUDA and Fabric Mgr share a host; it does not enclose or identify the host, and no equally explicit same-host claim encompasses DCGM or dcgm-exporter. Those additional residency relations remain unknown.
- `Driver+CUDA` is one combined node. `Fabric Mgr` is the literal abbreviation shown. Neither label is expanded into unseen components.
- Fabric Mgr's lower border `[23,42,12,1]` is fully present. It shares rows 41–42 with the controls but is separated from their right edge by 12 blank columns (11–22); no overlap occurs. Graph bottom row 42 leaves five grid rows below it. All six outlines remain intact in both states.

## Frozen blind findings for later Stage B

1. Recoverable displayed topology comprises 4, 3, 3, and 5 directed paths respectively. All their visible endpoints and directions are listed above; no missing intended links are guessed.
2. No actual shared edge runs or crossings are visible. v1 has a particularly tight adjacent-corner near-junction at `[56,19,3,1]`; independent paths remain traceable by stroke direction.
3. The strongest display ambiguity concerns **edge-text ownership**, specifically the lower `Redfish` in v2 and `serves :9400` in v4. Both sit under the rightward branch rather than adjacent to the leftward branch. Topology can be traced without confidently assigning those labels.
4. All 19 displayed node instances have complete borders and readable names. Selected captures preserve geometry and change only one border to bold amber. No separate selection handles are present. Root amber and selection amber coincide in hue.
5. The observed pane size is corroborated as 77×47. All displayed diagram content fits. A numerical 100% zoom, dynamic behavior, intended semantic layering, and intended residency/topology remain unverified at Stage A.

## Independent capture fingerprints

SHA256 values computed directly from the permitted final files, not from the supplied manifest:

```text
b43fe51a162737c241a35855f2ff6c338caa95ec859569873a708624ddaab2c9  v1-a4-unselected.txt
ab193166452975e76f8cfa7d02d7fde3241b3da0392980d13f4e34237866c51e  v1-a4-unselected.ansi
b43fe51a162737c241a35855f2ff6c338caa95ec859569873a708624ddaab2c9  v1-a4-selected.txt
e8807bf4aa06c5ed4d8060cf4a9aeb8e65a9177e66b3ee0747fe8c7900c8bc3f  v1-a4-selected.ansi
33d2fe708f21999931c3edfa2fd9bc4d837125cfff54bddbc9ad2ad6ad7f466c  v2-a2-unselected.txt
ee4b37c4eb1f3c399157b22728aa6e2bf8d75b3bd59a052e1263891beaf3c21f  v2-a2-unselected.ansi
33d2fe708f21999931c3edfa2fd9bc4d837125cfff54bddbc9ad2ad6ad7f466c  v2-a2-selected.txt
8a6ee0b7b6b6f257efba6472bcaa98794dda3561863ea1e74c37dabc6413f66d  v2-a2-selected.ansi
0a7ab4b624e1d74c74723c1143d60a4f6c132c35f095c2c1bd0578708f2a4394  v3-a3-unselected.txt
e767a8cad31ea67fc82dd5c04c5aaf4355dd1c3e7068e70ec19e2be36d406e5a  v3-a3-unselected.ansi
0a7ab4b624e1d74c74723c1143d60a4f6c132c35f095c2c1bd0578708f2a4394  v3-a3-selected.txt
48f335b42cc394d2c590945f61ea8fcd0e3066559a244680828fbf1e54b0e486  v3-a3-selected.ansi
832386799c0adb9fa44017ac7c8db5810c2fffb46c79b8c1d22775cb84f82a2d  v4-a2-unselected.txt
d883bd522ab6a18e03356728eed0da99a73f74a70b4395083f368e312fd2cd3f  v4-a2-unselected.ansi
832386799c0adb9fa44017ac7c8db5810c2fffb46c79b8c1d22775cb84f82a2d  v4-a2-selected.txt
881d1de89acf3c419766ac6becfbdb002e933cf61646504667853b6fdfea0617  v4-a2-selected.ansi
```
