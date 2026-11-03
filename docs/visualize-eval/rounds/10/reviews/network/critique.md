# Network — independent round 10 review

**Overall: FAIL.** The source relationships and the pinned views are readable, but the service-mesh fan recipe is not applied in source-list order, and frozen dataset-index identity does not verify. These are known defects, not reasons to rewrite the blind observation. Paths in this review and in `reviewer-result.json` are relative to the repository root. Capture coordinates are 1-based `[column,row,width,height]` within the frame, with the app header as row 1.

| Category | Decision | Basis |
|---|---|---|
| semantic_fidelity | pass | Six nodes, all seven directed relations and their exact meanings appear. The repeated core→Redis is explicitly documented coverage, not a second invented relationship. 1/10/25 GbE are visible labels; all flows use the same non-numeric default motion. |
| arrow_traceability | pass | All eight route occurrences have a distinct head and traceable source-to-head path, without junctions, crossings or apparent unnecessary loops. |
| layout_fit | pass | The spec-bound pinned final dumps both say `viewport: 77x47 zoom: 1.00 natural`; neither clips or overlays content. The live app headers independently show 82×51 at 100%, not 77×47. |
| conceptual_grouping_color | pass | ANSI shows network aqua ≈168°, app magenta 300°, state orange 30°, with source tier names readable and no drawn group enclosures. The previously noted color collision is absent in these captures. |
| category_fit | **fail** | `service-meshes` is a supported classification, and the app triangle and the secondary short transit chain are visible. The fan order is reversed relative to the source's listing: Redis above Web, not Web then Redis. No recorded yield addresses that demand. |
| border_integrity | pass | All 9 occurrence borders are complete and continuous in normal and select-all ANSI. Select-all proves simultaneous selected appearance, not nine separate selection operations. |
| workflow_evidence | **fail** | Actual `cases.json` hash does not equal the frozen `metadata.json` value. Individual network source, expected and historical files do match frozen hashes. The full capture and command records exist and validate; inaccurate coordinates in the generator's narration are a separate low-severity defect. |
| animation | pass | Sparse single dots start at the first drawn cell and every route advances three eligible cells over frames 0→6 (600 ms). Pinned dumps cover the longest laps, without dots on bends, heads, bridges or labels. Corner glyphs are skipped: this supports shared cadence over eligible cells, not constant literal grid-distance through bends. No same-arrival requirement was given. |

## Findings

### F1 — medium defect: source-list fan order reversed

The source lists `core -> web` before `core -> cache`. V1 places the cache/Redis route at upper source stem (52,23) and arrowhead (62,21), with Web at lower stem (52,25) and head (60,26): region `v1-77x47.txt` [39,20,32,9]. The rendered top-to-bottom fan order is therefore Redis then Web, despite `generation.json` claiming it matches the source's `web then cache` order. The required service-mesh recipe expressly requires fan ports to follow the source listing. The measured single-view shape attempts explain why the whole graph was split; they do not establish a yield for this different port-order demand. Correct category, accurate semantic links, and zero crossings do not waive the recipe. A skill-level correction candidate is to explicitly inspect port/target order against source order before claiming the recipe; a renderer-level candidate, if placement cannot otherwise produce it without other defects, is support for stable source-ordered fan ports. Neither remedy was tested or applied here.

The generator states its family in `generation.json` at `step0_classification` (structured fields, rather than a literal chat line): `family: service-meshes`; evidence: “The core switch fans two links into the application tier (core->web 10 GbE, core->cache 25 GbE) and the three application nodes close a triangle (web->cache session, web->db queries, cache->db fill), so the graph is a fan around a core with mesh relations, not a chain (density: 7 relations over 6 nodes) and not a fabric (no redundant parallel links, no double arrowheads).” Its density and fan/triangle rationale identifies the closest family. Its description “no double arrowheads” is imprecise: v2 Redis and DB each visibly receive two arrowheads from distinct relations, but these are not redundant parallel fabric links. No anti-parallel pair exists in the source; inventing one would be a semantic defect. The anti-parallel pair recipe is therefore inapplicable, not an evidenced yield. The secondary flow-chain recipe is declared in that same record and visible as WAN→Firewall→Core.

### F2 — high evidence identity defect / unresolved blocker

The frozen `metadata.json` records the dataset index SHA-256 as `e69179e59a3d36985cd7e8672b319b566701f88caef385c9cbde76d060c92d05`. Actual `docs/visualize-eval/cases.json` hashes to `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05`. This one-byte-looking difference in the textual digest is sufficient to prevent verification of the frozen index; it does **not** establish why the mismatch exists or that the network case changed. The network source, expected, and variant files each independently match their frozen metadata hashes. `reviewer-result.json` records the **actual** index hash, not the incorrect frozen claim, and inventories both files. Resolution needs the authoritative matching index or a justified correction to frozen metadata by the responsible party; this judge changed neither.

