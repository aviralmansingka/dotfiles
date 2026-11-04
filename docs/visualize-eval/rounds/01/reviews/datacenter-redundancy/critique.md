# Datacenter redundancy — round 01 independent Astra critique

## Verdict: FAIL

The four final JSON specs contain all **18 required concepts and 28 required endpoint pairs**, with no reversed pair or extra pair. The frozen captures do **not** independently establish the same complete visual result. Blind Stage A traced **26 endpoint paths**, left **two text-interrupted fabric paths qualified**, and left several fabric label associations ambiguous. After applying the full rubric, **19 complete relationship audits pass and 9 fail**: two fail full-path traceability, and seven additional links fail reliable label association despite having traceable endpoints.

This is not a judgment that the physical network lacks those connections. It is a judgment that the delivered visualization does not prove them clearly enough. JSON presence, arrowhead counts, and clean `--check` output cannot replace that proof.

| Frozen category | Decision | Main reason |
|---|---|---|
| semantic_fidelity | **FAIL** | All concepts/pairs exist in JSON, but visual coverage and seven per-link label associations are incomplete. |
| arrow_traceability | **FAIL** | Two required fabric paths are interrupted by label text; blind endpoint associations remain qualified. |
| layout_fit | **FAIL** | All boxes/labels fit the actual target, but V4 text overlays route cells. The no-overlay-occlusion gate still applies. |
| conceptual_grouping_color | **PASS** | Related pairs have related hues; border leaves and rack leaves share the requested level, with spines above. |
| border_integrity | **BLOCKED** | Unselected correctness is proven for 24/24 occurrences and captured-selected correctness for 5/24; selected evidence is missing for 19 occurrences. No border defect is alleged. |
| workflow_evidence | **BLOCKED** | Selected-node state coverage is incomplete (5/24); one initial pane's cleanup also lacks preserved closure/final-layout proof. Hashes, identities, commands, checks and captured states remain preserved. |
| animation | **N/A**, not a pass | Source line 134 explicitly removes dots; manifest and expected data say animation is off. |

There is **1 passed applicable category**, 3 failed categories and 2 blocked categories. The findings inventory remains 0 critical, 3 high and 1 medium observed defects. Missing selected-state coverage and cleanup proof are evidence blockers, not allegations of broken borders or a leaked pane and not additional scored visual defects. Known category/required-edge failures still determine the overall FAIL.

**Selected-state coverage correction:** the earlier border PASS improperly generalized five selected instances to all 24 node occurrences. Under the unchanged frozen rubric it is now BLOCKED. Superseded `reviewer-result.json` and `critique.md` are archived byte-for-byte under `superseded/pre-selected-state-coverage/`, with SHA256 `eb68e76d7e622651554ffadc8dd61e3c818cebe0430ebdca47ff72e938c1f598` and `db373fe0a102c953255deab4d343eddbf7dabeb4953503d79db48c0568d2c54b`, respectively. `observed-first.md` remains unchanged; no new rendering was performed.

## Review independence and frozen evidence

- Reviewer: `viz-judge01-datacenter-redundancy`, `openai/gpt-6-astra`. Current environment was checked: `PI_PROVIDER=openai`, `PI_MODEL=gpt-6-astra`.
- Generator: `viz-ds01-datacenter-redundancy`, `fireworks/accounts/fireworks/routers/deepseek-flash-latest`, as recorded in round metadata and `generation.json`. Its separate session identity is preserved there. No alternate generator or judge was substituted.
- Stage A preceded this expected-source reveal. `observed-first.md` was verified before Stage B and remains byte-for-byte unchanged: **`635c74dc1a54baf3ca70df5baed1ae332f19e2fdd1502430f3256a3aeef3ace2`**.
- This review used only this case and the shared frozen rubric/manifest/round metadata. No prior-round output was reused. No graph, expected data, skill, renderer or capture was changed. No rendering, pane/session operation, installation, fix, commit or subagent was performed.
- All evidence paths in `reviewer-result.json` are relative to the repository working directory, **not** to the review directory. The frozen executable is outside the repository; its evidence path uses a repository-relative `../…` path to that exact `/tmp` file. `verification.json` also preserves its original absolute metadata path. Source references use repository-relative paths with optional section/JSON-pointer fragments.

Verified frozen hashes:

