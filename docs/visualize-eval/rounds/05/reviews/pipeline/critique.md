# Pipeline — round 05 independent Sol review

## Verdict: FAIL

Three categories pass, two fail, and two are blocked. Every required relationship is present and statically readable. Nevertheless, all six animated arrows violate the pinned origin rule. The rubric explicitly makes that an arrow-traceability failure as well as an animation failure. Missing workflow/target-pane evidence cannot turn these known failures into a merely blocked result.

| Fixed category | Decision | Basis |
|---|---|---|
| semantic_fidelity | **pass** | Six concepts, six correctly directed relations, four correctly owned edge labels; no invented protocol or apparent extra relation. |
| arrow_traceability | **fail** | Static routes are clear, near-minimal and crossing-free, but all six frame-0 dots miss their true origins. The explicit rubric declares those arrow directions unproven. |
| layout_fit | **blocked** | Final-spec pinned 77×47 render fits at 100%; actual live app measured 83×51. No actual live 77×47 half-pane capture is preserved. |
| conceptual_grouping_color | **pass** | Source-backed edge/work hue families and proximity; client/state separated; causal tiers respected. |
| border_integrity | **pass** | Every node side/corner is complete and per-node color-continuous in normal and selected ANSI; no control-palette overwrite. |
| workflow_evidence | **blocked** | Strong hash/capture evidence and honest recovery disclosure, but incomplete command/status/isolation provenance, target live-pane evidence, and unavailable full geometry/probe record. |
| animation | **fail** | Six origin violations and an additional dot on the source-static Auth→Postgres route. Common slow cadence and single-dot counts pass. |

**Required-edge audits:** six audited, all six fail the explicit origin-based direction gate; none is semantically missing, reversed, or mislabeled. No extra apparent link needs an additional audit row. There is no synchronized-arrival requirement.

## Paths, identities, and immutable blind record

All evidence inventory paths are relative to the repository root. `reviewer-result.json` inventories and hashes the frozen inputs and capture files. Capture locations are 1-based `[column,row,width,height]` inside a referenced viewport/frame; frame-dump wrapper lines do not count as viewport rows. In the supplied lap-analysis text, coordinate pairs instead use `(row,column)`.

- Reviewer: `viz-judge05-pipeline`, `openai/gpt-6.1-sol`. Environment independently reported `PI_SUBAGENT_NAME=viz-judge05-pipeline`, `PI_MODEL=gpt-6.1-sol`.
- The full-task output naming convention requires generator slot `viz-ds05-pipeline`; that is the result's `generator.worker_id`. **Actual supplied generator identity is `viz-ds05-1`**, as both the user and recovered generation record say. The model is `fireworks/accounts/fireworks/routers/deepseek-flash-latest`. The canonical slot label is not a claim that a second worker existed or that a raw generator-session/model-routing transcript was preserved.
- Blind record: `docs/visualize-eval/rounds/05/reviews/pipeline/observed-first.md`.
- Blind SHA-256, verified unchanged before and during stage B: `0ecc05ad42d8884fcb46ce6029688f8de415d975651e1574edd82511881044c1`.
- `observed_first.saved_before_expected_reveal` is **true**, because stage A finished and published this hash before the reveal.

Verified frozen hashes:

| Input | SHA-256 |
|---|---|
| Candidate SKILL.md | `ff4a9d3f32ba0bf86e54ee6bfbac02fdea3fac3b95b82a958b3411accef0a949` |
| Frozen renderer binary | `b1ab9f2e78af11c2f2b005eea083a999079d184bf550e8d0b6d9c51867f22404` |
| Rubric | `039b96252d25ad2078a539fdb1d081ebdb6c09d6f7a3487b96ffbbf3b082e292` |
| Dataset manifest | `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05` |
| Single final spec | `fdb8c42f6810b541b8a5367d9572d2d47ced3e756598658ff61f1c833a935f2f` |

The actual binary was hashed, not executed. Source, expected-data and variant hashes also match metadata. The sole attempt spec is byte-identical to the final spec. No multi-spec manifest is needed.

## Source comparison and complete edge audit

The frozen source qualifies the historical relationships as generated claims, not independently verified application architecture. I preserve that qualification: this is a comparison with the requested diagram's relation set, not new verification of a real deployment. The source does not require preserving the incidental historical left-to-right orientation or old numeric flow values; the top-to-bottom causal tiers and legal constant default speed do not lose a source fact.

All coordinates in this section use the pinned 77×47 capture, evidence ID `lap`. `API` abbreviates the visible label `API gateway` only in the table headings.

