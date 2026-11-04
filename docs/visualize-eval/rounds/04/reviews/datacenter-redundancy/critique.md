# Round 04 — datacenter-redundancy — independent Sol review

## Verdict: FAIL

Four applicable categories pass, two fail, and one is blocked. Known visual defects remain failures even though workflow provenance is incomplete. This is not green, and a validator's green output is not a visual approval.

| Fixed category | Decision | Main reason |
|---|---|---|
| semantic_fidelity | **pass** | All 18 concepts and 28 endpoint/direction/label-meaning triples occur exactly once; qualified physical-link convention is stated; split coverage and corrected fabric geometry are preserved. |
| arrow_traceability | **fail** | One ambiguous ECMP owner in v3, plus one demonstrably removable two-step route jog. All 28 underlying links nevertheless retain independently traceable source stems and intact heads. |
| layout_fit | **fail** | All four saved views fit 77×47 at 100%, but v1 adds two avoidable feed bridges and v3 adds two avoidable fan bridges. |
| conceptual_grouping_color | **pass** | Source-related groups have related hues and proximity within each view. Cross-view hue stability is expressly not a separate round-04 gate. |
| border_integrity | **pass** | Normal and all-selected ANSI prove complete, color-continuous borders for all 26 node occurrences. |
| workflow_evidence | **blocked** | Exact final operation commands, complete output/status provenance and raw cleanup responses are missing; one preserved draft is unindexed. |
| animation | **pass** | Applicable as the explicit no-dots prohibition: all 12 final visual captures contain zero `●` glyphs. Positive-motion tests are not applicable. |

There are no observed critical defects. In particular, the explicit no-flowing-dots request is obeyed in every supplied final capture. No earlier-round verdict contributes to this result.

## Scope, identities, and frozen inputs

All evidence paths in `reviewer-result.json`, `spec-manifest.json`, and this critique are **repository-relative to the root of this dotfiles checkout**. Coordinates are 1-based terminal cells including the title row, written `[column,row,width,height]`. Edge IDs e1–e28 follow the candidate's explicit relationship audit; each JSON row also points to the matching frozen expected-relation array entry. No other case, unrelated historical chat, or earlier round was inspected.

- Generator: **`viz-ds04-5`**, model **`fireworks/accounts/fireworks/routers/deepseek-flash-latest`**, identified by the case-specific captain briefing. The generic `<case>` placeholder is not used to invent a different worker identity.
- Reviewer: **`viz-judge04-datacenter`**, model **`openai/gpt-6.1-sol`**; worker name and model were checked from this session's environment. The rubric's residual prose reference to an Astra critic is superseded by its required reviewer field, schema, revision note, metadata and explicit full-task instructions, all of which require Sol.
- No model switch, subagent, renderer run, viewer session, install, repair, or commit occurred during this review.
- Generation's isolated/fresh identity is a supplied assertion and case briefing, not a newly audited historical session transcript.

Actual hashes were verified, not copied untested:

| Frozen input | SHA-256 |
|---|---|
| candidate skill (`rounds/04/SKILL.md`) | ac431c6d3035e466e29136f36d9579c551c2e070a354dc5df72999b1bb1beb3c |
| existing frozen renderer executable | 0da16d8d8ed46e2a25eb773fc71ecad4de9e310cd33e303a4c7fe77231ad95bc |
| frozen rubric | 18412615f82841b34cf131976c6b5f4b00cd4fc031a710cdfc81058e2dd68d10 |
| dataset manifest (`cases.json`) | e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05 |
| case source | a3051af3eeeec31aee53558dafbbea5d061dc74253618fd6940eba5c39b5bb98 |
| case expectations | 926e866fbdbb3eaac5b7a21360905d1f621a7a6386139afab303e8ba7e62ed47 |
| case historical variants | a5753817a621b846abcb4105d028dbd0d0152214495f5b225044b3882f4f34b9 |
| **deterministic final-spec manifest** | **148a1f7742a5e212a41ad2f100160314138a1896cc5758040aa3eb50d7a81e3d** |

The renderer was rehashed at its frozen `/tmp/visualize-eval/round-04/bin/rataflow-view` path, **without execution**. It is the renderer baseline, not evidence of a skill-created renderer improvement. Its external executable path is documented here; inventory file paths remain repository-relative.

