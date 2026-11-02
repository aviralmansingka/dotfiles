# modal-runtime — round 02 independent full review

## Verdict

**PASS for this case: six applicable categories pass; animation is source-backed N/A.** All eight required directed relations pass. There are no failing rubric findings and no required renderer-capability blockers.

This is a case result, not a declaration that the eight-case evaluation is green. No round-01 score or renderer behavior was used. Round 02 is judged as its own frozen renderer baseline.

Reviewer: `viz-judge02-modal-runtime`, model `openai/gpt-6.1-sol`.
Generator: `viz-ds02-modal-runtime`, model `fireworks/accounts/fireworks/routers/deepseek-flash-latest`.

### Reports and path convention

All evidence paths in `reviewer-result.json` are repository-relative, rooted at `/Users/aviral/.herdr/worktrees/dotfiles/fix-visualize-skill`. Capture regions use 1-based `[column,row,width,height]`, including the header at row 1. In this document, `v1-ansi`, for example, is the evidence id for `docs/visualize-eval/rounds/02/modal-runtime/evidence/v1/v1-ansi.ansi`; selected and frames ids follow the same convention.

Deliverables:

- `docs/visualize-eval/rounds/02/reviews/modal-runtime/reviewer-result.json`
- `docs/visualize-eval/rounds/02/reviews/modal-runtime/critique.md`
- `docs/visualize-eval/rounds/02/reviews/modal-runtime/spec-manifest.json`
- Unchanged blind record: `docs/visualize-eval/rounds/02/reviews/modal-runtime/observed-first.md`

The manifest binds the **three final executed specs**, sorted by repository-relative path. Rejected/promoted attempt files are separately hashed in the result's evidence inventory; they are not alternative final views.

## 1. Seven-category comparison

| Category | Decision | Source/capture basis |
|---|---|---|
| semantic_fidelity | **pass** | Eight exact component titles and eight correct directed endpoint pairs are visible; abbreviated meanings are readable and the supplementary views expand protocols/actions without dropping a relation. |
| arrow_traceability | **pass** | All 16 displayed edge occurrences have followable source stems and unique, correct arrowheads. Zero crossings, wire junctions, fake branches, or uncertain caption owners. |
| layout_fit | **pass** | Every view is actually captured at 77×47, natural 100%; every box and label is complete, with no palette occlusion or need for pan/zoom. The independent CLI rectangle is unavailable and is not invented. |
| conceptual_grouping_color | **pass** | Captured hue families and proximity distinguish orchestration, execution, and storage concepts. Related pairs remain related within each view. Cross-view per-node hue stability is not an additional gate. |
| border_integrity | **pass** | ANSI proves complete, color-continuous normal and all-selected perimeters for all 17 node occurrences. |
| workflow_evidence | **pass** | Frozen hashes, exact commands, combined check output/exit states, captures, dimensions/zoom, selected-state coverage, stage-A seal, and three cleanup records are preserved and verified. Known metadata limitations are disclosed rather than filled with estimates. |
| animation | **N/A** — applicable=false, status=null | This source asks for readable runtime components, seams and RPCs, not motion. Both the frozen dataset entry and expected data mark animation `optional`. Optional dots do not impair static reading. |

No severity exception is being used to turn a failed applicable category into a pass. No applicable criterion is knowingly failed. Non-required motion/provenance capabilities are not new pass conditions.

## 2. Required concepts, meanings, and complete split coverage

The frozen source and expected data require these eight titles: modal-worker, modal-runtime, Task engine, Container backend, Task container, Filesystem + volumes, Blobnet, and modal-daemon. All eight are visible in v1. No machine-manager, River, database, NIC, or other concept is substituted or invented.

**The three-view composition preserves every required relation with complete coverage.** In fact, v1 already draws all eight directed relations. v2 is an upper-region protocol detail, not a replacement that silently discards execution/storage. v3 is a lower-region action/payload detail, not a disconnected second architecture. The same **Task engine** title is present in all three views. The dispatch arriving at Task engine in v2 connects to the two Task engine departures in v3; the complete bridge is also directly visible in v1.

