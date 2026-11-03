# Round 11 human review — feedback

Reviewer: the owner. Tabs opened 2026-11-03 (round 10 left vs round 11
right). Record verdicts and directives here; chat directives are
transcribed verbatim by the captain.

## Per-case notes

(network — PASS) 
(homelab-nic-trace) 
(server-nic-layout) 
(modal-machine-manager) 
(modal-runtime) 
(gb300-rack-software) 

## Directives for round 12

1. (owner, 2026-11-03, on the open r11 tabs) "both the modal diagrams
   are worse. They lose a lot of detail." — Confirmed by the captain from
   the specs: the softened family rule was spent on SPLITTING THINNER, not
   expressing more. modal-runtime went from 2 dense views (r10 v1 held
   the pair + fan + UDS seam in one 4-edge view) to 3 sparse views
   (pair-only 44×7, fan-only 59×9, compute 66×20); machine-manager's
   views carry 5/7/4/7 edges with 2 ambiguous labels hiding meaning.
   ROUND-12 SKILL RULE (density floor): each view must carry the
   densest subgraph that fits 77×47 — the 12-node/16-edge budget is a
   CEILING, never a target; split only when one view cannot hold the
   content, never for tidiness. Combined with the standing attribution
   cluster (qualifiers, verbs, caveats) as the other r12 skill item.
