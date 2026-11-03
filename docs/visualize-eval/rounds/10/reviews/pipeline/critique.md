# Independent review — pipeline, round 10

**Verdict: PASS.** All eight applicable categories pass; all six required directed edges pass. No unresolved capability blocker. This is the judgment of `viz-judge10-pipeline` on `openai/gpt-6.1-terra:high`; the generator was `viz-ds10-1` on `fireworks/accounts/fireworks/routers/deepseek-flash-latest`. Round is integer 10 as explicitly directed for this run; the full-task document's stale instruction to use 9 is not the requested round.

Evidence paths in `reviewer-result.json` are relative to the repository root. In this critique, `pipeline/` abbreviates `docs/visualize-eval/rounds/10/pipeline/`, `cases/pipeline/` abbreviates `docs/visualize-eval/cases/pipeline/`, and bare review filenames refer to `docs/visualize-eval/rounds/10/reviews/pipeline/`. `observed-first.md` was saved before the expected data was revealed and was not modified afterward; its verified SHA-256 is `b4b2cf06164c481bcd5919b749b4211cee92f38356ff230e10133ff46cfe30f7`.

## Category matrix

| Category | Decision | Independent basis |
|---|---|---|
| semantic_fidelity | pass | `cases/pipeline/source.md` and `expected.json` require CLI, API gateway, Auth, Job queue, Worker pool, Postgres and six specific directed edges. All labels and relationships are visible, including separate Auth read and Worker write. No extra apparent relationship. |
| arrow_traceability | pass | Six separate stems lead to six downward arrowheads in `pipeline/evidence/v1/v1-text.txt`; no junction, shared corridor or crossing. Read and write reach distinct Postgres ports, [40,40] and [42,40]. Routes follow near-minimal obstacle-safe paths; no visible unnecessary loops. |
| layout_fit | pass | Final spec's pinned capture says `viewport: 77x47 zoom: 1.00 natural` and shows the complete drawing and control palette without overlap or overflow. The actual pane is separately and honestly measured by its header as 82×51 at 100%; the pinned ruling applies. Check extent is 31×36, with zero bridges or touching bends. |
| conceptual_grouping_color | pass | ANSI shows five distinct family hues, with queue and worker in related yellow-green shades. Logical grouping preserves their relationship and stage proximity; no group rectangle/title is painted, correctly. Source requests semantic tiers but names no additional tier titles. |
| category_fit | pass | Correct and stated family **flow-chains**: six nodes, six edges, shallow processing path, animated traffic; no anti-parallel pair or bus. Capture shows short single-stage ranks and reserved distinct hop corridors; read legitimately spans the worker rank. Generator states the secondary mesh habit, visible as distinct target-aligned read/write ports. Its measured LR attempts of 89×9 and 79×10 both exceed the 77-column budget; `generation.json` records these attempts and the TB yield, meeting the recipe-yield rule. |
| border_integrity | pass | Unselected ANSI and select-all ANSI show complete corners and sides in consistent per-node colors. Select-all covers 6/6 node occurrences simultaneously, not six individually selected captures; the palette does not cover a border. |
| workflow_evidence | pass | Frozen metadata and actual hashes identify the skill, binary, rubric, dataset and final spec. All 13 records have hash-verified stdout/stderr, and `validation-v1.txt` records a successful `--require-records` validation. Manifest hashes verified. Stage A precedes reveal, both identities are distinct, pane dimensions and cleanup are recorded. See the reconciled digest discrepancy below. |
| animation | pass | At pinned 77×47, all six dots start at their respective first drawn route cells and advance at the same observed rate, one eligible position per two 100 ms frames, without resting on non-origin corners, bridges, arrowheads, or labels. Each route has one dot; all traffic edges are animated as requested. The read route completes a full lap by frame 30; see qualification below. Same-arrival was not requested. |

## Edge audit

Coordinates below refer to `pipeline/evidence/v1/v1-text.txt`, 1-based. There are no additional apparent edges or junctions; crossings and touching bends are zero. All arrows have visible downward heads.

| Edge | Expected | Captured trace | Decision |
|---|---|---|---|
| e1 | CLI → API gateway, no verb | Stem [42,13] straight to head [42,16]. | pass |
| e2 | API gateway → Auth, verify | Source [41,21], bends [41,23]/[34,23], head [34,24]; label [34,21,6,1]. | pass |
| e3 | API gateway → Job queue, enqueue | Source [43,21], bends [43,23]/[46,23], head [46,24]; label [44,21,7,1]. | pass |
| e4 | Job queue → Worker pool, no verb | Source [46,29], bends [46,31]/[44,31], head [44,32]. | pass |
| e5 | Worker pool → Postgres, write | Source [44,37], bends [44,39]/[42,39], head [42,40]; label [46,37,5,1]. | pass |
| e6 | Auth → Postgres, read | Source [34,29], bends [34,39]/[40,39], head [40,40]; label [37,29,4,1]. | pass |