| Required relation | Captured coverage | Meaning visible to a reader | Decision |
|---|---|---|---|
| e1 worker → runtime: task input + control RPCs | v1-A, v2-A | `task+ctrl` into runtime; `gRPC call` on the same directed endpoint pair in v2 | pass |
| e2 runtime → worker: events + management RPCs | v1-B, v2-B | `events+mgmt` on the separate return route; `gRPC events` in v2 | pass |
| e3 runtime → engine: dispatches tasks | v1-C, v2-C | `dispatches` / `dispatch` into **Task engine**, preserving the action and task context | pass |
| e4 engine → backend: starts / manages | v1-E, v3-A | `starts/manages` / `starts / manages` | pass |
| e5 backend → container: runs user process | v1-G, v3-C | `runs user proc` / full `runs user process` | pass |
| e6 engine → filesystem: mounts / snapshots | v1-F, v3-B | `mounts/snapshots` / `mounts / snapshots` | pass |
| e7 filesystem → Blobnet: image + volume data | v1-H, v3-D | `image+vol data` / full `image + volume data` | pass |
| e8 runtime → daemon: filesystem HTTP over UDS | v1-D, v2-D | `fs HTTP/UDS` / `HTTP over UDS`, distinct from both worker gRPC captions | pass |

There are eight **distinct** endpoint pairs and 16 displayed occurrences, not 16 independent source relations. All displayed occurrences belong to one of these eight audits; no extra apparent relation needs an unexpected-link entry.

`ctrl`, `mgmt`, `proc`, `vol`, and `fs` are understandable local contractions in this technical context. In v1, the input direction supplies the task-input role and the target **Task engine** supplies the dispatch task context. v2 makes the worker protocol explicit while preserving the action-oriented overview. The frozen rubric requires label meaning, not character-for-character reproduction of historical sentences. I do not use the generator's off-canvas abbreviation ledger as a substitute for an otherwise absent concept. Here the captured text and endpoints jointly carry the required meaning.

The source describes these relationships as historical claims, not independently verified runtime facts. This review preserves that provenance. The fixed case constraints still expressly require all eight relationships; they do not identify an individually unconfirmed edge that must be dashed, nor demand an on-canvas research citation. Solid routes therefore do not fail a source-required uncertainty condition. No new research or remote execution was appropriate.

## 3. Arrow audits and exact evidence regions

The unchanged blind record has all 33 diagram-label rectangles, all box rectangles, all bends, heads, and motion positions. The machine-readable result audits every required source relation and both of its captured occurrences. The following regions bind those audits to the still captures:

| Edge | v1 region | Supplementary region | Direction evidence |
|---|---|---|---|
| e1 | v1-ansi [20,11,12,4] | v2-ansi [24,19,12,4] | v1 stem (21,11), head `▼` (20,14); v2 head `▼` (24,22) |
| e2 | v1-ansi [34,8,14,9] | v2-ansi [38,16,14,9] | Runtime right-side stem, separate up corridor, left head `◀` (34,8) / (38,16) into worker |
| e3 | v1-ansi [20,19,12,4] | v2-ansi [24,27,10,4] | Down heads (21,22) / (25,30), into engine |
| e4 | v1-ansi [18,27,16,4] | v3-ansi [18,19,18,4] | Down/left/down to heads (18,30) / (18,22), into backend |
| e5 | v1-ansi [18,35,16,4] | v3-ansi [18,27,19,4] | Down/right/down to heads (20,38) / (20,30), into container |
| e6 | v1-ansi [23,27,19,4] | v3-ansi [23,19,19,4] | Independent engine stem, right/down to heads (41,30) / (41,22), into filesystem |
| e7 | v1-ansi [34,35,15,4] | v3-ansi [22,27,27,4] | Filesystem bottom stem, right/down to heads (48,38) / (48,30), into Blobnet |
| e8 | v1-ansi [22,19,24,4] | v2-ansi [26,27,18,4] | Independent runtime departure, right/down to heads (45,22) / (43,30), into daemon |