### F3 — low defect: capture-coordinate narration

Several `generation.json` claims use coordinates one row and one column below the 1-based frame coordinates: for example, the first WAN source dot is (12,24), not (11,23). Its longest-route description also says 11 drawn cells and a 20-frame lap at 0.5 cells/step; the actual dot-eligible cycle has 10 positions, with bend glyphs skipped. The raw frame and blind record make independent measurement possible, so the pictures remain reviewable. Skill-level correction: report one explicit coordinate convention, and distinguish geometric route cells from dot-eligible positions. Renderer-level correction candidate: document the timing unit and corner-skipping behavior, rather than claiming literal constant grid-distance. These are candidates, not changes made.

## Source-to-capture audit

The node names and route label rectangles are recorded in the unchanged blind record. For each relation the route below is independent, correctly directed, and has no bridge or touching bend:

| Relation | View | Source stem → arrowhead; visible label |
|---|---|---|
| WAN → Firewall | v1 | (12,24) → ▶ (19,24); `1 GbE` [13,23,5,1] |
| Firewall → Core switch | v1 | (30,24) → ▶ (38,24); `10 GbE` [31,23,6,1] |
| Core switch → Web tier | v1 | (52,25) → ▶ (60,26); `10 GbE` [52,26,6,1] |
| Core switch → Redis | v1 and repeated v2 | (52,23) → ▶ (62,21), `25 GbE` [53,22,6,1]; v2 (32,14) → ▼ (33,23), `25 GbE` [34,14,6,1] |
| Web tier → Redis | v2 | (45,14) → ▼ (35,23); `session` [37,21,7,1] |
| Web tier → DB tier | v2 | (47,14) → ▼ (40,34); `queries` [40,27,7,1] |
| Redis → DB tier | v2 | (34,28) → ▼ (38,34); `fill` [36,30,4,1] |

V2's two Redis arrowheads at (33,23) and (35,23), and two DB heads at (38,34) and (40,34), prove convergence without merged edges. The repeated core→Redis is honest cross-view coverage and makes the required separate convergence countable. No additional apparent or reverse edge is visible. All eight labels are closer to their own paths and visually attributable; the v1 fan labels occupy [53,22,6,1] above the upper route and [52,26,6,1] below the lower route. My eye agrees with the current checks' 0 ambiguous, 0 bridges and 0 touching bends, not merely because the checks report them.

For lone horizontal attachments on even four-row boxes, WAN and Firewall stems and the Firewall, Redis, Web target heads attach at the upper of the two middle interior rows; Core's two five-row fan ports straddle its center. V2 Core's lone lower stem is at its center x32, Web's two stems x45/x47 straddle x46, and target pairs similarly straddle Redis x34 and DB x39. This is a consistent even-height tie break, not a failed mid-side attachment.

## Evidence and limitations

The deterministic final-spec manifest is `docs/visualize-eval/rounds/10/reviews/network/spec-manifest.json`, SHA-256 `548c6880d5b100ce733bc20ed1bfc94516984bebe460ef72e8fa8766b08a0679`. Both final spec hashes, the captured binary hash, candidate skill and rubric hashes were independently verified. The preserved blind record SHA-256 remains `1ed206fbd227f5afee8d415008a8fd8b89dc0e55475f2113e9c3e97e1c822684`; it was saved before reveal and has not been modified. The ten recorded command entries bind specs and stdout/stderr to actual hashes, including both pinned full-lap dumps. Both recorded validator results pass. Contrary to the stage-B prompt's parenthetical that all records exited 0, `v1-c` exited **1** with its recorded route failure; this is a correctly recorded failed probe, not a failure of the final candidate. The pinned dump and frame copies are byte-identical to their recorded stdout. Pinned fit and full-lap evidence is accepted under the round ruling; live frame scrollback is only partial. The live headers show 82×51; manifests contain no pane rectangle and no `pane_cols`, so the header is the dimension evidence.

Two capture manifests report `confirmed_closed` for `w7E:pQQ` and `w7E:pQR`. The pinned dumps are headless and the judge launched no viewers. The full family classification was placed in `generation.json`, rather than in the visual itself; the rubric calls for a stated, source-backed line and it is preserved there, so its location alone is not a workflow failure. The generator's unsupported claim of source fan order is not excused by that placement. The review uses round integer 10 and the actual worker `viz-ds10-2`, following the explicit case handoff over stale round/identity templates in the general task file.

No independent renderer capability blocker is established for source-order fan placement: recorded attempts prove only that three whole-graph shapes failed, not that every ordered fan layout is impossible. The frozen-index hash mismatch is the unresolved evidence blocker; the visual fan-order defect remains a known failure even if that mismatch is resolved.