`spec_sha256` is the SHA-256 of `spec-manifest.json`, a sorted array of repository-relative final-spec path / actual SHA-256 pairs. All four individual specs are separately inventoried. The evidence inventory also hashes the final captures, manifests, check and validator records, preserved drafts, all 11 attempt check logs, five preflight logs and specs, and two frames-only probe logs. All indexed draft/check and probe-spec hashes match `attempts.json`. Every final manifest's five artifact hashes match its actual files.

### Sealed blind record

`docs/visualize-eval/rounds/04/reviews/datacenter-redundancy/observed-first.md`

SHA-256: **`5bc09c68db028c0f40c403378b2f0e7a1e6c8fbe64a3925e6ee880d8a759f9fe`**.

It was saved and hashed before the expectations reveal, and its bytes remain unchanged. `observed_first.saved_before_expected_reveal` is true. The stage-A record contains every label rectangle, box rectangle/color, arrow polyline/head, crossing and compact contact neighborhood, plus the 26/26 selected-border audit and zero-dot counts.

**Addendum, not a rewrite:** the control-widget border color in that blind record was misstated. It is RGB `(168,153,104)`, `#a89968`, in all normal and all-selected captures, not `#7c6f64`. The graph-border colors and all diagram counts are unaffected. This was disclosed immediately after the initial save and has not been silently repaired in the sealed file.

## Source-backed semantics and all-view coverage

Human corrections in source excerpts headed **Original line 248** and **Original line 270** govern geometry and independence. Historical variants are not independent fact verification. The source's final qualified 28-relation reference is the audit target; earlier variants with a single border leaf or fewer rack cross-connects are not alternatives that excuse omissions.

| View | Audited edge IDs | Captured relationships | Required words |
|---|---|---|---|
| v1 | e1–e4 | Four ISP feeds: A/B to MUX 1, C/D to MUX 2 | unlabelled, no invented protocol |
| v1 | e5–e8 | Both MUXes to both cores | `x-connect` ×4 |
| v2 | e9–e12 | Both cores to both firewalls | `active` ×2, `standby` ×2 |
| v2 | e13–e16 | Both firewalls to both border leaves | `active` ×2, `standby` ×2 |
| v3 | e17–e20 | Both border leaves to both spines | `ECMP` ×4, one owner ambiguous |
| v3 | e21–e24 | Both rack leaves to both racks | `dual` ×4 |
| v4 | e25–e28 | Both spines to both rack leaves | `ECMP` ×4 |

The final-spec relation multiset exactly equals the qualified expected multiset: **28 required, 28 actual, no missing relation, no extra, no duplicate**. This was also checked against the visible routes, not treated as a JSON-only pass. `reviewer-result.json` has a separate stem-to-head audit for every one of the 28 links, including bends, crossings, style, label rectangle, and target head. No extra actual relationship or shared bus was observed, so there is no invented `unexpected_link` entry. Compact apparent branches are resolved as crossings in those audits and in the blind record.

**Geometry:** in `evidence/v3/v3-ansi.ansi`, BL 1, BL 2, Leaf 1 and Leaf 2 all start at row 28, at columns 10, 27, 46 and 62. Both spines start at row 8; racks start at row 38. Differing box heights put BL 2's text one row lower, but do not put it on a different tier. This satisfies the corrected common leaf-band/spines-above requirement. v4 supplies the four spine-to-rack-leaf links absent from v3; the explicit coverage map makes this a complete split, not a missing relation. The source does not require every detail view independently to repeat the entire fabric, so v4's left-to-right orientation is not separately penalized.

**Firewall state:** FW1/FW2 labels are abbreviated from the historical state-bearing names. The eight incident `active`/`standby` labels in v2 consistently and clearly identify the pair's roles on the same view. Their exact rectangles and owners are preserved in stage A. None of those repeated words has an uncertain owner. Dashed routes express standby distinction without deleting labels or links.

**Arrow convention:** `generation.json` and `generation.md` explicitly say arrows follow the first-to-second endpoint order of the recorded relations and **do not assert one-way traffic**. No endpoint was reversed to make layout easier. The convention is in the accompanying artifact, not visible inside the pane; it nevertheless satisfies the source's instruction to state the convention. No new requirement for an in-pane legend is added.

The semantic category passes because identities, endpoint semantics, direction convention, qualifiers and label meanings survive. The localized ECMP owner failure is scored under arrow traceability, not misreported as a false or omitted physical link. The edge audit passes 26 links and fails e20 for ownership and e22 for route economy; their underlying endpoint coverage remains present.

## Concrete defects

### D01 — v1: two avoidable carrier-feed bridges — medium, layout_fit failure

Evidence: `evidence/v1/v1-ansi.ansi`, **[17,21,2,2]**, e2/e3.

