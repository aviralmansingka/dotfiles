# Pipeline — round 09 independent review

**Overall: FAIL.** Five categories pass, one fails on a known color defect, and two are blocked by incomplete full-cycle evidence. All six required edges pass. A known defect takes precedence over blocked evidence in the overall verdict. This is not a green case.

All paths in this review and `reviewer-result.json` are relative to the repository root. Coordinates are 1-based `[column,row,width,height]` in the named frame, including its header. Generator `viz-ds09-1` used `fireworks/accounts/fireworks/routers/deepseek-flash-latest`; the independent reviewer `viz-judge09-pipeline` used `openai/gpt-6.1-terra:high`.

## Category decisions

| Category | Decision | Basis |
|---|---|---|
| semantic_fidelity | **pass** | Six source nodes and all six directed historical relations survive with distinct verify/enqueue and read/write; no invented protocol or branch. |
| arrow_traceability | **pass** | All six lines are separately traceable from the source to a correctly directed arrowhead; labels have clear owners. No crossing, bridge, fake junction or needless detour is apparent; check reports 0 bridges and touching bends. |
| layout_fit | **pass** | The pinned direct dump of the final spec explicitly reports 77×47 natural and shows the complete graph, without overlay or overflow banner. Live capture separately measures 82×51 at 100%. The 31×46 extent leaves a thin target margin; the pinned header clips `q quit`, but no graph item is clipped. |
| conceptual_grouping_color | **fail** | Four logical semantic groups resolve to three visually distinct hue families. Auth (control) and Worker pool (compute) are both exactly RGB 211;134;155. Distinct roles cannot be reliably distinguished by hue; group boxes are correctly absent. |
| category_fit | **pass** | Correct family **flow-chains**, with source-backed classification line recorded before the ledger in `generation.json`; six nodes, six edges, shallow stage progression, clear hop corridors, and source-requested traffic dots support it. The generic two-edge fan and convergence do not make a mesh or fabric: there is no anti-parallel pair or dense redundant fabric. The fixed rubric's chain recipe requires short single-stage ranks and corridor room, both visible. The skill prefers `lr` at five or more stages, but no `lr` measurement was made: the generator's derived width bound is not an evidenced yield. That is an evidence gap about the preference, not a separate fixed rubric pass condition or proof the clean `tb` recipe is inapplicable. |
| border_integrity | **pass** | Normal ANSI shows every node's four sides and corners in a consistent per-node color. Select-all ANSI shows six of six borders selected and complete; this simultaneous state does not establish six separate selection interactions. |
| workflow_evidence | **blocked** | Hashes, identities, blind-first record, commands, three wrapper-recorded attempts and raw streams, 33/33 validator, target-size pinned fit proof, and pane cleanup are present. The 21-frame sequence does **not** cover a full lap of the longest route, explicitly required by the rubric; the validator's PASS cannot substitute for that capture. Classification is recorded in `generation.json` with the ledger and spec references; the rubric does not require duplicating the line in spec or image. |
| animation | **blocked** | All observed six routes have one dot, start at their own first cell, move at the same default rate, and have no observed corner, border, junction, or label violation. But the longest route's full cycle is not recorded at the target, so the unseen remainder and wraparound cannot be judged. |

## Source, edge and motion audit

`cases/pipeline/source.md` explicitly requires the six components, separate authentication/queue and read/write paths, preservation of the six historical relations, semantic tiers, related shades, plain background and slow, sparse traffic. The historical generated graph is a reference, not independent verification of real infrastructure. The relevant source facts, including the two-to-one Postgres convergence and two-way API fan, are requirements for this case.

All locations below refer to `pipeline/evidence/v1/v1-text.txt` at 82×51. They encompass each route, not just the label:

| Edge | Required and observed | Region | Decision |
|---|---|---|---|
| e1 | CLI → API gateway, unlabeled: bottom source stem, down/left corridor, downward API head; no invented protocol | `[37,7,5,5]` | pass |
| e2 | API gateway → Auth, `verify`: left fan port, vertical then left to downward Auth head | `[30,15,8,11]` | pass |
| e3 | API gateway → Job queue, `enqueue`: right fan port, vertical then right to downward queue head | `[39,15,9,11]` | pass |
| e4 | Job queue → Worker pool, unlabeled: bottom stem down/left to downward Worker head | `[39,29,4,5]` | pass |
| e5 | Worker pool → Postgres, `write`: bottom stem down to right-hand downward Postgres head | `[40,37,7,9]` | pass |
| e6 | Auth → Postgres, `read`: bottom stem down then right to separate left-hand downward Postgres head | `[28,29,11,17]` | pass |

