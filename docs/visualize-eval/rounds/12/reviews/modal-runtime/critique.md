# Modal runtime — round 12 independent verdict

**Overall: FAIL.** The final specs contain all eight source components and all eight directed relationships, and the split is supported by measured attempts. But the v1 gRPC pair's label placement makes its direction-specific meanings unreliable to a reader. The renderer's green `worker-plane` in v1 and orange `worker-plane` in v2 also violate the name-stable group hue rule. Source references here are historical claims, not independently verified runtime facts.

All paths in this report and `reviewer-result.json` are relative to the repository root. Coordinates below are `[column,row,width,height]`, 1-based in the 83×51 live text or ANSI capture, not the pinned 77×47 view.

| Category | Decision | Basis |
|---|---|---|
| semantic_fidelity | **fail** | Both gRPC pair payload labels are visually misplaced relative to their required directions. All eight relations exist in the specs but a reader cannot reliably associate those two labels with their routes. |
| arrow_traceability | pass | All eight physical routes run from a source box to a distinct correctly directed arrowhead. There are no crossings or branch glyphs. This does not cure label association. |
| layout_fit | pass | Both final-spec pinned 77×47 natural dumps show complete graphs and labels, no overflow; live headers measure 83×51 at 100%. |
| conceptual_grouping_color | **fail** | `worker-plane` is green for worker in v1 but orange for daemon in v2, despite the rule that a declared group name drives a stable hue family. Other declared families are internally coherent in each capture; no group outlines are drawn. |
| category_fit | **fail** | `service-meshes` is the correct, source-backed family; co-viewed pair and documented split are present, but the pair is not reliably readable as two correctly labelled edges. The split yield does not excuse the shipped pair-label error. |
| border_integrity | pass | Normal and select-all ANSI show complete, color-continuous borders for 10/10 node occurrences. Select-all does not prove individual selection transitions. |
| workflow_evidence | pass | Frozen inputs, identities, blind record, captures, checks, 18 wrapped records, validators and cleanup are preserved; record and capture hashes were independently checked. The supplied dataset hash typo is corrected below. |
| animation | N/A | The source does not request animation; the frozen manifest marks it optional. No dots; the four 83×51 frame payloads per view are identical. |

## Findings and source audit

**F1 — high, semantic fidelity.** The source requires worker → runtime `task input + control RPCs` and runtime → worker `events + management RPCs`, with worker gRPC distinct from HTTP over UDS. Both gRPC tokens are visible, but `task input + ctrl gRPC` at v1 `[24,31,22,1]` sits below and closest to the **runtime → worker** route, while `events + mgmt gRPC` at `[28,23,18,1]` lies above the **dispatch** route, not beside the runtime → worker route. The worker → runtime arrow is the upper lane pointing left; the reverse arrow is the lower lane pointing right. A viewer must consult the spec to recover the intended owners. The checker says zero ambiguous owners; that machine report does not override the observed misleading placement. The generator documented difficulty in merged candidates, but did not disclose or prove unavoidable this particular placement in the shipped pair. Required edges e1 and e2 therefore fail the semantic audit, despite physically traceable arrows.

**F2 — medium, category fit.** The generator's `service-meshes` classification and source-backed core fan plus anti-parallel pair are appropriate. The two separate arrows are co-viewed, and the identity-map habit of listing interface qualifiers is documented and their protocol words appear. However, a mesh recipe requires two *labelled* pair edges, not just two arrows and two detached labels; F1 means that part of the recipe does not work reliably in the capture.

**F3 — medium, grouping.** Normal ANSI shows the declared `worker-plane` worker border in v1 RGB `(183,206,115)` (green) and daemon in v2 `(206,161,115)` (orange). Those are not shades of one hue family, even though the group name is identical. This is not a demand that an individual node keep its own shade across views: these are two different nodes carrying the same declared group. Other v2 families are pink orchestration, blue compute and green storage. No source-named tiers or pinned ranks were declared. No enclosing group box or title was drawn, as required.

The other six relations are traceable and legible: runtime → Task engine `dispatch tasks`; engine → backend `starts / manages`; backend → container `runs user process`; engine → filesystem `mounts / snapshots`; filesystem → Blobnet `image + volume data`; runtime → daemon `fs HTTP over UDS`. Their stems, arrowheads and screen regions are listed individually in the JSON edge audit. No unexpected extra edge was observed. In v2, `mounts / snapshots`, `runs user process`, **and** `fs HTTP over UDS` touch their arrowheads without a separating blank cell. The generator disclosed the first two; the third is also flush. The text and head remain readable and this is not treated as a separate rubric failure.

`ctrl`, `mgmt`, `fs` and `vols` are recognizable abbreviations of control, management, filesystem and volumes; `dispatch tasks` preserves the action despite tense normalization. `gRPC` identifies the worker RPC protocol and `HTTP over UDS` identifies the other interface. No omitted word is independently found to thin a source concept here; the failure is the direction-specific ownership of the two labels, not abbreviation alone.

## Coverage-over-budget and recipe yield

The 3-edge v1 and 5-edge v2 together draw all eight source relations and all eight named components. Runtime and Task engine repeat as cross-view context; their connecting edge appears in v1. The generator records five whole-graph and six merged-seam variants, plus a separate v1-with-seam attempt: these encountered label-owner ambiguity, bridges, clipping or overflow. The clean tails-only probe is a comparison, not a failed one-view merge. The 18 wrapped records' stdout, stderr and spec hashes match, and both saved validators report records complete. These measured alternatives are a valid recorded reason for the split under the recipe-yield rule; coverage-over-budget does not require an arbitrary additional number of trials. They do not prove mathematically that every possible layout is impossible. The documented yield applies to merging the fan, not to the shipped pair's visual label association.

## Evidence, identity and corrections

The blind record is unchanged: SHA-256 `440cc49a2f3ffd0a30e9aeffa27e663ef28d36c97742b3bf1b952b5f6918b16b`. Both manifests say their owned panes `w7E:pY6` and `w7E:pY7` were confirmed closed. No unsupported rendering or model capability blocks the verdict.

Two request/schema inconsistencies are handled without fabricating evidence:

- The requested dataset hash contains `...e8672...`; `shasum -a 256 docs/visualize-eval/cases.json` and frozen metadata both give **`e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05`**. The result uses the verified actual digest.
- The strict frozen result schema disallows the requested extra top-level `blind_observation_sha256`; its exact hash is instead recorded as the `blind` evidence item's `sha256`, and linked by `observed_first.evidence_id`. The explicit request also specifies the v2 hash for `spec_sha256`; that value is used, while both final specs and hashes are present in the evidence inventory.

For future skill work, require visual verification of which labelled route each payload belongs to, rather than accepting checker ownership alone; choose logical groups whose hue remains stable across final views. A renderer-level candidate is a layout/label-placement mechanism that keeps each pair label visibly adjacent to its own route and assigns group colors by name across views. This round changed no renderer or skill, so the observations do not establish a renderer improvement.