The compact twist contains bridge cells (18,21) and (17,22). ISP B travels upward toward MUX 1 while ISP C travels upward into MUX 2, weaving around each other despite feeding separate appliances. Neither the ISP-pair graph nor the source's tier/order requirement forces these feed crossings.

Preserve A/B/C/D order and MUX 1/2 order, but allocate disjoint feed bands around the two MUXes, or choose a different covered split. No group needs to be reordered. Supporting frozen evidence: `specs/v1-a1.json` preserves those node/tier orders, and `attempts/v1-a1-check.txt` reports **one**, not three, bridges. That rejected draft has a separate label defect, so it is **not** accepted as a passing substitute; it only refutes the assertion that three crossings are a topology necessity. Exhausted candidate budget is not source geometry.

### D02 — v3: two avoidable BL/spine fan crossings — medium, layout_fit failure

Evidence: `evidence/v3/v3-ansi.ansi`, **[22,27,4,3]**, e18/e19/e20.

Three bridges occur in the BL/spine fan: (22,27), (24,27), (22,29). A fourth at (50,35) belongs to the separate leaf/rack fan. The generator's claim that four crossings all arise near the spines is not what the capture shows.

Spines-above and a common lower leaf band are source-required. Side-port serpentine entry is not. Retain the same ordered spine pair and the same ordered BL/leaf band, and use tier-facing BL/spine ports: the fan need only retain its ordinary interleaving crossing, rather than three. This is an analytical layout judgment, **not a newly rendered or verified replacement**. Two excess crossings are attributed to chosen port/routing geometry; no source group is swapped, moved out of its band, or dropped in this assessment.

### D03 — v3: ambiguous owner of one ECMP label — medium, arrow_traceability failure

Evidence: `evidence/v3/v3-ansi.ansi`, **[16,12,7,3]**; label itself **[17,12,4,1]**; e20, BL 2 → Spine 2.

The own-route candidate at column 22 is two cells from the label's right edge. The BL 2 → Spine 1 horizontal run at row 14 is two cells below its left edge. It also immediately abuts Spine 1's lower-right corner at (16,12). The blind observation already recorded this uncertainty; it is not introduced after learning expectations.

The other ECMP assignments and all endpoints make the likely intended owner recoverable, but the full-task rule expressly fails an equally close alternative unless an unavoidable-slot exception was recorded. Here the generator claims zero ambiguity, and no such exception exists. The check's `0 ambiguous owners` and the validator's `labels_ownership_clear` do not override the actual local geometry. The other 23 edge-label owners, including every active/standby occurrence, remain distinguishable.

### D04 — v3: unnecessary two-step jog on Leaf 2 → Rack 1 — medium, arrow_traceability failure

Evidence: `evidence/v3/v3-ansi.ansi`, **[49,32,15,6]**; e22.

Saved route, first stem cell to arrowhead:

`(63,32) → (63,34) → (62,34) → (62,33) → (50,33) → (50,36) → (49,36) → (49,37)`

This is **21 grid steps**. A geometrical shorter-path witness at identical source/head cells is:

`(63,32) → (63,33) → (50,33) → (50,36) → (49,36) → (49,37)`

This is **19 grid steps**. It removes the down-left-up jog using the route's own existing cells/corner strip. It does not touch a foreign node, label, other leaf output, or shared run, and retains the same crossing at (50,35). No source order, endpoint, label or geometry constraint changes. This is a static coordinate argument, not an executed fix. The check's near-minimal tolerance does not make the redundant up-step obstacle-forced.

Other long v3 polylines, especially the wraparound entrance to Spine 2, are conspicuous but are **not independently failed just because they look long**. Fixed side-port arrowhead approach accounts for their large runs. D02 addresses avoidable layout/port-induced crossing complexity separately.

## Crossing accounting: source geometry versus avoidable layout

| View | Visible bridge cells | Judgment |
|---|---|---|
| v1 | (18,21), (17,22), (60,18) | Two feed crossings avoidable; retain the one ordinary MUX/core interleaving crossing. |
| v2 | (43,25), (62,23) | One per ordered tier-to-tier 2×2 fan; no additional avoidable pair established. |
| v3 | (22,27), (24,27), (22,29), (50,35) | Three BL/spine crossings can be reduced to one without changing source bands/order; one rack-fan crossing remains. |
| v4 | (49,23) | One ordinary ordered spine/leaf fan crossing; no additional avoidable pair established. |

