# Round 09 human review — feedback

Reviewer: the owner. Tabs opened 2026-11-02 (round 08 left vs round 09
right, one per case, each side drawn by its own frozen binary). Record
verdicts and directives here; chat directives are transcribed verbatim by
the captain and override judge verdicts where they conflict.

## Per-case notes

(pipeline) 
(network) 
(homelab-nic-trace) 
(server-nic-layout) 
(datacenter-redundancy) 
(modal-machine-manager) 
(modal-runtime) 
(gb300-rack-software) 

## Directives for round 10

(owner, 2026-11-02, on the open round-09 tabs)

1. network: "why couldn't the outgoing arrows from web-tier be rearranged so
   that there is no overlap at all" — Captain's finding: the 1 bridge at
   (32,34) is structural under this binary. Three downward relations
   (web->cache, web->db, cache->db) plus core->cache all transit the single
   free lane of the web<->cache rank gap; ports are engine-assigned at fixed
   fan offsets, so the spec cannot widen or re-aim them. The two rejected
   candidates prove the only cheaper layouts fail fit (lr = 110 cols; plain
   tb = 67 rows). The remaining levers (reorder, merge) are forbidden by the
   skill. Round-10 engine item: multi-lane rank gaps / port spreading.
2. modal-machine-manager: "why is the diagram fully linear. There are
   multiple other connections in various directions that flat out missing."
   — Linearity is the lifecycle-machines recipe itself (one phase per rank,
   boot readable in one direction). The missing relations (web, web->wapi,
   pgrpc->db, pub->db; 16/17 components, 20/23 relations) were DROPPED under
   budget exhaustion, not proven impossible — the judge said so explicitly.
   A re-split (merging v2+v4 to free a view for the web/intake cluster) was
   available. Skill fix for round 10: never-drop rule + re-split-before-drop.
3. modal-runtime: "basically all detail from v4 is gone." — Round-08's
   v4-data-plane content (backend/filesystem/blobnet/container with 'runs
   user process' and 'image+volume data') moved into round-09's
   v5-engine-tree, with labels shortened ('runs user proc', 'image/vol
   data'). v4 became a thin 3-node fan. Net: the detail was redistributed
   and abbreviated, not preserved verbatim; the seam-qualifier richness of
   round-08's v1 seam views also thinned (v3 is a 2-node pair).

## Best semantic recreation across rounds (captain analysis)

Raw counts: r04 4P/8 (pipeline, network, server, datacenter) — but r04 was
user-reverted for overall regression and judged by a different model.
Best SHIPPED: r05 3P/8 (pipeline, network, server). Terra era: r08 2P > r09
1P. Per case: pipeline P in every round (7/7); machine-mgr, gb300, homelab 0P
across all seven rounds (never passed semantic). Judges differ per round
(Astra r01, sol r02-07, terra r08-09) so cross-era counts are indicative
only.

4. (owner, follow-up on machine-manager) "why is linearity the recipe. The
   primary goal is to express the connections and visualize the actual
   components and their relations, not give a very watered down version."
   — Captain's ruling: the user is right. Linearity is a MEANS (the phase
   axis makes the lifecycle order readable), never the goal. The goal is full
   component + relation coverage. ROUND-10 SKILL CHANGE: reword the
   lifecycle-machines recipe — the phase axis organizes the view, but every
   source relation must appear somewhere; side relations (web, wapi, db
   writes) are first-class content, expected in the same view when they fit
   and in a named split view when they do not. Dropping relations is never
   authorized. Paired ROUND-10 ENGINE CHANGE: multi-lane rank gaps so
   cross-rank side relations can be drawn beside the spine without bridges.

5. (owner, round-10 planning) "make sure the arrows also favor from the
   middle of the edge they originate from and join into." — ROUND-10
   ENGINE ITEM (top priority alongside coverage): lone edges attach at the
   MIDDLE of their side; multi-edge fans spread symmetrically around the
   middle, never hugging corners. Recorded for the r10-routing worktree.
