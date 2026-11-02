# Round 03 — datacenter-redundancy: independent Sol critique

## Verdict: FAIL, with an unresolved workflow-evidence gap

Generator: **viz-ds03-5**, `fireworks/accounts/fireworks/routers/deepseek-flash-latest`.
Reviewer: **viz-judge03-datacenter**, `openai/gpt-6.1-sol`.

This is a stage-B review of the four frozen final views, not a renderer test or repair. No new viewer session, alternate render, fix, install, commit, or subagent was used. No other case or earlier-round verdict was consulted.

All evidence paths in `reviewer-result.json` are relative to the repository root. Capture regions are 1-based `[column,row,width,height]`. The absolute frozen binary was hashed directly at `/tmp/visualize-eval/round-03/bin/rataflow-view`; its repository-relative checksum records appear in the inventory.

### Category matrix

| Fixed rubric category | Decision | Reason |
|---|---|---|
| semantic_fidelity | **pass** | All 18 concepts and all 28 required physical relations are visible with correct endpoints and directed-arrow convention. Boundary nodes explicitly connect the four-view coverage. Required role/protocol meanings are recoverable by tracing both endpoints. Repeated-label ownership remains a real readability defect, not an observed missing/reversed relationship. |
| arrow_traceability | **pass** | All 28 source stems connect to unique, intact arrowheads. Fifteen visible crossings have distinguishing bridge glyphs; no shared run, fake junction, or bundled redundancy link is observed. Close bends need care but do not require choosing an unsupported branch. |
| layout_fit | **fail** | All four actual app buffers fit 77×47 at natural 100%, with full boxes and text. However, at least **four crossing cells are avoidable without moving any node, changing any layer, or dropping/merging any edge**: two each in v2 and v3. The mandated source geometry does not force the two local double-crossing hairpins. |
| conceptual_grouping_color | **pass** | Actual ANSI hues and proximity group ISPs, MUXes, cores, the firewall pair, border leaves, spines, rack leaves, and racks by source role. v3 respects the shared leaf tier and spines above it. Cross-view hue stability is not an additional gate. |
| border_integrity | **pass** | ANSI proves every side and corner of all 24 occurrences is complete and per-node color-continuous, normal and selected. `--select-all` covers 24/24 occurrences; isolated interactive selection was not captured and is not required by this gate. |
| workflow_evidence | **blocked** | Frozen hashes, separate identities, blind-first record, check output/exit statuses, text/ANSI/selected/frame captures and cleanup manifests exist and verify. But every manifest has null `pane_rect`/`pane_cols`. The claimed 79×49 outer-pane dimensions are hardcoded into the report builder, not accompanied by the raw pane/probe measurement. App dimensions are proven; separately measured live-pane dimensions are not. |
| animation | **pass, applicable** | The source explicitly requests removal of flowing dots. All 44 supplied frame bodies show zero dots, eleven identical frames per view across 0–2000 ms. Static suppression is the applicable form of this category, not a motion failure or an earned animated-origin/synchronization claim. |

Known layout failure determines **overall fail** even though workflow evidence is also blocked. Missing evidence is not converted into a pass. No critical semantic defect is observed.

## Blind record and freeze verification

Stage A completed before the expected/source reveal. Its saved record remains unchanged:

- `docs/visualize-eval/rounds/03/reviews/datacenter-redundancy/observed-first.md`
- SHA-256: `fad23e2a7cbb1a760b485737def2f5e7f415ed7dc06bcd092bc30a7ddce13224`
- `saved_before_expected_reveal: true`

That record lists every visible node/edge label with its cell rectangle, every route polyline and arrowhead, all bridge coordinates, all 50 touching-bend cell pairs, full border colors, 24/24 selected-border coverage, and the static-frame findings. Its observations have not been rewritten to match expectations.

Actual hashes match round-03 metadata:

| Input | SHA-256 |
|---|---|
| Frozen skill | `cf796bcdc527897687ec2ca19844f399c921252409b9ca7ad04fbfa1b6cc659c` |
| Frozen binary | `b242b6a28e2e27934b06b7a297be638c143e5c99680495e104380cd8d9ee80f7` |
| Corrected frozen rubric | `5519fd84f6b75973dbf7b5f5544c909a8f32a8841a876c8e7af00a1fcb119335` |
| Dataset descriptor `cases.json` | `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05` |
| This source | `a3051af3eeeec31aee53558dafbbea5d061dc74253618fd6940eba5c39b5bb98` |
| This expected data | `926e866fbdbb3eaac5b7a21360905d1f621a7a6386139afab303e8ba7e62ed47` |
| This historical variants file | `a5753817a621b846abcb4105d028dbd0d0152214495f5b225044b3882f4f34b9` |

