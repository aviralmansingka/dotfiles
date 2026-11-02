# Network — round 04 independent Sol critique

## Verdict: FAIL

**Four categories pass, two fail, and one is blocked.** The static diagram preserves the network meaning and fits the target pane. The animated origin, corner, and physical-speed evidence fails the fixed rubric. Workflow evidence is incomplete. Neither green checks nor a passing validator changes these observations.

| Fixed category | Decision | Reason |
|---|---|---|
| semantic_fidelity | **pass** | Six required nodes and all seven required directed links and label meanings are visible. Core→Redis and Web→Redis remain separate. No extra apparent link. |
| arrow_traceability | **fail** | All seven static routes are readable, but every frame-0 dot starts one drawn cell late. The rubric explicitly makes that a failed direction proof. |
| layout_fit | **pass** | Measured live ANSI is 77×47; app header says `77x47 @100%`; pinned motion says `viewport: 77x47 zoom: 1.00 natural`. Every complete box, label, and route fits without overlay occlusion, pan, or zoom. |
| conceptual_grouping_color | **pass** | Source-supported role groups and blue data-store family remain legible. WAN's selection-color collision is a usability concern, but does not establish false conceptual grouping under this fixed category; selected weight changes are captured. |
| border_integrity | **pass** | All six complete borders are color-continuous in normal and selected ANSI, including every corner. Selected coverage is 6/6 final-view node occurrences. |
| workflow_evidence | **blocked** | Reproducible hashes, blind-first record, live dimensions, capture/check windows, final check exit, and pane closure are present. Complete long-route laps and parts of rejected/probe execution provenance are not. |
| animation | **fail** | Seven late origins, two corner-occupied routes, and unequal physical grid travel despite equal update cadence. This is not a failure for unequal arrival times. |

The seven per-edge audits are `fail` **only because the arrow-origin proof clause applies to each animated link**. Their static endpoints, labels, and directions are correct; I am not claiming seven reversed or missing source relations.

## Identity, frozen inputs, and path convention

- Generator: **`viz-ds04-2`**, model **`fireworks/accounts/fireworks/routers/deepseek-flash-latest`**, as assigned by the captain and confirmed by round configuration. I did not replace this actual worker identity with the generic name in the task template.
- Reviewer: **`viz-judge04-network`**, model **`openai/gpt-6.1-sol`**.
- Round: integer **4**.
- The rubric's workflow prose retains a stale `gpt-6-astra` name. Its top-level required model, result schema, revision note, and the explicit task require Sol. The actual reviewer is Sol; this is not grounds to substitute a model or falsify identity.
- Evidence paths in `reviewer-result.json` are **repository-relative**, from the root of this dotfiles worktree. Capture regions are 1-based `[column,row,width,height]`, with the application header included as row 1. For multi-frame evidence, regions are within the specified frame's viewport, not line numbers in the concatenated dump.
- The external binary is identified by the `renderer_sha256` field, the preserved `bin.sha256` record, and frozen metadata. Its existing bytes were hashed, not executed. It was not copied, rebuilt, or replaced.

Verified hashes:

| Input | SHA-256 |
|---|---|
| Frozen candidate skill | `ac431c6d3035e466e29136f36d9579c551c2e070a354dc5df72999b1bb1beb3c` |
| Existing frozen renderer binary | `0da16d8d8ed46e2a25eb773fc71ecad4de9e310cd33e303a4c7fe77231ad95bc` |
| Round-04 rubric | `18412615f82841b34cf131976c6b5f4b00cd4fc031a710cdfc81058e2dd68d10` |
| Dataset manifest | `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05` |
| Final single spec `network/specs/v1-a3.json` | `3a2a475ace1149a25048717a2c01e6df4971e74002642b38266baeca8f90f2a3` |
| Saved blind record | `5e859582d424fc430d3625949b67f4b56ec56ea4176ef0779d1b8cabc496dccf` |

The source, expected data, historical variant, and every artifact hash in the capture manifest also match their frozen records. The JSON inventory contains actual hashes for 45 evidence files, including the blind record. `observed_first.saved_before_expected_reveal` is **true**, because stage A completed and its hash was reported before the reveal. The blind file has not been changed.

The historical network spec is qualified evidence of this task's relationships, not independent verification of a real network. The fixed source constraint overrides the old speed-scaled animation: link speeds belong in text, not quantitative dot-speed encoding.

## Deep source-to-capture audit

All six node labels appear verbatim:

| Concept | Label region | Full box |
|---|---|---|
| WAN | [35,3,3,1] | [34,2,5,4] |
| Firewall | [33,11,8,1] | [32,10,10,4] |
| Core switch | [31,19,11,1] | [30,18,13,4] |
| Web tier | [33,27,8,1] | [32,26,10,4] |
| Redis | [20,36,5,1] | [19,35,7,4] |
| DB tier | [52,44,7,1] | [51,43,9,4] |

These regions are in `network/evidence/v1/v1-text.txt` and both normal/selected ANSI captures. The complete verbatim label inventory, including the header and palette, remains in the sealed blind record.

Every required relationship has a distinct source stem and unique downward `▼` immediately above its target box:

| Edge | Required relationship / meaning | Actual source-border port → first external cell | Target arrowhead | Label region |
|---|---|---|---|---|
| e1 | WAN → Firewall, `1 GbE` | (35,5) → (35,6) | (33,9) | [37,7,5,1] |
| e2 | Firewall → Core switch, `10 GbE` | (33,13) → (33,14) | (31,17) | [35,15,6,1] |
| e3 | Core switch → Web tier, `10 GbE` | (33,21) → (33,22) | (33,25) | [35,23,6,1] |
| e4 | Core switch → Redis, `25 GbE` | (31,21) → (31,22) | (20,34) | [23,23,6,1] |
| e5 | Web tier → Redis, `session` | (33,29) → (33,30) | (22,34) | [25,32,7,1] |
| e6 | Web tier → DB tier, `queries` | (35,29) → (35,30) | (54,42) | [41,39,7,1] |
| e7 | Redis → DB tier, `fill` | (20,38) → (20,39) | (52,42) | [34,42,4,1] |

`reviewer-result.json` contains a full polyline, label location, arrowhead region, frame-0 dot location, source references, and finding IDs for every edge. The sealed blind record enumerates all twelve ordinary route bends.

There are **zero bridges, crossings, touching bends between routes, junctions, shared runs, or fake branches**. The two Core switch exits and two Web tier exits are separate ports, not a shared bus. Redis and DB tier each receive two separate arrows. No named bus is required here. There is no extra apparent relationship to audit.

Every route is monotone between its specified source and target ports. The long left Redis approach and right DB approaches do not loop or reverse. No shorter-than-Manhattan path exists between the same endpoints, so there is no observed avoidable route detour to add to the origin failure. Small upper doglegs remain traceable. This agrees with `7/7 near-minimal, 0 detours`; `1 shortened` describes planning, not a remaining detour.

All seven labels have clear owners. The two `10 GbE` strings are source-required on two different hops, not an accidental duplication or label-ownership defect. `session` sits above its own horizontal route; `queries` sits above the upper DB-bound horizontal; `fill` sits below the lower one. No label is on a route cell.

## Findings and classifications

### F01 — DEFECT, high: all seven origins fail both animation and arrow-direction proof

Primary evidence: `network/evidence/v1/v1-frames-77x47.txt`, **frame 0**; independently recovered box borders from all captured frames.

| Edge | First drawn cell after true source border | Actual frame-0 dot |
|---|---|---|
| e1 | (35,6) | (35,7) |
| e2 | (33,14) | (33,15) |
| e3 | (33,22) | (33,23) |
| e4 | (31,22) | (31,23) |
| e5 | (33,30) | (33,31) |
| e6 | (35,30) | (35,31) |
| e7 | (20,39) | (20,40) |

Every dot occupies the **second drawn cell**, not the first. For WAN, the region [35,5,1,3] contains its actual bottom-border cell, a visible external `│`, and then the dot. Equivalent three-cell vertical regions are supplied for every edge in the JSON finding.

The generator helper shifts every supposed source port down one row, calling the first external route cell a port. Its `7/7` calculation therefore checks the wrong boundary.

**The check line `origins: 7/7 routes start at their arrow origin` and the capture disagree.** The line cannot override the actual cells. Under the explicit round-04 arrow-traceability clause, this fails the direction proof as well as animation, even though the static arrowheads make intended directions recoverable. No semantic reversal is asserted.

### F02 — DEFECT, medium: two dots rest on corners

Primary evidence: the pinned dump, **frames 4,5,10,11,16,17**, and the normal live ANSI still.

- e1 dot at **[33,8,1,1]** replaces `╭`.
- e2 dot at **[31,16,1,1]** replaces `╭`.

The underlying corners are visible in other frames. There are **two affected routes, two distinct corner cells, and twelve corner-dot observations**. Each affected position remains occupied in two consecutive 100 ms samples. This is not merely a theoretical path touching a corner; the dot actually replaces the bend glyph in the captured drawing.

**The check's `0 violations` claim and the captures disagree.** No bridge, graph-label, box, or arrowhead dot collision was observed within the supplied window.

