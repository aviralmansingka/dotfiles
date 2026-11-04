# Network round 01 — independent Astra Stage B critique

## Verdict

**FAIL.** The three final views preserve all six source concepts and all seven directed relationships. Every required link is locally traceable. The result nevertheless fails the frozen border-color continuity and sparse-animation gates. The earlier conceptual-color failure is withdrawn after checking its basis against the source; it had improperly treated cross-view hue stability as a separate requirement. Natural-100% scale attestation and executed-binary/check-command provenance remain blocked. Missing evidence does not turn the known failures into a merely blocked case.

| Frozen category | Decision | Main reason |
|---|---|---|
| `semantic_fidelity` | **pass** | Six concepts and seven relations are visible; labels and directions match the qualified case source; complete split coverage is explicit. |
| `arrow_traceability` | **pass** | Seven required links, eight rendered instances, all have continuous isolated stems and unique downward arrowheads. |
| `layout_fit` | **blocked** | Actual 77×47 and complete unobscured fit are established. The numerical 100% zoom state is not independently attested. |
| `conceptual_grouping_color` | **pass** | Related roles remain adjacent in source-ordered chains; distinct named tiers remain distinguishable. The source defines no multi-node same-tier color group, and view-local hue changes do not themselves imply a false group. |
| `border_integrity` | **fail** | Every node has two neutral-colored border cells, including selected outlines. Geometry is complete; per-node color continuity is not. |
| `workflow_evidence` | **blocked** | Frozen hashes, captures, checks/status, identity records and cleanup exist, but launch-to-binary binding and exact executed check argv are missing. |
| `animation` | **fail** | Adjacent double dots occupy two of three stem cells on every route in frame-02. Direction and slow speed additionally remain unverified because samples alias. |

All seven categories apply. There is no animation N/A: `cases.json`, the case task, and `expected.json` explicitly require animation. Three categories pass, two fail, two are blocked. This is a case-level decision, not an eight-case aggregate or permission to revise the skill. The captain must collect all eight complete critiques first.

## Independence, paths, and frozen baseline

All evidence inventory paths in `reviewer-result.json` are **repository-relative**, rooted at the checkout containing `docs/visualize-eval/`. Capture coordinates are 1-based **[column,row,width,height]**, not spec/world coordinates. Short references such as `v02-unselected-ansi` are exact evidence IDs in that JSON inventory. View IDs resolve under:

`docs/visualize-eval/rounds/01/network/views/<view>/`

The Stage A record was saved before this follow-up and was not changed. Its SHA-256 was checked before reading the revealed inputs and again during Stage B:

`2b96648d1c9df2483cb2d6bd347401fb951138cb8335bfca1bc94d49f301f436`

I used the source and expected relation list only after that check. I did not change the observations to match the source. In particular, Stage A already read both `fill` arrows as Redis cache → DB tier, reported the neutral border cells and changing normal hues, and declined to infer continuous dot direction/speed or numerical zoom.

Reviewer runtime identity was inspected directly: `PI_SUBAGENT_NAME=viz-judge01-network`, `PI_PROVIDER=openai`, `PI_MODEL=gpt-6-astra`. Its session differs from the generator session recorded in `generation.json`. The required generator identity is `viz-ds01-network`, model `fireworks/accounts/fireworks/routers/deepseek-flash-latest`, consistently recorded in frozen metadata and the generator report. The report writer hardcodes that generator identity; I distinguish those records from independently retained raw generator process attestation. I did not substitute another model or delegate review.

The frozen inputs were rehashed, with these results matching metadata:

| Input | SHA-256 |
|---|---|
| Candidate skill | `9c5cea272a88300644cacda52c853c7c9169eeec91f0355d3460ee8741308d92` |
| Frozen renderer bytes | `4a883e73b822f009c504bd21d0c2fc383067bf1b83b9791ccbda431912e3a1d8` |
| Round01 rubric | `60997237bd996f1e1b6a16e0b68133859b9f03fd83c85e7f508e286743240f5d` |
| Dataset index (`cases.json`) | `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05` |
| Network source | `9d23a7b50d1d26a69f95523a9586bab96ec588afb9628ae274c896992b147947` |
| Network expected data | `8cb86d269c21176d775e79f8592f09067049031a0e581df38d66705e73a8caa9` |
| Sorted final-spec manifest | `6d2ed7273ed73fd6fb6338542605e4d5181c0e0376f98484cc0826a4c6883fa7` |

