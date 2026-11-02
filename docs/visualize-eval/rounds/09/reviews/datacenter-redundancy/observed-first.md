# Blind observation — datacenter-redundancy, round 09, stage A

Coordinates below are 1-based screen cells in frame 0 of each pinned 77×47 dump, excluding the `viewport` and `frame` metadata lines. Label rectangles are `[column,row,width,height]`. Node and edge labels are counted separately; the application header and controls are UI, not diagram labels. This record uses the captures, final specs, and supplied generation disclosure only; it does not consult source or expected data.

## Final spec hashes

- v1: `01e46b4746373afc71f2717b4079f75de67259c1f4398c4a785d17c309ddcc6a`
- v2: `df2505bc739009f5fa803fae9b1afafaa96583f9388f0c8467ddfe07e693eb9f`
- v3: `ca3c86a14350ceca0c47d02d7a90cd6db5da4a49d61f78d930c1cf3999691bc1`
- v4: `49425ffad45a72995fb412a22c0d049a6e0328a87db32394c0b968490a7da006`

## Scorecard

| view | nodes | drawn routes | node labels | edge labels | declared groups / distinct visible hue families | pinned nodes/ranks | reported bridges / touching bends | reported ambiguous owners | visibly clipped | selected occurrences | dot violations |
|---|---:|---:|---:|---:|---|---|---|---:|---:|---|---:|
| v1 | 8 | 8 | 8 | 4 | 3 / 2 | 0 / 0 | 1 / 1 | 0 | 0 | 8/8 | 0 |
| v2 | 6 | 8 | 6 | 8 | 3 / 3 | 0 / 0 | 2 / 1 | 0 | 0 | 6/6 | 0 |
| v3 | 8 | 12 | 8 | 12 | 4 / 3 | 8 / 3 | 15 / 5 | 3 | 0 | 8/8 | 0 |
| v4 | 6 | 8 | 6 | 8 | 3 / 2 | 0 / 0 | 2 / 2 | 1 | 0 | 6/6 | 0 |

Totals: 28 node occurrences, 36 route occurrences (28 distinct stated relations, with 8 repeated in v4), 28 node-label occurrences and 32 edge-label occurrences. Selection is the `--select-all` capture: all 28 borders are shown selected simultaneously; it does not prove a separate individual-selection interaction for each node. Ambiguity counts are the check's counts, not independently localized exact ownership counts; see below. v3 and v4 validators explicitly fail `check_warnings_absent` and `labels_ownership_clear`, respectively reporting 3 and 1 ambiguous labels. v1/v2 validator outputs report pass.

## Labels, verbatim

- v1 nodes: `ISP A` [13,16,5,1]; `ISP B` [13,21,5,1]; `ISP C` [13,26,5,1]; `ISP D` [13,31,5,1]; `MUX 1` [25,21,5,1]; `MUX 2` [25,27,5,1]; `Core 1` [59,21,6,1]; `Core 2` [59,27,6,1]. Edges: `x-connect` [40,19,9,1], [39,23,9,1], [38,25,9,1], [40,29,9,1].
- v2 nodes: `Core 1` [30,9,6,1]; `Core 2` [41,9,6,1]; `FW1 active` [26,24,10,1]; `FW2 standby` [41,24,11,1]; `BL 1` [32,39,4,1]; `BL 2` [41,39,4,1]. Edges: `active` [23,16,6,1], [33,18,6,1], [35,35,6,1], [26,37,6,1]; `standby` [45,17,7,1], [33,22,7,1], [34,31,7,1], [45,32,7,1].
- v3 nodes: `Spine 1` [30,13,7,1]; `Spine 2` [42,13,7,1]; `Leaf 1` [22,25,6,1]; `Leaf 2` [33,25,6,1]; `BL 1` [44,25,4,1]; `BL 2` [53,25,4,1]; `Rack 1` [31,36,6,1]; `Rack 2` [42,36,6,1]. Edges: `ECMP` [34,16,4,1], [33,17,4,1], [46,17,4,1], [24,20,4,1], [38,20,4,1], [45,22,4,1], [54,22,4,1], [26,23,4,1]; `dual` [37,29,4,1], [28,30,4,1], [34,32,4,1], [24,34,4,1].
- v4 nodes: `Spine 1` [9,21,7,1]; `Spine 2` [9,27,7,1]; `Leaf 1` [40,21,6,1]; `Leaf 2` [40,27,6,1]; `Rack 1` [64,21,6,1]; `Rack 2` [64,27,6,1]. Edges: `ECMP` [25,21,4,1], [24,23,4,1], [23,25,4,1], [25,29,4,1]; `dual` [57,21,4,1], [50,23,4,1], [51,25,4,1], [52,29,4,1].

