# Network — round 05 independent Sol review

## Verdict: FAIL

The diagrams preserve the source relationships and are easy to trace statically. They are not green: **all seven dots start one drawn cell past the required origin**, and five arrows only toggle between two dot positions. Workflow verification is additionally blocked by incomplete target-color and execution-provenance evidence.

| Fixed category | Decision | Basis |
|---|---|---|
| semantic_fidelity | **pass** | Six concepts and all seven directed relationships retained across the two views; no invented link, reversal, missing label, or merged cache relation. |
| arrow_traceability | **fail** | Static stems, labels, bends and heads are clear, but the rubric explicitly makes an off-origin dot a direction-proof failure. All seven arrows fail that condition. |
| layout_fit | **pass** | Complete final-spec 77×47 full-lap text dumps show natural 100% fit, no clipping or palette occlusion, and zero crossings. The frozen metadata explicitly accepts these pinned dumps when the measured live viewport is larger. |
| conceptual_grouping_color | **pass** | Nearby network infrastructure uses pink; service/data tiers use teal. ANSI proves the hue families. Exact per-node RGB stability is not a separate gate. |
| border_integrity | **pass** | Complete normal and selected borders for all 9/9 node occurrences, with color continuity proved by 83×51 ANSI. Pinned text independently shows intact target-size geometry and zero palette-overwritten border cells. This is not a claim of captured 77×47 selected colors; that missing target state blocks workflow completeness. |
| workflow_evidence | **blocked** | Immutable blind record and input hashes verify, but target-size color captures, complete raw command/status/cleanup records, and an executed-validator snapshot/version lineage are missing. |
| animation | **fail** | Seven first-drawn-cell origin failures and five directional-motion legibility defects. Constant mode and unequal lap times are legal; non-origin corner skipping is not separately penalized. |

**Aggregate:** four categories pass, two fail, one is blocked. All seven required edges have correct static semantics but fail their mandatory origin/direction audit. Known failures determine the overall **fail**, even with workflow blockers outstanding. No expectation-based relationship was silently changed to fit the captures.

## Evidence base, identities, and hashes

All report and inventory paths are **relative to the repository root** `/Users/aviral/.herdr/worktrees/dotfiles/fix-visualize-skill`. The only absolute executable path mentioned is the frozen renderer `/tmp/visualize-eval/round-05/bin/rataflow-view`; its repository-relative `bin.sha256` records are inventoried and its actual binary hash was independently checked without executing it.

- Result: `docs/visualize-eval/rounds/05/reviews/network/reviewer-result.json`
- Spec manifest: `docs/visualize-eval/rounds/05/reviews/network/spec-manifest.json`
- Immutable blind record: `docs/visualize-eval/rounds/05/reviews/network/observed-first.md`
- Blind SHA-256: `b80b4076225a9ee5c838c09a9ce5227e6f1c7d710a954f610bf62eb554990d4a`
- Spec-manifest SHA-256, used as `spec_sha256`: `c008ca5bdc6b1b7dc512fd43ed26b6f2ebb524c5243964eb5b74a742089f2561`

The manifest is a JSON list sorted by repository-relative spec path, with actual SHA-256 values. It includes only the final `specs/v1.json` and `specs/v2.json`; both hashes match the supplied prefixes and full capture-manifest hashes. Each spec and the manifest has a separate evidence inventory entry. All original manifest artifact hashes and all attempt-ledger spec/check hashes verified. The result inventories 68 evidence entries, including frame-specific references into the original pinned files; no derived capture replaces an original.

Frozen hashes independently verified:

| Input | SHA-256 |
|---|---|
| Candidate skill | `ff4a9d3f32ba0bf86e54ee6bfbac02fdea3fac3b95b82a958b3411accef0a949` |
| Renderer | `b1ab9f2e78af11c2f2b005eea083a999079d184bf550e8d0b6d9c51867f22404` |
| Rubric | `039b96252d25ad2078a539fdb1d081ebdb6c09d6f7a3487b96ffbbf3b082e292` |
| Dataset manifest | `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05` |

The network source, expected data, and historical-variants hashes also match frozen metadata. Historical diagrams were treated as qualified historical relations, not independent factual verification. No original chat or credentials were opened.

