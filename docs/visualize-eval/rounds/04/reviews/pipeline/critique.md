# Pipeline — round 04 independent Sol critique

## Verdict: FAIL

Four applicable categories pass, two fail, and one is blocked. All six required relations are semantically correct and statically traceable, but every animated edge violates the explicit origin rule. Missing workflow evidence is reported separately and does not hide these known failures.

| Fixed category | Decision | Basis |
|---|---|---|
| semantic_fidelity | **pass** | Six required concepts, six correctly directed relations, all four action labels, and both intentionally unlabeled relations remain visible. Read/write and auth/queue paths stay separate. |
| arrow_traceability | **fail** | Static stems and heads are readable, with no crossings or route detours. However, all six frame-zero dots start after the first drawn stem cell; the rubric expressly makes that an arrow-direction failure. |
| layout_fit | **pass** | App-measured live `77x47 @100%`; 77×47 ANSI buffers; full graph, labels and heads visible without pan, zoom or overlay occlusion. Zero observed crossings agrees with the check. |
| conceptual_grouping_color | **pass** | Async queue/worker are proximate and share related green shades; client/control/identity/storage have role-based hues. Source tiers remain intact. Plain canvas and box backgrounds match. |
| border_integrity | **pass** | All six normal and selected perimeters are complete and color-continuous. All-selected ANSI covers 6/6 occurrences and all 140 perimeter cells. |
| workflow_evidence | **blocked** | Frozen hashes, identities, blind record, pane geometry, checks and cleanup confirmation exist. Full long-route cycle evidence and exact raw attempt/probe execution records do not. |
| animation | **fail** | All six origins are offset. The two short hops visibly bobble instead of convincingly conveying directed traffic. Long-route later arrival is legal and is not a failure. |

Applicable category total: **7**. Passed: **4**. Failed: **2**. Blocked: **1**. Findings: zero critical, three high (one defect and two evidence gaps), one medium defect. The counts do not represent four independent rendering faults: F1 is the same origin defect applied to the two categories that explicitly require it.

## Identity, inputs, and blind-record integrity

- Generator: `viz-ds04-1`, `fireworks/accounts/fireworks/routers/deepseek-flash-latest`.
- Reviewer: `viz-judge04-pipeline`, `openai/gpt-6.1-sol`.
- The case-specific revealed generator identity and the preserved generation record agree. I retain that actual identity rather than replacing it with the full-task template's generic `viz-ds04-pipeline` spelling. No model substitution is used. The stale `openai/gpt-6-astra` wording in the workflow category does not override the frozen required reviewer model, schema constant, or explicit Sol instructions.
- The blind record was saved and hashed before expectations were revealed. It has not been modified:
  - `docs/visualize-eval/rounds/04/reviews/pipeline/observed-first.md`
  - SHA-256: `7e18c6bd4a40966eb619f1370ee564715bef308cf1d7733a13bf33ae8c358a06`
  - `observed_first.saved_before_expected_reveal: true` in the JSON result; the evidence inventory includes this file and actual hash.
- Final spec: `docs/visualize-eval/rounds/04/pipeline/specs/v1-final.json`.
- Final spec SHA-256: `fd8c35436a83da8412417e3a72037092fa4800d17ed6eced13779290979159ad`.
- There is one final view/spec. Rejected draft specs are preserved workflow artifacts, not additional final specs. No multi-spec manifest is needed.

I independently verified the frozen candidate skill, renderer binary bytes, rubric, dataset manifest, pipeline source/expected/variants, all manifest-listed artifacts, all three attempted-spec hashes, and the saved blind hash. All matched the supplied frozen metadata. The renderer was hashed, not executed. Hash fields in `reviewer-result.json` use those verified frozen identities; no current renderer source or current installed skill substitutes for an executed frozen input.

### Path and coordinate conventions

All evidence inventory paths are repository-relative, rooted at `/Users/aviral/.herdr/worktrees/dotfiles/fix-visualize-skill`. External renderer identity is bound through the repository-relative `evidence/v1/bin.sha256`, independently checked against `/tmp/visualize-eval/round-04/bin/rataflow-view`.

Capture locations use 1-based `[column,row,width,height]`, starting at the viewer's header row. They exclude the direct capture's `viewport:` and frame/time wrapper lines. Evidence IDs `frames-0`, `frames-2`, `frames-18`, and `frames-20` bind regions to explicit frames within the same hashed direct-capture file. The immutable blind record contains the complete label/border inventory and all 21 frames' dot coordinates.

## Source versus actual view

