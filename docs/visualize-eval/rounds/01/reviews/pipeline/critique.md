# Pipeline / round 01 — independent Astra Stage B critique

## Verdict: FAIL

Four categories pass, one fails, and two remain blocked. All six source relationships pass the endpoint/label/arrow-trace audit. **The required animation fails sparsity on the two short routes.** In addition, direction/speed evidence aliases and selected-state border coverage is incomplete. A blocked gate cannot produce green, and an evidence blocker does not downgrade an observed failure to merely blocked.

Reviewer: `viz-judge01-pipeline`, `openai/gpt-6-astra` (review environment: `PI_PROVIDER=openai`, `PI_MODEL=gpt-6-astra`). Generator: `viz-ds01-pipeline`, `fireworks/accounts/fireworks/routers/deepseek-flash-latest`, as recorded in the frozen metadata and generation identity record. No subagent, pane, viewer, build, install, fix, or new rendering was used during this review.

All evidence paths in `reviewer-result.json` are **repository-relative**. Coordinates are 1-based `[column,row,width,height]`, excluding a text capture's leading `#` metadata row. `captures/…` below abbreviates `docs/visualize-eval/rounds/01/pipeline/captures/`. This report evaluates the final single `spec/view1.json`; attempts 1 and 2 are preserved alternatives, not additional required final views.

## Frozen record and provenance

The blind record remains unchanged at `docs/visualize-eval/rounds/01/reviews/pipeline/observed-first.md`, SHA-256:

`433079ce2330ef2fbb6a378f60e48378a59aa077ac3ccede3342facf701d3743`

It was saved and its hash verified before expected-source disclosure. The Stage B comparison does not rewrite that observation. In particular, the blind observer identified all six directed links without the source, noticed adjacent dots, identified the same-color CLI/selection issue, and explicitly withheld claims about sampled motion direction and numeric zoom.

Independent hash verification is saved in `hash-verification.json` alongside this critique. Verified inputs:

| Input | SHA-256 |
|---|---|
| Candidate skill snapshot | `9c5cea272a88300644cacda52c853c7c9169eeec91f0355d3460ee8741308d92` |
| Frozen executed renderer | `4a883e73b822f009c504bd21d0c2fc383067bf1b83b9791ccbda431912e3a1d8` |
| Round 01 rubric | `60997237bd996f1e1b6a16e0b68133859b9f03fd83c85e7f508e286743240f5d` |
| Dataset manifest | `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05` |
| Pipeline source | `68aa197fdc597c3a22d1b8ca88a3ebee861dcda34684da15ae69b6946b741e58` |
| Pipeline expected data | `ea177d01af818876ff04bf707b923326b153185fd425f21ea96250486b504ec3` |
| Final spec | `d5e59fa46e19f77f6841cf382c0794a45dca2aadf1a2142d6d7d1830d031d4cb` |

The binary was hashed, not executed or replaced. Its external `/tmp` path and actual hash appear in the verification record; the JSON evidence inventory references repository-local records consistently. Single final spec: no multi-spec manifest is needed. Its bytes equal `attempts/view1-attempt3.json`.

`checks/hashes.txt` contains an older `generation.json` hash; its later replacement in `checks/report-hashes.txt` matches the actual final report. This is a documented superseding report hash, not an unexplained spec/binary/capture mismatch. All other listed evidence hashes match. The final check preserves stdout (`ok: nodes=6 edges=6 flows=6 direction=tb theme=gruvbox`, `extent=36x40 cells`), empty stderr, and exit 0. Those facts establish validation execution, not visual correctness.

Round 01 is its **own renderer baseline**. Nothing in this review scores cancelled round 00 or attributes renderer changes to the unchanged candidate skill. The qualified historical graph is a test reference, not independent verification of a real deployed system.

## Fixed category matrix

