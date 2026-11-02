# Round 04 — modal-runtime — independent Sol critique

## Verdict: FAIL

**Category matrix: 2 pass / 4 fail / 1 blocked.** Four of the eight required relationship audits pass completely; four fail on source specificity. All eight endpoint pairs, directions, node identifiers and visible edge labels are present. Zero uncertain label owners does **not** establish complete semantic fidelity.

| Fixed category | Decision | Evidence-based reason |
|---|---|---|
| semantic_fidelity | **fail** | Worker links say only `RPC`, not gRPC; daemon link omits `filesystem`; container-process link drops `user`. |
| arrow_traceability | **pass** | Eight separately traceable stems/heads, correct directions, unique label owners, no actual crossings or shared route cells. Revealed origin definition is satisfied. |
| layout_fit | **fail** | Actual 77×47 @100% canvas is proven, but the palette overwrites two Task container perimeter cells. Complete boxes without overlay occlusion are required. |
| conceptual_grouping_color | **pass** | Source-related orchestration, compute, storage and service concepts use related hue families; the paired functional chains are near each other and not grouped merely by depth. |
| border_integrity | **fail** | Task container loses one left-side cell and its bottom-left corner, including selected state; seven of eight boxes have complete color-continuous borders. |
| workflow_evidence | **blocked** | Hashes, identities, blind record, captures and raw draft check text/status exist. Exact executed check/capture/cleanup command logs and raw cleanup/probe output do not. Animation evidence is truncated and not a full longest-route cycle. |
| animation | **fail** | Six routes have 28 corner-hit route-frame observations. Shared update cadence does not yield shared geometric advance. These are observed defects, not merely missing evidence. |

Known failures determine the overall **fail** even though workflow verification is blocked. Severity does not waive a category. The renderer is the frozen baseline; no improvement is attributed to the skill merely because a checker or validator reports success.

## Provenance, identities, paths and blind seal

All evidence paths in `reviewer-result.json` are **repository-relative** to this dotfiles worktree. Locations are **1-based `[column,row,width,height]` in the displayed viewer frame**, not line offsets in a concatenated recording. Findings name the relevant animation frame numbers explicitly. The generator report uses zero-based coordinates and a different edge ordering; neither convention is silently mixed into this review.

- Round: integer **4**.
- Actual generator: **`viz-ds04-7`**, `fireworks/accounts/fireworks/routers/deepseek-flash-latest`, as supplied in the reveal and corroborated by `generation.json`. This actual identity is retained instead of replacing it with the full-task template's generic `viz-ds04-<case>` string.
- Reviewer: **`viz-judge04-runtime`**, `openai/gpt-6.1-sol`; the local PI provider/model also report `openai` / `gpt-6.1-sol`. No model switch or subagent was used.
- The workflow category's stale prose reference to `gpt-6-astra` is not the active model requirement: the frozen `required_reviewer_model`, result schema, metadata, full-task instructions and reveal all require Sol.
- Final view set: **one spec**, `docs/visualize-eval/rounds/04/modal-runtime/specs/v1-b.json`. Rejected drafts are inventoried as evidence, not final views. No multi-spec digest replaces its actual hash.
- Final spec SHA-256: `5048cd78f17c25d03b40df241f04c8d17bf0459b0f2dd67e7f5d740614d293c9`.
- Candidate skill SHA-256: `ac431c6d3035e466e29136f36d9579c551c2e070a354dc5df72999b1bb1beb3c`.
- Renderer SHA-256: `0da16d8d8ed46e2a25eb773fc71ecad4de9e310cd33e303a4c7fe77231ad95bc`.
- Rubric SHA-256: `18412615f82841b34cf131976c6b5f4b00cd4fc031a710cdfc81058e2dd68d10`.
- Dataset manifest SHA-256: `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05`.

These hashes were computed from the actual files and matched frozen metadata. The actual external binary at the metadata path was hashed without executing it. This case's source, expectations and variants hashes also match metadata, as do all seven artifact hashes in the evidence manifest. Thirty evidence inventory entries carry actual SHA-256 values.

The blind observation is preserved at:

`docs/visualize-eval/rounds/04/reviews/modal-runtime/observed-first.md`

SHA-256: **`b1e8047212d3957c5c3762a5bd56bcec5a9584b011ad1e88b0d6487ee08f4784`**.

It was saved before the expectations reveal and was not edited. The JSON includes it as evidence `blind` and sets `observed_first.saved_before_expected_reveal: true`.

## Semantic fidelity and complete edge audit