| Input | SHA256 |
|---|---|
| Candidate skill snapshot | `9c5cea272a88300644cacda52c853c7c9169eeec91f0355d3460ee8741308d92` |
| Executed frozen renderer | `4a883e73b822f009c504bd21d0c2fc383067bf1b83b9791ccbda431912e3a1d8` |
| Round01 rubric | `60997237bd996f1e1b6a16e0b68133859b9f03fd83c85e7f508e286743240f5d` |
| Dataset manifest | `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05` |
| Case source | `a3051af3eeeec31aee53558dafbbea5d061dc74253618fd6940eba5c39b5bb98` |
| Case expected | `926e866fbdbb3eaac5b7a21360905d1f621a7a6386139afab303e8ba7e62ed47` |
| Four-final-spec manifest | `075c093b2bf489459a149d7e1bc2b5099a77e7d42ec29263062ebd9bf1c7f7a5` |

`spec-manifest.json` contains sorted `[repository-relative spec path, actual SHA256]` pairs. It includes only the four delivered views, not rejected attempts or oversized reference specs. All four actual spec hashes match both generation records and their final capture-log records. All inspected final and V1c capture hashes match their recorded values. The independent helper compared the complete spec edge union with all 28 expected pairs: 28 unique pairs, none missing, none extra. These hash/set checks establish intent and provenance, not visual success.

The round01 renderer is its own new baseline. Neither complete borders nor any other improvement can be attributed to the skill alone from this round. The cancelled round00 contributes no evidence or score.

## Source meaning, arrow convention and complete cross-view accounting

The original graph was a historical generated relation set, not independent verification of a real deployed network. The frozen source explicitly retains its 28 pairs subject to human corrections. The latest relevant requirements take precedence: independent cross-connects, border leaves at the same level as rack leaves, both spines above, readable default zoom, compact boxes, and no flow dots.

`generation.json#/arrow_convention` and the corresponding section of `generation.md` explicitly state that arrow direction follows recorded `from → to` order **for physical connectivity**, not proof of one-way traffic. That satisfies the requirement to state the convention in the delivered explanation. The pane itself has no convention legend, so this explanation must accompany it; I do not impose an additional in-pane-legend requirement. In particular, BL → Spine arrows must not be reversed merely to simplify top-to-bottom routing. No reverse-traffic edge is required or invented.

`x-conn`, `act`, `stby`, and `FW2 stdby` retain the source meanings x-connect, active and standby. The variant spelling `stdby` is a readable abbreviation here, not a different role. ISP links remain unlabeled, correctly avoiding an invented protocol.

| View | Visible concepts | Required relationship group | Coverage |
|---|---|---|---|
| V1 | ISP A/B/C/D, MUX 1/2 | 4 ISP-to-MUX links | 4 complete visual audits pass. |
| V2 | MUX 1/2, Core 1/2 | 4 MUX-to-Core cross-connects | 4 pass. |
| V3 | Core 1/2, FW1 active/FW2 stdby, BL 1/2 | 4 Core-to-FW plus 4 FW-to-BL | 8 pass. |
| V4 | Spine 1/2, BL 1/2, Leaf 1/2, Rack 1/2 | 4 BL-to-Spine, 4 Spine-to-Leaf, 4 Leaf-to-Rack | 3 complete audits pass; 2 paths qualified and 7 other label associations ambiguous. |

MUX identities bridge V1/V2, Core identities bridge V2/V3, and BL identities bridge V3/V4. IDs and visible labels agree; no invisible connector is needed between those duplicated boundary nodes. All 18 concepts are visible. There is no observed extra directed relationship, no source-required bus, and no missing HA-interfirewall edge to invent: FW1–FW2 is not one of the frozen 28 relationships. All audited edges are independent links, not buses.

## Actual view, fit and selection evidence

Capture base: `docs/visualize-eval/rounds/01/datacenter-redundancy/captures/`.

| View | Final prefix | Capture-session start UTC | Actual graph extent [column,row,width,height] |
|---|---|---|---|
| V1 | `final-view1-20261102T083328Z` | 2026-11-02 08:33:28 | [17,18,44,13] |
| V2 | `final-view2-20261102T083335Z` | 2026-11-02 08:33:35 | [17,19,44,11] |
| V3 | `final-view3-20261102T083341Z` | 2026-11-02 08:33:41 | [6,19,66,11] |
| V4 | `final-view4-20261102T083348Z` | 2026-11-02 08:33:48 | [8,10,62,28] |