| Category | Decision | Basis |
|---|---|---|
| semantic_fidelity | **pass** | Six required concepts and all six directed relations are visible. `verify`, `enqueue`, `write`, and `read` retain source meaning. Added `request` and `dispatch` are neutral verbs, not invented protocols. No extra relationship or missing cross-view coverage. |
| arrow_traceability | **pass** | All six routes have attached source stems and unique downward target arrows. API branches are separate; Postgres receives separate read/write entries. No crossings, false junctions, or unrelated box contacts. Dot-masked elbows remain recoverable. |
| layout_fit | **pass** | Actual 77×47 text/ANSI grids and in-pane dimensions agree. Revealed launch/state records support natural unzoomed startup. All boxes/labels fit, and the lower-left palette occludes nothing. |
| conceptual_grouping_color | **pass** | Source-supported hierarchy and branches remain apparent. Gateway's two sibling destinations share related pinks; queue and worker remain vertically adjacent on the write branch; Auth/read stays separate. No source-defined tier/order is violated. |
| border_integrity | **blocked** | All observed borders pass: six unselected nodes, gateway-selected and Auth-selected states. Selected CLI, queue, worker, and Postgres ANSI/buffer evidence is absent. The every-node selected-state claim is not established. |
| workflow_evidence | **blocked** | Frozen inputs, correct identities, blind-first record, final checks, exact launch, sizes, text/ANSI captures, and cleanup records exist. Complete selected-state and non-aliased motion verification are missing. |
| animation | **fail** | Required by source. Adjacent simultaneous dots make two short routes locally dense (AN1). Direction/speed remain separately blocked by two-second sample aliasing (AN2). |

Animation is applicable; no N/A exception is used. The six per-edge JSON statuses concern the required endpoints, label meanings, and stem-to-arrow trace. They do not certify animation. Animation findings explicitly identify the affected edge IDs and independently prevent green.

## Source coverage and every-edge audit

Source: `docs/visualize-eval/cases/pipeline/source.md`, especially Task, Relationship facts, and Fixed constraints; reference: `expected.json#/historical_reference`.

All six node labels are complete in `captures/view1-visible.txt` and the final ANSI captures:

| Concept | Box rectangle | Label rectangle |
|---|---|---|
| CLI | [36,7,5,4] | [37,8,3,1] |
| API gateway | [36,15,13,4] | [37,16,11,1] |
| Job queue | [23,23,11,4] | [24,24,9,1] |
| Auth | [49,23,6,4] | [50,24,4,1] |
| Worker pool | [23,31,13,4] | [24,32,11,1] |
| Postgres | [36,39,10,4] | [37,40,8,1] |

| Edge ID / expected relationship | Actual stem → route → arrow / label | Result |
|---|---|---|
| cli-api: CLI → API gateway; historically unlabeled | CLI bottom row 10 → [37,11,1,3] → ▼ [37,14,1,1], above gateway top row 15. `request` [39,12,7,1]. | pass |
| api-auth: API gateway → Auth, verify | Gateway bottom row 18 → [39,19,1,2] → [39,21,12,1] → ▼ [50,22,1,1], above Auth row 23. `verify` [41,20,6,1]. | pass |
| api-queue: API gateway → Job queue, enqueue | Gateway bottom row 18 → [37,19,1,2] → [24,21,14,1] → ▼ [24,22,1,1], above queue row 23. `enqueue` [28,20,7,1]. | pass |
| queue-worker: Job queue → Worker pool; historically unlabeled | Queue bottom row 26 → [24,27,1,3] → ▼ [24,30,1,1], above worker row 31. `dispatch` [26,28,8,1]. | pass |
| worker-db: Worker pool → Postgres, write | Worker bottom row 34 → [24,35,1,2] → [24,37,14,1] → ▼ [37,38,1,1], above DB row 39. `write` [28,36,5,1]. | pass |
| auth-db: Auth → Postgres, read | Auth bottom row 26 → [50,27,1,10] → [39,37,12,1] → ▼ [39,38,1,1], above DB row 39. `read` [43,36,4,1]. | pass |

These are actual capture coordinates, not the generator's mostly zero-based prose coordinates. Stems begin adjacent to source bottom borders, and arrows end adjacent to target top borders; arrows are not inside the border cells themselves.

- **Intentional branch:** API gateway has two independent outputs, not a drawn shared bus. Their stems at columns 37 and 39 have an empty separator at column 38, rows 19–21.
- **Intentional convergence:** two arrows enter Postgres at columns 37 and 39. [38,37,1,2] is empty; neither approach run merges into the other.
- **Crossings:** none observed. Auth's column-50 down-run clears Worker pool's column-35 right side; [36,31,14,4] is empty.
- **Unexpected apparent links:** none. No additional audit row is invented merely to pad the edge inventory.
- **Labels:** `read` is above its horizontal approach, not attached to `write`. Its distance from the right vertical does not make it unreadable. Off-center entries and tightly spaced DB arrows are visible, but the fixed gate does not require centered ports or a larger separation when traceability survives.
- **Coverage:** one final view covers all six concepts and relations. No split-view relation is omitted. Attempts 1/2 retain the same relation set but use different placements; their defects are not substituted for final-view defects.