### F03 — DEFECT, medium: uniform update cadence is not uniform physical grid speed

Primary evidence: the pinned dump, frames 0–20, plus the sealed blind record's independently measured route-index table.

Every odd frame repeats the preceding even frame, so all dots share a 200 ms update cadence. But some updates jump two drawn path cells:

- e1, frame 0→2: **(35,7)→(34,8)**, skipping corner (35,8).
- e3 over the same interval: **(33,23)→(33,24)**, only one cell.
- e6, frame 16→18: **(35,39)→(36,40)**, skipping corner (35,40).

Six routes show an observed two-cell forward jump; only straight e3 does not. Each of e4–e7 advances **eleven** actual route cells over the 20 captured time steps, not the helper's claimed ten. That interval averages 0.55 physical route cells per 100 ms, with nonuniform local travel rather than the advertised uniform 0.5. The small doglegs repeat their sampled positions every 600 ms, while e3 repeats every 400 ms.

This is a physical character-grid measurement, not a comparison of array-update counts. The generator's equal count of ten updates does not prove equal distance. The numeric flow settings are not proportional to the 1/10/25 GbE labels; I do not claim a critical bandwidth-encoding error.

### F04 / B01 — EVIDENCE GAP, high: no full lap for four long routes

The pinned 77×47 dump has all 21 frames, including frame 0, but its **0–2000 ms** span is not a complete constant-mode lap for e4, e5, e6, or e7. These routes contain 24, 16, 32, and 36 drawn cells respectively; at frame 20 their dots are still well before their target ends. No dot is observed on any arrowhead during this window.

The skill's assertion that 21 constant-mode frames cover the longest route, and the generator's “whole cycle” description, are contradicted by the captures. Whole-lap corner/head behavior of the long routes is missing evidence, not demonstrated correctness.

This blocks complete workflow evidence. **It does not impose synchronized arrival.** The source requests slow sparse motion, not same-arrival timing; round 04 permits unequal arrival times. Animation remains a known **fail**, not merely blocked, because F01–F03 are already visible.

### F05 / B02 — EVIDENCE GAP, high: incomplete rejected/probe execution provenance

Preserved material is substantial: all three named candidate specs, raw rejected v1-a2 check output, final checks, numerous geometry dumps, capture timestamps, final harness exit 0, artifact hashes, and recorded pane closure. The accepted capture command and pinned motion command are recorded in `generation.json`.

The remaining gaps are concrete:

1. `attempts.json` references **`dumps/probe-webcache_same.txt`**, which is absent. `dumps/probe-webcache_same.json` exists, but it is a spec, not its rendered output.
2. `generation.md` mentions a **two-node synthetic diagnostic**; no corresponding raw spec/output/command record is preserved in this bundle.
3. Exact per-probe commands, timestamps, and exit/status/stderr records are not fully preserved. In particular, the raw rejected `v1-a2.check.txt` is retained, but its standalone executed command/exit/stderr record is not. The final harness check's exit 0 is not evidence for another execution's status.

These are missing provenance, not proof that an unknown execution failed. They block `workflow_evidence`. They have no meaningful viewport rectangle, so the JSON finding supplies references but does not invent a spatial region. No viewer or diagnostic was rerun to reconstruct missing history.

## Color and other observations that do not add failed gates

### WAN accent collision: non-gating presentation concern under this rubric

Normal WAN border uses **#d8a657**, also the dot and selection foreground. The normal state can therefore look preselected on color alone. The generator calls its selection change invisible, but ANSI proves a real difference: every normal WAN border cell is non-bold and every selected WAN border cell is bold. This covers all 14 WAN border cells, not a single sample. The five other nodes change foreground as well as weight.

I place this observation in the grouping/color judgment, not border integrity. The source-supported roles still use distinct normal hue families, with Redis/DB in a common blue family. WAN's group is not a false source relationship, and a foreground collision does not break a color-continuous border. The fixed grouping category does not separately require accent exclusivity or color-only selection feedback. I therefore **do not add a new pass condition** to fail the category. A palette improvement is reasonable, but the collision is not a new scored defect in this review.

Redis and DB are spread horizontally for their independent routes, but remain in consecutive lower data-store bands with related blue hues. There is no source claim that every depth level is a concept; grouping is explicitly by role, not inferred from geometry.

### Fit and selection coverage

Normal and selected ANSI each measure **77 columns × 47 rows**. The tight graph rectangle is **[19,2,41,45]**; the check allocation is **42×46**. The bottom node border ends at row 46, with blank row 47. The palette at **[2,41,9,6]** does not overlap the graph. No item is clipped or hidden in the required view. Limited allocated vertical slack is not itself a rubric failure.