The stage-A file was saved and hashed before the expectations reveal and is unchanged; `observed_first.saved_before_expected_reveal` is true. The result uses the mandated normalized generator identity `viz-ds05-network`. The actual generating session is recorded in `generation.json` as **viz-ds05-2**, session `01a19cf3-b63f-779f-bbc3-ff37722edffc`, provider fireworks, model `accounts/fireworks/routers/deepseek-flash-latest`; its full model identity is `fireworks/accounts/fireworks/routers/deepseek-flash-latest`. The reviewer is **viz-judge05-network**, `openai/gpt-6.1-sol`; the current runtime reports `PI_PROVIDER=openai`, `PI_MODEL=gpt-6.1-sol`. No model was switched or substituted. The stale “astra” wording inside one rubric sentence does not override the corrected required-reviewer field, result schema, and full-task instruction.

## Source coverage and per-edge audit

The frozen task requires WAN → firewall → core, both core-to-service paths, web application relations, and Redis fill. Motion is explicitly required. The fixed constraint keeps 1/10/25 GbE in labels without turning dot velocity into a measurement. Constant default velocity therefore follows the current rule and is not a loss of the historical numeric `flow` values.

All coordinates below are **1-based [column,row] in pinned 77×47 frame 0**. The result JSON supplies [column,row,width,height] regions and source references for every edge. Add (+3,+2) for the corresponding 83×51 graph geometry, not for palette coordinates.

| ID | Required relationship / view | Observed source stem, turns, target head, and label | Audit |
|---|---|---|---|
| e1 | WAN → Firewall, `1 GbE`, v1 | Border port [34,10], stem [34,11], straight down to ▼[34,14], Firewall begins row 15. Label [36,12,5,1]. | Static pass; origin gate fail. |
| e2 | Firewall → Core switch, `10 GbE`, v1 | Port [34,18], stem [34,19], straight down to ▼[34,22], Core switch begins row 23. Label [36,20,6,1]. | Static pass; origin gate fail. |
| e3 | Core switch → Web tier, `10 GbE`, v2 | Port [36,18], stem [36,19], straight down to ▼[36,22], Web tier begins row 23. Label [38,20,6,1]. | Static pass; origin gate fail. |
| e4 | Core switch → Redis, `25 GbE`, v1 | Port [34,26], stem [34,27], straight down to ▼[34,30], Redis begins row 31. Label [36,28,6,1]. | Static pass; origin gate fail. |
| e5 | Web tier → Redis, `session`, v2 | Port [36,26], stem [36,27], down to ╯[36,29], left to ╭[23,29], down to ▼[23,30], Redis begins row 31. Label [27,28,7,1]. | Static pass; origin gate fail. |
| e6 | Web tier → DB tier, `queries`, v2 | Distinct port [38,26], stem [38,27], down to ╰[38,29], right to ╮[49,29], down to ▼[49,30], DB tier begins row 31. Label [40,28,7,1]. | Static pass; origin gate fail. |
| e7 | Redis → DB tier, `fill`, v1 | Port [34,34], stem [34,35], straight down to ▼[34,38], DB tier begins row 39. Label [36,36,4,1]. | Static pass; origin gate fail. |

`25 GbE` has the core→Redis link as its clear owner. `session` belongs to the left Web→Redis departure, not the right queries route. Both were identifiable in the blind record before expected relationships were available. No ambiguous owner is recorded.

All seven relations appear exactly once across the two views; core, Redis and DB tier repeat as continuity anchors. The two source-required cache relations remain separate across the split. No extra apparent relationship needs an unexpected-link entry: the only apparent fanout is the two independent outputs of Web tier. There is no shared bus, T junction, hidden merge, crossing, bridge or touching bend. The four route corners are [36,29], [23,29], [38,29] and [49,29] in v2; none connects different routes. Every route is visually monotone and near-minimal between its selected ports. No source tier or relationship was reversed to lower the crossing count.

## Findings and classifications

### N01 — Defect, high: all seven origins are late

The pinned rule is the **first drawn corridor cell after the source-border port**, including a corner if that were the first cell. It is not the second straight cell, first renderer-eligible dot position, or the coordinate claimed by `origins: N/N`.

| Edge | Required first cell | Actual frame-0 dot |
|---|---|---|
| e1 | [34,11] | [34,12] |
| e2 | [34,19] | [34,20] |
| e3 | [36,19] | [36,20] |
| e4 | [34,27] | [34,28] |
| e5 | [36,27] | [36,28] |
| e6 | [38,27] | [38,28] |
| e7 | [34,35] | [34,36] |

These first cells are visibly drawn and remain unoccupied throughout the laps. There is no uncertain port interpretation: the source-border attachment, following vertical cell, and later dot are visible together. The blind result is **7/7 failures**, not a checker pass. `check.txt` claims 4/4 and 3/3 origins; that disagreement independently fails the animation category's explicit check/capture agreement requirement. The arrow category expressly states that an off-origin dot makes direction unproven, so its static clarity cannot waive this failure.