The frozen source is qualified historical evidence, not independent external fact verification. This review uses its fixed constraints and required eight relations, not a later historical drawing as superior authority. No unrelated chat, credentials, other case contents or earlier-round reviews were read. Earlier-round failures are not carried forward as verdicts.

**Edge IDs below match the final spec order and blind record.** In particular, e4 is runtime→daemon, e5 is engine→backend, e7 is backend→container, and e8 is filesystem→Blobnet. The generator's meaning ledger uses different IDs for several of these relations.

| ID | Required relation | Actual captured label / location | Audit |
|---|---|---|---|
| e1 | worker→runtime, task input/control RPCs; worker gRPC seam | `task+ctrl RPC` [38,12,13,1] | **fail**: task/control shorthand is understandable, but `RPC` does not identify gRPC. |
| e2 | runtime→worker, events/management RPCs; worker gRPC seam | `events+mgmt RPC` [18,12,15,1] | **fail**: events/management shorthand survives, but gRPC is unspecified. |
| e3 | runtime→engine, dispatches tasks | `task dispatch` [23,20,13,1] | **pass**: noun-form label retains action and object, with an unambiguous owner. |
| e4 | runtime→daemon, **filesystem** HTTP over UDS | `HTTP over UDS` [42,20,13,1] | **fail**: HTTP/UDS survives; filesystem purpose is absent. |
| e5 | engine→backend, starts/manages | `starts/manages` [16,27,14,1] | **pass**: both actions survive, with an unambiguous owner. |
| e6 | engine→filesystem, mounts/snapshots | `mounts/snapshots` [34,30,16,1] | **pass**: both actions survive. |
| e7 | backend→container, runs **user** process | `runs process` [11,36,12,1] | **fail**: the user-process qualifier is deliberately dropped. |
| e8 | filesystem→Blobnet, image/volume data | `image+volume data` [34,36,17,1] | **pass**: both payload types survive. |

All eight nodes are present with their full required names. There are no extra apparent **connected** relations to audit: the nearby bends/parallel routes do not form an additional junction or branch. The machine-readable audit records every required relation's source border, outside stem, complete polyline, head, label ownership and semantic outcome.

### Highest-impact semantic defects

**S1 — missing worker gRPC specificity, critical.** The source explicitly distinguishes HTTP over Unix-domain sockets from worker gRPC. A viewer cannot derive gRPC from the general word `RPC`. Keeping the two directions separate is necessary, but does not recover their protocol. Prose in the generator's report cannot repair the visible labels.

**S2 — missing filesystem daemon-seam purpose, critical.** `HTTP over UDS` alone does not say that this route serves the filesystem interface. The separate `Filesystem + volumes` node has a different route from Task engine and does not label runtime→daemon by implication.

**S3 — dropped user-process qualifier, critical.** The generator acknowledges shortening `runs user process` to `runs process` after the v1-a ownership warning. This changes a source-required payload/role distinction: the container runs a user process, not merely an unspecified process. Attempt-budget pressure and a documented reason do not authorize dropping required meaning. The rubric's critical severity includes a missing source concept that changes meaning; these omissions are not merely typography.

### Ownership is genuinely clearer in the final capture

No finding is carried forward against `task dispatch` or `starts/manages` ownership. The final screenshot shows each closer to its own route than to a competing route; the blind observation independently found zero uncertain owners. The final check agrees with that narrower observation. This improvement does not offset the missing specificity above.

## Arrow traceability, crossings and route economy

Every source stem can be traced to one correct head:

- e1: worker outside port [36,11] straight down to `▼` [36,14].
- e2: runtime outside port [34,16] left/up/right via [33,16] and [33,8] to `▶` [34,8] at worker's left side.
- e3: runtime [36,19] via [36,21] and [37,21] to `▼` [37,22] at Task engine.
- e4: runtime [38,19] via [38,21] and [58,21] to `▼` [58,22] at daemon.
- e5: engine [37,27] via [37,28] and [9,28] to `▼` [9,30] at backend.
- e6: engine [39,27] via [39,29] and [32,29] to `▼` [32,30] at filesystem.
- e7: backend [9,35] via [9,37] and [11,37] to `▼` [11,38] at container.
- e8: filesystem [32,35] via [32,37] and [39,37] to `▼` [39,38] at Blobnet.

There are zero actual crossings, bridge glyphs, shared route cells or connected junctions. One touching bend–bend pair occurs between e3 [37,21] and e4 [38,21]. Six adjacent pairs occur between e5's row-28 run and e6's row-29 run at columns 32–37, including two bend–straight contacts. These are not crossings; the neighboring glyphs do not connect.