Normal border colors are WAN #d8a657, Firewall #7daea3, Core switch #d3869b, Web tier #a9b665, Redis #7da0b8, DB tier #97b8ce. All **132 border cells per state** were decoded. Each complete border has one foreground throughout; selected borders are all gold and bold. Selected coverage is **6/6** distinct node occurrences in the one final view, not a multiplier for 21 animation repetitions. The evidence does not prove unrecorded interactive drag/hover states, and no such claim is made.

### No additional failures for these items

- Duplicate `10 GbE` labels are required on two separate source links.
- Constant timing is the correct default here. Unequal arrival times and `arrivals: 0/0 same-arrival` are not defects.
- The long core-to-Redis route remains a separate traceable monotone edge; a diagonal is not a valid shorter orthogonal corridor through obstacles.
- `1 shortened` does not mean a remaining route-economy defect.
- The missing opening of older `v1-frames.txt`/`.ansi` does not erase the complete frame 0 in the separately pinned target-size dump.

## Workflow, cleanup, and capability status

The final manifest records check window **2026-11-02T12:42:56Z** and capture window **2026-11-02T12:42:56Z–12:43:00Z**. Its final `check_exit` is 0. Manifest hashes all match the actual artifact bytes. The app's own live header is accepted as size proof despite null `pane_rect`/`pane_cols`; a hardcoded pane size was not substituted. The pinned dump adds its own natural-zoom viewport line.

One owned pane, **`w7E:pDR`**, is recorded and `cleanup: confirmed_closed` is preserved. The generation report says probes were direct dumps, not panes. The review preserves this capture-time closure record; it does not claim a new live closure probe. The reviewer opened no panes.

The validator's “all checks passed” is retained as evidence, not adopted as the verdict. It reads the same incorrect origin/dot check claims, does not independently recover source borders, and does not supply the missing diagnostic history or long-route lap.

**No unavailable model/tool capability was identified.** The frozen renderer demonstrably produces the motion defects above; that is not evidence that a model or tool was unavailable. The unresolved blockers are evidence completeness B01/B02. Known renderer failures remain failures independently of those gaps.

## Correction candidates — not implemented

### Renderer-level candidates

1. Derive the animated origin from the actual source-border exit and include the first external cell at t=0. Validate that cell against the captured grid; do not relabel the first stem as a port.
2. Keep actual grid-distance motion separate from the list of cells allowed to display dots. Avoid corner masking without silently accelerating over skipped cells; the current filtered position/update count is not a physical speed proof.
3. Detect actual rendered dot/corner occupancy and origin mismatches in checks. `0 violations` and `7/7 origins` must not certify this capture.
4. Consider a non-colliding normal WAN palette value or stronger redundant selection styling. This is a usability improvement, not a reason to invent semantic groups.

These are candidates based on frozen rendered behavior, not an attribution to current source code. No current renderer source was used as a substitute for executed evidence.

### Skill/harness-level candidates

1. Remove the assertion that a fixed 21-frame/2000 ms window covers a full lap of any constant-speed route. Determine evidence duration from measured route travel, and retain frame 0 plus the whole required target-size lap.
2. Require coordinate checks from actual node borders and actual route cells, not from generator-supplied source-port lists or clean check counts.
3. Preserve exact commands, statuses/stderr, timestamps, and raw outputs for every probe/diagnostic/rejected check; ensure every referenced file exists. Record probes even when no `--check` was spent.
4. Continue preserving both source-required `10 GbE` labels and all independent links. Do not repair motion or reduce crowding by dropping semantics.
5. Keep constant-speed and same-arrival evidence requirements separate. Do not make long routes finish together when the user has not asked for that.

No fix, install, model switch, new viewer session, subagent, or commit was performed. The blind record remains sealed. The captain must gather all eight complete critiques before revising the skill.

## Deliverables and verification

- `docs/visualize-eval/rounds/04/reviews/network/reviewer-result.json` — conforms to the frozen embedded result schema; 45 hashed evidence entries, seven edge audits, five evidence-linked findings, two evidence blockers, and the preserved cleanup record.
- `docs/visualize-eval/rounds/04/reviews/network/critique.md` — this critique.
- `docs/visualize-eval/rounds/04/reviews/network/observed-first.md` — unchanged stage-A record.

The JSON was checked offline against every keyword used by the embedded schema, with evidence-ID integrity and the unchanged blind-file digest asserted. No dependency installation or viewer execution was needed. Frozen input and capture-manifest digests were independently checked against actual bytes.