The source explicitly qualifies its relations as historical generated claims, not independently verified application architecture. This review checks preservation of those qualified facts, not their external truth. All six concepts are visible: CLI, API gateway, Auth, Job queue, Worker pool, and Postgres. No technology or protocol is invented on the source's two unlabeled hops.

There is one complete final view, so no relation or qualifier requires cross-view stitching. Source does not constrain the auth/queue pair's lateral order; placing queue left and Auth right does not reverse a source-defined tier or order.

### Per-edge audit

The JSON contains a full audit for each source relation. No extra apparent relation exists: the source box's two outbound ports are not a shared-route split, and the two database approach ports do not create an extra relation.

| Edge | Source-required relation | Observed stem → bends → head | Label and owner | Edge verdict |
|---|---|---|---|---|
| e1 | CLI → API gateway, unlabeled | `(37,11)` → downward head `(37,14)` | No invented label | **fail F1**; static meaning passes; short-hop issue F2 |
| e2 | API gateway → Auth, `verify` | `(39,19)` → `(39,21)` → `(50,21)` → head `(50,22)` | `verify` `[41,20,6,1]`, uniquely this route | **fail F1**; static meaning passes |
| e3 | API gateway → Job queue, `enqueue` | `(37,19)` → `(37,21)` → `(24,21)` → head `(24,22)` | `enqueue` `[28,20,7,1]`, uniquely this route | **fail F1**; static meaning passes |
| e4 | Job queue → Worker pool, unlabeled | `(24,27)` → downward head `(24,30)` | No invented label | **fail F1**; static meaning passes; short-hop issue F2 |
| e5 | Worker pool → Postgres, `write` | `(24,35)` → `(24,37)` → `(37,37)` → head `(37,38)` | `write` `[28,36,5,1]`, left database approach | **fail F1**; static meaning passes |
| e6 | Auth → Postgres, `read` | `(50,27)` → `(50,37)` → `(39,37)` → head `(39,38)` | `read` `[43,36,4,1]`, right database approach | **fail F1**; static meaning passes |

Each head is the intact `▼` directly above its target's complete top border. Every first stem cell sits immediately below its source's complete bottom border. There are eight ordinary route bends, zero crossing bridges, zero touching bends, zero shared runs, zero T/cross/bus junctions, and zero label cells on routes. The blank column between the two API ports, and between the two Postgres ports, keeps their routes independent. No label is as close to a foreign route as to its own edge.

All six visible paths are monotone, obstacle-safe staircases. The check agrees: `crossings: 0 bridges, 0 touching bends` and `routes: 6/6 near-minimal, 0 detours, 0 shortened`. The tall Auth read path is not a gratuitous loop. A declared bus is neither required nor appropriate for this source. No universal no-bus condition is being imposed on other sources.

## Findings and round-04 motion interpretation

### F1 — HIGH defect: every frame-zero dot starts one cell late

Evidence: `frames-0`, `blind`, `check`, `validator`.

| Edge | First drawn cell | Frame-zero dot | Evidence region |
|---|---|---|---|
| e1 | `(37,11)` | `(37,12)` | `[37,11,1,2]` |
| e2 | `(39,19)` | `(39,20)` | `[39,19,1,2]` |
| e3 | `(37,19)` | `(37,20)` | `[37,19,1,2]` |
| e4 | `(24,27)` | `(24,28)` | `[24,27,1,2]` |
| e5 | `(24,35)` | `(24,36)` | `[24,35,1,2]` |
| e6 | `(50,27)` | `(50,28)` | `[50,27,1,2]` |

The first stem is visibly drawn and belongs to the arrow. Calling it a port stem and excluding it from a traversable-dot array does not change the rubric's definition: first drawn cell after the source port. The reader sees a dot already separated from the box by an intervening line cell. The generator acknowledges this discrepancy in its known defect d3.

`origins: 6/6` and the validator's origin PASS are contradicted by coordinates. This is an observed defect, not a missing-evidence issue. It fails **animation** and, by the explicit origin clause, **arrow_traceability** for all six edges. The static heads still communicate correct semantic direction, so no source relationship is declared missing/reversed and semantic_fidelity remains pass.

### F2 — MEDIUM defect: two short routes read as a bobble

Evidence: `frames-0` and `frames-2`, regions `[37,11,1,4]` and `[24,27,1,4]`; all subsequent paired frames in `frames-all` confirm the repetition.

- e1: `(37,12)` ↔ `(37,13)`.
- e4: `(24,28)` ↔ `(24,29)`.
- Each position holds 200 ms. Each cycle lasts 400 ms. Five cycles occur in the saved window.

