# Round 02 human review — feedback

Left pane is round 01 (its own binary), right pane is round 02. Write under
each case: what you see, whether you agree with the judge, and what the next
candidate should change.

## Round-level feedback (verbatim, 2026-11-02)

1. **Dot timing.** "I want all dots to start and meet at their destination at the
   same time unless specified otherwise." Every animated route must leave its
   source and reach its arrowhead in the same interval; a per-edge duration is
   the only exception.
2. **Dot origin.** "In all cases, make sure the dot starts from the actual
   starting point of the arrow." A dot that begins mid-route or one cell in is a
   defect.
3. **Overlaps.** "Try to make sure overlaps are kept to a minimum by laying out
   the diagram. Do not sacrifice readability or logical organization to achieve
   this." Crossings are a layout quality measure, never a reason to reorder
   source groups.
4. **Overall.** "Most of the diagrams are objectively better, so I'd say this
   eval process is going well."

### Per-case note

- `gb300-rack-software`: "the arrows could be laid out to minimize overlaps
  better" — 13 crossings in the round-02 sample, and the trunk's two junctions.
- Dots apply to every animated case: `pipeline`, `network`, `datacenter-redundancy`,
  `modal-machine-manager`.
- All other cases carry no specific note; the round-level verdict is "objectively
  better".

| Case | Writer| Case | Writer (left) | Candidate (right) | Judge | Your verdict |
|---|---|---|---|---|
| `pipeline` | view1.json | v1.json | blocked | pending |
| `network` | spec.json | v1.json | fail | pending |
| `homelab-nic-trace` | v1-local-nets.json | v1.json | fail | pending |
| `server-nic-layout` | vA-host-tor.json | v1.json | fail | pending |
| `datacenter-redundancy` | view1-isp-mux.json | v1.json | fail | pending |
| `modal-machine-manager` | v1-provisioning.json | v1.json | fail | pending |
| `modal-runtime` | overview.json | v1.json | pass | pending |
| `gb300-rack-software` | v1-a4-rail-lr.json | v1.json | fail | pending |

---

## pipeline

- tab: `w7E:t3E`  panes: before `w7E:pAH`, after `w7E:pAJ`
- judge verdict: **blocked**  (categories: semantic_fidelity=pass, arrow_traceability=pass, layout_fit=pass, conceptual_grouping_color=pass, border_integrity=pass, workflow_evidence=pass, animation=blocked)
- views available: 1 before, 1 after
- what I see:
- agree with the judge? 
- verdict: round-level feedback recorded; case verdict pending

## network

- tab: `w7E:t3F`  panes: before `w7E:pAK`, after `w7E:pAM`
- judge verdict: **fail**  (categories: semantic_fidelity=fail, arrow_traceability=pass, layout_fit=pass, conceptual_grouping_color=pass, border_integrity=pass, workflow_evidence=pass, animation=fail)
- views available: 3 before, 2 after
- what I see:
- agree with the judge? 
- verdict: round-level feedback recorded; case verdict pending

## homelab-nic-trace

- tab: `w7E:t3G`  panes: before `w7E:pAN`, after `w7E:pAP`
- judge verdict: **fail**  (categories: semantic_fidelity=fail, arrow_traceability=pass, layout_fit=fail, conceptual_grouping_color=pass, border_integrity=pass, workflow_evidence=pass, animation=na)
- views available: 3 before, 3 after
- what I see:
- agree with the judge? 
- verdict: round-level feedback recorded; case verdict pending

## server-nic-layout

- tab: `w7E:t3H`  panes: before `w7E:pAQ`, after `w7E:pAR`
- judge verdict: **fail**  (categories: semantic_fidelity=fail, arrow_traceability=pass, layout_fit=fail, conceptual_grouping_color=pass, border_integrity=pass, workflow_evidence=pass, animation=na)
- views available: 2 before, 2 after
- what I see:
- agree with the judge? 
- verdict: round-level feedback recorded; case verdict pending

## datacenter-redundancy

- tab: `w7E:t3J`  panes: before `w7E:pAS`, after `w7E:pAT`
- judge verdict: **fail**  (categories: semantic_fidelity=fail, arrow_traceability=pass, layout_fit=fail, conceptual_grouping_color=pass, border_integrity=pass, workflow_evidence=blocked, animation=na)
- views available: 4 before, 4 after
- what I see:
- agree with the judge? 
- verdict: round-level feedback recorded; case verdict pending

## modal-machine-manager

- tab: `w7E:t3K`  panes: before `w7E:pAV`, after `w7E:pAW`
- judge verdict: **fail**  (categories: semantic_fidelity=fail, arrow_traceability=pass, layout_fit=fail, conceptual_grouping_color=pass, border_integrity=pass, workflow_evidence=pass, animation=fail)
- views available: 4 before, 4 after
- what I see:
- agree with the judge? 
- verdict: round-level feedback recorded; case verdict pending

## modal-runtime

- tab: `w7E:t3M`  panes: before `w7E:pAX`, after `w7E:pAY`
- judge verdict: **pass**  (categories: semantic_fidelity=pass, arrow_traceability=pass, layout_fit=pass, conceptual_grouping_color=pass, border_integrity=pass, workflow_evidence=pass, animation=na)
- views available: 3 before, 3 after
- what I see:
- agree with the judge? 
- verdict: round-level feedback recorded; case verdict pending

## gb300-rack-software

- tab: `w7E:t3N`  panes: before `w7E:pAZ`, after `w7E:pA0`
- judge verdict: **fail**  (categories: semantic_fidelity=fail, arrow_traceability=fail, layout_fit=pass, conceptual_grouping_color=pass, border_integrity=pass, workflow_evidence=blocked, animation=na)
- views available: 4 before, 2 after
- what I see:
- agree with the judge? 
- verdict: round-level feedback recorded; case verdict pending

