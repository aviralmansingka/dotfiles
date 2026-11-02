# Pipeline, round 08 — independent review

**Overall: fail.** Six source relations are legible and the pinned target-size dump fits, but all six animated dots start one cell late. The rubric explicitly fails both animation and arrow-direction proof for this defect. The source-required semantic tier shades are also not established. Two evidence gaps remain blocked rather than silently passed.

All evidence paths in `reviewer-result.json` and this critique are relative to the repository root. Generator: `viz-ds08-1`, `fireworks/accounts/fireworks/routers/deepseek-flash-latest`. Reviewer: `viz-judge08-pipeline`, `openai/gpt-6.1-terra:high`. The saved blind record `docs/visualize-eval/rounds/08/reviews/pipeline/observed-first.md` has SHA-256 `d89a78689b832ac096155b992d861a0bf5a07e50e913be40b103bcecf0267e46` and was saved before the expected-data reveal; it has not been changed.

## Category decisions

| Category | Status | Decision |
|---|---|---|
| semantic_fidelity | pass | The six concepts and six historical endpoint pairs, including both separate read/write and verify/enqueue paths, are present; no protocol is invented. Static arrows show the expected direction. Motion-origin proof is assessed separately by the stricter arrow gate. |
| arrow_traceability | **fail** | Static stems, routes and arrowheads are legible, with zero crossings or fake junctions. However, the rubric expressly says a dot starting away from its arrow origin makes direction unproven. All six edges fail that gate. |
| layout_fit | **blocked** | The 77×47 natural-zoom full-lap dump shows the entire graph and zero crossings without clipping. It is a pinned direct dump, not an actual measured 77×47 half-pane capture; the actual app header is 83×51. The required target-sized live-pane proof is missing, not visibly defective. |
| conceptual_grouping_color | **fail** | The source explicitly requires semantic tiers and related shades. The ungrouped final spec and ANSI capture do not establish semantic hue families; the generator records this shade requirement as dropped. A graph's topological ranks do not themselves prove conceptual color grouping. Avoiding false regions is correct; a flow-chain does not need decorative group boxes merely to pass this gate. |
| category_fit | pass | `flow-chains` matches the small directed pipeline with a gateway fork, join, E=N and animated traffic. The source-backed family line is recorded in `generation.json`, `generation.md`, and `attempts.json`, together with the spec/captures, so its placement is sufficient. The visible recipe uses staged ranks and separate per-hop corridors. The documented `tb` orientation departure avoids the demonstrated `lr` overflow and immobile short hops; the frozen rubric's chain recipe does not require invented regions. |
| border_integrity | pass | All six boxes have four complete sides and corners with continuous per-node foreground colors in normal ANSI and continuous selected borders in `--select-all`; 6/6 node occurrences are covered. The palette does not overwrite them. These ANSI states are measured at 83×51; they do not supply the missing 77×47 live-pane fit proof. |
| workflow_evidence | **blocked** | Frozen inputs, final spec, separate reviewer identity, blind record, measured app header, target dump, 36-frame full lap, attempt files and closed pane are recorded. The family line is in the generation record and is not missing. However, raw renderer stderr and exit statuses for the rejected probes are not preserved separately; the final manifest supplies its check exit but not a separate stderr transcript. This is a verification evidence gap. |
| animation | **fail** | Motion is required, sparse, and visibly moving; the default constant mode is legal and same-arrival was not requested. All six dots miss the first painted route cell at frame 0, and the clean check contradicts the pixels. Frame 0→2 also advances each dot one eligible dot position, but the CLI and queue dots skip a painted corner and move two route-grid cells while the straight-path dots move one, so shared physical cell speed is not established. |

## Relation audit

Coordinates are 1-based `[column,row,width,height]` in `evidence/v1/v1-77x47-frames.txt` frame 0, relative to the case bundle `docs/visualize-eval/rounds/08/pipeline/`. Each source port and first stem is visible; animated dots obscure one downstream route cell at a time. No edge crosses, touches a bend of another edge, bridges, or forms a shared junction.