These dots are not absent or static: they visibly change position. But every single downward move is followed by a return upward, with too little travel to distinguish wrapping from reverse movement. The arrows, rather than the motion, carry direction. I judge this a localized failure of the requested slow, sparse traffic animation, not a false source relation or a new critical issue. The generator independently documents it, and the frozen skill says not to animate routes too short to show motion.

The overall animation verdict would remain fail even if this legibility judgment were relaxed, because F1 is independently decisive.

### Constant-speed default — legal, not a synchronized-arrival failure

The source requests slow, sparse motion, not same-arrival timing. The final spec uses `flow: true`, `dots: 1`, with no opt-in same-arrival timing or duration field. The historical variant's numeric rates do not override the qualified source and current round's default.

The measured cadence is shared: positions hold on paired frames and update every 200 ms, consistent with 0.5 eligible-slot steps per 100 ms. All six routes have one dot in all 21 direct frames. Long routes are allowed to finish later. **Unequal arrival time is not a defect.**

No observed dot touches an arrowhead. Under this constant-mode source, **that is not an arrival-visibility defect**: the rubric requires visible touching only for requested same-arrival mode. The short routes' pre-head resets inform F2's legibility decision, but I do not invent a constant-mode head-touch gate.

### Corner skipping — observed limitation, accepted as locally legible

At frames 1→2, e2 jumps `(39,20)` → `(40,21)`, e3 jumps `(37,20)` → `(36,21)`, and e5 jumps `(24,36)` → `(25,37)`. At frames 17→18, e6 jumps `(50,36)` → `(49,37)`. Each bypasses a rounded corner cell that remains visible. These are two Manhattan grid steps in one update rather than one; the blind record's rejection of unqualified uniform geometric grid speed remains accurate.

For the round-04 animation legibility judgment, I accept these short, isolated diagonal transitions: they maintain the visible turn, leave every glyph intact, move forward, and do not invite a wrong branch or label ownership. The dots share the eligible-position cadence. I do **not** count four corner skips as four additional defects, nor add a separate Manhattan-distance pass condition. This acceptance does not excuse F1/F2 or establish an unseen full cycle.

Across 126 direct dot samples there are zero missing/excess instances, zero dots on corners/bridges/junctions, zero label/node/border occupancies, and zero arrowhead occupancies. Normal and selected static ANSI dots are also confined to straight route cells.

## Evidence gaps and blockers

### F3 — HIGH evidence gap: full cycles of four long routes are not captured

`captures/v1-frames-direct.txt` is a complete **21-frame window**, not a complete cycle for e2/e3/e5/e6. At frame 20 their dots are respectively `(49,21)`, `(27,21)`, `(34,37)`, and `(48,37)`, still away from their destination ends and not returned to their frame-zero starts. Full-cycle wrapping and later-route behavior cannot be audited.

The direct capture is valid actual-render evidence at the pinned target size, including the missing frame 0 and `viewport: 77x47 zoom: 1.00 natural`. Its usefulness is not rejected just because it is out of pane. The terminal pane frames confirm matching later positions, but truncate frame 0 and supply no later window.

The full task requires full-cycle target-size motion proof. Its absence blocks **workflow_evidence** and the completeness of animation verification; animation remains **fail** for already observed defects. This is an evidence-coverage blocker, **not a demand that long constant-speed routes finish by 2000 ms**. No simulated later position or extrapolated cycle is accepted as captured evidence.

The frozen skill's statement that 21 frames at 100 ms covers the longest route is false for this specimen at the declared default rate. That is a concrete skill-level correction candidate, not a reason to waive the evidence gate.

### F4 — HIGH evidence gap: exact execution and probe records are incomplete

All three attempted specs and full raw check text files exist. Their hashes match. The first orientation draft is too wide; the second is accepted; the third adds ambiguous label ownership and is rejected. The third check explicitly calls its long route **forced** and says no shorter obstacle-safe path exists. I do not use the generator's contrary narrative about that rejected draft to accuse the final graph of a detour, nor count a rejected draft as an additional final-view visual failure.

However, `attempts.json` supplies specs, raw text locations, notes and verdicts, not exact executed per-attempt command/cwd and raw exit-status records. No preserved harness invocation or raw launch/close/probe command/status transcript is present in the case's complete file inventory. Final `check_exit: 0` and check/capture timestamp windows are preserved in `manifest.json`; they establish that final record but do not fill missing draft/probe details. No stderr stream/status provenance is separately bound for the attempted checks. The direct dump and validator command strings are recorded, but not the missing execution details.

The pane size itself is **not** blocked: the running app's own header proves `77x47 @100%`, which the rubric explicitly allows. The manifest's null rectangle and null `pane_cols` are not treated as fabricated geometry. Live dimensions are recorded separately in the JSON as 77×47, supported by that app measurement.