For each prefix, `-visible.txt/.ansi`, `-selected.txt/.ansi` and `-frame2.txt` are inventoried. Additional `final-view1c-20261102T083435Z-visible.txt/.ansi` and `-selected2.txt/.ansi` prove ISP B selection. All locations are 1-based `[column,row,width,height]`; route waypoints below use `(column,row)` and identify unit cells.

All final ANSI grids are 77 columns × 47 rows. Plain text omits the last blank row and trailing spaces but otherwise matches. The original `/tmp/vizdim-final-view{1,2,3,4,1c}.txt` probes each contain `47 77`; their original bytes and hashes are preserved in `verification.json`. Thus `live_pane` records the actual **77×47 PTY**, separately from the generator-reported **79×49 outer Herdr rectangle including chrome**. The outer rectangle is a report, not independently preserved raw layout output.

Blind Stage A correctly did not infer zoom from plain art. Stage B adds the frozen fresh-launch command and capture procedure: bare invocation of the frozen binary, no pan, zoom or `f` command, plus the recorded natural-100% state. Combined with the full-size fixed-character boxes, that supports the target natural-100% capture. There is no explicit percentage in the visible UI; I do not pretend there is. No later viewer run was used to repair that evidence.

Every node and label is inside the viewport; no graph overlaps the complete control box `[2,41,9,6]`. Full border details and every label rectangle are in unchanged `observed-first.md`. There are 24 displayed node instances across the views, representing 18 concepts. In the unselected captures, all have complete sides and four rounded corners with one RGB per perimeter, including both sides of V4 BL 2 `[31,24,6,4]` and both arrow-adjacent sides of Spine 1 `[18,12,9,4]`. This proves unselected correctness only; it does not prove how those nodes render when individually selected.

ANSI independently shows these selection changes:

| State | Entire selected border | Change |
|---|---|---|
| V1 selected | ISP A [17,18,7,4], 18 perimeter cells | Bold only; normal RGB already equals selection RGB. |
| V1c selected2 | ISP B [28,18,7,4], 18 cells | All change from (228,184,111) to (216,166,87), bold. |
| V2 selected | Core 1 [53,19,8,5], 22 cells | All teal → (216,166,87), bold. |
| V3 selected | BL 1 [66,19,6,5], 18 cells | All pink → (216,166,87), bold. |
| V4 selected | BL 1 [8,24,6,5], 18 cells | All teal → (216,166,87), bold. |

Labels, geometry and routes do not change in these five captured selected states. Uniform selection recoloring is not a border-integrity failure. However, these states prove only **5/24 selected node occurrences**, not full selected-state coverage.

### Existing selected-state proof and missing occurrences

A further read-only audit inspected **20 existing ANSI files** whose capture-log spec hashes match one of the four final specs, including matching pre-final renders, final V1b and V1c. Each selection was identified from that node's own complete bold perimeter and selection RGB—not from the node merely appearing in a frame with another selection. Matching pre-final/repeated frames select the same nodes and add no coverage. Plain-text `frame2` captures cannot establish the missing border colors or selected identity; different-spec renders cannot establish a final-view occurrence's selected state.

The following are the actual raw selected-state proofs, relative to the capture base above:

| View | Node occurrences with selected proof | Actual raw ANSI file | Missing selected occurrences |
|---|---|---|---|
| V1 | ISP A; ISP B (**2/6**) | `final-view1-20261102T083328Z-selected.ansi`; `final-view1c-20261102T083435Z-selected2.ansi` | ISP C, ISP D, MUX 1, MUX 2 (**4**) |
| V2 | Core 1 (**1/4**) | `final-view2-20261102T083335Z-selected.ansi` | MUX 1, MUX 2, Core 2 (**3**) |
| V3 | BL 1 (**1/6**) | `final-view3-20261102T083341Z-selected.ansi` | Core 1, Core 2, FW1 active, FW2 stdby, BL 2 (**5**) |
| V4 | BL 1 (**1/8**) | `final-view4-20261102T083348Z-selected.ansi` | Spine 1, Spine 2, BL 2, Leaf 1, Leaf 2, Rack 1, Rack 2 (**7**) |