Each source stem remains adjacent to the source box, and each head points into the correct target box. The two worker/runtime directions do not share a route. Engine/backend and engine/filesystem are independent links, not a source-named bus. No trunk is demanded by this source, so absence of a trunk is not a capability failure.

There are four tight **same-route** touching bend pairs: v1 (20,13)/(21,13), v1 (20,21)/(21,21), v2 (24,21)/(25,21), and v2 (24,29)/(25,29). These S turns are compact but readable. They do not connect two unrelated edges. There are no crossing bridges or T junctions to disambiguate.

### Local placement caveats, not failing findings

- v1 `dispatches` [22,21,10,1] begins immediately after its own bend (21,21); v2 `dispatch` [26,29,8,1] does likewise. Neither erases a route cell or attaches to the HTTP route.
- v1 `mounts/snapshots` [24,28,16,1] and v3 `mounts / snapshots` [24,20,18,1] begin directly beside their own vertical segment. They remain legible, even where the optional dot replaces that straight segment.
- v1 `image+vol data` [34,38,14,1] ends immediately before its own arrowhead (48,38). The head remains present and distinct.
- v3 `image + volume data` [22,27,19,1] begins under the left box and spans the gap. This invites an initial left-side reading, but its final character at column 40 directly abuts the **right** route at column 41. The left route is at column 18, with no contact to this caption. I assigned the right-hand owner in the blind stage, before seeing expected relationships; no expectation-driven reassignment is made now.

These observations do not establish an unreadable label or uncertain owner. Fused labels, clipped items, and uncertain label owners remain zero.

## 4. Grouping and border evidence

### Conceptual families actually visible

In v1:

- **Orchestration:** modal-runtime [19,15,15,4] has RGB (125,174,163); Task engine [20,23,13,4] has RGB (147,194,183). The nearby teal shades and connected vertical placement pair the dispatcher with its engine.
- **Execution:** Container backend [17,31,19,4] has RGB (169,182,101); Task container [19,39,16,4] has RGB (189,201,124). These green shades pair the lifecycle backend with its child process container.
- **Storage:** Filesystem + volumes [40,31,22,4] has RGB (125,160,184); Blobnet [47,39,9,4] has RGB (151,184,206). The blue pair forms the separate storage branch beside execution.

v2 retains the runtime/engine teal family. v3 uses a teal execution pair and a pink storage pair; their relative proximity still expresses the same source-backed chains. Engine as the local root is gold. This is not evidence of arbitrary alphabet/depth cycling: different concepts at the same depth have different hues, and related concepts at different depths share hue families. The changing family palette between views is **not** an extra frozen failure condition.

Worker and daemon remain separate interface roles, rather than receiving the same color merely because each touches runtime. The source distinguishes task/control/event RPC seams from the daemon's filesystem HTTP interface; not every pair connected by an edge must be monochromatic.

### Border gate

All **17/17** normal node perimeters and **17/17** all-selected node perimeters are checkable. Complete top/bottom runs, both vertical sides, and four corners were checked against the actual capture glyphs. ANSI proves each normal perimeter has one uniform per-node foreground. In selected captures, every perimeter cell is uniformly bold RGB (216,166,87), including corners. The first node of each view is gold in both captures but gains bold in the selected capture.

No handle is visibly drawn through or over a perimeter. The evidence does not prove isolated one-node selection, dragging/hover states that were never captured, or timestamped color continuity: diagram portions of the `*-frames.ansi` files are uncolored glyph output. Those are explicit limits, not observed broken borders. The required captured selected state is covered fully by the all-selected frames.

## 5. Motion applicability and the four fixed-position routes

**The four aliased/stationary route occurrences do not fail this source.**

Source references:

- `docs/visualize-eval/cases/modal-runtime/source.md`: Task and original user excerpts at lines 5/12 ask for runtime components, readable seams/modules/RPCs, and research, not animated motion.
- `docs/visualize-eval/cases.json`: modal-runtime entry has `animation: "optional"`.
- `docs/visualize-eval/cases/modal-runtime/expected.json`: `animation: "optional"`.