| Audit ID | Required relationship | Visible source stem → target head | Label region | Decision |
|---|---|---|---|---|
| cli-api | CLI → API, unlabeled | (37,11) → (37,14), down | none, correctly unlabeled | Static pass; origin gate fail |
| api-auth | API → Auth, verify | (39,19) → (50,22), down/right/down | [41,20,6,1] | Static pass; origin gate fail |
| api-queue | API → Job queue, enqueue | (37,19) → (24,22), down/left/down | [28,20,7,1] | Static pass; origin gate fail |
| queue-worker | Job queue → Worker pool, unlabeled | (24,27) → (24,30), down | none, correctly unlabeled | Static pass; origin gate fail |
| worker-db | Worker pool → Postgres, write | (24,35) → (37,38), down/right/down | [28,36,5,1] | Static pass; origin gate fail |
| auth-db | Auth → Postgres, read | (50,27) → (39,38), down/left/down | [43,36,4,1] | Static pass; origin gate fail; additional motion-scope defect |

All heads are unique intact downward `▼` glyphs directly above their target boxes. Each entire route is traceable. Read/write are not swapped. There are no bus semantics to preserve, no cross-view relation gaps, and no unstated bidirectionality.

There are **zero crossings, zero bridge glyphs, zero touching bends, zero shared route runs, zero drawn junctions**, agreeing with `check.txt`. Eight isolated ordinary bends are at pinned coordinates (37,21), (24,21), (39,21), (50,21), (24,37), (37,37), (50,37), and (39,37). The two API outgoing routes have independent ports and a blank separating column; the Postgres convergence also uses independent ports. These are intentional semantic fan-out/convergence, not fake drawn branches or accidental junctions.

The four labeled routes have their own unambiguous adjacent label slots; none is equally close to another route. All routes are monotone between endpoints without a backtracking loop or avoidable obstacle detour. There is no `routes: N/M near-minimal` line in this frozen build. Metadata explicitly acknowledges that baseline limitation; I do not require a nonexistent metric or substitute a current renderer build.

## Concrete defects

### F01 — HIGH: every dot starts one drawn cell too late

**Classification: defect. Categories: arrow_traceability and animation.** This is one root cause, not twelve independent defects.

| Route | True origin | Frame-0 dot | Evidence region |
|---|---|---|---|
| CLI → API | (37,11) | (37,12) | lap frame 0 [37,11,1,2] |
| API → Auth | (39,19) | (39,20) | lap frame 0 [39,19,1,2] |
| API → Job queue | (37,19) | (37,20) | lap frame 0 [37,19,1,2] |
| Job queue → Worker pool | (24,27) | (24,28) | lap frame 0 [24,27,1,2] |
| Worker pool → Postgres | (24,35) | (24,36) | lap frame 0 [24,35,1,2] |
| Auth → Postgres | (50,27) | (50,28) | lap frame 0 [50,27,1,2] |

The true origin is the **first drawn cell after the source border port**, not the first eligible interior dot cell. All six origins here are straight cells, so there is no corner-definition ambiguity. The full-lap sequence never visits any true-origin cell.

`check.txt` claims `origins: 6/6 routes start at their arrow origin` and zero dot violations. **The captures contradict that claim on all six routes; the captures win.** The lap helper calls its initial dot cells “origin,” but that naming cannot redefine the frozen rule. The generation records admit the worker never recorded its own origin measurement. My blind measurement is the primary coordinate evidence, not a repaired generator self-audit.

Static arrowheads still make the intended directions recoverable. That does not waive the category's explicit rule that an off-origin dot makes direction unproven.

### F02 — MEDIUM: source-static database read receives added motion

**Classification: defect. Category: animation.** Evidence: `lap` [39,27,12,12], especially frame 0 [50,28,1,1]; normal ANSI also has the read-route dot at [53,33,1,1].

The frozen historical variant marks five routes with `flow`: CLI→API, API→Auth, API→Job queue, Job queue→Worker pool, and Worker pool→Postgres. Auth→Postgres `read` has **no flow**. The final candidate sets `flow: true` and `dots: 1` on all six edges, and the extra read-route motion is observable.

The current round's animation category and frozen skill both say dots appear **only where the source animated them**. Case-level required animation does not erase that edge-level scope. This is an animation-scope violation, not a false relationship: the read edge itself is required and correctly directed. It does not violate the source's separate prohibition on *background/border* dots; those remain absent. No explicit no-motion prohibition for the whole case is invented.

## Motion findings that do not add failures

The pinned dump contains 53 frames, 0–52, at 100 ms intervals. Every frame has exactly six dots, one per current animated route. Ordered dot tracks and all verbatim label/border measurements remain in the blind record.

| Route | Distinct visited dot cells | Observed lap |
|---|---:|---:|
| CLI → API | 2 | 400 ms |
| API → Auth | 11 | 2200 ms |
| API → Job queue | 13 | 2600 ms |
| Job queue → Worker pool | 2 | 400 ms |
| Worker pool → Postgres | 13 | 2600 ms |
| Auth → Postgres | 19 | 3800 ms |