Thus **24/24 unselected occurrences are proven correct, 5/24 selected occurrences are proven correct, and 19/24 selected occurrences lack evidence**. V2 Core 1 does not cover V3 Core 1; V3 BL 1 and V4 BL 1 are separate occurrences. No border defect was observed or added to the findings. `selected-state-coverage.json` records all 24 occurrences, all 20 scanned raw files, actual selection identities, raw hashes and precise selected perimeter rectangles. Border integrity is BLOCKED until the required selected evidence exists; the present instruction forbids creating it.

 Related hue families are consistent within a view; repeated identities change hues across views. The frozen rubric does not require a globally stable per-identity hue. In V4 the requested same-level BL/Leaf tier is teal, Spine is gold above, Rack is pink below. All four BL/Leaf tops are at row 24; BL 1's extra port row does not put it in another tier.

## Concrete failures

### F01 — high, arrow_traceability: BL 1 → Spine 2 (e18)

Evidence: V4 `-visible.txt` and `-visible.ansi`, `ECMP` `[14,21,4,1]`, interrupted vertical cell `[16,21,1,1]`, source stem `[14,27,1,1]`, target `◀` `[54,13,1,1]`.

The source route reaches column 16 and is visible immediately above and below row 21. The label occupies that would-be route cell. The rest wraps over the top at row 10 and reaches the Spine 2 arrowhead. The blind reading retained this as a strong candidate, not a complete independently verified association. The expected pair and JSON clarify what was intended, but do not restore the missing visible stroke. No direction reversal or bundled route is claimed; the defect is the missing independent full-path proof.

### F02 — high, arrow_traceability: BL 2 → Spine 1 (e19)

Evidence: V4 `-visible.txt` and `-visible.ansi`, interrupted horizontal region `[19,23,6,1]`, label `[20,23,4,1]`, source stem `[30,25,1,1]`, target `▶` `[17,13,1,1]`.

The inline ECMP text replaces four cells of the apparent row-23 route between crowded crossings. A reader can hypothesize the intended continuation, and JSON confirms that hypothesis as intent. Stage A did not count it as a complete trace, so Stage B does not upgrade it simply because the answer is now known. No source-required relationship is declared absent from JSON; this is an observed traceability failure.

### F03 — high, semantic_fidelity: seven unresolved label associations

Evidence: V4 label rectangles `[19,24,4,1]`, `[31,21,4,1]`, `[40,19,4,1]`, `[51,19,4,1]`, `[32,30,4,1]`, `[51,29,4,1]`, `[55,31,4,1]` in both visible formats.

The affected endpoint routes are e17, e21, e22, e24, e25, e27 and e28. Their endpoints and arrow direction are traceable, but their labels sit between or beside multiple routes. The eight ECMP strings and four dual strings are individually legible. Counting the strings or reading labels from JSON does not establish which visible relationship each labels. Identical words preserve a broad tier-level impression, not the rubric's reliable per-link label meaning. These seven audits fail for label association, **not** for missing arrowheads or shared corridors.

For contrast, the labels beside V4 BL 2 → Spine 2 at `[56,17,4,1]` and Spine 2 → Leaf 1 at `[50,22,4,1]` are locally associated strongly enough to pass. The `dual` at `[32,28,4,1]` is directly above the Leaf 2 → Rack 1 row-29 run; this visual association passes, regardless of which identical `dual` instance the generator intended it to be.

### F04 — medium, layout_fit: visible overlay occlusion

Evidence: the two text/route overlaps in F01/F02. Compactness and complete box fit are real strengths, but the frozen gate also prohibits overlay occlusion. This is a localized fit failure with recoverable intent; medium severity does not waive it. This finding records the second category affected by the same two locations, not two additional failed endpoint pairs.

## Crossings and apparent relations: what does not fail

- V1 has four separate stems and arrowheads and no crossing. Close corners near `[29,24,1,2]` do not merge the ISP links.
- V2 has a crossing at `[50,23,1,1]`; the adjacent bends at `[50,22,2,1]` are crowded but distinct. Both diagonal cross-connects remain traceable.
- V3 has crossings at `[43,25,1,1]` and `[63,23,1,1]`. The nearby corners remain separate. All eight endpoint paths are traceable.
- V4 has fourteen explicit hump cells: `[15,13,1,1]`, `[55,18,1,1]`, `[28,20,1,1]`, `[49,20,1,1]`, `[55,20,1,1]`, `[49,21,1,1]`, `[28,22,1,1]`, `[44,22,1,1]`, `[16,23,1,1]`, `[28,23,1,1]`, `[16,25,1,1]`, `[47,30,1,1]`, `[49,30,1,1]`, `[22,31,1,1]`. Their orthogonal continuations read as crossings, not source-named junctions.
- Adjacent `╯╰` cells `[28,25,2,1]` do not create BL 1 → BL 2. Adjacent verticals `[28,24,2,1]` are separate tracks. There is no extra apparent edge to add to the edge audit.
- The long top run `[15,10,41,1]` can initially resemble a frame but is not a closed group boundary. Wrap length and crossing count alone are not new failure conditions. The failure is the actual text interruption/attribution, not the mere existence of a backward edge.