Accordingly animation is N/A, not pass. No motion category point is earned.

At 0,100,200,300,400 ms:

| Optional route | Captured dot coordinates | Interpretation |
|---|---|---|
| v1-A / e1 | (21,12) in all five frames | Motion direction and cadence unproved |
| v1-C / e3 | (20,20) in all five frames | Motion direction and cadence unproved |
| v2-A / e1 | (25,20) in all five frames | Motion direction and cadence unproved |
| v2-C / e3 | (24,28) in all five frames | Motion direction and cadence unproved |

These are four displayed route occurrences over two distinct source relations. The captures cannot decide whether the dots are truly stationary or sampling-aliased. In addition, v1-E/v3-A repeat a three-position local cycle, and v1-G/v3-C repeat a two-position local cycle. No end-to-end transit is demonstrated for any route.

The generator's `generation.json` and `generation.md` claim that dot cells move on every 100 ms step; that claim is **not supported** for the four routes above. I retain the contrary blind observations. This is not missing evidence for a required animation task, because there is no such task here; nor does the inaccurate self-audit remove the preserved inspectable captures. It earns no credit.

All 80 timestamped route-dot observations show exactly one dot per route and no dot on a corner, bridge, junction, arrowhead, border, or label cell. The optional animation therefore does not damage the applicable arrow-traceability, border, label-meaning, or fit gates. If motion were required, the fixed-position samples would not prove directed movement; this case result must not be reused as an animation pass.

## 6. Fit, workflow, hashes, and cleanup

### Measurement

All three ANSI stills have 47 rows of 77 cells. Each header contains `77x47 @100%`, and each captured transcript prints `viewport: 77x47 zoom: 1.00 natural`. Observed graph bounds are:

- v1: columns 17–61, rows 7–42.
- v2: columns 23–55, rows 15–34.
- v3: columns 17–61, rows 15–34.

The zoom palette [2,41,9,6] does not occlude any graph item. No pan or zoom-out is needed. All labels and all box sides fit.

The manifests record pane rows 47, but `pane_rect`, `pane_cols`, and `viewport_line` are null. I do not replace them with the generator's estimated geometry; `live_pane` is **null** in the result. The app viewport line is separately recoverable from every frames transcript. Frozen `metadata.json` explicitly discloses the non-focused-tab rectangle limitation and identifies the app header/startup line as the accepted authority, with no verdict effect. The measured actual grids independently agree. This is not a silent waiver or invented live rectangle.

### Reproducibility and identities

Verified against frozen metadata and execution receipts:

| Input | SHA-256 |
|---|---|
| Candidate SKILL.md | `7d1ff098d3ff460046e794c29925482ffd0ccb8c6fa493bc390758d976b75d70` |
| Executed renderer bytes | `ee085c0f3a82e9b7d516cde7532f394864b3490c99691cd7ac5b2d36d640e8ea` |
| Frozen rubric | `555e3b1d5881449b79eb1dc1d9538df2c4fe0880aa850becbf9060c1bf42f86f` |
| Dataset manifest | `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05` |
| This case source | `c6e4552d5842347bc9472e53a2351897c3624c92b5a14541aaa3c28216dc4a0d` |
| This case expected data | `fd3963e207e9c433b7e5825c8a1691766bb13d5df7322ac97a05e379d2cbba99` |
| Final-spec manifest | `22a9b5376d014909cdce316cc9ceae8507421ee6aab371c56bc480776b3094bb` |
| Unchanged observed-first.md | `b28d0ab9be6b6d08c43eb92d03e32c1368cc5a12996f2c6e1e7221be0ba24a75` |

The result inventories each final spec, every recorded attempt spec, the manifest, blind record, source/expected data, and all still/selected/motion/check/validation/cleanup-manifest files with their actual hashes. All three execution manifests' artifact maps match the bytes on disk. The absolute frozen binary was rehashed, not executed. Hashes of the frozen capture, validator, and aggregation helpers also match metadata. Passing checks/validation were inspected only as workflow records, not as substitutes for visible labels, borders, routes, or motion.

