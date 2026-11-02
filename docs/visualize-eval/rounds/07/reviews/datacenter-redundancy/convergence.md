# Round 07 convergence: datacenter-redundancy

Blind record: [observed-first-rf.md](observed-first-rf.md), SHA-256 `143aab87ac0f1311edd45e70f797f5bd9d6bc956843829b3efcf0875aae7c0fe`, `saved_before_expected_reveal: true`; rehashed unchanged. Generator `viz-rf07` / `fireworks/accounts/fireworks/routers/deepseek-flash-latest`; reviewer `openai/gpt-6.1-sol`.

## Coordinate convention

`R(x,y)` refers to native 83×51 round-05 `evidence/vN/vN-text.txt` screen, one-based column x and one-based row y; `P` means the 77×47 pinned screen and its previously audited coordinates. Native bridge coordinates are from the delivered round-05 edge audit; pinned versions subtract (3,2). `F(x,y)` refers to the complete capture scaled to 1054×2000, x right and y down; multiply x by 2442/1054 and y by 4634/2000 to obtain original PNG pixels. Coordinates F ±3 scaled pixels. Full F node rectangles, labels and group bounds are in the blind record. Native ANSI/selected files, pinned frames, checks, source and delivered round-05 result supplement the text.

## All views: shape, groups, ports and links

- v1 R ISP A/B/C/D centers approximately (24,11/21/31/41), MUX1/2 (41,17/37), Core1/2 (57,17/37). F ISP A/B/C/D (169,257/340/423/506), MUX1/2 (496,340/423), Core1/2 (824,340/423). Both are left-to-right; F uses WAN B(68,211;270,535), MUX B(396,294;597,453), CORE B(722,294;925,453), each tinted/titled and containing members; R hue-only. R ISP A→MUX1 starts (29,11) and ends (37,16), ISP B starts (29,21) and ends (37,18), two distinct target ports; F those paths merge at (333,340) and end in one center at (410,340). Similarly R C/D approach MUX2 at (37,36)/(37,38); F merge (333,423) and share one target at (410,423). These four edges are unlabeled on both sides.
- v2 R core (14,21/31), firewall FW2 above FW1 (30,21/31), BL1 above BL2 (49,21/31), Spine2 above Spine1 (68,21/31). F core1/2 (139,990/1051), FW1/FW2 (377,990/1051), BL1/2 (615,990/1051), Spine1/2 (854,990/1051): firewall and spine ordering reverses vs R. F CORE B(65,957;212,1073), FIREWALL B(303,957;451,1073), BORDER-LEAF B(542,957;689,1073), SPINE B(780,957;928,1073); all contain members. R colored nodes have no group boxes/titles. The separate firewall/spine groups both retain teal, but F titles resolve membership.
- v3 R Spine1/2 (24,21/31), Leaf1/2 (42,21/31), Rack2/Rack1 (59,21/31); F Spine1/2 (169,1623/1706), Leaf1/2 (496,1623/1706), Rack1/2 (824,1623/1706). F reverses rack identity order. F SPINE B(68,1577;270,1735), RACK-LEAF B(396,1577;597,1735), RACK B(722,1577;925,1735); R hue-only, with teal reused for spine/leaf. Neither provides a view with both leaf classes at one level and both spines above: R v2 BL/spine x≈49/68 y≈21/31 and v3 spine/leaf x≈24/42 y≈21/31; F v2 BL/spine x≈615/854 y≈990/1051 and v3 spine/leaf x≈169/496 y≈1623/1706. This is an inherited source-tier defect, not an effect of the fit-only gate.

## Each edge label and route relation

R target label coordinates below are `P` as reported in the prior edge audit; where it does not record a specific label rectangle, `R row` identifies its actual native displayed source/route region without inventing a precise owner. F positions are screenshot centers, with owner assignment from HTML and its target-sorted label buckets: individual repeated labels and coincident paths are not individually distinguishable by the screenshot. Correction to the immutable blind record: its two v3 Leaf2→Rack label positions were swapped; Leaf2→Rack1 is at (660,1694), Leaf2→Rack2 at (660,1717). All four ISP→MUX edges are unlabeled, as intended.