Every route satisfies visited-cell index `floor(frame/2) mod N`: exactly one visited-cell advance per 200 ms, with a shared phase and sparse, slow cadence. The longest observed lap is 38 frames, not a first completion at frame 53. The recovered generation sentence “lap closes at frame 53” is imprecise; the actual dump covers all laps anyway.

- **Unequal arrival/lap times — non-defect.** Constant speed is legal and default; no source requests same-arrival. I do not reintroduce the reversed round-03 default.
- **Four routes skip corners — non-defect on the observed legibility evidence.** Example: API→queue moves (37,20) to (36,21), bypassing (37,21); Auth→Postgres moves (50,36) to (49,37), bypassing (50,37). This produces a two-cell Manhattan jump at those updates, not perfectly uniform physical grid-distance motion. However all six share the same visited-cell cadence, the bend glyphs stay visible, direction remains readable, and no dot rests on a prohibited non-origin corner, bridge, junction, or label. The rubric prohibits resting there, not skipping. I do not count skipping as prohibited occupancy or add a new smooth-interpolation condition.
- **No dot ever reaches its arrowhead — observed, but not an independent constant-mode defect.** This persists through full laps, so it is not an incomplete-evidence excuse. Nevertheless the pinned rubric requires visible head-touching arrival specifically for opt-in same-arrival timing, absent here. It does not impose that endpoint occupancy on constant mode. The blind scorecard's six “routes without arrowhead visit” remain valid observations, but its pre-rubric origin-plus-arrival property count is **not** a stage-B count of twelve rubric defects. There is no simultaneous arrival to verify, and `arrivals: 0/0` proves none.

The rule disagreements are therefore resolved narrowly: F01 fails actual origins; it does not license failing every other motion property.

## Fit, color, borders, and evidence blockers

### B01 — missing actual target-size live-pane proof

**Classification: evidence gap / blocker, not observed clipping. Categories: layout_fit and workflow_evidence.** Relevant regions: normal ANSI header [2,1,71,1]; pinned dump header [2,1,71,1]; pinned graph bounds [23,7,32,36].

Normal/selected live ANSI grids independently measure 83×51, with `83x51 @100%` in the app header. The separate geometry probe reports an outer even 85×53 split on each side of a 170×53 area, with inner app viewport 83×51. Those are distinct, disclosed dimensions, not an invented 77×47 live pane.

The pinned final-spec dump reports `viewport: 77x47 zoom: 1.00 natural`. All nodes, full labels, routes, heads and controls fit. Graph ink is 32×36 in both sizes, compatible with the check's 36×40 margin-inclusive extent. No palette covers Postgres at the target; the palette ends at column 10 while Postgres begins at column 36.

Metadata records that the validator was changed before generation to accept pinned dumps when live panes were larger. I acknowledge this as valid target-size **render/motion** evidence. It is not an actual live 77×47 half-pane capture under the unchanged category's wording. Thus `viewport.verified=false`, `live_pane={columns:83,rows:51}`, and layout remains blocked rather than being declared an overflowing failure or silently green. The 83×51 short sequence also does not by itself cover its longest lap; no new viewer session was run to fill either gap.

### Border and grouping passes, with stated limits

The all-selected ANSI proves each of six v1 node occurrences has its own bold accent border: **6/6** final-view occurrences, not six separate selection interactions. If auxiliary 77×47 occurrences are counted separately, it covers 6/12 occurrences across sizes; there is no selected ANSI at 77×47. Normal/selected perimeter checks include all 140 border cells across the six boxes. Every side and corner is intact, same color along each node perimeter, and unobstructed.

Normal hue families: API/Auth blue (125,160,184 and 151,184,206); queue/workers pink (211,134,155 and 226,156,175); CLI teal (125,174,163); Postgres green (169,182,101). Selection is bold accent (216,166,87) on every node border. Related concepts are near each other, and the background/node fill is the same plain (40,40,40). No unsupported enclosing-group geometry is claimed. Target text proves complete target perimeters, not their RGB; target live/color evidence limitations are explicitly retained rather than inferred from plain text.

### B02 — incomplete recovered workflow provenance

**Classification: evidence gap / blocker. Category: workflow_evidence.** The captain-assembled `generation.json` and `.md` disclose two ENOSPC crashes and their reconstruction from preserved artifacts. **Captain authorship alone is not a defect**, and I do not reject objectively hashable capture evidence because its summary was recovered.

What is supported: frozen input hashes; one kept candidate with raw check stdout; final spec identity; manifest check exit 0, timestamps and cleanup claim; normal text/ANSI and all-selected capture; short timestamped frames; pinned full-lap target dump; pre-reveal blind record; declared generator/model identity and separate Sol reviewer.

