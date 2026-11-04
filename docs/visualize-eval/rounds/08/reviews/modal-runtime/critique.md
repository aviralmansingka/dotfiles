# Independent review — modal-runtime, round 08

**Overall: FAIL.** This is a historical architecture reference, not independent verification of the implementation. Evidence paths in this review and the JSON are repository-relative. The blind record was saved and hashed before the expectation reveal and remains unchanged. All final spec hashes match their capture manifests; frozen skill, renderer binary, rubric, dataset manifest and this case's source/expectation hashes match round metadata. The generator and reviewer use the requested distinct identities/models.

## Category matrix

| Category | Decision | Reason |
|---|---|---|
| semantic_fidelity | **fail** | All eight endpoints and directions occur, but `task+ctrl RPC` loses **input**, `events+mg RPC` makes **management** cryptic, and `HTTP over UDS` loses **filesystem**. These required meanings are not conveyed elsewhere on those paths. |
| arrow_traceability | **pass** | All eight separately drawn links trace to their correct heads; no route crossing or uncertain label owner observed. The cross-view anti-parallel split is acceptable for this gate and source's separate-arrows constraint, but not category_fit. No apparent additional relationship is established by the region strokes. |
| layout_fit | **fail** | The orchestration title is missing and v3 region/arrow overlays and v3/v4 incomplete region outlines prevent the declared grouping from appearing as complete labeled shapes. The target-size frames are direct 77×47 dumps, not an actual measured 77×47 half-pane; the latter is also an evidence gap, not a reason to erase a known failure. |
| conceptual_grouping_color | **fail** | Related v4 pairs have related hues and proximity, and conceptual group names are reasonable. But incomplete/overlapping region borders and the absent orchestration title make declared membership misleading or unrecognizable; the capture does not support the asserted complete regions. |
| category_fit | **fail** | `generation.json` states `family: service-meshes` and provides a source-backed fan + anti-parallel-pair evidence line, a reasonable classification. The pinned recipe explicitly requires that pair co-viewed as two distinct edges: v1 has only return and v2 only intake. Recorded sizing probes explain the split but do not waive that categorical requirement. |
| border_integrity | **pass** | All 13 node occurrences have complete node sides and rounded corners in the normal and `--select-all` ANSI evidence, with continuous per-node color. Palette does not overwrite a node border. Region defects are not node-border defects. Select-all is one simultaneous state, not evidence of every interaction or individual hover. |
| workflow_evidence | **fail** | Final captures, manifest hashes, commands template, check output, static frames and closures are recorded. However, attempts explicitly record overwritten draft specs, and two claimed hard-routing-error raw files (`v1-seam-overview-b-check.txt`, `...-c-check.txt`) are empty; stderr/exit status and exact per-probe commands are not preserved. A summary assertion is not raw error evidence. The app's 83×51 live header is honest, while a 77×47 direct dump is not proof of a measured 77×47 live half-pane. |
| animation | **N/A** | The frozen case manifest and expected data mark animation optional; the source does not request it. Zero route dots, static three-frame dumps in every view, are consistent with that source. UI `·` separators are not flow dots. |

## Important determinations

