# Blind observation — datacenter-redundancy, round 13

Coordinates below are 1-based [column,row,width,height] in the 72×112 diagnostic `recorded/canvas-3-visual.stdout` drawing body, including its header; they are not the local coordinates in `--check`. This capture is a separate, larger static diagnostic, not the 68×44 pane or 77×47 pinned frame. Counts from `--check` are explicitly distinguished from visible evidence. The live pane shows only the top and beginning of security; the diagnostic shows all three. The capture is plain text; it cannot establish the colors of the lower diagrams.

## Uplinks — diagram 1 of 3

Title `ISP uplinks and core cross-connect` [4,3,34,1]; description `Four ISP handoffs, two per MUX; each MUX reaches both cores.` [4,4,60,1]; both complete in diagnostic and pane. Check origin 0,3; extent 49×30. Eight nodes, eight edges and eight routes in check; eight boxes and eight arrowheads visible. Node labels: `ISP A` [5,7,5,1], `ISP B` [15,7,5,1], `ISP C` [25,7,5,1], `ISP D` [35,7,5,1], `MUX appliance 1` [5,16,15,1], `MUX appliance 2` [25,16,15,1], `Core router 1` [7,32,13,1], `Core router 2` [25,32,13,1]. Edge labels `x-connect` [15,22,9,1], [2,24,9,1], [19,24,9,1], [24,27,9,1]. The pane capture clips the left-hand x-connect to `connect`; the diagnostic shows it complete. The check reports no ambiguous owners; the diagonal crossing requires deliberate tracing, rather than reading the labels as a bundled path.

Arrows visible, all downward with filled ▼ heads: ISP A→MUX 1, ISP B→MUX 1, ISP C→MUX 2, ISP D→MUX 2; MUX 1→Core 1, MUX 1→Core 2, MUX 2→Core 1, MUX 2→Core 2. ISP paths are easy to follow. The four separate MUX ports and core heads are countable; the crossing `⌒` at [13,28] requires following the horizontal and vertical tracks carefully. The bridge denotes a crossing rather than a branch, but close parallel bends make the cross-connect more effortful to audit. No other visible junction or branch is needed to explain these paths. The live crop makes the left edge label incomplete.

Pinned ranks as declared: ISP A–D, then MUX 1–2, then Core 1–2; capture shows those ranks. Each of the eight borders has complete sides and corners in both diagnostic and live view. ANSI confirms continuous sibling border colors: ISP A #b7ce73, B #cbdb99, C #a4c14e, D #dce7bb (green family); MUX 1 #cea173, MUX 2 #dbba99 (orange); Core 1 #8a73ce, Core 2 #aa99db (violet). Sibling order is A/B/C/D then 1/2 then 1/2. No group enclosing box/title. No separate tier title; role words and hue bands mark tiers. Select-all ANSI captures the eight nodes in selected gold borders, not eight separate selection frames.

Near miss check: `near-miss: route uplinks:e5 passes 2 cell(s) at ring 2 of node 'core1' (nearest cell 29,23)`. Check route indices are zero-based: e5 is MUX 1→Core 2 in spec order, not MUX 1→Core 1. Its crossing runs near Core 1 in the capture; the check gives the precise closest local cell. Other routes: no near-miss line; this is a check result, not a complete independent cell-by-cell measurement.

## Security — diagram 2 of 3

Title `Active/standby firewall pair` [4,38,28,1], complete. Description declared `FW1 active, FW2 standby, fed by both cores, feeding both border leaves.`; diagnostic visible fragment `FW1 active, FW2 standby, fed by both cores, feeding both border leave` [4,39,69,1]: its last `s.` is clipped at the right edge. Live pane shows less, and an overlay occludes some of the remaining text. Check origin 0,38, extent 45×33. Six boxes, eight arrows and eight routes reported; diagnostic shows six boxes and all eight arrowheads.

Labels: `Core router 1` [5,42,13,1], `Core router 2` [23,42,13,1], `FW1 active` [8,56,10,1], `FW2 standby` [23,56,11,1], `Border leaf 1` [5,70,13,1], `Border leaf 2` [23,70,13,1]; edge `active` [18,48,6,1], [3,49,6,1], [4,63,6,1], [21,66,6,1]; `standby` [15,51,7,1], [23,51,7,1], [18,62,7,1], [22,65,7,1]. Check says zero ambiguous owners; two consecutive standby labels and closely spaced tracks demand attention. The live viewport occludes Core 1's border and label with controls and shows only the very top of this diagram.

Visible arrows all down with ▼: Core 1→FW1, Core 2→FW1, Core 1→FW2, Core 2→FW2; FW1→Border leaf 1 and 2; FW2→Border leaf 1 and 2. Separate ports, crossings and heads are countable in the whole diagnostic, but the two `⌒` bridges and touching bends within the cross-connects require careful tracing; these are not visually asserted branches. Traceability is possible with effort for this plain-text drawing, not instant. Declared ranks core pair, firewall pair, border-leaf pair match diagnostic. Complete borders and corners there; color continuity cannot be confirmed in the uncaptured lower section. Only partial core boxes are in the selected ANSI slice, so no full selected border for this diagram is proven. Core is violet in the visible upper diagram; the security occurrence's full border/hue is obscured. Firewall and border-leaf hue families and cross-diagram color consistency are not established by the ANSI capture. Group boxes/titles absent in diagnostic; active/standby node labels mark roles.

