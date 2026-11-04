# Round 09 — network independent review

**Verdict: FAIL.** Two known failures remain even though the captured routes themselves are traceable. Full-lap motion evidence is also missing. A green result requires all eight applicable categories and all required edges to pass.

All evidence paths in `reviewer-result.json` are relative to the repository root. Regions are `[column,row,width,height]`, 1-based in the cited capture; pinned coordinates count its viewer header as row 1. The generator's coordinates in `generation.json` use a different convention, so I independently measured the pinned frame. `observed-first.md` was saved before the reveal and remains unchanged; its SHA-256 is `27c54b99abc577cdfc62d6010d955c2f4c13f3fa2cf6bb8fc872ae298bfe54e4`.

| Category | Decision | Basis |
|---|---|---|
| semantic_fidelity | **fail** | Four labels in two paired gutters cannot be assigned reliably to their correct links by the reader. |
| arrow_traceability | pass | Seven separate, correctly directed paths and heads; the two convergence pairs remain separate. The one bridge distinguishes crossing from connection. |
| layout_fit | pass | Pinned final-spec 77×47 natural dump is accepted proof, shows all boxes, labels and controls intact. No proven avoidable crossing. |
| conceptual_grouping_color | **fail** | Fabric and app role groups have identical teal, not distinguishable hue families. Logical groups correctly have no enclosure. |
| category_fit | pass | Service-meshes is the best fit: core fan of two, ordered source ports, one connected graph and both inbound pairs kept separate. No anti-parallel pair exists in this source; do not invent one or require a yield for it. |
| border_integrity | pass | Six complete, continuous normal ANSI borders and six complete bold selected borders in select-all. |
| workflow_evidence | **blocked** | Frozen inputs, blind record, probe records, validator and cleanup are present; target-size animation does not cover a full lap of the longest route. |
| animation | **blocked** | All observed dots satisfy origin, spacing, straight-cell and common-rate checks, but the required longest-route full-cycle capture is absent. |

## Highest-impact defect: label ownership versus the checker

The `--check` says `7/7 placed, 0 on route cells, 0 skipped, 0 ambiguous owners`. Placement and lack of route overlap are visible, but its ownership conclusion does **not** match the reader-facing capture. In pinned frame 0:

- Core→Web and Core→Redis start at columns 34 and 36. `10 GbE` is `[41,22,6,1]` and `25 GbE` is `[41,23,6,1]`. Both text starts are closer to the right-hand x=36 route than the x=34 route. Their two separate rows are not connected by leaders to different routes. The source intends 10 GbE for Web and 25 GbE for Redis; neither is independently assigned by the drawing.
- Web→Redis and Web→DB start at columns 33 and 35. `session` is `[39,30,7,1]` and `queries` is `[39,31,7,1]`. Both start closer to the right-hand x=35 route; no leader or exclusive adjacent placement assigns either string to one of the two paths. The source intends session for Redis and queries for DB.

This is both a **layout defect** and a **checker metric defect**: the metric passes a layout that fails visual ownership. The recorded attempts do not demonstrate that an unambiguous placement was impossible. The issue is separate from route geometry: all four source-to-target paths can still be traced. It affects the meaning of four required edges, each marked fail in the edge audit. WAN→Firewall (`1 GbE`), Firewall→Core (`10 GbE`), and Redis→DB (`fill`) are identifiable. All link-technology strings remain visible; `flow: true` uses a single default rate, not numeric rate encoding. No different animation speed is presented as a link measurement.

## Relations, crossing, and grouping

The seven single-headed edges are WAN→Firewall, Firewall→Core, Core→Web, Core→Redis, Web→Redis, Web→DB and Redis→DB. Redis receives separate heads at pinned (39,34) and (41,34); DB receives heads at (36,42) and (38,42). Their route stems are distinct. The sole bridge `⌒` is screen (35,33), or live screen (38,35): Web→Redis travels horizontally across Web→DB, which continues vertically. The generator calls it (32,34) under its own indexing; these are not the same screen coordinate convention. No fake branch or touch is visible. All three recorded candidates have one bridge; that does not prove global minimality, but it supplies no basis to assert an avoidable crossing without reordering source relations. No extra apparent relation needs an audit entry.

ANSI confirms edge blue `(125,160,184)` / `(151,184,206)`, data pink `(211,134,155)` / `(226,156,175)`, and **both** fabric Core and app Web exactly `(125,174,163)`. This is a **medium defect** in logical-group color legibility, not a complaint that group boxes are missing. Source role names remain visible, which limits the damage. The six individually colored borders and their selected counterparts are continuous; select-all establishes all six occurrences but not six independent selections. No `layers` pins or `minlen` are declared; there is no ignored pin.

The generator's exact family evidence is in `generation.json#step0_classification.evidence`; the result JSON preserves it verbatim. The family and ordered core fan are source-backed. The evidence sentence groups the cache and DB pairs together when mentioning the fixed constraint, although the explicit fixed constraint names the cache pair; the DB pair itself is independently present in the source facts. Neither pair is anti-parallel. The supported family and its applicable recipe pass; label ambiguity is not excused by that pass.

## Evidence gap: full lap

Pinned frames 0–20 cover 0–2000 ms at 77×47. Frame 0 has seven dots on their own first route cells; at frame 2 all seven have advanced one eligible cell, consistent with the checker’s 0.5 cells per 100 ms step. The source requests slow sparse directional traffic; all seven routes have one dot, no numeric flow values, and none occupies a non-origin corner, bridge, arrowhead or label in these frames. Different route lengths need not arrive together.

However, Core→Redis starts at (36,22), and at frame 20 its dot has only reached (45,24), still before the right-side vertical leg and head (41,34). It has **not completed or wrapped a full lap**. Web→DB also has not wrapped. The live 82×51 frames end at the same 2000 ms and begin with a fragment before frame 2. Thus neither target nor live evidence meets the rubric's animated-view full-lap requirement; the pinned fit ruling does not waive motion coverage. Treat this as an **evidence gap/blocker**, not as proof that motion later fails. The validator's all-pass result does not test away this missing observation. No unsupported renderer capability has been demonstrated.

## Workflow and correction candidates

The actual frozen binary, skill, rubric, dataset, three network case files and final spec hashes match metadata/manifest. The three distinct candidate checks plus the pinned dump are wrapper-recorded with exit 0 and matching stdout/stderr hashes; final and third-candidate spec bytes match, and the pinned dump matches its recorded stdout. Validator reports all pass, including `attempts_records_complete`. Live app header is 82×51 @100%; pinned final view proves the required target, not the larger pane. Manifest and generation report pane `w7E:pNM` confirmed closed. Classification in `generation.json` is acceptable workflow placement; the blind stage could not read it.

- **Skill-level correction candidate:** independently inspect label-to-route ownership instead of accepting `0 ambiguous owners`; seek a distinct unambiguous placement without losing any source edge or label. Record a longer target-size animated capture through a full cycle of the longest route.
- **Renderer/checker-level correction candidate:** detect competing parallel routes near gutter labels rather than evaluating only internal label assignment; allow unambiguous route-label placement. Avoid group-name hue collisions or provide a deterministic distinct-family mechanism.
- **Blocker:** missing complete target-size full-lap capture. There is no demonstrated unsupported capability blocker. No viewer session, spec, renderer or blind record was modified during this review.