1. **Seams and qualifiers — defects (critical).** The v2 worker → runtime label `task+ctrl RPC` [35,27,13,1] is directionally correct, and `ctrl` is a recognizable abbreviation, but `task` alone does not explicitly specify task **input**. V1 runtime → worker `events+mg RPC` [36,28,13,1] preserves events but `mg` is not a clear rendering of **management**. V1 runtime → daemon `HTTP over UDS` [36,24,13,1] preserves its interface distinction but omits **filesystem**, the qualified purpose. The abbreviated graph does not retain these qualifiers elsewhere, even though the off-pane generation ledger does. Separately, `task dispatch` and `mount/snapshot` preserve dispatching tasks and mounting/snapshotting: their one/two-cell shortening does **not** lose a required word or change meaning. `starts/manages` and `image+volume data` also retain their meaning.
2. **Anti-parallel split — explicit recipe defect (high), not an independently missing direction.** The source permits separate directed relations, so preserving them in separate views is semantically acceptable as a split in isolation, subject to the qualifier defects above. The explicit round-08 mesh recipe independently demands co-viewing and is not satisfied. The recorded 4-node top-bottom candidate skipped a label; the 2-node left-right pair skipped one; a 3-edge fan had ambiguous ownership; the 4-node left-right hard-failure claim lacks its raw stderr/exit evidence because the named files are empty. These are real measurements or recorded claims, not a proof that every alternative is impossible. No older verdict is used as a waiver.
3. **Region geometry — defect (high).** In v3 [19,23,46,27], orchestration lacks its title and a closed outline; the compute/storage outlines lose corners and boundary segments, and top edges are overwritten by arrows. In v4 [19,12,46,30], the two declared regions present contiguous/overlapping top/bottom strokes, missing corners, and crowded interior boundary strokes alongside the storage route. Their nodes have intact borders; this is a separate renderer region-geometry issue. At the target dump, the v3 view still has the missing title and broken outlines. A clean `groups:` check and validator output do not prove region rendering.
4. **Target and probe records — blockers/evidence gaps.** Live capture headers report 83×51 @100%; pinned direct render outputs report 77×47 @100%, and the latter are useful visual evidence but are not a measured 77×47 live half-pane. Three timestamped frames satisfy the frozen workflow minimum; the task description's five-frame claim is not borne out. Since the diagram is static, the absent fourth/fifth frames do not establish a motion defect. Some original candidate specs and exact per-probe commands/statuses are missing; two failure logs are empty. These are evidence gaps, not proof of a different rendering result.

## Eight-relation audit

Coordinates below refer to the 83×51 text captures, 1-based. Each link has one visible arrowhead and an unambiguous adjacent label, with zero observed route crossings/junctions.

| Source relation | Observed | Decision |
|---|---|---|
| worker → runtime, task input + control RPCs | v2 `task+ctrl RPC` [35,27,13,1], `▶` [49,26] | **fail**: task input qualifier missing |
| runtime → worker, events + management RPCs | v1 `events+mg RPC` [36,28,13,1], `▶` [50,28] | **fail**: management abbreviation unclear |
| runtime → engine, dispatches tasks | v3 `task dispatch` [38,15,13,1], `▼` [37,23] | **pass** |
| engine → backend, starts/manages | v3 `starts/manages` [22,42,14,1], `▼` [21,44] | **pass** |
| backend → container, runs user process | v4 `runs user process` [23,26,17,1], `▼` [29,36] | **pass** |
| engine → filesystem, mounts/snapshots | v3 `mount/snapshot` [41,35,14,1], `▼` [43,44] | **pass** |
| filesystem → Blobnet, image + volume data | v4 `image+volume data` [45,26,17,1], `▼` [48,36] | **pass** |
| runtime → daemon, filesystem HTTP over UDS | v1 `HTTP over UDS` [36,24,13,1], `▶` [50,23] | **fail**: filesystem qualifier missing |

All eight concepts occur. A few v3/v4 border fragments appear like adjacent route stems or junctions, but no extra independently traceable arrow or fabricated edge is established; they are recorded as region artifacts instead. The lack of a named bus is appropriate.

## Correction candidates, not fixes

- **Skill/workflow:** retain all qualifiers explicitly; use a meaning ledger as a verification aid, not a substitute for visible text. Require the mesh pair to share a view when applying the fixed mesh recipe; if the renderer cannot do that without loss, report the capability blocker rather than declare a pass. Inspect actual region outlines and verify target-sized live capture, preserving exact probe argv, stderr, exit codes, and draft bytes.
- **Renderer:** investigate bounded, complete, titled group regions with corners and route/border interactions, plus co-view routing and label placement for anti-parallel pairs and sizing of top-bottom labeled rank gaps. The observed alternatives show constraints of this frozen binary; they do not prove a universal impossibility. The renderer is its own baseline; no improvement is attributed to the skill.

## Evidence and cleanup

Each evidence manifest reports `cleanup: confirmed_closed` for panes `w7E:pM2`, `w7E:pM3`, `w7E:pM5`, `w7E:pM7`; no pane was opened by this reviewer. No remote source execution or viewer session was run. The candidate validation file reports all checks passed, but does not supersede the independently observed region, qualifier, family-recipe or raw-record findings. Unresolved capability/evidence blockers are the absent actual 77×47 live pane, missing raw routing failure details/draft bytes, and measured co-view sizing/label-placement limitations.