What is not fully preserved: exact check, normal/selected capture, pinned full-lap and cleanup invocations with complete command/status output; distinct check stderr evidence; fresh generator isolation/model-routing transcript; complete probe records; saved validator output. The short dump wrapper does retain its absolute-binary 19-frame command. A missing separate validator result is not itself a new rendering criterion, but no validator success may be asserted. `generation.md` contains literal `{spec_h[:16]}` rather than a usable hash; the verified spec and JSON supply the real hash, so that placeholder is a recovery-quality limitation, not a new spec mismatch.

Summary claims cannot reconstruct the missing raw provenance. Equally, a missing raw transcript does not negate the exact coordinates independently measured from the surviving captures. Workflow remains blocked, while F01/F02 remain failures.

### B03 — oversized then unavailable raw geometry record

**Classification: resource/evidence blocker. Category: workflow_evidence.** The read tool rejected `pipeline/geometry.txt` because it exceeded 2 GiB. A bounded read-only Python inspection measured **385,578,044,677 logical bytes**, **385,578,045,440 allocated bytes**, and read only its first/last 4096 bytes. These contained repeated geometry records, a timestamp `2026-11-02T15:55:04Z`, app/outer split measurements, clamp probes and restored-layout snapshots, and final `cat: stdout: No space left on device`.

Between that inspection and report construction, the raw file **disappeared**. The first report-builder attempt consequently raised `FileNotFoundError`. I did not remove, truncate or repair it, and make no claim about who changed it or why. The builder was adjusted only inside this review directory to preserve the already observed measurements as `geometry-excerpts.json`.

That file is a **transcribed observation derivative**, not a raw byte snapshot. Its inventory hash identifies only the derivative, never the original 385 GB record. No original full-file SHA-256 or complete probe audit is fabricated. This previously unreadable, now unavailable geometry record is an additional evidence limitation discovered in stage B; the immutable blind record is not rewritten to pretend stage A inspected it.

## Cleanup

No reviewer-created viewer pane exists. The preserved capture manifest records `w7E:pGD` as `confirmed_closed`. Initial bounded geometry inspection explicitly showed `w7E:pGJ` and `w7E:pGN` confirmed closed, then a restored layout containing only parent `w7E:pFF`, indirectly establishing other probe panes `w7E:pGK` and `w7E:pGM` absent. The result reports those five owned capture/probe panes closed on this record-based basis. Parent `w7E:pFF` is not claimed as an owned disposable pane. Missing exact close-command/status transcripts and later unavailability of the original probe log remain B02/B03; I did not run live cleanup probes.

## Correction candidates — proposals only

### Skill/generation-level

1. Preserve an edge-level motion ledger from the source. Do not automatically set flow on all six relations when the source animated only five; keep the required static read link visible.
2. Require an actual frame-0 coordinate audit against the first drawn source cell, not a copied `origins: N/N` line or a helper that names its first observed dot “origin.” Report check/capture disagreement before calling a candidate complete.
3. Preserve bounded raw commands, stdout/stderr/status, dimensions and cleanup records atomically. Recovery summaries should remain labeled derivative evidence; guard against accidental self-appending probe logs. Keep these evidence-capture recommendations separate from renderer improvements.
4. Resolve the target live-pane evidence gap with the captain/harness in a later run; do not overwrite a frozen result or claim an 83×51 pane was 77×47. A future protocol change must be labeled, not applied retroactively to make this sample green.

### Renderer/check-level

1. The frozen executable produces the off-by-one source exclusion under a standard supported spec. Align animation initialization/eligible cells with the pinned FIRST-drawn-cell rule and make the check inspect the same rendered coordinate. This is a renderer/check correction candidate inferred from the executed evidence, not a claim based on current source code.
2. Corner skipping and constant-mode arrowhead exclusion may merit a design discussion, but are **not additional failures here**. Do not force same-arrival or slow down long routes to repair an origin defect. Do not make a dot park on forbidden non-origin bends to smooth motion.

No fixes, installs, commits, new viewer sessions, model switches, or subagents were used. No current renderer source replaced frozen execution evidence. Gather all eight complete critiques before revising the skill; renderer gains must not be attributed to the skill.

## Deliverables and verification

- `reviewer-result.json`: fixed result-schema fields, all seven categories, six complete edge audits, two findings with capture regions, three blockers, evidence hashes and cleanup records.
- `critique.md`: this adjudication.
- `geometry-excerpts.json`: explicitly derived observations of the unavailable geometry record.
- `build-review.py`: small review-only builder/validator; does not run the viewer.

The builder verifies frozen hashes and every inventoried artifact hash, checks evidence references, and validates the result offline against the embedded schema using the JSON Schema keywords present there. No dependency installation was needed. The blind file remains unchanged and its original hash is carried in the evidence inventory.