| ID | Source relationship | Observed | Arrow-gate status |
|---|---|---|---|
| e1 | CLI → API, unlabeled | port (38,5), stem (38,6), dot (38,7), head (34,9), leftward bend | fail: origin |
| e2 | API → Auth, verify | port (34,13), stem (34,14), dot (34,15), head (30,23); `verify` [27,18,6,1] | fail: origin |
| e3 | API → queue, enqueue | port (36,13), stem (36,14), dot (36,15), head (39,23); `enqueue` [38,18,7,1] | fail: origin |
| e4 | queue → worker, unlabeled | port (39,27), stem (39,28), dot (39,29), head (37,31) | fail: origin |
| e5 | worker → Postgres, write | port (37,35), stem (37,36), dot (37,37), head (37,43); `write` [39,39,5,1] | fail: origin |
| e6 | Auth → Postgres, read | port (30,27), stem (30,28), dot (30,29), head (35,43); `read` [25,35,4,1] | fail: origin |

The gateway's two routes start at separate ports and the database receives separate heads. The long read route goes around the worker, consistent with an obstacle; no unnecessary loop is apparent. No extra apparent relationship is present. The source records historical generated relationships, not independent verification of a real system.

## Motion detail and check disagreement

At zero-based coordinates CLI → API has source border port (37,4), first drawn stem (37,5), and frame-0 dot (37,6); the same one-cell discrepancy occurs on every route. `check.txt` reports `origins: 6/6 routes start at their arrow origin`, which is false under the rubric's first-drawn-cell definition. `dots: 6 single-dot routes, 0 periodic routes, 0 violations, 6 constant at 0.5c/step, 0 same-arrival at 2000ms` is not independent visual proof.

Across the 36 pinned frames each route shows one dot. Frame pairs repeat at 100 ms steps; the longest route wraps by frame 34, giving a full observed cycle. The dots skip corners and no dot visibly occupies a non-origin corner, bridge, junction, label, or arrowhead. On frame 0→2, CLI's dot goes from (38,7) to (37,8), skipping corner (38,8), while API→Auth goes from (34,15) to (34,16); the queue route likewise skips a corner. Equal increments through an eligible-cell list are therefore not equal physical grid-cell displacement. Unequal arrival times alone are not a defect in constant mode.

## Defects, blockers, and correction candidates

- **Defect, high — direction gate:** all six dots start late, so every direction is unproven by the rubric even though the static heads are readable. **Defect, medium — animation:** the same pixel observation contradicts the check; corner skipping also causes unequal physical displacement at bends. Renderer-level candidate: align both initialization and `--check` with the first drawn cell after the port, and resolve the interaction between corner avoidance and genuinely shared physical speed. Do not treat clean check output as a fix.
- **Defect, medium — semantic grouping/color:** required semantic tier shades were knowingly omitted. The synthetic sibling-group probe demonstrates a particular false-region rendering; it does not prove every possible honest color-only or grouping approach impossible. Renderer-level candidate: expose or preserve semantic hue grouping without drawing regions outside members. Skill-level candidate: require a source-backed shade plan and record any unsupported capability rather than treating topological rank as a substitute. Do not add fabricated regions to a chain.
- **Evidence gap, high — target live fit:** the 77×47 pinned dump is strong render evidence but cannot prove the rubric's actual 77×47 half-pane condition. Capture a measured target-size live pane in a later candidate; do not reinterpret the 83×51 header or the pinned environment as a measured target pane.
- **Evidence gap, high — raw probe status:** preserve separate stdout, stderr, and exit status for every probe and rejected attempt. This is a workflow/harness candidate, not an inferred rendering defect.
- **Capability blocker:** the frozen renderer's six-route origin behavior is observed; the synthetic group probe also exposes mispositioned group regions, though it does not establish that all semantic-color strategies are impossible. No spec-only remedy is proven in this bundle.

The correct family declaration is present in the generation records. Its absence from the blind capture-only stage was an observation-scope limitation, not a workflow or category-fit failure. The manifest records `w7E:pK6` as `confirmed_closed`; this review opened no pane. Frozen hashes in the JSON inventory were verified against actual files and metadata. JSON schema validation passed.