There are no extra apparent relationships, crossings, junctions or shared routes. Six arrows have intact `▼` heads. Node labels are CLI `[41,5,3,1]`, API gateway `[37,13,11,1]`, Auth `[33,27,4,1]`, Job queue `[42,27,9,1]`, Worker pool `[40,35,11,1]`, Postgres `[38,47,8,1]`. Edge text is `verify` `[30,20,6,1]`, `enqueue` `[41,20,7,1]`, `read` `[28,37,4,1]`, `write` `[42,41,5,1]`; none has an uncertain owner.

Pinned target frames use a different grid. Frame 0 dot origins for e1–e6 are `(38,6)`, `(34,14)`, `(36,14)`, `(39,28)`, `(37,36)`, `(30,28)` respectively; each is the first drawn route cell after its box port. Frame 2 moves each one cell down; frame 1 repeats frame 0. One dot per route across 21 frames is sparse. Inspection of all 126 positions found no dot on a non-origin corner, bridge, head, junction or label. Unequal arrival is expected under the shared constant rate; the source does not request synchronized arrivals. However e6 starts at `(30,28)` and at frame 20 is still at `(30,38)`, before its bottom bend and Postgres arrowhead. Thus the longest lap has not been observed, notwithstanding the clean check and 33 validator passes. This is **missing evidence**, not a demonstrated motion defect.

## Classification and grouping details

The exact `generation.json` `step0_classification.family_line` is:

> family: flow-chains  
> evidence: six stages and exactly six relations (E = N = 6, shallow one-hop hops) plus the brief's 'slow, sparse motion for traffic', which is the animated chain signature.

Tie-breakers and the absence of a secondary recipe are recorded there. The graph has no reciprocal pair or bus between separate worlds. No `layers` pins are declared, so none can be ignored; the five displayed stage levels are CLI; API; Auth and Job queue; Worker pool; Postgres. The skill's orientation preference is not proven impossible: a measured `lr` candidate would be needed before claiming a renderer-limited yield. The clean shipped `tb` view meets the chains requirements as enumerated in the frozen rubric; do not conflate an unmeasured preference with a proven defect or a proven yield.

At `v1-ansi.ansi`, ingress is orange (CLI `231;138;78`, API `241;164;108`), control is pink (Auth `211;134;155`, queue `226;156;175`), compute is pink (Worker `211;134;155`), and storage is blue (Postgres `125;160;184`). The specific collision is visible at Auth `[32,26,6,4]` and Worker `[39,34,13,4]`. Positions and individual labels remain recoverable, but equal RGB undermines semantic color distinction. The candidate cap explains why a renaming attempt was not made; it does not erase the defect. One final view does not prove sibling ordering across multiple views. No group rectangle or title is painted, correctly.

## Candidate, evidence and capability notes

- **Defect F1 (high):** source-semantic groups lose color distinction as measured above. A skill-level candidate is to preflight generated group colors before spending the candidate budget, or to choose group names with distinguishable resulting hues. A renderer-level candidate is an explicit, collision-resistant semantic palette. Neither is implemented or proven here.
- **Evidence gaps F2/F3 (high):** no target-size full lap of Auth→Postgres. A capture long enough to show the longest path and its wraparound would resolve workflow and animation evidence; no new viewer was run in this review. This is not an unsupported rendering capability.
- **Unmeasured orientation:** no `lr` candidate was run. It prevents an evidence-backed impossibility/yield claim, but does not by itself change the category decision under the eight fixed pass conditions.
- **Measured renderer limit:** rejected candidate a2 set `label_slot` on the four labeled edges and exited 1 with `no obstacle-safe route for api -> auth, api -> queue; increase node/layer spacing`. This establishes the failure for that candidate, not universal impossibility under all spacing/layouts. Candidate a3 checked at 31×42 with read/write slots but was not shipped. The shipped labels are complete and have clear owners.
- **Fit boundary:** target-size graph fills down to the bottom row, so a shorter pane is not proven to fit. The pinned target header's last control text is truncated, not the diagram. No fit failure is assigned under the stated graph gate.
- **Blind record:** `docs/visualize-eval/rounds/09/reviews/pipeline/observed-first.md`, SHA-256 `3a4de3ece2f99ebafcc76c58fcf456caef1c6f11e6e081deae15aaa7fdbb308f`, was saved before expected data was revealed and was not altered afterward. Its statement that the full classification line was unavailable at stage A reflects that stage's evidence restriction.
- **Provenance:** final spec SHA-256 `2623986f89d0bc134eef5e0b58ef7b40a818012d48ac793f7eb9bce0aabb9357`; frozen renderer `405a61a674a7cc6271ae1276794eb270c9425dfc38585f4cbb1c48e9b6db495b`. The result JSON inventories the frozen skill, rubric, dataset, source, spec, check, all attempt records, captures and hashes. The renderer is its own baseline; no gain is attributed to the skill.
- **Cleanup:** capture manifest records pane `w7E:pNH` as `confirmed_closed`; generator reports a post-close probe. The reviewer opened no pane.