| View | Edge / label | R evidence | F center |
|---|---|---|---|
| v1 | MUX1→Core1 `x-connect` | R(45,15), distinct straight route R(45,16)→(53,16) | (660,329) |
| v1 | MUX1→Core2 `x-connect` | R label x40–48 at rows 21 or28, owner ambiguous | (660,351) |
| v1 | MUX2→Core1 `x-connect` | same two R label candidates, owner ambiguous | (660,412) |
| v1 | MUX2→Core2 `x-connect` | R(45,39), distinct straight route row38 | (660,434) |
| v2 | Core1→FW1 `active` | R(28,26) | (258,982) |
| v2 | Core1→FW2 `standby?` | R row19 | (258,998) |
| v2 | Core2→FW1 `active` | R(20,33) | (258,1042) |
| v2 | Core2→FW2 `standby?` | R around (14,27) | (258,1058) |
| v2 | FW1→BL1 `active` | R(36,29), misleadingly touches the standby route, prior D3 | (496,982) |
| v2 | FW1→BL2 `active` | R row33 near firewall→BL | (496,998) |
| v2 | FW2→BL1 `standby?` | R row19 near firewall→BL | (496,1042) |
| v2 | FW2→BL2 `standby?` | R row23 near firewall→BL | (496,1058) |
| v2 | BL1→Spine1 `ECMP` | R (55,23) or (54,29), ambiguity prior D4 | (735,982) |
| v2 | BL1→Spine2 `ECMP` | R row19 | (735,998) |
| v2 | BL2→Spine1 `ECMP` | R row33 | (735,1042) |
| v2 | BL2→Spine2 `ECMP` | R (55,23) or (54,29), ambiguity prior D4 | (735,1058) |
| v3 | Spine1→Leaf1 `ECMP` | R row19 straight | (333,1611) |
| v3 | Spine1→Leaf2 `ECMP` | R center gutter rows26–27 | (333,1634) |
| v3 | Spine2→Leaf1 `ECMP` | R center gutter rows26–27 | (333,1694) |
| v3 | Spine2→Leaf2 `ECMP` | R row33 straight | (333,1717) |
| v3 | Leaf1→Rack1 `dual` | R center gutter rows26–27 | (660,1611) |
| v3 | Leaf2→Rack1 `dual` | R row33 | (660,1694) |
| v3 | Leaf1→Rack2 `dual` | R row19 | (660,1634) |
| v3 | Leaf2→Rack2 `dual` | R center gutter rows26–27 | (660,1717) |

F uses central right/left handles; R allocates separate ports, e.g. MUX1 outgoing R(45,16)/(45,18) and Core1 incoming R(53,16)/(53,18), versus F MUX1 (583,340) and Core1 (737,340), both links sharing each port. F labels are fanned vertically by source, not allocated to distinct routes; role/destination attribution is especially unsafe for solid/dashed overlapping v2 paths.

## Crossing and shared-run audit

R has six distinct bridge crossings with nonjoining routes: v1 R(51,19); v2 R(26,23), (44,29), (62,23); v3 R(35,23), (53,23). There are no shared link runs. F has no distinct bridge glyph and its opposing routes share entire corridors instead of resolving as isolated crossings:

- v1 ISP fan-in x333 around F(333,340)/(333,423); MUX→Core rails y340/423 with counter-direction vertical x660, junctions F(660,340)/(660,423). The four F label boxes center at x660, y329/351/412/434, obscuring parts of these joins. The MUX1→Core2 and MUX2→Core1 routes coincide along x660 y340–423 and share the horizontal approach rails with the straight routes.
- v2 three 2×2 gutters have shared source/target rails y990/1051, counterflow verticals x258, x496, x735 and junctions F(258,990/1051), F(496,990/1051), F(735,990/1051). Four `standby?` HTML strokes are dashed but overlap solid paths, making exact individual dashed/solid routes uncertain. React Flow has no evidence of a countably higher number of distinct crossings here; counting coincident lines as X crossings would be misleading.
- v3 equivalent counterflow/shared rails at y1623/1706 and verticals x333 and660, junctions F(333,1623/1706), F(660,1623/1706). No F independent X crossings. The visible T-like merge violates the explicit requirement for independent redundancy links even though HTML declares 28 separate edge objects.

R calls six bridges and separates heads; F coincident arrows at each target conceal multiplicity. The mismatch is not repaired by repeated identical gutter labels. R already had five localized label-owner defects (D2/D3/D4); F introduces merged-link ambiguity across all three views, including v1/v3. `notes.md` says v1/v3 read cleanly and v2 has more crossings; the image supports neither claim as stated. It also says `dual` absent, but F v3 contains four `dual` labels, confirmed by HTML and image. Hue collision and missing tier elevation are inherited; the stated reason 'dagre cannot' is not established as a capability impossibility.

## Animation, fit, chrome, evidence

R five timestamped static frames and specs show no dots, delivered animation pass; F all 28 edges `animated:false`, image has none. There is no applicable dot-origin or speed comparison: both are static; datacenter's zero-dot prohibition is absolute. All F graphs fit each captured 1100×700 canvas at shown zoom; full page not proof that three fit simultaneously. This adaptation yields F fit pass, separate from semantic/grouping tier failure. All F node borders complete; group-title interruptions are intentional. F attribution at (912,662), (912,1303), (912,1945) is chrome, not graph; R header/palette are different chrome.

`notes.md` reports identical reload digest `831223310`, but only the assertion is saved, no two raw measurement outputs. `commands.txt` lists capture sequence; `attempts.md` and preserved drafts give a partial ladder. Raw exit/status, digest pair, full capture lifecycle and browser closure are absent; workflow remains blocked, not an invented proof of nondeterminism. The source's arrow-convention requirement is not stated on the F screenshot/page: shown closed arrowheads on physical links could suggest direction, and `notes.md` does not furnish a clear convention either.