## Where generator assertions differ from raw evidence

1. **V3 act/stby coordinates are transposed in generation coverage/D3.** Raw capture has `stby` at `[56,24,4,1]` beside the column-61 FW2 → BL 1 ascent, and `act` at `[65,24,3,1]` beside the column-63 FW1 → BL 2 descent. Blind Stage A read these correctly. I do not adopt the generator's coordinate swap or automatically fail these two edges because its self-audit says attribution is impossible.
2. **28 JSON pairs / 28 arrowheads does not mean 28 fully readable relations.** The report's complete-coverage claim conflicts with the blind-qualified V4 paths and label associations. Clean checks are not an exception to the rubric.
3. **Selection of ISP A is not entirely unchanged.** RGB is unchanged, but every perimeter cell becomes bold; V1c proves an additional RGB-changing selection.
4. **Files named `-header.txt` are not app headers.** Their content is the bottom control-box lines (`--lines 2` returned the tail). The real app header is preserved in each full visible capture, so app launch evidence is not missing.
5. **`frame2` is not proven unselected.** The script sends a second Tab, which cycles selection. The second frame is text-only, so the selected node cannot be established from that file. This does not invalidate the separately captured visible/selected ANSI states.
6. **Frame equality cannot prove lack of motion in general.** These snapshots are byte-identical, but samples can alias. Animation is N/A because the source switches it off and no flow is configured—not because equality measures speed or direction. Prefix timestamps mark capture-session starts; no independent clock value is preserved for each frame.
7. **A general backward-edge impossibility is not established.** The generator's failed alternatives and wrap complaint do not prove every supported layout is impossible. I record the failed frozen output and the required capability without asserting an unsupported global renderer limitation.

## Workflow evidence and coverage/cleanup blockers

All final checks are preserved with commands, timestamp `20261102T083542Z`, exact matching spec hashes, stdout, empty stderr and exit `0`. Their extents are 45×14, 45×12, 67×12 and 63×28 respectively. Those are check-reported extents, distinct from the literal occupied-cell bounding boxes above. The viewer was launched through the frozen absolute binary path using the stored self-closing Herdr procedure. No pane art was pasted into the judge's chat reply.

**B01: incomplete cleanup verification.** The generation record lists 25 created panes. The frozen capture log has 24 distinct `pane_after_quit: closed` records, including all four delivered views and V1c. The one exception is the initial `w7E:p37`: `generation.json` asserts that all panes closed and that a later layout listed only `w7E:p20`, but the raw close result or final layout output is not present in the case artifacts. I neither invent its closure nor assert a leak. `cleanup.status` and `workflow_evidence` remain blocked; `closed_pane_ids` lists only the 24 directly logged confirmations. The reviewer created no panes and did not query current state to replace missing frozen evidence.

**B03: incomplete selected-state evidence.** The existing frozen border gate applies to every node occurrence, including selected states. Only five of 24 occurrences have their own selected perimeter captured in ANSI. Nineteen remain unverified, as listed above. This blocks both complete border coverage and the workflow's complete-state evidence. Correct unselected borders and five correct selected instances remain established; no defect is alleged and no new rendering was performed.

**B02: unresolved output capability, not a proven impossibility.** The frozen V4 sample does not demonstrate label-safe traceability for all requested independent links. No required model/tool is missing or substituted. A future renderer or supported layout must demonstrate those same source pairs at the target without text-covered paths or detached labels. This review did not test alternatives or make a new rendering. The existing defects remain FAIL, not BLOCKED, regardless of how they could be repaired.

## Correction candidates — proposals only, no revision applied

### Skill-level candidates