`near-miss: route security:e5 passes 2 cell(s) at ring 2 of node 'bl1' (nearest cell 27,26)`. Zero-based e5 is FW1→Border leaf 2. Its diagonal traverses the neighborhood of Border leaf 1; exact local position comes from check. No other route has a reported near miss.

## Fabric — diagram 3 of 3

Title `Dual-spine fabric and dual-homed racks` [4,76,38,1] and description `Each leaf reaches both spines; both leaves dual-home both racks.` [4,77,64,1], complete. Check origin 0,76, extent 66×30; eight boxes, 12 edges, 12 routes reported and visible as endpoint ports/arrowheads. The description's phrase `both leaves dual-home both racks` omits the distinction between border and rack leaves, while the drawing specifies rack leaves; it does not assert that border leaves directly connect to racks. Its `Each leaf reaches both spines` describes the four leaf boxes' links, although two point upward and two downward.

Node labels: `Spine 1` [27,82,7,1], `Spine 2` [39,82,7,1], `Rack leaf 1` [5,94,11,1], `Rack leaf 2` [21,94,11,1], `Border leaf 1` [37,94,13,1], `Border leaf 2` [55,94,13,1], `Rack 1` [28,105,6,1], `Rack 2` [39,105,6,1]. Edge labels: `ECMP` [62,83,4,1], [20,85,4,1], [52,85,4,1], [13,86,4,1], [20,89,4,1], [46,89,4,1], [34,91,4,1], [38,92,4,1]; `dual` [29,98,4,1], [20,99,4,1], [33,102,4,1], [17,103,4,1]. Check reports no uncertain label owners; nevertheless densely packed ECMP labels and repeated bridges make visual association harder than the checker implies.

Declared and visually intended paths: Border leaf 1→Spine 1 and Spine 2; Border leaf 2→Spine 1 and Spine 2 (upward ▲); Spine 1→Rack leaf 1 and 2; Spine 2→Rack leaf 1 and 2 (downward ▼); Rack leaf 1→Rack 1 and 2; Rack leaf 2→Rack 1 and 2 (downward ▼). Eight ECMP paths are individually declared and eight spine/rack-leaf arrowheads appear; do not treat that as independent proof that each complex route was successfully followed end-to-end. The top spaghetti of adjacent `⌒` bridges and touching corners makes the source/target of individual ECMP paths genuinely hard to verify without tracking characters through every crossing. Long return paths hugging the spines can look related to the wrong box. Dual links also cross repeatedly; four heads and separate ports are present. These glyphs are bridges, not proven branching joins, but carry a real audit ambiguity at a glance. I cannot certify individual attribution of all eight ECMP routes from this capture without guessing. No shared trunk is declared or reported.

Pinned ranks: Spine 1/2; Border leaf 1/2 and Rack leaf 1/2; Rack 1/2. The capture shows these ranks but middle sibling order is Rack leaf 1, Rack leaf 2, Border leaf 1, Border leaf 2. Borders have complete sides/corners except the control overlay masks the far-left segment of the Rack 1 row region; rack boxes themselves remain visible, including all four sides. ANSI/color and selected borders for this entire diagram are absent; spine, border-leaf, rack-leaf, rack colors and consistency with security cannot be established. No group enclosure or tier title is visible.

`near-miss: route fabric:e2 passes 22 cell(s) at ring 2 of node 'sp2' (nearest cell 44,-2)`; zero-based e2 is Border leaf 2→Spine 1, a long return near Spine 2. `near-miss: route fabric:e6 passes 3 cell(s) at ring 2 of node 'sp1' (nearest cell 21,5)`; zero-based e6 is Spine 2→Rack leaf 1. The dense paths near the spines support the concern, but the exact 22/3 cells and negative local coordinate come from check and cannot be individually counted with confidence in the text. No other near miss is reported. No direct contradiction with capture established.

## Whole canvas and scorecard