`spec-manifest.json` contains sorted `[repository-relative spec path, actual SHA-256]` pairs. Each spec also matches its saved `captures/spec.sha256`. The renderer exists at the external path declared by metadata, `/tmp/visualize-eval/round-01/bin/rataflow-view`; its bytes were hashed but **never executed** during review. `artifact-verification.json` preserves this external-artifact verification, runtime reviewer identity, independent raw-cell audits, and the source/spec relation unions. No current source tree or current shell PATH was used as proof of historical execution.

Round01 is its own renderer baseline. No cancelled-round evidence was read, reused, or scored, and no renderer improvement is attributed to a skill change. Generator claims about discarded arrangements are not evidence against the three final views, nor proof that every possible one-view solution is impossible. Those attempts were not used for scoring.

## Source coverage and meaning

The case source qualifies its topology as historical generated relations, not independently verified facts about a real network. I judge fidelity to this frozen case contract; I do not certify that these relationships describe a deployed system.

All six required concepts are visible:

| Source concept | Final views | Visible label locations |
|---|---|---|
| WAN (`wan`) | 01 | `[34,8,3,1]` |
| Firewall (`fw`) | 01 | `[34,16,8,1]` |
| Core switch (`core`) | 01, 02 | 01 `[34,24,11,1]`; 02 `[34,16,11,1]` |
| Web tier (`web`) | 01, 03 | 01 `[34,32,8,1]`; 03 `[34,16,8,1]` |
| Redis (`cache`) | 02, 03 | Both `[34,24,11,1]`, labeled `Redis cache` |
| DB tier (`db`) | 01, 02, 03 | 01 `[34,40,7,1]`; 02/03 `[34,32,7,1]` |

`Redis cache` is a faithful clarification of Redis with the source's `cache` identity, not a substituted concept. Every link label retains its meaning. The fixed constraint requires visible speed labels without pretending motion measures throughput; uniform `flow: 0.2` on every edge does not invent measured link rates. The older request about representing speed does not override that qualified constraint.

### Every relation, source stem to target arrowhead

The following table records all required routes. Each corridor includes the initial stem through the arrowhead; source/target contact cells are listed separately. All coordinates reference the view's `captures/unselected.txt` and match its ANSI export.

| Expected relation | View | Source border contact | Full corridor | Arrowhead → target border contact | Label |
|---|---|---|---|---|---|
| WAN → Firewall | 01 | `[34,10,1,1]` | `[34,11,1,4]` | `[34,14,1,1]` → `[34,15,1,1]` | `1 GbE` `[36,12,5,1]` |
| Firewall → Core switch | 01 | `[34,18,1,1]` | `[34,19,1,4]` | `[34,22,1,1]` → `[34,23,1,1]` | `10 GbE` `[36,20,6,1]` |
| Core switch → Web tier | 01 | `[34,26,1,1]` | `[34,27,1,4]` | `[34,30,1,1]` → `[34,31,1,1]` | `10 GbE` `[36,28,6,1]` |
| Core switch → Redis cache | 02 | `[34,18,1,1]` | `[34,19,1,4]` | `[34,22,1,1]` → `[34,23,1,1]` | `25 GbE` `[36,20,6,1]` |
| Web tier → Redis cache | 03 | `[34,18,1,1]` | `[34,19,1,4]` | `[34,22,1,1]` → `[34,23,1,1]` | `session` `[36,20,7,1]` |
| Web tier → DB tier | 01 | `[34,34,1,1]` | `[34,35,1,4]` | `[34,38,1,1]` → `[34,39,1,1]` | `queries` `[36,36,7,1]` |
| Redis cache → DB tier | 02 and 03 | `[34,26,1,1]` | `[34,27,1,4]` | `[34,30,1,1]` → `[34,31,1,1]` | `fill` `[36,28,4,1]` |

Each unselected corridor reads, top to bottom, vertical line, vertical line, dot, downward arrow. The line cells remain continuous through the animation substitutions. No route bends or crosses another; same-column corridors have disjoint row ranges separated by node boxes. Every label is separated from its route by one blank column, in that route's own inter-node gap. The two `10 GbE` occurrences are distinct correctly associated labels.

The source's intentional fan-out/fan-in is represented **across views**: Core has Web and Redis targets; Web has Redis and DB targets; Redis receives the separate Core and Web relations; DB receives Web queries and Redis fill. These relations were not bundled into a common bus or erased. The rubric allows split views with explicit complete coverage; it does not require an additional simultaneous overview. The source → target tuple union in the final specs equals the seven source tuples, and each tuple was separately verified in raw captures.

