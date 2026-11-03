# Round 13 — modal-machine-manager independent critique

**Verdict: fail.** The full system and all 23 relations are visible on one canvas, with readable label ownership in the whole-canvas capture. Two known presentation defects fail gates; missing whole-canvas color proof blocks two more. This is not a claim that the engine's reported hue assignment is wrong.

All evidence paths in the JSON are relative to the repository root. The frozen blind record is unchanged, SHA-256 `301a6ace54758fffc7dfc7a8017c61c007dcdbc63dd4bb45cf6daaef3ab71ee2`. **Its recorded viewport row numbers are one too high:** subtract 1. The edge locations in the JSON have that correction applied and are in the whole-canvas frame 0.

## Category decisions

| Category | Status | Basis |
|---|---|---|
| semantic_fidelity | pass | All 17 components and all 23 source relations appear on one canvas. The JSON audits each source edge and points to its actual label in the full capture. The two boot directions, janitor proposal and distinct S3 paths survive. Source relations remain historical claims, not independently verified architecture facts. |
| arrow_traceability | pass | All 23 routes have distinct destinations and visible directed heads. The full capture resolves all label owners, including the opposed boot edges. Check says 0 bridges, 0 touching bends, and 0 near-miss cells; I found no conflicting visible near miss or extra branch. |
| layout_fit | pass | Branch B: one natural-scale 260×64 canvas contains 260×11, 118×15 and 132×25 described diagrams. Wide capture and check agree; no diagram overlap or shrink. The request ribbon alone needs about 3.4 target-pane widths of horizontal navigation. A 77×47 pane does not satisfy branch A, and the actual live pane was 68×44. |
| navigation_clarity | fail | Three distinct, informative descriptions and their coverage map exist; however, the 68×44 live capture shows the controls over the ops title and description, and the pinned 77×47 capture shows minimap text overwriting the ops description. Descriptions also clip horizontally. Rev 11 requires titles and descriptions not to be clipped or occluded. The ops title says “reconcile loop” while no closed cycle is drawn; the source itself uses that name, so I do not infer a missing relation or treat the name alone as false. |
| conceptual_grouping_color | blocked | Group assignments are plausible and no grouping enclosure is drawn. ANSI covers only the left pane band. The plain-text whole capture does not prove the ops group's hue or repeated tags' hue consistency between diagrams. |
| category_fit | pass | The stated and judged family is `lifecycle-machines`. The source's request-to-boot stages form a directional sequence, and the capture shows those stages and sparse live dots. The opposite boot edges show the borrowed mesh habit. The generator recorded measured reasons for three sections and a left-to-right rather than top-to-bottom axis. The queue's five destinations are distributed across the canvas rather than shown as one co-viewed fan. |
| border_integrity | fail | `sections/request-300x18-frames.txt` frame 0 visibly overlays the humans + mmctl box and label with the controls, including its lower border. This is a concrete defect under the rule, even though the wide capture avoids that overlay. Most nodes' normal and selected color continuity is also unproved: whole-canvas select-all is text-only. |
| workflow_evidence | pass | Three candidate probes are recorded, the validator passes, input and artifact hashes were computed, the live header measures 68×44, the blind record predates the reveal, and the manifest reports pane `w7E:pZS` confirmed closed. Full-canvas frames cover the longest dot lap. The supplemental capture and color limitations are not silently treated as proof of color categories. |
| animation | blocked | Independent offline rerun of `scripts/viz-frame-audit.py` reports 88 evenly spaced frames, 22 dots per frame, 22/22 steady routes and equal 0.500 cells/frame. Check reports 22/22 origins and zero violations. Full-canvas ANSI/buffer evidence is missing, however, so per-route source/destination dot-color binding and case-wide conflict claims cannot be checked against actual colored pixels; the audit proves speed and count, not color or all corner occupancy. |

## Triage record

The record lists eight provoked questions, seven used. The first three answers match the corresponding annex verbatim; questions 4–7 are attributed to reasoned own judgment, and the eighth is explicitly unused. Registry and agent are actually retained; the separate boot and S3 routes remain; a static host-residency edge is a defensible reading, not an invented historical qualifier. The brief already settles scope, canvas preference and motion, so revisiting those points is redundant, but these are the supplied scripted answers rather than a fabricated live dialogue. The record's own judgments reach the named source seams and measured alternatives; it does not assert an additional unbacked source relation. Thus the triage record meets the honesty bar, albeit with more questions recorded than this explicit framing needed.

## Per-surface and canvas findings

- **Request:** all ten arrows and labels are visible in the 300×70 evidence. The `iPXE request` and `boot.ipxe + S3 args` routes are opposite and distinct. In the 300×18 section capture the controls overwrite the humans node; the request's 260-column width also makes the reader pan considerably.
- **Heartbeat:** five directed relationships include three independent arrowheads into Postgres. The `runs on host` edge is static; the other four have dots. Full capture presents all labels.
- **Ops:** eight routes remain distinct, including queue-to-S3 diagnostics and janitor-to-webapi. Reconcile's two outgoing edges carry cluster state and `gcore sync, 1 min`. The actual small viewport covers or clips navigation text. The name “loop” is source-backed but should not be mistaken for an illustrated cycle.
- **Canvas:** no route crosses between diagrams; recurring names join the sections conceptually. The descriptions and coverage map make the split intelligible in the unobstructed whole capture. Check's 23/23 labels and zero ambiguous owners agree with my reading of that capture. A normal target-pane reader cannot see the full graph at once, and the evidence contains no recorded interactive pan sequence.

## Triage and correction candidates

**Skill / evidence capture:** capture whole-canvas normal and selected ANSI or buffer states, plus timestamped color evidence that covers every animated route and all repeated groups. Preserve the pinned small-pane evidence as well, and test the named descriptions at that size rather than assuming the full-width render proves navigation. Keep the explicit split coverage ledger and the two boot edges.

**Engine / UI:** keep controls and minimap from overwriting canvas text and box borders at small viewports; provide a reachable way to read complete descriptions at natural scale. Do not attribute these renderer defects, or any engine gains, solely to the skill. Pan distance is a usability cost worth revisiting, not evidence that branch B itself fails.

## Result schema conflict

The requested JSON fields `viewport: {columns: 260, rows: 64, zoom_percent: 100, verified: true, note: ...}` and top-level `blind_observation_sha256` cannot coexist with the frozen rev-11 schema: `viewport` requires constants 77×47 and forbids `note`, and the root forbids additional properties. To deliver a schema-valid file, JSON records the **verified pinned viewport** as 77×47; its `layout_fit.reason` records the 260×64 canvas extent and branch B. The blind hash is in the `blind` evidence item's `sha256`, not a forbidden top-level field. These represent different measurements; 260×64 is not presented as the target viewport. The result passes the embedded draft-2020-12 schema.

## Verification and blockers

- Frozen renderer, rubric, dataset, skill and spec hashes were recomputed; the dataset hash matches the corrected `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05`.
- Offline `uv run scripts/viz-frame-audit.py … --expect-routes 22 --summary` passed; no viewer session was launched.
- `reviewer-result.json` validated against the embedded rubric schema and contains 23 source-edge audits.
- Remaining blockers: whole-canvas colored normal/selected borders and per-route colored dot evidence. The UI overlay is a known failure, not a blocker that could be cured by proof alone.
