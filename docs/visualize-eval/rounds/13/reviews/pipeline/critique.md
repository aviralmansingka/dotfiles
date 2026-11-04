# Round 13 — pipeline independent review

**Overall: FAIL.** The graph passes the content, routing, target-fit, navigation, grouping, family and animation gates. Workflow evidence fails because the frozen dataset digest does not match the supplied dataset. Border integrity is blocked because the only colored captures clip most of the Postgres border. All six required edges pass. Evidence paths in the JSON are repository-relative; coordinates are 1-based in their referenced captures.

| Category | Verdict | Basis |
|---|---|---|
| semantic_fidelity | PASS | Six named nodes and six historical relations are visible, with correct directions and verb ownership. The two unlabeled links have no invented protocol. |
| arrow_traceability | PASS | Separate source stems and arrowheads, no crossings or fake branches, and zero unrelated-node near misses in capture and check. Read and write remain distinct. |
| layout_fit | PASS | The final-spec pinned 77×47 direct dump shows the complete graph at natural zoom without an overflow banner. This is branch A, not an inference from the check. |
| navigation_clarity | PASS | One concept, one fitting single-graph view: the rubric's title/description exemption applies. No canvas navigation is required. |
| conceptual_grouping_color | PASS | Client blue, services pink shades, workers green shades, store orange. Related nodes share meaningful hue families, with no drawn group boxes. One view means no cross-view hue drift. |
| category_fit | PASS | The stated and judged dominant family is **flow-chains**: six relations, connected directional progression, fan two, no bus, reciprocal pair or identifier-heavy map. Short ranks, separate corridors and sparse moving dots are visible. The recorded top-to-bottom deviation is backed by the overflowing left-to-right attempt. The generator's separate tie-breaker says there is no double-arrowhead target, but Postgres visibly has two; this is a record error, not a reason to reject the supported family. |
| border_integrity | BLOCKED | Pinned text shows complete boxes, but does not prove color. In both live ANSI captures Postgres is cut off below its top border; complete normal and selected Postgres border color continuity is unverified. Five other complete selected borders are shown. No color defect is inferred from this absence. |
| workflow_evidence | FAIL | The actual SHA-256 of `docs/visualize-eval/cases.json` is `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05`, but frozen metadata and generation claim `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05`. The claimed frozen dataset identity is not reproducible. The ANSI coverage gap above remains. |
| animation | PASS | Six source-hued dots start at the respective route origins; 40 timestamped frames show no dot resting on labels, arrowheads or corners. The independently rerun frame audit passes at 0.500 cells/frame for tracked routes and zero rate spread. No synchronized arrival was requested. |

## Reader job and material limitations

The pinned target is small and readable at a glance; all six components and separate read/write paths are visible without dragging. However, the **actual captured live half-pane is 68×44**, not 77×47. It displays a pan prompt and clips the Postgres label and border. In that actual pane the reader cannot perform the brief's no-drag quick-reference job. The rubric explicitly accepts the pinned 77×47 dump for layout fit, so that practical limitation is not misrepresented as a target-fit failure.

The check reports 31×46, while the live header reports a 21×46 canvas. The generator attributes the difference to label gutters, but the evidence here does not independently prove that explanation. The observed target fit rests on the full pinned rendering, not either width claim. The compact a3 draft would fit the smaller pane but its recorded audit fails at 0.000..0.500 cells/frame; it was rejected rather than shipped. The short queue-to-worker route displays only two alternating dot positions before wrap, so the arrowhead is especially important for reading its direction; this does not contradict the source's required direction because the arrow itself is clear.

The source-hue choice is defensible: source-only and destination-only each leave one shared pair. Source binding makes the two API-origin dots share pink, while auth-read and worker-write dots remain distinct. Destination binding would make the latter pair share the Postgres color, although their separate labeled routes would still distinguish them; shared color alone is not proof they would be confused.

## Triage and evidence

The seven recorded questions cover shape, motion, the database paths, scope, reader job, speed semantics and unlabeled links. The three annex answers are verbatim. Scope and reader job are supported by the brief; the speed interpretation is consistent with the annex's direction-over-speed answer. The no-protocol decision is recorded as own judgment with a source-based reason. No invented user answer is evident. The convergence record stops after the three annex answers and the brief/source-resolved questions, consistent with the quick-reference framing's one-pass intention. One fitting view is the right shape; splitting would add navigation to a small connected graph. The triage record passes its honesty review, independently of the dataset-hash failure.

The provided validator reports success, but does not resolve the frozen dataset digest mismatch or prove the clipped selected border. Manifest artifact hashes were independently checked; the frozen renderer, rubric and skill hashes matched. The offline frame-audit tool was rerun against the final pinned capture and reproduced PASS. Cleanup is `confirmed_closed` for owned pane `w7E:pZX`. The blind record was saved before the reveal and remains unchanged; its SHA-256 is `ac0648e162db959dc40831910942139b7fcb03c89ead483fea29bfd07570ff7b`.

The result JSON uses the *actual* dataset digest, not the conflicting requested/frozen value. The requested extra top-level `blind_observation_sha256` property is incompatible with the rubric schema's `additionalProperties: false`; the same digest is included in the `blind` evidence entry instead. The single-spec candidate and spec digests are identical.

## Correction candidates and blockers

- **Skill/evidence workflow:** freeze and verify dataset hashes against actual bytes, and capture normal and selected ANSI states at a size that shows all node borders. Check real pane dimensions before claiming a diagram serves a no-drag reader job. Correct the classification tie-breaker record.
- **Engine/evidence tooling:** investigate why check extent and app canvas width differ, and make the extent definitions explicit. A compact layout that preserves enough drawable motion on very short hops could improve real smaller-pane usability; the failed a3 audit does not prove the exact cause of its rate discrepancy.
- **Unresolved blocker:** no complete normal or select-all ANSI/buffer evidence for the Postgres border. Do not treat monochrome pinned text as color proof.