Check, verbatim:
```
viewport: unknown zoom: 1.00 natural
canvas: 3 diagrams on one canvas, drawn whole at 100%
diagram uplinks "ISP uplinks and core cross-connect" at 0,3: extent=49x30 nodes=8 edges=8 routes=8
  description: Four ISP handoffs, two per MUX; each MUX reaches both cores.
diagram security "Active/standby firewall pair" at 0,38: extent=45x33 nodes=6 edges=8 routes=8
  description: FW1 active, FW2 standby, fed by both cores, feeding both border leaves.
diagram fabric "Dual-spine fabric and dual-homed racks" at 0,76: extent=66x30 nodes=8 edges=12 routes=12
  description: Each leaf reaches both spines; both leaves dual-home both racks.
pins: 22 pinned, 0 conflict(s)
extent=71x106 cells (whole canvas)
crossings: 14 bridges, 9 touching bends
near-misses: 29 cell(s) inside the 2-cell margin of a node the route does not serve (0 on trunk buses)
passes-near-unrelated-node: 29
labels: 24/24 placed, 0 leader-ticked, 0 on route, 0 skipped, 0 ambiguous owners
groups: isp(4) mux(2) core(4) firewall(2) border-leaf(4) spine(2) rack-leaf(2) rack(2)
trunks:
dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 constant at 0.5c/step, 0 same-arrival at 2000ms
dot hues: 0 by source, 0 by destination, 0 shared-hue pair(s) (source-only 0, destination-only 0)
origins: 0/0 routes start at their arrow origin
arrivals: 0/0 same-arrival routes show their dot at the arrowhead on the final step
```
No `routes:` line is expected. Check supplies totals, not a per-diagram crossing breakdown; visually the fabric is much denser, and crossings in all three diagrams appear as bridge glyphs rather than intended junctions. I have not verified every one of the 14 bridges or nine touching bends manually.

| Surface | visible boxes / check edges / routes | edge labels visible diagnostic | group hue proven | pinned | near-miss routes/cells | selected complete borders | clipping/uncertain ownership |
|---|---:|---:|---|---:|---:|---:|---|
| uplinks | 8 / 8 / 8 | 4 | isp green, mux orange, core violet | 8 | 1 / 2 | 8 / 8 | live crops one edge label; check 0 uncertain |
| security | 6 / 8 / 8 | 8 | unknown in security ANSI | 6 | 1 / 2 | 0 / 6 complete | diagnostic description last 2 chars; live overlay/crop; check 0 uncertain |
| fabric | 8 / 12 / 12 | 12 | unknown | 8 | 2 / 25 | 0 / 8 | no label clipped in diagnostic; ECMP ownership hard to audit despite check 0 |
| canvas | 22 occurrences / 28 / 28 | 24 | three families proven, five unknown | 22 | 4 / 29 | 8 / 22 complete | no inter-diagram overlap; captures do not prove all selected states |

Unique identities across the diagrams: 18, since the two cores and two border leaves recur. Total node-label occurrences 22; check's 24 labels are edge labels. Groups by diagram: uplinks isp/mux/core; security core/firewall/border-leaf; fabric spine/border-leaf/rack-leaf/rack. No observed enclosing group borders. Cross-diagram group hue change: unknown, not proven absent, because the lower sections lack ANSI. 0 dots in all three pane frames (0,100,200 ms) and all 12 pinned frames (0 through 1100 ms); pinned drawing bodies compare identical. No animated routes, so dot spacing/direction/origin, arrival, corner rest, dot-to-border hue and matching are inapplicable; check has 0 violations and 0/0/0 hue counts, consistent with the visible static frames.

Fit: check 71×106 whole canvas; pinned viewport `viewport: 77x47 zoom: 1.00 natural`; live `viewport: 68x44 zoom: 1.00 natural`, header also `68x44 @100%`. Diagnostic `viewport: 72x112 zoom: 1.00 natural`. Canvas height exceeds both real capture viewports; the 68-column live viewport is also narrower than the canvas, cropping a left label. Security and fabric require pan in the pane; no captured panning sequence proves how to reach them. No overflow banner is visible. Controls `+`, `−`, `f`, `i` appear over content; no visible diagram index or explicit pan-key instructions. Whole diagnostic shows titles and separators and hence identifies each section after reaching it, but the initial pane does not reveal the third diagram or its location; the height in header hints at more content, not what it contains. Security description clips even in the whole-canvas diagnostic; its description is additionally truncated/overlaid in smaller captures.

Neutral shape: three connected diagram components joined conceptually through repeated core and border-leaf identities, rather than drawn edges between panels. Widest fan-out is two per source; no antiparallel box pair in the spec. Several destination nodes receive two separate heads. Uplinks 8/8, security 6/8, fabric 8/12; four complete 2×2 cross-connects plus other pairs in the fabric. Identifiers are abundant (18 unique), labels repeated for qualifiers: x-connect, active/standby, ECMP, dual. Vertical ranks look like tiers rather than elapsed phases; fabric has upwards and downwards arrows. The spec lists all 22 pinned occurrences and the diagnostic visually agrees with ranks.

Generator classification as stated in `generation.json` classification fields: `family: redundant-fabrics`; `evidence: 18 nodes against 28 relations with four tiers that each form a complete 2x2 cross-connect, and the source kills the dots outright (line 134: 'remove the dots flowing for now'): the densest, dot-free fabric case.` This is generator wording, not an independently checked source claim.

Evidence limitations: lower-section ANSI and individual selection captures are missing; route and label ownership in dense fabric cannot be independently certified from text alone. The dataset file was not opened or hashed during blind stage: the manifest is prohibited here. The declared digest is not an independently computed digest. No viewer session was launched.