The check says `0 bridges, 0 touching bends`, while the captures show the above literal glyph contacts. This is a checker/visible-definition discrepancy, not a reason to invent a crossing or fail the crossing gate. All eight routes remain readable; a dot on a corner weakens the corner glyph but does not remove a head or sever the visible chain of cells.

The check reports `8/8 near-minimal, 0 detours, 4 shortened`. There is no conspicuous avoidable loop. Seven observed polylines have Manhattan-length travel between their outside endpoints; e2 adds a small left/right side-entry jog needed to approach its right-facing head outside the boxes. No shorter obstacle-safe, orientation-preserving route is established by the captures, so no route-economy defect is invented.

### Origin interpretation after reveal

The blind record measured two origin conventions: adjacent source box border and first outside source-port cell. It correctly recorded every initial dot at **path index 1**, the first cell *after* the outside port, but called those misses under its alternative border/port-origin test.

The revealed rubric explicitly defines the actual start as **the first drawn cell after the source port**. Applying that definition to the unchanged measurements, the initial dots **pass 8/8**. For example, e1's source border is [36,10], outside port [36,11], and initial dot [36,12]. This is not an origin violation under the active rule. The record is not rewritten and the stage-A `frame0_origin_misses: 8` count is not mechanically promoted into a stage-B failure. The check's `origins: 8/8` agrees under the revealed definition.

## Fit, grouping and borders

### Target size is proven, despite missing pane rectangle

`v1-ansi.ansi` and `v1-selected.ansi` each measure **77 cells × 47 rows**. The running app's own header reads **`77x47 @100%`**, so the target and actual pane dimensions can be recorded as 77×47 without inventing a rectangle. Manifest `pane_rect`/`pane_cols` and `viewport_line` are null; `pane_rows` is 47. The actual `--check` line is `viewport: unknown zoom: 1.00 natural`, which by itself would not prove fit. The app token is the rubric-permitted positive proof.

The graph's visible extent is columns 8–70, rows 7–42 (63×36 inclusive); the check reports 64×37 layout cells. These are different measurements, not silently substituted. Controls extend to row 46. No node label or edge label is viewport-clipped. No view needs pan or zoom to expose a relation.

### B1 — palette occlusion, medium; fails layout_fit and border_integrity

The palette occupies [2,41,9,6]. Task container spans [10,39,16,4]. Their intersection damages exactly two node perimeter cells:

| 1-based cell | Request's zero-based cell | Actual | Required node border |
|---|---|---|---|
| [10,41] | (9,40) | palette `┐` | left-side `│` |
| [10,42] | (9,41) | palette `│` | bottom-left `╰` |

Normal ANSI gives these cells palette RGB **(168,153,104)** rather than node RGB **(226,156,175)**. Selected ANSI leaves the same two palette-colored cells instead of selected RGB **(216,166,87)**. Of Task container's 36 perimeter cells, 34 retain node/selected color and two do not.

All seven other nodes have complete sides/corners and one continuous per-node border color. All eight occurrences have selected-state evidence, but only seven have a complete selected border. This is an **observed localized defect**, not missing evidence, and one physical defect causes two category failures. It should not be double-counted as two independent physical defects when interpreting severity totals. The label remains legible, so the defect is medium, not a missing component.

### Grouping passes independently of the border failure

The normal ANSI verifies these source-related families:

- orchestration: runtime (125,174,163), engine (147,194,183), paired on the spine;
- compute: backend (211,134,155), container (226,156,175), paired on the left chain;
- storage: filesystem (169,182,101), Blobnet (189,201,124), paired on the storage chain;
- RPC-side services: worker (216,166,87), daemon (228,184,111), on their respective seams around runtime.

Different roles on the same row have different hue families; related roles at different depths share a family. The source leaves these groups' relative screen columns free. No new containment/residency is asserted by the visible boxes.

## Animation: optional does not mean unjudged when present

The source/manifest marks animation optional. Its absence could receive source-backed N/A. This final view **has eight animated routes**, so observed motion must meet the applicable quality rules. It cannot receive N/A merely to avoid judging the damage it draws.

Constant speed is legal and is the default. Same-arrival is not requested, so **neither unequal route completion times nor the lack of simultaneous head-touching arrival is a defect**. The `arrivals: 0/0` line is appropriate to that mode, not a failed synchronized-arrival claim.

### What passes

- Eight dots per sampled frame, exactly one on each route.
- Initial dots at the first drawn cell after each outside source port, including initially corner-shaped cells.
- No observed node-box, label, bridge or arrowhead occupancy; no bridge exists in this view.
- Slow shared update cadence: frames 0/1, 2/3, …, 18/19 repeat; movement occurs on the even-frame transitions.
- Forward movement along the arrows before short-route wraps.