### N02 — Defect, medium: five two-position toggles fail directional-motion legibility

For each v1 route, the dot rows over frames 0–4 are `r,r,r+1,r+1,r` (r = 12,20,28,36). V2's input route does the same at rows 20 and 21. This is one downward cell after 200 ms followed by an upward reset after another 200 ms, repeated every 400 ms. It reads as jitter rather than sustained traffic flow, as recorded blindly and independently disclosed in the generator's short-span defect.

This is a localized **legibility defect in the requested animation**, not a false network relationship. The static heads still show the correct directions. The criterion is not that every arrow must be long, nor that all dots must reach heads together; it is that the required live traffic motion be readable as directional movement. The frozen skill itself says not to animate a route too short to show motion. Hiding the five dots is not a demonstrated complete remedy for this animation-required source; fit-aware composition or renderer support would need review.

### Corner skipping, wrap timing, and arrival — not additional defects

The two long output routes move visibly along their horizontal runs. Their first move skips the departing corners: [36,28] → [35,29], and [38,28] → [39,29]. The final occupied cells are [24,29] and [48,29], before the arriving corners and heads. Thus a literal grid-displacement measurement over the turning step is not the same as the straight-run one-cell movement; the full blind record preserves this limitation instead of declaring a perfect continuous grid-velocity proof.

However, revision 6 explicitly prohibits resting on **non-origin** corners. None of these four corners is an origin. Skipping them is not independently penalized, and no new “must occupy every corner” gate is added. No dot rests on a forbidden corner, bridge, junction or label. Long-route step cadence is one eligible position per 200 ms, matching the nominal shared default; the origin failure still prevents an animation pass regardless of how the turning displacement is interpreted.

Unequal laps of **400 ms, 2200 ms and 2600 ms** are legal under constant mode. No source asks for same-arrival. No captured dot reaches its arrowhead, but head contact is required for opt-in same-arrival, not this constant-mode case. The short arrows wrap immediately before their heads; the long arrows wrap before their final corner as well. These are accurately described observations, **not invented synchronized-arrival failures**.

### N03 — Evidence gap / capability blocker, high: no target-size color states

The complete 77×47 dumps establish target-size geometry and full motion laps. Normal and all-selected color evidence instead comes from the measured **83×51 app viewport**. There is no color-bearing 77×47 normal or selected capture, and no live target-size pane was produced. The generator explicitly distinguishes its larger pane from its pinned dumps; this review does too.

The border pass is limited to what is actually proved: all 9/9 selected node occurrences and all 202 perimeter cells are complete and uniformly colored in the normal/selected ANSI captures, while target text proves geometry and no palette overlap. It does not manufacture target-size selected-state colors. The missing target capture blocks full workflow evidence rather than being silently passed or called a visible border defect.

### N04 — Evidence gap, high: raw execution and cleanup records incomplete

`attempts.json` records three candidates per final view plus one abandoned decomposition. All listed spec and check hashes verify, and rejected raw check text is present. However, those files do not preserve original command/exit status or separated stderr. The abandoned first run's original output was overwritten and replaced with a disclosed re-run; a re-run does not restore the original execution record. The command summary also uses placeholders, and does not give a complete exact v2 capture invocation.

The final-pane manifests record `w7E:pGS` and `w7E:pGV` as `confirmed_closed`. Five more manually opened probe panes are enumerated in the cleanup narrative: `w7E:pFR`, `w7E:pFS`, `w7E:pFT`, `w7E:pFY`, `w7E:pF0`. No verbatim close result/probe for them is retained. The same narrative calls these “two” probe panes while listing five. The result therefore lists the two manifest-attested closures but leaves all-owned-pane cleanup **blocked**. It does not assert leaked panes. The reviewer created no pane.

The app's own header proves the live **content viewport** 83×51; the physical pane rectangle is null in both manifests. The narrative's inferred 85×53 outer pane and 0.5 split are not independently measured rectangle evidence. The source's even-split preference therefore remains a workflow verification gap, not an invented semantic edge failure.

### N05 — Evidence gap, high: executed validator differs from frozen hash

Frozen metadata names validator SHA-256 `0f036e7a08ea04b1c23d3611bde50972dec5d4ecec6b2ab960685d4e2d7c7a99`. Generation says the executed validator hash was `902370989d632a497db9ebe325ca378a1f4fd81e0214f91f44906157bc1d453e` after concurrent changes. The case includes passing output, but not the executed-version snapshot or a raw version/edit timeline binding that different hash to the commands.