`fill` appears twice, with the same endpoints/direction/label, and is explicitly declared duplicated coverage in `generation.json`. It is not a new eighth semantic link. No unexpected apparent link was found. Edge-audit entries pass endpoint/direction/label/trace requirements; their references to animation findings do not claim that animation also passes.

The stems contact a horizontal `─` border near the left interior column rather than a center-handle glyph. This is visually unambiguous on these straight chains and is not itself a fabricated junction. The off-axis center-color cells are a border-color defect, not evidence of a hidden edge.

## Concrete failures and blockers

### N01 — Border integrity fails; medium severity

Every one of the eleven visible node instances has two neutral RGB `(146,131,116)` border cells. The remaining outline uses the node's normal hue. All four corners and both sides are geometrically complete, so this is a **color continuity**, not missing geometry, failure.

Exact exception locations in unselected ANSI:

- View 01: WAN `[35,7,1,1]`, `[35,10,1,1]`; Firewall `[38,15,1,1]`, `[38,18,1,1]`; Core `[39,23,1,1]`, `[39,26,1,1]`; Web `[38,31,1,1]`, `[38,34,1,1]`; DB `[37,39,1,1]`, `[37,42,1,1]`.
- View 02: Core `[39,15,1,1]`, `[39,18,1,1]`; Redis `[39,23,1,1]`, `[39,26,1,1]`; DB `[37,31,1,1]`, `[37,34,1,1]`.
- View 03: Web `[38,15,1,1]`, `[38,18,1,1]`; Redis `[39,23,1,1]`, `[39,26,1,1]`; DB `[37,31,1,1]`, `[37,34,1,1]`.

Both selected captures highlight the middle box `[33,23,13,4]` in each view: Core in view 01, Redis in 02/03. Its corners and sides become amber `(216,166,87)` and bold; the two neutral cells retain their different RGB, although they become bold too. Every selected/unselected outline was checked from raw ANSI, not only plain text.

The generator calls this cosmetic and its verification report still concludes that all mechanical checks pass. Neither statement changes the frozen requirement that **every** border cell, including handles and selected states, use consistent per-node color. Severity does not waive the failure.

### Conceptual color grouping passes — prior finding N02 withdrawn

**Consistency correction, existing evidence only.** The earlier N02 did not establish a source-backed grouping defect independently of cross-view hue drift. That observation is real, but a requirement for globally stable per-node hues is not in the frozen rubric. N02 is removed from the active findings; it is not downgraded into a speculative defect. The source, rubric, raw captures, and blind observations are unchanged.

Superseded reports are archived byte-for-byte under `superseded/01-color-stability/` in this review directory:

- `reviewer-result.json`: SHA-256 `454642029522a98cd6d9417335ebb17a7220e0faa7cf9bb0619aca3341280c92`.
- `critique.md`: SHA-256 `87000dd8274b5bc69fdbae605916ac5145fcf3ad5d240cb937aa52382a2d819f`.

No sibling-case output was read. The correction rests only on this case's source and retained captures.

Normal per-node colors, excluding the neutral defects:

| Concept | View 01 | View 02 | View 03 |
|---|---|---|---|
| WAN | amber `(216,166,87)` | — | — |
| Firewall | teal `(125,174,163)` | — | — |
| Core switch | pink `(211,134,155)` | amber `(216,166,87)` | — |
| Web tier | green `(169,182,101)` | — | amber `(216,166,87)` |
| Redis cache | — | teal `(125,174,163)` | teal `(125,174,163)` |
| DB tier | blue `(125,160,184)` | pink `(211,134,155)` | pink `(211,134,155)` |

Core changes hue between boxes `[33,23,13,4]` in view 01 and `[33,15,13,4]` in view 02. Web and DB similarly change hue. These remain valid raw observations, but **they are not by themselves violations**. WAN/Core/Web sharing amber in separate views does not assert that they form one source group. There is no shared enclosure, source-group label, legend, or simultaneous same-hue cluster making that claim. Absence of a legend is not a separate frozen failure condition.

The actual related source concepts are the adjacent roles on the source's directed paths: WAN/Firewall/Core switch/Web tier/DB tier in view 01, Core switch/Redis cache/DB tier in view 02, and Web tier/Redis cache/DB tier in view 03. Their boxes occupy the ordered regions `[33,7,13,36]`, `[33,15,13,20]`, and `[33,15,13,20]`, respectively. The source specifically distinguishes the Core-to-Redis and Web-to-Redis links, and both remain separate and clearly associated. It describes Web, Redis/cache, and database as distinct tiers, not a source-defined same-tier sibling set requiring one hue family. Nor does a shared source endpoint make Core's Web/Redis targets, or Web's Redis/DB targets, a declared color group.