- Keep the source edge inventory and cross-view boundary identities, but distinguish **present in spec**, **endpoint route visually traced**, and **label association visually established**. A generator must not collapse these into one `covered: true` field.
- Treat a text-covered route or label between several routes as unresolved, even when all labels in the tier have identical text. Ask the independent judge to read without the expected map first, as this evaluation did.
- Carry the physical-connectivity arrow convention alongside every split-view delivery. Do not reverse BL/Spine endpoints to accommodate layout or add reciprocal traffic edges not requested by this source.
- Preserve the initial/failed pane's raw closure or final-layout result as well as successful capture cleanup. Capture frame state and per-frame timestamps accurately; do not call a second Tab an unselected state.
- Clarify the skill's direction and layer-color advice: explicit source physical-connectivity semantics and human tier placement take precedence over generic producer/consumer language or the instruction to avoid backward edges. View-local color should not be advertised as a stable cross-view identity palette.

### Renderer-level candidates

- Prevent labels from occupying any route cell, including another edge's vertical run; reserve label footprints against routed paths, not merely against node boxes or other labels. The exact regressions are `[16,21,1,1]` and `[20,23,4,1]` in V4.
- Place a relationship label on an unmistakable isolated segment or attach it with a visible association. Simply finding free text cells or reporting zero dropped labels is insufficient.
- Consider route/label diagnostics that report intersections and ambiguous placement in addition to shared corridors and dropped labels. A clean current check missed the observed defects.
- Preserve the working independent ports, distinct arrowheads, hump crossing semantics and the five proven selected-border states; obtain coverage before claiming correctness of every selected occurrence. Explore better backward-edge layouts without changing endpoint meaning or merging redundant links. This is a candidate investigation, not a claim that one specific algorithm will fix every topology.

The captain must collect all eight complete case critiques before proposing or applying a new skill candidate. No renderer gains in this new baseline should be scored as a skill-only gain.

## Deliverables and verification

- `observed-first.md`: unchanged blind observation and full node/label/border inventory.
- `reviewer-result.json`: exact frozen result-schema structure, all seven categories, 28 required independent-link audits, four evidence-linked findings, blockers and cleanup records.
- `spec-manifest.json`: four final specs, deterministically sorted paths and hashes.
- `verification.json`: independent frozen-hash comparisons, complete spec-pair set comparison, check contents, current reviewer model environment, raw dimension-probe contents, and cleanup-record comparison.
- `critique.md`: this corrected review plus the complete unchanged edge audit appendix below.
- `selected-state-coverage.json`: read-only audit of 20 existing final-spec-matching ANSI files, with 5 proven and 19 missing selected occurrences.
- `superseded/pre-selected-state-coverage/`: archived pre-correction final JSON and critique, with original hashes recorded above.

No extra apparent edge was observed, so no invented `unexpected_link` record is included. All JSON evidence IDs, edge/finding references, capture regions, input hashes, and the embedded schema are checked offline by the reviewer helper. No viewer tests were run.

## Complete source-edge audit appendix

Each row below is based on the unchanged blind trace. The final waypoint is the visible arrowhead; the first is the visible source stem. All waypoints are capture `(column,row)` coordinates. The machine-readable audit additionally records source/target box rectangles, crossing cells, label rectangles, source references and finding IDs. An edge marked FAIL because of label ownership can still have a fully traceable endpoint path.