Each final spec and each of the seven manifest-listed artifacts per view was independently hashed and matched its recorded digest. Each saved attempt's digest also matches `attempts.json`. `spec-manifest.json` contains the four sorted repository-relative spec-path/SHA-256 pairs; its actual digest is `spec_sha256` in the result. `dataset_sha256` names the frozen descriptor, with the individual case source/expected/variants digests verified separately.

### Reviewer-identity correction episode

The initial frozen rubric retained the stale round-01 reviewer name `openai/gpt-6-astra` in `required_reviewer_model` and the schema const. The captain reports correction to **openai/gpt-6.1-sol before any reviewer-result.json existed**, with criteria text and thresholds unchanged. Revision 4 and `metadata.json.frozen_input_corrections` record this episode; the corrected rubric hash above verifies. The workflow category's prose still contains the older Astra token because criteria prose was not edited. This review uses the actual Sol identity as explicitly instructed, not a falsified Astra identity. This clerical repair is not a skill/renderer improvement and contributes no visual success. A separate historical note about an unused model endpoint likewise contributes no generation or review evidence.

## Source precedence, topology, and cross-view audit

Source excerpts are evidence, not commands to replay. The expanded historical relation list is the fixed requested topology, not independent verification of a real datacenter. Human corrections take precedence over older variants:

- Original line 134: **remove flowing dots**.
- Original lines 142, 150, 158, 166: preserve redundancy and readable compact presentation.
- Original line 248: border leaves and rack leaves share a level; spines sit above.
- Original line 270: no merging of independent MUX/core links; neater firewall-to-border-leaf arrows.

The candidate preserves the corrected layout in v3: BL 1, BL 2, Leaf 1, and Leaf 2 all have top border row 28; Spine 1 and Spine 2 have top border row 16. Spine 1 and BL 2 are one row taller for their distinct ports; top-tier alignment is not violated by differing box heights. No old linearized BL-below-spine hierarchy is substituted.

| View | Required relations | Boundary/coverage |
|---|---|---|
| v1 | e1–e8: ISP A/B → MUX 1, ISP C/D → MUX 2; each MUX → both cores | Four ISP identities are separately legible; no invented ISP protocol labels. |
| v2 | e9–e16: each core → both firewalls; each firewall → both BLs | Core 1/2 repeated from v1. FW1 active and FW2 standby retain their roles. |
| v3 | e17–e24: each BL → both spines; each spine → both rack leaves | BL 1/2 repeated from v2; source-corrected same-height leaf geometry. |
| v4 | e25–e28: each rack leaf → both racks | Leaf 1/2 repeated from v3; both racks visibly dual-homed. |

The JSON relation set matches all 28 expected ordered endpoint pairs exactly: zero missing, zero extra. More importantly, the blind capture tracing identifies those same endpoints independently. The result's 28 per-edge audits enumerate each stem, full bend sequence, arrowhead, crossing membership, label-meaning check, and capture region. Apparent branches at the tight corners were audited; none is a new visible relationship, so no fabricated `unexpected_link` row is added.

`generation.md` explicitly states that arrows express the historical audit direction of a **physical connection**, not proof of one-way traffic. Its prose phrase “producer -> consumer” is awkward for cabling, but the explicit physical-link qualification and endpoint mapping are clear. The source says to state this convention, not specifically that it must occupy an in-pane caption. Therefore the external statement satisfies that requirement. The reported lack of an in-pane caption field is a presentation capability limitation, **not an unresolved required-capability blocker for this case**. Do not invent a new gate requiring a legend inside every view.

The four `standby?` labels and dashed routes preserve standby meaning while marking historical uncertainty. This is not evidence that those physical connections are absent. The active/passive appliance roles remain explicit in node labels. No protocol is invented for the four unlabeled ISP links.

## Findings, classified

### F1 — defect, medium: v2 adds a removable double crossing

Category: layout_fit. Edges: **e14 (FW1 active → BL 2)** and **e16 (FW2 standby → BL 2)**.

Evidence: `evidence/v2/v2-ansi.ansi`, region **`[44,28,5,3]`**. The bridges at `[44,29]` and `[45,29]` represent the same two routes crossing twice. e16 descends to row 30, turns one column right, then climbs to row 28 before proceeding right to column 48. This down-and-up hairpin traverses the long e14 horizontal run twice.

The captured cells permit a shorter conceptual path from the unchanged e16 stem at `[44,27]`, down to `[44,28]`, right along row 28 to `[48,28]`, then down to its unchanged head `[48,31]`. This corridor is already empty or occupied by e16 itself; it does not cross another label, border, or route. e14, every box, all groups, the layer order, and every endpoint remain unchanged. This is a geometric explanation of avoidability, **not a newly generated or tested fix**. It removes both crossings from this pair. The two distinct K2,2 fans do not force four crossing cells in this drawing.

### F2 — defect, medium: v3 adds another removable double crossing