### A1 — corner masking, medium, observed defect

The 21 sampled frame portions contain **28 corner-hit route-frame observations across six routes**:

| Edge | Corner cell(s) | Frames | Hits |
|---|---|---|---:|
| e2 | [33,16] `╰`; [33,8] `╭` | 0,1,18,19; 16,17 | 6 |
| e3 | [37,21] `╮` | 2,3,6,7,10,11,14,15,18,19 | 10 |
| e5 | [37,28] `╯` | 0,1 | 2 |
| e6 | [32,29] `╭` | 14,15 | 2 |
| e7 | [11,37] `╮` | 4,5,10,11,16,17 | 6 |
| e8 | [39,37] `╮` | 14,15 | 2 |

All frame-0 dot cells survive its truncation; **26 of the 28 observations occur in complete frames**. This is not a missing-evidence inference. The reported e3 corner at zero-based (36,20) is confirmed. It stays occupied for both frames in each listed pair, not just odd-numbered capture frames or a lone 100 ms frame. The generator's prose underdescribes its duration and omits other affected routes.

The check's **`0 violations`** is contradicted by the captures. A generator acknowledgement and a validator pass do not waive the no-corner gate. Classification: a recoverable, localized **animation defect**, not a blocker caused by an unavailable rendering/model capability. It still fails the category.

The rule allows an origin to coincide with a corner but also prohibits obscuring corner glyphs. Those are distinct requirements: satisfying origin placement on e2/e5 does not exempt their actual corner masking. For optional flair, a future spec can avoid animating an unsuitable route instead of sacrificing the drawing.

### A2 — unequal geometric advances, medium, observed defect

All dots update on the same cadence, but from complete frame 1 (100 ms) to frame 2 (200 ms), without any wrap:

- e1/e2/e5 advance **one** path cell.
- e3/e4/e6/e7/e8 advance **two** path cells, skipping an intermediate corner.

Examples: e1 [36,12]→[36,13] versus e4 [38,20]→[39,21] via [38,21]. Common nominal settings and paired frames prove a common clock, not a constant shared geometric rate. The blind record gives the full per-route position-index sequences for all samples. This judgment does not impose same-arrival timing.

### Motion evidence gaps are additional blockers

Both frame files lack the frame-0 header and first 11 viewer rows. The initial fragment is identified by placement before frame 1 and by alignment to the complete viewer geometry. Every dot is visible, so the origin and corner measurements above remain available; full frame-0 verification is incomplete.

Frames 1–20 are complete and measured at the target size, but the two-second interval does **not** cover the longest-route cycle. For example, e5 goes from path index 1 to 11 on a 32-cell route and has not reached/wrapped past its destination. e4 is likewise incomplete. This prevents a complete-cycle speed/occupancy proof, but cannot convert the already demonstrated A1/A2 defects into a mere blocked animation verdict.

The reported direct pinned dump `captures/v1-frames-direct.txt` is **absent** from the bundle and supplies no evidence. The animation `.ansi` has no color styling on the diagram itself; only shell residue has escapes. Normal/selected static ANSI, not the animation file extension, establishes color.

## Workflow, raw checks, validator and cleanup

The bundle preserves all five draft specs and all five raw check-output/status files. Every preserved draft check ends `exit=0`, including warning-bearing rejected candidates:

- v1-a: one ambiguous owner;
- v1-b: zero ambiguous owners, kept;
- v1-c: clean check, larger declared extent but no preserved draft visual probe proving the claimed unchanged geometry;
- v2-a: one skipped label and two ambiguous owners;
- v3-a: two ambiguous owners.

The final harness check body matches v1-b's body, but the files are **not byte-identical**: `checks/v1-b.check.txt` has an additional `exit=0` trailer, while `evidence/v1/check.txt` relies on manifest `check_exit: 0`. This distinction is recorded rather than repeating the generator's inaccurate byte-identical claim.

The validator records **34 PASS / 0 FAIL**. Its assertions check the manifest, check text and artifact presence/hashes. They do not invalidate the observed corner masks, palette occlusion, missing qualifiers or incomplete longest-route motion.

The generator/manifest supply a window for check execution (`2026-11-02T12:42:20Z`) and captures (`12:42:20Z`–`12:42:24Z`), the absolute frozen binary path/hash, pane ID and app size token. These are useful reproducibility facts. However:

1. The exact executed viewer, check, capture and cleanup invocation logs are not preserved. The report gives the exact validator command and generic descriptions, not the full actual capture/check commands and arguments.
2. Raw probe logs, including the draft frame probe and the pane cleanup close/gone probe, are absent. A current script cannot retroactively establish the exact frozen commands or their raw output.
3. Cleanup is **attested** as `confirmed_closed` for **`w7E:pDK`** in the manifest and generator report. No raw close result or pane-gone probe output independently proves it. The result records owned pane `w7E:pDK`, leaves independently proven closed panes empty, and marks cleanup verification **blocked**. This is not a claim that the pane is still alive or leaked.
4. The truncated initial frame and missing full cycle limit animation evidence as described above.

These are evidence blockers. No unavailable model, missing installed tool or unsupported required source feature was demonstrated. Workflow therefore is blocked rather than silently passed or falsely accused of a known execution failure. The reviewer created no panes and ran no new viewer sessions.

## Correction candidates — no changes made

The captain must collect all eight critiques before revising. These are candidates, not fixes applied here.

### Skill/spec-level

1. **Preserve seam and payload specificity before shortening text.** Carry gRPC on the worker seams, filesystem on runtime→daemon, and user on the process edge. A recorded drop remains a defect. The skill already says not to drop required facts; tighter enforcement of its meaning ledger matters more than another generic warning.
2. **Treat the 14-character label guideline as subordinate to source meaning.** It must not turn into permission to erase protocol/role qualifiers. Layout alternatives or coverage-preserving splits should make room for complete meanings.
3. **Keep the floating palette's actual occupied cells clear.** Empty leading layer slots were not evidence that the lower-left box moved. Require the final capture to show every node perimeter, not just an extent that fits numerically. No proposed column swap is treated as verified here.
4. **Keep optional dots only where they do not damage the drawing.** Disabling unsuitable flair routes is source-compatible in this case; no mandatory-animation capability blocker needs to be invented.
5. **Correct the full-cycle evidence guidance.** The frozen skill's claim that 21 frames at the default constant rate cover the longest route is false for this captured 32-cell route. Evidence duration must follow actual route length/rate and include intact frame 0; fixed two-second capture advice is insufficient.
6. **Preserve raw executed command/probe records.** Keep check/capture/close invocations, arguments, output/status, pane dimensions and cleanup proof in the frozen bundle rather than depending on the current harness source or a summary.

### Renderer/harness-level

1. **Make dot eligibility and checker accounting match the final displayed glyph.** Six routes visibly replace corners despite a zero-violation check; e3 is not an isolated cosmetic exception. No renderer source inspection is needed to establish that executed discrepancy.
2. **Separate common clock cadence from common geometric speed.** Excluding some corners while displaying others creates unequal geometric advances. The rendered motion and checker should agree with the requested cells-per-time rule without masking the route.
3. **Protect graph borders from control overlays.** The current output permits the palette to replace node perimeter cells after otherwise fitting. Both rendering and fit validation should respect the occupied overlay area.
4. **Validate capture completeness and cycle coverage.** A 1,000-line scrollback limit cut frame 0, yet the manifest/validator accepted 21 frames. Validate actual frame boundaries/row counts, not merely artifact presence and later timestamps. Preserve pinned direct evidence if the generator cites it.
5. **Clarify touching-bend diagnostics.** The checker reports zero while adjacent corner glyphs are visible. This should not be conflated with crossings, and there is no reason to sacrifice source meanings to lower it.

## Verification and report files

- Read the frozen rubric including its entire embedded schema, metadata, required dataset manifest, this case's source/expectations/variants, final and rejected specs, generator records, raw checks, capture manifest, validator record and captures.
- Independently verified frozen input/artifact hashes and the unchanged blind SHA-256.
- Measured ANSI dimensions/colors, selected coverage, per-route frame coordinates, corner-hit counts, source-port-relative initial positions and speed differences from actual captured cells.
- Validated `reviewer-result.json` against every embedded schema constraint used by the result using an offline standard-library helper; also checked evidence-ID references, all eight audit IDs and inventory hashes. No dependencies were installed.
- Created only review outputs and an optional helper under `/tmp`; no skill, renderer, spec, capture, expected data or blind-record edits, no viewer launches, no subagents and no commits.

Outputs:

- `docs/visualize-eval/rounds/04/reviews/modal-runtime/reviewer-result.json`
- `docs/visualize-eval/rounds/04/reviews/modal-runtime/critique.md`
- Unchanged: `docs/visualize-eval/rounds/04/reviews/modal-runtime/observed-first.md`