Each named role/tier has one node per view. Source order and proximity are preserved, with different tier hues rather than a visibly false within-tier grouping. There is no source-defined multi-node tier or pair whose related-hue treatment is demonstrably broken here. I therefore cannot name an actual misleading or unsupported source group independent of the withdrawn global-stability assumption. **The category passes for this source granularity.** This does not waive related hues for a source-defined multi-node group; it avoids inventing such a group or requiring all connected endpoints to share a hue. It also does not claim that automatic geometric depth universally proves conceptual grouping.

Gruvbox styling and matching interiors/backgrounds remain positive observations, not substitutes for the source check. The normal first node and selected middle node share amber, but bold distinguishes selection. Border-color discontinuities remain independently failed under N01.

### N03 — Sparse animation fails; medium severity

Frame-02 of **every view** has two adjacent `●` glyphs on each edge:

- View 01: `[34,12,1,2]`, `[34,20,1,2]`, `[34,28,1,2]`, `[34,36,1,2]`.
- Views 02 and 03: `[34,20,1,2]`, `[34,28,1,2]`.

Each route has only three stem cells before its arrowhead; two are dots in these frames. That is visibly non-sparse on these short corridors. This finding does not introduce a numeric seven-cell threshold into the frozen rubric: the seven-cell separation statement is a **generator/skill claim contradicted by the capture**, while the rubric's actual requirement is sparse motion. No inference about backend particle implementation is necessary.

The dot glyphs stay off borders in all retained frames. They do not replace label text or arrowheads. All frames were audited, including selected-state text, and all seven source routes are covered. These positives do not cancel N03.

### N04 — Direction and slow-speed evidence is aliased; high-severity evidence gap

Frames are separated by approximately 2–3 seconds. Views 01/02 show lower-only → adjacent pair → upper-only → lower-only. View 03 remains upper-only in frame-04 and is lower-only again in the later unselected capture. This proves temporal variation, not a unique particle's continuous trajectory or speed.

The source requires motion direction to follow traffic direction and asks for slow motion. A downward arrow plus changing dot cells cannot establish that the dots continuously travel downward, nor how fast they do so. Identical `flow: 0.2` in JSON is intended configuration, not sufficient actual-render evidence. The generator's “5–6 cells every 2.5 seconds” is not derivable from these four-cell visible routes and sparse samples. No speed ratio or measured-throughput claim is accepted.

The animation category remains **fail** because N03 is already observed. Direction/speed evidence is additionally blocked, not silently assumed good.

### N05 — Workflow execution provenance is incomplete; high-severity evidence gap

Positive evidence:

- Frozen input and all final spec hashes match.
- Actual final text and ANSI, selected/unselected states, four timestamped frames per view, command logs, and raw dimensions exist.
- Each `check.txt` preserves a summary/extent and `exit=0`; each corresponding stderr file is empty. No final check warning is present.
- Generator and critic assignments match the mandated lanes; actual critic environment matches Astra. Stage A predates this reveal and its file is unchanged.
- Actual cleanup layouts show only the generator's owning pane after each final view closes.

Missing binding:

1. Each saved actual viewer command launches bare `rataflow-view`, not the frozen absolute path. `capture-view.sh` declares `BIN=/tmp/visualize-eval/round-01/bin/rataflow-view` but does not use `$BIN` in its launch. There is no retained pane-shell resolved executable/PATH evidence in the final records. Hashing the frozen file today proves those bytes exist, not that this bare command executed them.
2. Check stdout/stderr/exit records exist, but the exact executed `--check` command/executable/arguments are not retained in the final command logs or capture procedure. A candidate skill example is not an execution record.
3. Generator process identity/freshness is recorded consistently by orchestrator metadata and self-report, but the report writer hardcodes its model/session fields rather than storing a raw process-environment attestation. No substitution is inferred; the limitation is kept explicit.

The category is **blocked**, not a claim that another binary/model was actually used. Current PATH, current renderer source, or a new render would not prove what the historical commands executed. No such repair was attempted.

### N06 — Fit is visibly good; strict numerical scale attestation is blocked

Every `dims-raw.txt` records `47 77` at `[1,6,5,1]`, then `77` and `47` on rows 7/8. The captures are 77-column ANSI grids with a blank row 47. Each split command uses ratio 0.5.