## Relations and visual traceability

The following are the declared source→target pairs; all have an arrowhead at the target in the captures. These names are needed to enumerate edges, but their presence in the spec does not prove every crowded route is visually unambiguous.

- v1 e1–e4: ISP A→MUX 1, ISP B→MUX 1, ISP C→MUX 2, ISP D→MUX 2; rightward `▶`, two separate ports per MUX, traceable. e5–e8: MUX 1→Core 1, MUX 1→Core 2, MUX 2→Core 1, MUX 2→Core 2; rightward `▶`, two per core. The diagonal pair crosses at a bridge; with close attention the paths can be followed, though the crossing requires interpreting the bridge convention rather than treating it as a junction.
- v2 e9–e12: Core 1→FW1, Core 2→FW1, Core 1→FW2, Core 2→FW2; downward `▼`, two per firewall. e13–e16: FW1→BL 1, FW1→BL 2, FW2→BL 1, FW2→BL 2; downward `▼`, two per BL. Crossed lanes require careful tracing through their bridges; paths and arrowheads remain individually visible.
- v3 e17–e20: BL 1→Spine 1, BL 1→Spine 2, BL 2→Spine 1, BL 2→Spine 2; arrowheads point right into the spine boxes after long backward outer-rail detours, two per spine. The reader sees rails on both outside edges and many adjacent/crossed segments; individual source-to-target pairing is not reliably traceable without careful reconstruction or guessing. In particular, a reader may see a surrounding frame or apparent branching where rails and bends meet; it is not a group border. e21–e24: Spine 1→Leaf 1, Spine 1→Leaf 2, Spine 2→Leaf 1, Spine 2→Leaf 2; downward `▼`, two per leaf; bridges and adjacent bends make individual paths difficult to trace. e25–e28: Leaf 1→Rack 1, Leaf 2→Rack 1, Leaf 1→Rack 2, Leaf 2→Rack 2; downward `▼`, two per rack; the two-rank fan is visible, but detoured rails and nearby bridges complicate the diagonal routes.
- v4 repeats e21–e28: Spine 1→Leaf 1, Spine 1→Leaf 2, Spine 2→Leaf 1, Spine 2→Leaf 2; Leaf 1→Rack 1, Leaf 2→Rack 1, Leaf 1→Rack 2, Leaf 2→Rack 2. All rightward `▶`, two distinct target ports per box. Paths are much easier to follow than in v3 but crossing pairs require bridge interpretation and the close label association is not always certain.

## Crossings, ownership, borders

The pinned frame contains the following actual `⌒` bridge glyph coordinates (column,row): v1 (55,23); v2 (32,19), (34,34); v3 (51,9), (26,14), (30,18), (32,18), (42,18), (44,18), (50,18), (59,18), (37,19), (42,19), (32,21), (35,21), (37,21), (50,29), (33,31); v4 (36,23), (60,25). These counts match checks. The checks additionally report touching bends 1/1/5/2; these are not separately marked by a unique glyph, and I cannot independently identify all exact touching-bend coordinates from the capture. There are numerous adjacent corner/straight cells, especially v3 near rows 18–23 and 29–33. They can look like junctions or branches; no declared trunk is drawn. Do not interpret visual contact alone as a junction.

Ownership: v1 and v2 checks say zero ambiguous; labels are near their lanes, though crossings still require tracing. v3's check reports three, but does not identify them. The independently measured `ECMP` text at [34,16] and [33,17] sits between closely spaced vertical lines, [38,20] is immediately between several lines, and [26,23] is adjacent to multiple downward arrow lanes; the `dual` text at [37,29], [28,30] and [34,32] also sits amid neighboring lanes and the outer rail. These are visually uncertain candidates, not a claim that those are precisely the three validator-flagged occurrences. v4's check reports one without identifying it: the opposed lanes around `ECMP` [24,23]/[23,25] and `dual` [50,23]/[51,25] offer plausible ambiguous associations. The capture does not supply per-label ownership diagnostics, and identical text makes exact route attribution unreliable; I cannot independently identify the exact 3+1 flagged labels from these images.

All node rectangles have visible rounded corners and complete sides in the plain captures; route ports adjoin rather than visibly remove border cells. ANSI samples at each node's left border show group/sibling colors below; selection capture changes each sampled border to RGB 216,166,87. I did not verify every cell of every border for color continuity, so full color-continuity is not established by this record.