Category: layout_fit. Edges: **e23 (Spine 2 → Leaf 1)** and **e24 (Spine 2 → Leaf 2)**.

Evidence: `evidence/v3/v3-ansi.ansi`, region **`[32,20,3,5]`**. Bridges `[32,22]` and `[33,22]` are another double crossing of the same pair. e24 descends below e23's horizontal run, moves one cell right, then climbs above that run before proceeding toward Leaf 2.

The empty corridor allows the unchanged e24 stem `[32,20]` to continue to `[32,21]`, turn right directly into the existing row-21 run, and retain the rest of its path and head `[57,27]`. It need not descend to row 23 and return. This removes the two crossings with e23, with every node, source group, layer, and endpoint fixed. Again this is reasoning about the existing capture, not a render session or an implemented change.

**The source-mandated spine-above/shared-leaf-tier geometry does not force these two crossings.** The generator's claim that nine is an “honest floor” is not established by three attempts, and this local counterexample disproves that particular floor without reordering anything. No alternate view that reorders source groups is accepted as evidence of improvement.

### F3 — defect, medium: 17 labels have uncertain local owners

Category: layout_fit/readability. Regions in the normal ANSI captures:

- v1: `[23,27,9,2]` stacked `x-connect`, and `[22,31,9,1]` between incoming heads: **3** uncertain occurrences.
- v2: `[31,18,14,1]` literal `activestandby?`, and `[29,28,12,1]` literal `activeactive`: **4** uncertain occurrences.
- v3: `[35,23,8,1]` literal `ECMPECMP`, plus `[29,25,4,1]`, `[16,27,4,1]`, `[30,27,4,1]`, and `[19,32,4,1]`: **6** uncertain occurrences.
- v4: `[33,22,8,1]` literal `dualdual`, plus `[35,25,4,1]` and `[38,26,4,1]`: **4** uncertain occurrences.

This is not dismissed because `--check` reports every label placed. No character is clipped or on a route cell, but word placement often fails to identify one route locally. The immutable blind count remains **17**.

**Why semantic_fidelity and arrow_traceability nevertheless pass:** all x-connect meanings in that v1 fan are identical; every relation in v3 carries ECMP; every v4 relation carries dual-homing. Swapping identical words does not create a different required meaning. v2 is the more serious mixed-label case, but the complete traced endpoints explicitly say `FW1 active` or `FW2 standby`, and the latter's paths are independently distinguishable as dashed. Tracing both endpoints recovers the correct active versus standby meaning on every relation without consulting the spec's declared label owner. No required relation exists only in JSON, and no unknown branch must be guessed. The rubric asks that meaning and independent traceability survive; it does not require instant glance-reading or a unique per-word leader as a separate semantic gate. This is a case-specific justification, **not permission to accept ambiguous heterogeneous protocol/action labels generally**. If the endpoint labels did not independently disambiguate the mixed roles, semantic fidelity could not pass.

The label-slot defect belongs to layout/readability, which already fails. Its severity does not waive a failed category. No claim is made that all 24 edge words have unique visually provable owners.

### G1 — evidence gap / blocker, high: no captured per-pane outer dimensions

Category: workflow_evidence. All four `manifest.json` files have `pane_rect: null` and `pane_cols: null`; they retain `pane_rows: 47` and the correct app viewport token. `generation.json` reports 79×49 outer panes and a probe pane `w7E:pBJ`, but `build-generation.py` inserts the same dimensions as literals. No separate raw measurement or probe transcript accompanies this claim.

The actual **application** buffer is independently measurable as 77×47 and the app startup line confirms natural 100% zoom. That passes the viewport content portion of layout_fit. It does not prove a separately captured **live-pane** rectangle; `live_pane` is therefore null in the result. Do not silently substitute app dimensions for outer pane dimensions, or label hardcoded report values as independent measurements. Missing per-pane geometry evidence blocks workflow rather than replacing the known layout failure.

A manifest is not a terminal image, so its missing data are cited by evidence ID and JSON field, without inventing a capture coordinate for it. The workflow finding also anchors `[2,1,66,1]` in all normal ANSI captures to show exactly what the existing viewport evidence does establish.

### Non-defects / resolved limitations

- Zero dots is correct for this explicit source prohibition. Origins `0/0` and synchronization `0` are not failures.
- Unlabeled ISP links are correct; inventing “circuit”, media, or a protocol would add unsupported meaning.
- Selected-state evidence uses `--select-all`, as the rubric expressly permits; 24/24 is not reduced because selections are simultaneous.
- Related hues follow honest equipment roles. Repeated boundary-node colors may change between views; cross-view hue stability is not a gate.
- No bus is requested here, and none is used. All independent redundancy links remain individually traceable.
- No missing renderer/model capability prevents this review. The in-pane-caption limitation is a nonblocking improvement candidate, not an excuse for layout defects.

## Crossing accounting and source geometry