Metadata does document intended pre-generation corrections: remove the unavailable route-diagnostic requirement and accept final-spec pinned dumps for fit. Those policies inform this review. They do not explain away the distinct executed-validator hash or restore immutable execution provenance. The current source tree was not used as a substitute for the executed artifact.

### N06 — Evidence gap, medium, partly compensated: truncated live v2 frames

The 83×51 v2 dumps retain complete frames 12–30 only. The target-size pinned v2 file contains frames 0–30, including frame 26's session wrap, so target motion full-lap coverage is **not blocked** by the live dump truncation. V1 pinned frames 0–8 cover two complete short laps.

The nominal `frames.ansi` files do not preserve node foreground colors in frame-grid bodies. The result does not mistake their file extension for a time-varying ANSI color proof. Generator v2 motion/pane narratives also cite absent frame 0 or advance coordinates inconsistent with the actual raw grid. Those statements were not used as coordinate evidence; the blind record enumerates the actual positions.

## Other disclosed limitations, correctly scoped

- **No `routes: N/M near-minimal` line:** recorded as missing in stage A. Stage B metadata explicitly establishes that the frozen reverted renderer lacks it and the harness requirement was removed before generation. It is therefore an expected diagnostic capability absence, not a fresh workflow/category failure. The reviewer directly audited all seven short monotone routes and found no avoidable loop or detour. No numerical near-minimal ratio is invented.
- **No group outlines or names:** the skill promises group blocks, but the frozen renderer only colors member borders. The source and fixed grouping category require conceptual proximity and hue families, not named group boxes. This is a skill/renderer documentation mismatch to correct, not a new diagram pass condition.
- **Repeated-node RGB changes:** Core switch, Redis and DB tier change exact RGB values between views, but retain their conceptual hue families. The full task expressly says per-node cross-view hue stability is not a separate gate.
- **Narrow v1 column:** large blank margins are not clipping, a lost relation, or a rubric density failure. The source-complete split is valid; no extra aesthetics gate was added.
- **Validator PASS:** both preserved transcripts say all checks passed. They neither override the visible origin failures nor resolve missing raw evidence.

## Correction candidates — not implemented

### Skill-level

1. Make first-drawn-cell comparison mandatory in the post-capture audit; never trust `origins: N/N` alone. The captured border, stem and dot coordinates must agree with the pinned definition.
2. Detect two-position toggle motion as a readability issue before claiming lively flow. Preserve all seven relations and labels, keep default constant speed, and report a capability limitation when fit and motion cannot both be met. Do not hide required animation merely to get zero dot violations.
3. Correct claims about bordered group blocks and unconditional orientation guarantees to match the frozen renderer; keep semantic hue grouping that actually works.
4. Preserve exact commands, statuses, stderr, immutable rejected originals, all probe launches/closures, and the executed validator snapshot. Declare pinned geometry versus live color-state evidence separately. Increase retained scrollback or save dumps outside pane scrollback without losing binding to the executed binary/spec.

### Renderer/harness-level

1. Correct the animation/checker origin disagreement so the dot and origin diagnostic both use the first drawn cell after the border port. This is a frozen-renderer behavior, not evidence of a skill-only improvement.
2. Investigate a fit-aware minimum readable animated runway along near-minimal paths, or another honest motion representation for adjacent hops. Do not manufacture long detours, misencode link speeds, force unrequested synchronization, or drop links to make dots travel farther.
3. Provide real color-bearing target-size normal/selected capture support, reliable owned-pane dimension records, and durable raw cleanup probes. Freeze the executed harness version before generation.

No skill, renderer, spec, capture, source, expected data, or blind record was changed. No viewer session, install, model switch, or subagent was launched. Only review artifacts and a temporary stdlib evidence helper were written.

## Verification and remaining blockers

`reviewer-result.json` was checked against every keyword used by the embedded `result_schema` with a stdlib-only validator run through `uv`; no dependencies were installed. Evidence IDs, actual hashes, spec-manifest contents, and the blind hash were checked. The reports retain the source-backed seven-edge mapping and all seven fixed category keys.

Unresolved blockers are target-size color/selected-state capture capability, complete raw execution/cleanup provenance, and executed-validator reproducibility. The truncated larger v2 dump is compensated for target motion by the pinned full lap. Missing route diagnostics are baseline-expected and are not an unresolved blocker to this direct route audit.

The case remains **FAIL**, not merely blocked, because N01 is conclusive. Gather all eight complete critiques before revising the skill; this case alone does not establish an improvement to the frozen renderer baseline.