Cleanup of generator pane `w7E:pDJ` is recorded as `confirmed_closed` in the manifest and corroborated by generation.json. I preserve that cleanup result, with `owned_pane_ids` and `closed_pane_ids` both containing that ID; I do not invent raw probe output. Missing exact probe records remain a workflow evidence gap. The reviewer opened no panes and ran no viewer, so no new cleanup action is needed.

There is **no demonstrated unavailable model or renderer feature blocker**. The two unresolved blockers are missing frozen evidence. Origin offset is an observed renderer-behavior defect, not an unsupported capability inferred from current code.

## Borders, grouping, and selection: evidence-supported passes

The blind record's normal border measurements are confirmed:

- CLI `(216,166,87)`; API gateway `(125,174,163)`; Auth `(211,134,155)`.
- Job queue `(169,182,101)` and Worker pool `(189,201,124)` share the async green family.
- Postgres `(125,160,184)` is storage-colored.

Every side and corner of each node uses its one normal RGB value. All-selected ANSI changes all borders to accent RGB `(216,166,87)` and makes all 140 perimeter cells bold. CLI's selected and normal hues match, but the bold attribute differs. Therefore the generator's claim that CLI has no distinguishable selected state does not establish a failure under this border gate. Selection coverage is 6/6, not 5/6. Independent single-node selection interactions are not evidenced and are not an added requirement.

The graph bbox `[23,7,32,36]` ends at column 54, row 42; controls `[2,41,9,6]` are separate. The viewer measures 77×47 and both static ANSI buffers actually contain that grid. No clipping, hidden items, or pan/zoom-only labels are observed. The difference between check extent 36×40 and drawn graph bbox 32×36 is not evidence of clipping; the actual capture proves fit.

## Correction candidates — not implemented

### Skill-level

1. Require coordinate-based frame-zero verification instead of accepting `origins: N/N` as authoritative. Explicitly reject a visible stem cell skipped by the dot.
2. Replace the fixed “21 frames covers the longest route” claim with coverage based on actual route travel and wrap, retaining the original timestamped target-size evidence. Constant-speed mode must stay constant; do not speed up long routes to manufacture synchronized completion.
3. Detect two-state short-hop bobbling before accepting motion. Prefer static short hops with a recorded reason, while retaining requested sparse motion on useful routes, rather than adding semantically unnecessary bends or detours merely to lengthen a path. This is the frozen skill's existing short-route policy, not permission to remove the case's required animation altogether.
4. Preserve the exact commands, cwd, stdout/stderr and raw exit statuses for every attempted check and launch/close/probe operation. Keep rejected drafts and actual measurements; do not replace missing transcripts with narrative verdicts.
5. Preserve the successful source mapping, single-view coverage, conceptual hues, border evidence, and route economy. Do not revise facts merely to clear a motion check.

### Renderer/check or harness-level

1. Align the displayed frame-zero sample with the first visible route cell, including a corner when it is the true first cell. Align origin diagnostics with that visible definition.
2. Revisit short-route dot wrapping so that it does not read as repeated reverse traffic, or expose a reliable policy to suppress misleading short-hop dots without removing the link.
3. Retain the legible corner glyphs. If animation interpolation changes, verify actual path speed and all protected glyph cells rather than assuming array-index speed is pixel-grid speed. Corner skipping alone is not failed here.
4. Make capture storage retain the complete frame-zero output and enough frames for the longest cycle. Bind raw commands/status and cleanup probes into the manifest.

No code, skill, renderer, spec, expectations, or captures were changed. These are candidates for the captain only after gathering all eight critiques. No renderer gain is attributed to this skill-only round.

## Verification and deliverables

- `reviewer-result.json` conforms to the frozen embedded result schema. Validation used an offline Python standard-library evaluator implementing all schema keywords used here; no dependencies were installed.
- Evidence IDs, finding references, all six audited edge IDs, actual inventory hashes, and unchanged blind hash were checked.
- All evidence is capture-backed or explicitly classified as missing. Passing generator validator output is inventoried, not substituted for independent judgment.
- No new viewer sessions, fixes, installs, commits, or subagents were used.

Files:

- `docs/visualize-eval/rounds/04/reviews/pipeline/observed-first.md` — unchanged stage-A record.
- `docs/visualize-eval/rounds/04/reviews/pipeline/reviewer-result.json` — structured stage-B result with 32 hashed inventory entries and all seven categories.
- `docs/visualize-eval/rounds/04/reviews/pipeline/critique.md` — this critique.