Thus the saved counts are **3/2/4/1**, with **four avoidable extra bridges identified**. The **3/2/2/1 touching-bend reports are not additional crossings**. All exact tight-turn neighborhoods, including apparent branches, are recorded in stage A.

This is not a claim that abstract K2,2 has crossing number one: it is planar. The generator's unqualified mathematical claim is too broad. One crossing is a reasonable local minimum for these ordered, tier-facing monotone fan drawings; eliminating it through an outer wrap may introduce a route-economy defect. Nor is six a theorem that every imaginable source-compliant split must have six bridges. This review accepts the local fan crossings and rejects the demonstrably unnecessary extra ones. It does not award a lower count produced by reordering source groups, reversing endpoints, collapsing links, or losing labels.

## Passing color, border, fit, and no-dot evidence

### Conceptual grouping

Within each saved view, hue families correspond to actual device roles: carriers, MUX aggregation, core routers, firewalls, border leaves, spines, rack leaves and racks. Related members are near each other; geometry alone is not presented as the conceptual reason for grouping.

Three of four repeated groups change family: core pink→gold, border leaves pink→teal, rack leaves pink→teal. Spines remain gold. **This remains a blind observation and a usability advisory, not a failed rubric gate or an unsupported-capability blocker.** The full task explicitly excludes cross-view per-node hue stability as a separate gate. The format's lack of a color override therefore does not block this case. No requirement is waived or added to obtain this pass.

### Borders and selected coverage

All **26/26 node perimeters** have complete normal borders with uniform per-node RGB around every side and corner. All four `*-selected.ansi` captures show each corresponding perimeter in continuous bold gold, including nodes already gold normally. Selected geometry matches normal geometry. These files prove simultaneous selected-border coverage, not a drag/hover/animation history. Plain text was not used to certify color.

### Fit

Every actual ANSI capture is **77 columns × 47 rows** and its running-app title reports **`77x47 @100%`** at **[2,1,66,1]**. All boxes, full labels, arrowheads and routes are visible without clipping, panning, zooming or overlay occlusion. The control palette is clear of v3 racks.

Every check says `viewport: unknown zoom: 1.00 natural`; manifests have no pane rectangle or pane columns. These absences are disclosed, but **are not a fit blocker under the frozen round-04 rubric**, which expressly accepts the running application's measured header token instead of a pane rectangle. `live_pane` records dimensions derived from that observed token, not a hardcoded launch geometry. Check extent values alone would not prove fit. Layout_fit still fails on the known avoidable crossings, not on missing rectangle data.

### Explicit no-dots request

Source **Original line 134** says to remove flowing dots; frozen expected data and dataset both say animation off. All **12** final text/normal-ANSI/selected-ANSI captures contain **zero U+25CF (`●`) glyphs**. All 28 final spec edges set `dots: 0`, no edge has `flow`, and all four checks report zero flows and zero dot violations. The explicit prohibition passes on the saved captures. No critical no-dots finding is carried over from any earlier round.

**No final frame dumps exist.** This gap is recorded in the workflow decision and evidence limitations. It cannot prove temporal absence during uncaptured states, and no origin, speed, spacing or synchronized-arrival claim is made. However, timestamped full-cycle evidence is required for animated routes, not an explicitly static view with no visible motion. The lack of frames is therefore a **nonblocking evidence limitation for this source**, not a fabricated animation pass and not an unsupported rendering capability. Positive-motion tests are source-backed N/A; the applicable animation decision tests the explicit prohibition itself.

## Workflow evidence gap / blocker G01

The available records are substantial but incomplete:

- Four final check texts and manifests with `check_exit: 0`, check windows and capture windows.
- Four normal text captures, four normal ANSI captures and four all-selected ANSI captures.
- Four validator outputs, all green, generated without `--require-frames` for this static case.
- Eleven raw case-view check logs, indexed **3/2/3/3** for v1/v2/v3/v4.
- Five preflight capability/label check logs and specs, and two disclosed frames-only rejected candidate captures.
- Absolute renderer path and actual hash; frozen skill/rubric/dataset/source hashes; all final specs and a new deterministic hash manifest.
- The sealed pre-reveal blind file.

**Required items not preserved:** exact final check, validator, pane-launch/run/read and close command invocations; provenance establishing whether saved check text preserves complete stderr as well as stdout; process exit statuses for rejected/preflight invocations; raw pane-close responses. Merged stdout/stderr would be acceptable—separate files are not a new requirement—but the execution record must establish that the merged file is complete. A generic skill example or the current harness implementation cannot replace the missing executed command ledger.