- View 01 actual graph bounds: `[33,7,13,36]`.
- Views 02/03 actual graph bounds: `[33,15,13,20]`.
- All views' control box: `[2,41,9,6]`, separated from graph content.

All node labels and all edge labels are full-width, all boxes complete, and no overflow badge or overlay occlusion is visible. The check extents are 17×40 and 17×24, consistent with the observed graph plus margins. Large blank margins are not themselves a frozen-rubric failure.

The saved procedure launches the default view and contains no zoom commands; the four-row boxes look natural-sized. Nevertheless, neither capture nor saved executed state reports numeric zoom, and the default of the hashed binary is not tied to the bare executed command (N05). I retain Stage A's uncertainty rather than promote the generator's “100%” assertion to a measurement. `viewport.verified` is false for that combined gate; `live_pane` separately records the measured 77×47. This is a scale-attestation blocker, **not** an accusation of zooming out, panning, or clipping.

## Cleanup

The generator declares these thirteen owned visualization/attempt panes in tab `w7E:tK`:

`w7E:p33`, `w7E:p38`, `w7E:p3H`, `w7E:p30`, `w7E:p44`, `w7E:p46`, `w7E:p4B`, `w7E:p4J`, `w7E:p4P`, `w7E:p52`, `w7E:p54`, `w7E:p5A`, `w7E:p5D`.

Each final view's `layout-after-close.json` lists only `w7E:p2R`, the owning generator pane, with no split. The three final command logs additionally record `p54`, `p5A`, and `p5D` gone after `q`. This supports the final cleaned state, including absence of declared earlier panes from that tab. It does not individually attest every prior close operation. The reviewer created or operated no panes/sessions.

## Correction candidates — not applied

These are bounded candidates for the captain's later synthesis, not approved edits or claims that a workaround has been proved.

### Skill/workflow-level candidates

- Preserve the existing per-relation split coverage discipline. It succeeds here; do not reverse `fill`, delete the separate Core/Web cache links, or shorten away required speeds to hide other defects.
- Judge color groups against source-defined roles, tiers, and pairs, not an added global per-node color-stability rule. Do not infer that arbitrary geometric depth proves semantic grouping, but do not invent a multi-node hue group where the source defines distinct singleton tiers. No network color-grouping correction is required by the retained evidence.
- Make actual frozen-path launch and exact `--check` argv part of the saved execution record. Preserve process identity/zoom state attestation rather than only prose claims. Require capture results to drive the decision; border-color exceptions cannot remain non-failing notes under this rubric.
- Plan time-resolved motion evidence that can distinguish direction and slowness on short routes. Do not infer a fixed number of traversed cells from aliased sparse snapshots. This review does not request a new rendering now.

### Renderer-level candidates

- Keep handle strokes in the node's own normal/selected border color. Actual handles remain neutral in every inspected state, despite complete corners/sides. The frozen documented spec exposes no direct handle-color control.
- Investigate adjacent double-dot rendering on short edge corridors and ensure sparse presentation without changing direction/labels or covering borders. The visible failure is established; whether its cause is particle spacing, compositing, or another implementation detail was not diagnosed from current source code.
- Expose or preserve actual zoom state and useful time-resolved flow evidence if the current capture interface cannot attest them. This is an evidence/capability candidate, not permission to substitute another rendering surface.

The generator's assertions that no single-view workaround exists or that side attachments always fail are not independently established by the final captures reviewed here. They are not used as rubric exemptions. Similarly, its pre-review “Astra not run” note is superseded by this independent two-stage review, not carried forward as an unresolved absence of a reviewer.

## Reports and verification

Files written under `docs/visualize-eval/rounds/01/reviews/network/`:

- `reviewer-result.json` — all seven category decisions, seven per-edge audits covering both fill instances, 85 hashed evidence entries, five active evidence-linked findings (N02 withdrawn), blockers, and cleanup.
- `critique.md` — this complete critique.
- `spec-manifest.json` — deterministic final-spec path/hash pairs.
- `artifact-verification.json` — independent frozen hash checks, raw ANSI/text correspondence, per-node border exceptions, per-frame dot cells, relation-union checks, and actual reviewer identity.

The original `observed-first.md` remains unchanged. Independent Python inspection ran through `uv` with the standard library; no package installation, generator verification helper execution, new rendering, fixes, builds, commits, or subagents were used. JSON schema validation is performed against the embedded frozen `result_schema`, without installing a validator dependency.