## Complete borders, selected states, and conceptual color

Independent Stage A ANSI decoding inspected every perimeter cell, not just top lines. `view1-ansi-unselected.txt` has uniform per-node RGB colors:

| Node | RGB | Whole-perimeter cells |
|---|---|---:|
| CLI | (216,166,87) gold | 14 |
| API gateway | (125,174,163) aqua | 30 |
| Job queue | (211,134,155) pink | 26 |
| Auth | (226,156,175) lighter pink | 16 |
| Worker pool | (169,182,101) green | 30 |
| Postgres | (125,160,184) blue | 24 |

For each box rectangle above, the entire first/last row includes intact `╭ ╮ ╰ ╯` corners and horizontal strokes, and both intervening rows have intact left/right `│` cells. `observed-first.md` records the exact top, bottom, left, and right rectangles separately. No border dots or differently colored handle cells appear. Box interiors match the canvas RGB (40,40,40); no background dot grid is present. Node/edge text is cream (235,219,178), routes and arrows muted (124,111,100), and flow dots gold (216,166,87).

`view1-selected1-ansi.txt` changes all 30 gateway border cells to gold/bold. `view1-selected2-ansi.txt` changes all 16 Auth border cells to gold/bold and restores the gateway. Other borders retain their colors. No side/corner becomes incomplete in either state.

**BI1 / high evidence blocker:** the same assurance cannot be made for selected CLI, Job queue, Worker pool, or Postgres. Their unselected boxes are proven, not their selected variants. The Worker-selected metadata in `view1-live-frame1..3.txt` is plain text and cannot prove color continuity. This is missing evidence, not a claim that those four selected borders are actually broken. It also blocks complete workflow state coverage (WE1).

Grouping passes on a limited, source-grounded interpretation: ingress → gateway → two gateway destinations, then queued work and common persistence. The two pink nodes are source-related as sibling gateway destinations, not interchangeable functions. The queue/worker path remains spatially coherent even though worker uses another stage hue. I do not accept automatic geometric depth alone as proof of a meaningful tier, nor impose an unsupported requirement that all nodes on a path share one hue.

The unselected CLI's gold equals the selected border/dot RGB. That is a candidate skill promise mismatch (`accent … selection and flow dots only`) and a useful renderer correction candidate. It is **not by itself a new fixed-rubric failure**: complete borders remain consistent, and the rubric does not explicitly require exclusive accent allocation. Selection's bold attribute also differs. No unsupported new color condition was added.

## Fit, actual dimensions, and natural zoom

`captures/view1-dims.txt` contains `47 77`, measured inside the final pane before viewer startup. Both earlier retained dimension files agree. Decoded unselected and selected ANSI grids are each exactly 47 rows × 77 columns. The final graph spans [23,7,32,36]; palette [2,41,9,6] is separate. All labels, arrows, sides, and corners fit; no overflow warning is visible.

`commands/split-view1-final.json` reports `scroll.viewport_rows=49` at pane creation. I do **not** substitute that value for the later `stty` measurement and actual 47-row captures. Live pane dimensions for the evaluated render are recorded separately as 77×47 in the result.

Stage A correctly stated that numeric zoom was not printed in the capture. Stage B now adds `commands/view1-launch-final.txt`, the frozen candidate's natural-startup contract, and `generation.json`/`commands.md` recording no fit, scroll, zoom, pan, drag, or node movement. Those executed records support the 100% natural-startup gate; this is an evidence addition, not a rewrite of Stage A. No rerender was performed to rescue fit.

## Required animation: concrete failure and separate uncertainty

### AN1 — medium, known failure: adjacent dots on both short routes

The source requests **slow, sparse** traffic. `view1-frame1.txt`, `view1-frame4.txt`, `view1-live-frame3.txt`, and `view1-selected2-ansi.txt` show two simultaneous dots at:

- request / cli-api: [37,12,1,2];
- dispatch / queue-worker: [24,28,1,2].