| Edge | Expected relation / meaning | View | Source stem → bends → target arrow | Decision |
|---|---|---|---|---|
| e01 | ISP A → MUX 1; unlabeled | V1 | (18,22) → (18,25) → (29,25) → ▼(29,26) | PASS |
| e02 | ISP B → MUX 1; unlabeled | V1 | (29,22) → (29,24) → (31,24) → ▼(31,26) | PASS |
| e03 | ISP C → MUX 2; unlabeled | V1 | (44,22) → (44,25) → (55,25) → ▼(55,26) | PASS |
| e04 | ISP D → MUX 2; unlabeled | V1 | (55,22) → (55,24) → (57,24) → ▼(57,26) | PASS |
| e05 | MUX 1 → Core 1; x-connect | V2 | (24,20) → ▶(52,20); x-conn [35,19,6,1] | PASS |
| e06 | MUX 1 → Core 2; x-connect | V2 | (24,22) → (50,22) → (50,26) → ▶(52,26); x-conn [34,21,6,1] | PASS |
| e07 | MUX 2 → Core 1; x-connect | V2 | (24,26) → (48,26) → (48,23) → (51,23) → (51,22) → ▶(52,22); x-conn [33,25,6,1] | PASS |
| e08 | MUX 2 → Core 2; x-connect | V2 | (24,28) → ▶(52,28); x-conn [35,27,6,1] | PASS |
| e09 | Core 1 → FW1; active | V3 | (14,20) → ▶(45,20); act [28,19,3,1] | PASS |
| e10 | Core 2 → FW1; active | V3 | (14,26) → (43,26) → (43,22) → ▶(45,22); act [27,25,3,1] | PASS |
| e11 | Core 1 → FW2; standby | V3 | (14,22) → (41,22) → (41,25) → (44,25) → (44,26) → ▶(45,26); stby [25,21,4,1] | PASS |
| e12 | Core 2 → FW2; standby | V3 | (14,28) → ▶(45,28); stby [27,27,4,1] | PASS |
| e13 | FW1 → BL 1; active | V3 | (58,20) → ▶(65,20); act [60,19,3,1] | PASS |
| e14 | FW1 → BL 2; active | V3 | (58,22) → (63,22) → (63,26) → ▶(65,26); act [65,24,3,1] | PASS |
| e15 | FW2 → BL 1; standby | V3 | (57,26) → (61,26) → (61,23) → (64,23) → (64,22) → ▶(65,22); stby [56,24,4,1] | PASS |
| e16 | FW2 → BL 2; standby | V3 | (57,28) → ▶(65,28); stby [59,27,4,1] | PASS |
| e17 | BL 1 → Spine 1; ECMP | V4 | (14,25) → (28,25) → (28,13) → ◀(27,13); nearby ECMP [19,24,4,1] ambiguous | FAIL F03, label only |
| e18 | BL 1 → Spine 2; ECMP | V4 | Candidate: (14,27) → (16,27) → **text gap at (16,21)** → (16,14) → (15,14) → (15,10) → (55,10) → (55,13) → ◀(54,13) | FAIL F01/F04 |
| e19 | BL 2 → Spine 1; ECMP | V4 | Candidate: (30,25) → (29,25) → (29,23) → **text gap [20,23,4,1]** → (15,23) → (15,22) → (13,22) → (13,13) → ▶(17,13) | FAIL F02/F04 |
| e20 | BL 2 → Spine 2; ECMP | V4 | (37,25) → (44,25) → (44,21) → (55,21) → (55,15) → ◀(54,15); ECMP [56,17,4,1] | PASS |
| e21 | Spine 1 → Leaf 1; ECMP | V4 | (19,16) → (19,22) → (47,22) → ▼(47,23); ECMP [31,21,4,1] between routes | FAIL F03, label only |
| e22 | Spine 1 → Leaf 2; ECMP | V4 | (21,16) → (21,20) → (63,20) → ▼(63,23); ECMP [40,19,4,1] ownership uncertain | FAIL F03, label only |
| e23 | Spine 2 → Leaf 1; ECMP | V4 | (46,17) → (46,19) → (49,19) → ▼(49,23); ECMP [50,22,4,1] | PASS |
| e24 | Spine 2 → Leaf 2; ECMP | V4 | (48,17) → (48,18) → (65,18) → ▼(65,23); ECMP [51,19,4,1] between routes | FAIL F03, label only |
| e25 | Leaf 1 → Rack 1; dual | V4 | (47,28) → (47,31) → (20,31) → ▼(20,33); dual [32,30,4,1] between routes | FAIL F03, label only |
| e26 | Leaf 2 → Rack 1; dual | V4 | (63,28) → (63,30) → (45,30) → (45,29) → (22,29) → ▼(22,33); dual [32,28,4,1] above row-29 run | PASS |
| e27 | Leaf 1 → Rack 2; dual | V4 | (49,28) → (49,31) → (48,31) → (48,32) → (47,32) → ▼(47,33); dual [51,29,4,1] ambiguous | FAIL F03, label only |
| e28 | Leaf 2 → Rack 2; dual | V4 | (65,28) → (65,32) → (49,32) → ▼(49,33); dual [55,31,4,1] between routes | FAIL F03, label only |

No Stage B endpoint association was filled in solely from the expected topology. All 28 pairs remain physical-connectivity relationships; their displayed arrow directions follow the stated convention, not a claim of unidirectional traffic.