The only recorded literal executable command strings are the two frames-only probes in `attempts.json`, with `COLUMNS=77 LINES=47`, the absolute frozen binary, `--frames 1`, and their respective rejected specs. Those are not evidence of commands executed for the final four views. Do not infer probe execution timestamps from the frame's `0ms` simulation time.

Additionally, **`specs/v4-a1.json` exists but has no entry in the attempts/probe index and no matching raw output or disposition**. Its mere existence does not prove a fourth executed v4 check or a budget violation. It does leave its execution history unknown. The budget cannot be enlarged or the unknown draft silently hidden; the gap must be resolved from preserved execution evidence, not a fresh viewer rerun.

The v1 first-draft file is disclosed as a preserved/reconstructed copy after the canonical name was overwritten. Its actual hash matches the supplied attempt ledger. The claimed byte-identical replay is only a generator assertion here; this judge did not rerun it. No false execution history is manufactured.

### Cleanup record

Owned panes **`w7E:pE5`, `w7E:pE6`, `w7E:pE7`, `w7E:pE8`** each have a final manifest saying `cleanup: confirmed_closed`. They are listed as closed in the structured record on that basis. No judge pane was opened. The missing raw close responses constrain independent command-level verification; they are not treated as evidence that a pane is currently leaking, and no new live probe was performed.

### Blockers versus defects versus advisories

- **Known defects:** D01/D02 avoidable crossings, D03 label ownership, D04 removable route jog. These fail their categories now.
- **Required evidence blocker:** G01 execution/output/status/cleanup provenance and unindexed draft disposition. Missing evidence is blocked, not pass.
- **Nonblocking evidence limitations:** no static frame time series; unknown `viewport:` check dimensions and no pane rectangle, with the allowed app token supplying fit proof; no selected-state interaction history beyond captured all-selection.
- **Advisories only:** cross-view hue changes and v3 requiring its explicitly mapped v4 detail to show spine/leaf links.
- **Unresolved required rendering/model capability blocker:** none demonstrated. Sol judging and the specified generator model were available; static independent links and source-required geometry are expressible. Lack of a cross-view color override is not an applicable blocking requirement.

## Correction candidates, not changes made

### Skill / generation-workflow candidates

1. Preserve source tier/order and all 28 independent links while evaluating crossings by subgraph, not by the generator's incorrect abstract K2,2 claim. Keep feed pairs in disjoint bands; compare port assignment, spacing or a different covered split without swapping source groups.
2. Verify every label against visible competing runs. In v3, the equal-distance ECMP owner should be caught even when `--check` is green. Do not record a predeclared edge owner as proof the reader can identify it.
3. Apply the route-economy rule to actual cell walks, including small removable jogs within a checker's near-minimal tolerance. The e22 two-step witness is a precise regression target.
4. Capture exact commands, combined-output provenance, exit codes, time windows and raw cleanup results at execution time. Index every preserved draft and say whether it ran. Do not repair missing provenance retrospectively by replaying live viewers.
5. Retain the successful explicit `dots: 0` treatment and complete 28-edge split coverage. Do not add motion to make the view look more active.

### Renderer / evidence-harness candidates

1. Prefer ports facing adjacent source tiers and order-aware fan routing, while retaining separate corridors and bridge semantics. This may remove the v3 side-port-induced extra crossings without changing source bands.
2. Improve label-owner checks around labels abutting boxes and equally close to a competing route; maintain the explicit reader-level gate rather than trusting a clean counter.
3. Eliminate tiny backtracking jogs before rendering or report them in economy diagnostics; do not equate a thresholded near-minimal count with a strict no-redundant-jog guarantee.
4. Preserve invocation/output/status/cleanup provenance automatically alongside manifests. No measured geometry should be invented; retain the accepted live-app header token.

These are correction candidates for the captain after all eight critiques arrive. **No skill, renderer, spec, source, expected data, capture, or blind record was modified by this review.**

## Deliverables and verification

- `docs/visualize-eval/rounds/04/reviews/datacenter-redundancy/reviewer-result.json`
- `docs/visualize-eval/rounds/04/reviews/datacenter-redundancy/critique.md`
- `docs/visualize-eval/rounds/04/reviews/datacenter-redundancy/spec-manifest.json`
- Pre-existing sealed `observed-first.md`, unchanged.

Verification uses saved evidence parsing, actual SHA-256 calculations, all 28 relation audits, and offline validation of the result against the embedded schema. No live viewer or improvised session test is necessary or permitted.