The fan stems are symmetric around the API's middle, and the two target ports preserve left/right source ordering. CLI→API uses the center of each box; other lone ports attach on the middle side subject to even-width rounding. The short fan labels remain visually associated with their own routes. The check's clean ownership result is supported by the captured drawing.

## Findings, reconciliations, and classification

There are **no remaining rubric defects or unresolved blockers**. The following are evidence/documentation discrepancies or bounded evidence limitations, not independent failed-category findings:

1. **Resolved evidence gap — generator dataset digest transcription.** `pipeline/generation.json` records `e69179e59a3d36985cd7e8672b319b566701f88caef385c9cbde76d060c92d05`, whereas frozen `rounds/10/metadata.json` and `shasum` of `docs/visualize-eval/cases.json` agree on `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05`. The canonical frozen index and all three pipeline case files independently match their metadata hashes; the actual dataset input remains identifiable. The result uses the verified canonical digest, not the mistyped generator field. This is an audit-trail correction candidate, not evidence of a changed pipeline source.
2. **Resolved evidence gap — verify lap description.** Generator says verify has a seven-cell lap. The pinned frames show its eight eligible positions: frame 0 [38,19], frame 2 [38,20], frame 4 [37,21], then one position every two frames through frame 14 [32,21], returning to [38,19] at frame 16. This does not affect the read route's demonstrated full 15-position lap, frame 0 [31,27] to frame 30 [31,27], or common advancement. At frame 20 each route has advanced ten eligible positions modulo its own lap. Geometric corners are skipped diagonally, so the visual rate is one **eligible dot position** per 200 ms, not strictly equal Euclidean distance through each bend. No dot rests on any non-origin bend. `lockstep-check.txt` explicitly explains its 14 initially unexplained short-route wrap transitions; the raw frames support that explanation.
3. **Resolved evidence gap — frame and pane size.** Pane `--frames` capture holds 19 of 44 requested frames, and the pane is 82×51 rather than 77×47. Neither is hidden. The separately recorded 44-frame pinned final-spec dump establishes target-size fit and the full longest-route cycle. The direct dump's record uses `env` as the wrapper and consequently has a null wrapper `binary_sha256`; its command specifies the absolute viewer path, and the frozen metadata, manifest, binary-hash file and independently hashed viewer establish the intended binary identity.
4. **Recorded sensitivity, not a shipped defect.** `v1-draft1-tb-rejected.json` differs from final `v1.json` only by swapping the declaration order of `verify` and `enqueue`. Captured checks report one ambiguous owner for the former and zero for enqueue-first. The preserved spec bytes, record hashes and recorded outputs substantiate the disclosure without requiring a new run. There are nine spec filenames but eight distinct hashes because the enqueue probe duplicates the final spec.
5. **Recorded yield, not a blocker.** The LR orientation is too wide in both recorded attempts; the 77×47 TB final retains all facts and the chain recipe's corridor properties. The two measured examples establish the recorded, source-preserving orientation yield under the pinned round rule; they do not prove every conceivable different renderer or split impossible.

## Evidence and limits

The machine-readable inventory includes the frozen metadata, source and expected files, all spec files including abandoned probes, the 13 recorded commands and their stdout/stderr files, validation, manifest, `--check`, text, ANSI, select-all, pane frames, pinned frames and blind record. All 26 raw record streams and all manifest artifact hashes were independently verified; no viewer session was run. The recorded validator reports all 34 checks pass. Cleanup records identify harness pane `w7E:pRN` as confirmed closed and the manual probe `w7E:pRD` as `pane_not_found` after close; that latter claim is preserved in `generation.json` rather than independently re-probed.

## Correction candidates, not changes in this review

- **Skill/workflow:** obtain dataset identity from the frozen metadata automatically instead of manually copying a digest; compute route lap lengths directly from captured frames and distinguish eligible positions from geometric distance. Keep declaration-order sensitivity and LR yield explicit.
- **Renderer/harness:** investigate whether label ownership can be made independent of edge declaration order and whether `env`-wrapped record commands can bind the underlying viewer binary hash directly. These are follow-up candidates, not proven skill-caused renderer gains or failures of this shipped view.