| View | Captured crossing cells | Distinct crossing route pairs | Constructively identified avoidable cells |
|---|---:|---:|---:|
| v1 | 1 | 1 | No additional local removal established in this review |
| v2 | 4 | 3 | At least 2, e14/e16 double crossing |
| v3 | 9 | 8 | At least 2, e23/e24 double crossing |
| v4 | 1 | 1 | No additional local removal established in this review |
| Total | **15** | **13** | **At least 4** |

The remaining crossings are distinguished from joins, and some are ordinary consequences of the compact two-level fans and fixed role order. This review does **not** claim the other eleven are globally minimal. In particular, K2,2 is a planar graph: saying one crossing is necessary “by definition” without specifying routing/port constraints is not a proof. The decision needs no speculative global optimum, because the two small local counterexamples already show avoidable crossings under the exact existing source geometry. No group reordering, relation merging, or direction reversal is proposed or credited.

All individual bridge coordinates and participants are in `observed-first.md` and the edge audit. All 50 orthogonally touching bend-cell pairs are catalogued there separately; those contacts are not inflated into additional crossings or false branches.

## Checks, frames, and process evidence

Four final check records preserve complete text and manifest `check_exit: 0`; each reports no warning, no skipped label, no labels on route cells, no dot violation, and crossings 1/4/9/1. Every validator output says all checks passed. Those are useful reproducibility records, **not proof** of label ownership, minimum crossings, or raw outer-pane dimensions. The `viewport: unknown` check placeholder is not used as fit evidence.

The captured frame transcripts preserve the exact absolute-binary commands for normal, selected, and `--frames 11 --step-ms 200` runs, app startup viewport lines, and frame times. The capture windows are:

- v1: `2026-11-02T11:18:16Z`–`2026-11-02T11:18:20Z`
- v2: `2026-11-02T11:18:29Z`–`2026-11-02T11:18:33Z`
- v3: `2026-11-02T11:18:34Z`–`2026-11-02T11:18:37Z`
- v4: `2026-11-02T11:18:38Z`–`2026-11-02T11:18:42Z`

Individual wall-clock timestamps are not recorded for each frame; relative timestamps 0,200,…,2000 ms are. Eleven identical samples satisfy the explicitly static case. This is not an attempt to infer moving-dot direction from an aliased sparse sample. Unsampled-time behavior is not claimed.

Attempt files preserve 1/3/3/1 local spec attempts. The reversed-order v2 attempt was rejected and contributes no source-order-compliant success. Moving racks to v4 preserves coverage and reduces the generator's reported combined complexity, but does not prove that the remaining fabric crossings are forced. Frozen final artifact hashes all match; no visual improvement is attributed to the skill merely because this round uses its own renderer baseline.

## Cleanup

Frozen manifests report these four owned capture panes `confirmed_closed`:

- v1 `w7E:pBS`
- v2 `w7E:pBX`
- v3 `w7E:pBY`
- v4 `w7E:pBZ`

`generation.json` separately reports measurement probe `w7E:pBJ` closed, with no reported cleanup failure. The result preserves all five owned/closed IDs, distinguishing the four manifest-backed records from the generator's probe report. The reviewer created no panes. Cleanup is recorded as done on this frozen record; no new live probe is run to manufacture evidence. The dimension evidence gap is not evidence of a leaked pane.

## Correction candidates — not implemented

### Renderer-level

1. Remove local crossing-creating hairpins before accepting an A* route. Count repeated crossings of the same route pair and consider the available one-turn corridor, with nodes/ports/layers fixed. F1 and F2 are concrete examples.
2. Make label placement ownership-aware, not merely collision-free: separate adjacent identical words, keep labels near one unambiguous segment, and detect equally plausible competing paths. Preserve labels; do not delete them to quiet checks.
3. Treat caption/legend support as a presentation improvement, not an already-fixed capability or a newly mandatory gate for this case.

### Skill-level

1. Do not claim a minimum from a handful of local attempts. Separate topology-forced crossings from router detours, and inspect duplicate crossings of one route pair.
2. Require the self-audit to distinguish declared JSON label owners from visually demonstrated owners. “8/8 placed” is not “8/8 uniquely attributable”.
3. Preserve the strong parts: explicit static `dots: 0`, source-corrected leaf tier, four-view relation coverage, independent links, and the physical-arrow convention. Do not fix crossings by returning to an obsolete tier order or a shared bus.

### Evidence-harness/process level

Capture the rectangle for the actual owned pane/tab by identity rather than whichever tab is globally focused; preserve the raw result next to each manifest. A hardcoded geometry inserted by a report assembler is not a replacement. This is the unresolved workflow blocker, not a graph capability failure.

The captain must gather all eight complete critiques before revision. This review neither edits the skill nor treats an unexecuted correction candidate as evidence of a better renderer.