## Groups, hue, ordering, rank

Groups draw no container, title, or border: that absence is correct for this contract. Rounded rectangles are individual node boxes. Tier identification comes from node names, spatial ranks and the group border hues; there is no separate tier-title line or hue band.

ANSI sampled border colors (RGB, siblings in visible order): v1 ISP green (169,182,101; 189,201,124; 143,157,79; 208,217,150), MUX blue (125,160,184; 151,184,206), core green (169,182,101; 189,201,124). v2 core green (same pair), firewall teal (125,174,163; 147,194,183), BL gold (216,166,87; 228,184,111). v3 spine teal and rack-leaf teal (same teal pair), BL gold (same pair), rack pink (211,134,155; 226,156,175). v4 spine teal, rack-leaf teal, rack pink, same pairs. Thus group families are shared by some distinct groups; hue alone cannot distinguish v1 ISP from core or v3/v4 spine from leaf. Siblings retain numeric/alphabetic order within each group. In v3 the engine places Leaf 1/2 to the left of BL 1/2, despite the pin list putting BL before leaf; each group's own order remains stable.

Only v3 declares rank pins: `[[sp1,sp2],[bl1,bl2,leaf1,leaf2],[rack1,rack2]]`. The capture actually puts spines at rows 11–15, all four BL/leaf boxes at rows 24–27, and racks at rows 35–38; check reports 8 pinned, 0 conflicts. The other views use natural rank placement, not declared pins.

## Structure, fit, motion

There are 18 distinct named devices across the four overlapping views, and 28 distinct declared directed relationships. Widest outgoing fan is 2. No pair of boxes has arrows in both directions; there are many targets with two incoming arrowheads at separate ports. The four views share Core, BL, Spine/Leaf/Rack names and form one connected overall chain of tier-to-tier fans, not isolated worlds. Labels are short device identifiers with active/standby qualifiers and repeated relation names; no addresses or explicit phases appear. Spatial tier progression is evident, but no temporal phases are labelled.

All pane captures show `82x51 @100%`; pinned dumps state `viewport: 77x47 zoom: 1.00 natural`. Checks outside a measured tty say `viewport: unknown`, not 77×47. Extents disclosed/check-reported are 65×19, 32×34, 52×32, 74×11. The pinned dumps show all diagram boxes, edge labels, ports and routes within the screen without an overflow banner or visible clipping; v4 has little horizontal spare space. There is no evidence that pan or zoom is needed for these captures. Missing `routes:` lines are expected.

Each `vN-frames.txt` contains five frames; comparison of the complete first 51 text rows per frame found them identical in each view. All pinned dumps have three identical frames as well. No flow-dot glyph is visible; checks report zero single-dot routes, zero periodic routes and zero dot violations. Thus spacing, direction, origin, corner/bridge/arrowhead contact and synchronized arrival are not applicable rather than demonstrated motion properties. Pixel identity as an actual raster is not independently available: equality established here is captured character-grid text, not a pixel-level image comparison.

## Generator's own classification and recorded blockers

Verbatim at `generation.md`, section `Step 0 — family`:

```text
family: redundant-fabrics
evidence: every one of the 28 links over 18 devices is a tier-to-tier cross-connect
          where each lower target takes a double arrowhead (2 ISPs per MUX, 2 MUXes x
          2 cores, 2 cores x 2 firewalls, 2 firewalls x 2 border leaves, 2 border
          leaves x 2 spines, 2 spines x 2 rack leaves, 2 rack leaves x 2 racks) and
          the source says "remove the dots flowing for now" — densest family,
          double-arrowhead targets, dots forbidden.
```

Same section says service-meshes is not selected as family, but the mesh principle "never one bidirectional arrow" is applied as a secondary rule. This is a generator claim, not a blind family verdict. Its `generation.json` and `generation.md` disclose, neutrally: no backward-edge lane inside a pinned rank; `label_slot` broke fan routing and skipped a label under minlen; minlen cannot exceed a pinned rank gap; and an isolated 2×2 cross-connect probe still reported one bridge. The present stage does not independently reproduce probes or run the viewer.

## Evidence limitations

All listed plain text and ANSI formats were readable. ANSI border colors were sampled, not exhaustively audited cell-by-cell. Selected capture is simultaneous select-all, not separate individual captures. The checks report ambiguous counts but not their identities; exact flagged coordinates cannot be established from the supplied evidence alone. Captures provide text/ANSI, not raster screenshots for pixel-level identity. No source, expected data, rubric, or dataset manifest was read.