`generation.json` records exact absolute-binary and capture/validation commands. The hash-verified capture helper redirects `--check` stdout and stderr together into `check.txt`; each corresponding manifest records exit 0 and its check interval. The check reports' `viewport: unknown` is not used as fit proof. The actual capture windows are 2026-11-02T09:59:43Z–09:59:47Z, 09:59:56Z–10:00:00Z, and 10:00:07Z–10:00:11Z for v1/v2/v3. Capture timestamps in the result are those intervals, not invented exact still instants.

The metadata discloses the initial generator tab label `viz-ds02-undefined-7`; it also states that case assignment occurred before any spec was written. The semantic worker identity required by the stage-B contract is `viz-ds02-modal-runtime`, which agrees with generation.json. This review uses that identity without pretending the initial tab label was different. The workflow rubric prose contains an obsolete Astra name, but the frozen required-reviewer field, result schema, metadata, and explicit stage-B instructions all require **Sol**; this independent session is the Sol review. There is no model substitution.

### Cleanup

| View | Owned pane | Frozen close/probe result |
|---|---|---|
| v1 | `w7E:p6Z` | `confirmed_closed` |
| v2 | `w7E:p60` | `confirmed_closed` |
| v3 | `w7E:p71` | `confirmed_closed` |

All three manifests agree with the generator cleanup ledger. The frozen capture helper writes `confirmed_closed` only after closing the owned pane and probing its absence with `pane get`. Rejected layout attempts are recorded as rejected before capture; no additional owned pane is recorded. The reviewer created no pane and ran no cleanup/viewer command. No captures, specs, renderer, skill, or expected data were changed. No subagent was spawned, no install performed, and no commit made.

## 7. Defects, blockers, and correction candidates

### Rubric findings and blockers

- Critical/high/medium/low failing rubric findings: **0/0/0/0**.
- Missing/reversed/invented required relationships: **0/0/0**.
- Required capability blockers: **none**.
- Required evidence blockers after applying the frozen metadata's viewport authority: **none**.

The generator calls lack of an on-canvas provenance/legend annotation a blocker. It is **not a blocker for this source**: the source does not require that citation on the canvas, and the eight historically sourced relations are all required and visible. I also do not infer a universal inability to render long labels from the generator's failed attempts; those uncaptured attempts do not independently establish a renderer-wide impossibility.

### Skill/reporting-level candidates — advisory, not repairs performed

1. Base motion statements on per-route timestamp comparisons. Do not report every dot moving per step when four captured routes repeat the same cell. Keep source-backed optional-motion applicability separate from the renderer's default behavior.
2. Prefer meaningful complete captions over a hard universal character cap, and preserve the overview/detail coverage map. This sample's contractions remain meaningful, but the generator's own attempt history shows why a blanket label-length recipe can induce unnecessary compression.
3. Avoid calling a missing non-required annotation field a source blocker. Separate historical-reference provenance from a source-required uncertain edge or required visible citation.

### Renderer/harness-level candidates — advisory, no required gap proved

1. Investigate short-route dot phase/sampling behavior, or improve frame sampling, before making animation claims for sources that require motion. The captures prove fixed samples and short cycles, not whether the root cause is simulation or aliasing.
2. A caption-placement preference for one blank cell beside route glyphs could improve the local regions listed above. Current adjacent captions remain traceable and readable; no renderer failure is established by those contacts.
3. Fix future capture harnesses to query the **owned** pane rectangle explicitly and preserve actual columns/rows even in an unfocused tab. Preserve per-frame diagram ANSI attributes when timestamped color continuity is needed. These are evidence-quality improvements; this frozen round provides sufficient accepted static viewport and selected-border evidence.

No renderer gain is attributed to the skill, and no new render was used to improve the sample. The stage-A file remains byte-identical to its pre-disclosure seal.