These fill two of the three cells between source box and arrow with an adjacent bead. That is locally dense rather than sparse. The selected2 ANSI proves these are actual gold `●` glyphs, not a plain-text annotation. This is not inferred from a frame-to-frame speed estimate. The generator's claim that spacing is never under seven cells is demonstrably false in these short paths. I do not impose seven as a new rubric threshold; the visible adjacent pair is the sparsity failure.

Neither pair sits on a node border, and the label and arrow remain visible. Thus semantic/arrow categories still pass and severity is medium, but the animation category fails.

### AN2 — high evidence blocker: direction/speed cannot be recovered uniquely

All six routes have changing dot positions across two timestamped series, but both series sample every two seconds. Long runs repeat dots about seven cells apart. Example:

- frame2 (08:26:38Z): enqueue [29,21,1,1], [36,21,1,1]; write [25,37,1,1], [32,37,1,1]; Auth stem [50,30,1,1].
- frame3 (08:26:40Z): enqueue [25,21,1,1], [32,21,1,1]; write [29,37,1,1], [36,37,1,1]; Auth stem [50,34,1,1].

This permits forward-four-cell motion in intended directions, but periodicity also permits backward-three-cell phase movement. The live series has the same ambiguity: Auth dots [50,28,1,1]/[50,35,1,1] → [50,32,1,1] → [50,29,1,1]/[50,36,1,1]. Short-edge repeated/disappearing dots are not independent direction/speed proof either. Configured `flow=0.2` expresses intent; it does not prove the executed output's motion.

The observed arrows remain unambiguously source→target, and no dots cover words or node borders in the supplied frames. Dots sometimes replace elbows, e.g. [24,21,1,1] and [37,37,1,1] in live-frame1/selected2. Adjacent geometry keeps those particular routes traceable, so this is a correction candidate, not a separate invented arrow failure.

The unresolved capability/evidence need is a non-aliased actual-render recording or suitably close timestamped frames covering **all six routes**, plus per-node selected ANSI/buffer states. This review is not authorized to produce either. There is no demonstrated model/tool unavailability; required verification capability is unsupported by the frozen sample, not assumed impossible in the renderer.

## Workflow and cleanup

Correct identities, separate generator/judge roles, preserved blind-first hash, final spec/binary/skill/dataset/rubric hashes, complete final check outputs, measured viewport, and actual text/ANSI evidence are all present. The judge did not paste pane art into its chat reply. The saved generation Markdown's illustrative relation sketch is a file artifact, not evidence that pane art was pasted into chat.

**WE1 / blocked:** selected-state coverage and actual motion verification are incomplete. Clean check output and generator self-audit claims cannot fill these gaps. The supplied raw ANSI was independently examined before the generator audit was revealed.

Cleanup records list four owned panes: `w7E:p2X`, `w7E:p3A`, `w7E:p3E`, `w7E:p3R`. All are recorded closed. Launch files contain self-close commands; `generation.json` and `commands/commands.md` record final `pane_not_found` and a generator-only tab listing. These are preserved records, not a new live probe. No reviewer pane was created. No unrelated process/session was touched.

## Correction candidates — recommendations only, not applied

### Skill / evaluation-workflow candidates

1. Require an explicit selected-state coverage checklist: ANSI/buffer evidence for each node unselected and selected, including corners/handles. Do not let plain-text Worker selection stand in for color verification.
2. Require motion evidence with a temporal cadence that distinguishes intended direction from a periodic-dot alias on every requested route. Report actual timestamps; do not infer speed from nearest-dot matching or `flow` alone.
3. Explicitly inspect short routes for simultaneous neighboring dots. A clean check and broad claim of seven-cell spacing do not prove sparse animation.
4. Preserve per-evidence coordinate convention and final report hash ordering. The independent report uses 1-based capture coordinates rather than copying zero-based generator prose.

### Renderer-level candidates

1. Investigate short-route dot placement/wrap behavior that produces adjacent beads on request and dispatch. Preserve the source-required animated links rather than disabling motion or deleting edges to obtain green.
2. Consider keeping turn glyphs legible when a dot crosses an elbow; in this sample masking is recoverable but remains visually fragile.
3. Separate the layer-0 border hue from the selection/dot accent to fulfill the candidate skill's exclusive-accent promise. This recommendation is not scored as an extra rubric gate.

No current source-tree implementation was used as a substitute for frozen executed evidence, and no correction was applied. Gather all eight independent critiques before proposing a new skill candidate, as required by the protocol.
