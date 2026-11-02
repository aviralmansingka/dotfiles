# modal-runtime — round01 independent Astra critique

## Verdict: FAIL

The frozen case is not green. **Two of six applicable categories pass, three fail, and border_integrity is blocked.** Animation is source-backed N/A and adds no pass to the metric.

**Selected-state coverage correction:** the original Stage B report incorrectly counted 51 box appearances across frames as complete selected/unselected coverage. They contain 45 unselected appearances and only six selected appearances. The unchanged raw evidence proves all 17 node occurrences unselected, but only 6/17 selected. The remaining 11 selected occurrences are unverified, not defective. Original reports are preserved unchanged under `docs/visualize-eval/rounds/01/reviews/modal-runtime/superseded/`: `reviewer-result.json` (SHA256 `e44c0a0b8d435463c0a97b9442da9bd1941be2bb7300e29e741329f617d1f002`) and `critique.md` (SHA256 `eeee487002fe62cc2a4368d26f57cc3985f4139919ee1348e0ce0b1f87129813`). This correction uses the same final ANSI captures; it adds no rendering and does not change the blind record.

| Fixed category | Decision | Main basis |
|---|---|---|
| semantic_fidelity | **FAIL** | Task-input and management meanings disappear from the worker RPC labels; user-process specificity is shortened away; two label-to-edge associations remain ambiguous. |
| arrow_traceability | **PASS** | All eight endpoint pairs, repeated across 16 visible paths, have separately traceable source stems and unique correctly directed heads. No crossings or false branches. |
| layout_fit | **PASS** | Actual 77×47 terminal grids show every graph box, graph label and arrowhead at native size, without overlay occlusion. |
| conceptual_grouping_color | **FAIL** | Colors express geometric depth, not the source's execution/container and filesystem/storage relationships. Several same-hue groupings have no source-defined tier behind them. |
| border_integrity | **BLOCKED** | All 17 unselected occurrences and six captured-selected occurrences have correct borders. Selected evidence for 11 other occurrences is missing; no border defect is observed. |
| workflow_evidence | **FAIL** | Existing chronology/state-record failures remain. In addition, selected-state coverage is incomplete (6/17); that evidence gap is blocked, not an observed border failure. |
| animation | **N/A** | Manifest/expected say optional; the source user request does not request motion. No flows are rendered. |

There are **2 critical, 4 high, and 2 medium findings**. Known failures remain failures despite the additional evidence blockers. This is an assessment of the frozen round01 baseline, **not evidence of a skill-only improvement**. No cancelled-round00 material contributes to the decision.

## Independence, frozen evidence, and path conventions

All evidence paths in `reviewer-result.json` are **repository-relative**, rooted at the dotfiles checkout. The one binary outside that tree is named inside `verification.json` as `/tmp/visualize-eval/round-01/bin/rataflow-view`; its verified hash is the result's `renderer_sha256`. I hashed it without executing it. Evidence IDs in the JSON point to files, not renderer world coordinates.

Every capture region is 1-based `[column,row,width,height]`. The reviewed capture root is:

`docs/visualize-eval/rounds/01/modal-runtime/captures/`

Only final `overview`, `seams`, and `execution` capture families were scored, in text and ANSI and all three states (`none`, `sel-tab`, `sel-right`). Earlier variants were not used as visual evidence. Four earlier-attempt timeline files were read only through their lifecycle lines to account for owned panes, not to score those captures.

I verified the previously saved blind report **before** reading the reveal:

- File: `docs/visualize-eval/rounds/01/reviews/modal-runtime/observed-first.md`
- SHA256: `b49b433d92fe06c005feeb3e64dd50c39fdd60fa89a80144a2a6e506c13b803b`
- It remains unchanged. The expected/spec reveal did not retroactively turn unknown label associations into observed facts.

Reviewer session identity was independently available as `PI_SUBAGENT_NAME=viz-judge01-modal-runtime`, `PI_PROVIDER=openai`, `PI_MODEL=gpt-6-astra`. Generator identity is recorded as `viz-ds01-modal-runtime`, `fireworks/accounts/fireworks/routers/deepseek-flash-latest`, session/subagent identity `2cc07bfe`, matching frozen metadata. No reviewer substitution occurred. I spawned no agents and performed no pane/session operation, rendering, installation, fix, or commit.

The expected relationships are explicitly qualified as historical generated claims, not current independent implementation verification. I used the frozen qualified source and constraints; I did not turn the old assistant diagram into independent research, read unrelated chats, or execute source excerpts.

### Verified hashes

| Input | SHA256 |
|---|---|
| Frozen candidate `rounds/01/SKILL.md` | `9c5cea272a88300644cacda52c853c7c9169eeec91f0355d3460ee8741308d92` |
| Frozen renderer binary | `4a883e73b822f009c504bd21d0c2fc383067bf1b83b9791ccbda431912e3a1d8` |
| Frozen round01 rubric | `60997237bd996f1e1b6a16e0b68133859b9f03fd83c85e7f508e286743240f5d` |
| Dataset manifest `cases.json` | `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05` |
| modal-runtime source | `c6e4552d5842347bc9472e53a2351897c3624c92b5a14541aaa3c28216dc4a0d` |
| modal-runtime expected | `fd3963e207e9c433b7e5825c8a1691766bb13d5df7322ac97a05e379d2cbba99` |
| Final overview spec | `e6fdb516325c72692661235f3794e8660ce4809d3ada9af21e9f8f37dff7bf93` |
| Final seams spec | `f0d0da4a41d6419763af4e2c040f5b0b654d6a783ef3c0a564b5235ceb547867` |
| Final execution spec | `1e3d23a22364fd791094ace692dbb6db58d7a77a3eee6ef37fa6014e7139ae6d` |
| Sorted three-spec manifest | `7e6c2daf77ca55bf3ef5103e34034bbec9dcab31a14afeff85405acb9f5a6005` |

Every final capture hash also matches `generation.json`; actual hashes and timestamp qualifications appear in the 63-entry evidence inventory, including the new independent selected-state coverage ledger. `evidence/spec-hashes.txt` is an **interim** list with the old seams hash, so it is not the final manifest. The new deterministic manifest contains sorted repository-relative path/SHA256 pairs for the three actual final specs.

## Source coverage and complete edge audit

All eight source component names are visible in overview: modal-worker, modal-runtime, Task engine, Container backend, Task container, Filesystem + volumes, Blobnet, modal-daemon. No extra node or substituted machine-manager component appears. Seams shows worker/runtime/daemon/engine. Execution shows engine/backend/container/filesystem/Blobnet.

Overview contains all eight required endpoint pairs. Seams repeats R1, R2, R3 and R8; execution repeats R4–R7. Task engine is the explicit shared component at the boundary, so there is no missing cross-view topological handoff. Coverage is nevertheless **not semantic success**: missing words/meanings and ambiguous labels are not repaired by the coverage map in generation prose.

The table below summarizes each audited source relation. The JSON and unchanged blind report specify every source stem, intermediate route rectangle, target head and label coordinate in both occurrences.

| ID | Required directed relation and meaning | Actual view evidence | Whole-edge status |
|---|---|---|---|
| R1 | worker → runtime: **task input + control RPCs** | Overview stem [12,10,1,2] → head [11,13,1,1]; seams [25,19,1,2] → [24,22,1,1]. Both say only `control gRPC`. | **FAIL**, F01: task-input meaning missing. |
| R2 | runtime → worker: **events + management RPCs** | Overview right stem [25,15,1,1] → left head [25,7,1,1]; seams [38,24,1,1] → [38,16,1,1]. Both say only `events gRPC`. | **FAIL**, F02: management meaning missing. |
| R3 | runtime → engine: **dispatches tasks** | Overview [11,18,1,2] → [12,21,1,1]; seams [26,27,1,1] → [43,30,1,1]. `task dispatch` preserves meaning. | **PASS**. |
| R4 | engine → backend: **starts / manages** | Overview [12,26,1,3] → [9,30,1,1]; execution [21,19,1,2] → [18,22,1,1]. `starts/manages` is between the two branch heads in both views. | **FAIL**, F03: label attachment unknown from captures alone. |
| R5 | backend → container: **runs user process** | Overview [9,35,1,2] → [35,38,1,1]; execution [18,27,1,2] → [20,30,1,1]. Both say `runs process`. | **FAIL**, F05: user-specific meaning lost; action/direction retained. |
| R6 | engine → filesystem: **mounts / snapshots** | Overview [14,26,1,3] → [32,30,1,1]; execution [23,19,1,2] → [41,22,1,1]. `mount/snapshot` retains both actions. | **PASS**. |
| R7 | filesystem → Blobnet: **image + volume data** | Overview [32,35,1,1] → [61,38,1,1]; execution [41,27,1,2] → [48,30,1,1]. `image/vol data` retains both data kinds. | **PASS**. |
| R8 | runtime → daemon: **filesystem HTTP over UDS** | Overview [13,18,1,1] → [58,30,1,1] is clear; seams [24,27,1,2] → [25,30,1,1] has an ambiguously placed `fs HTTP over UDS`. | **FAIL**, F04: detail-view label association unreliable. |

There are **no extra apparent endpoint relations** to add as unexpected-link records. The ambiguous labels could misassign *meaning* to an existing branch; they do not create another visible source→target line. No unassigned arrowhead remains.

Arrow traceability passes independently of these whole-edge semantic failures. Worker/runtime directions use separate paths rather than one misleading shared line. Runtime's daemon and task-dispatch exits are separate; the engine's backend and filesystem exits are separate. There are no edge-edge crossings, overlapping line runs, T-junctions, fake branches, or unrelated box contacts. Source stems abut complete borders; heads terminate outside the correct targets. The source requests no bus here, and none was invented.

## Concrete defects

### F01 — Critical: task-input meaning removed

Source: `cases/modal-runtime/source.md`, relationship `worker -> runtime: task input + control RPCs`; expected edge 0.

- `overview.text.none.txt`: `control gRPC` [14,11,12,1].
- `seams.text.none.txt`: `control gRPC` [27,20,12,1].

The source names two purposes. The visible label retains only control. `gRPC` identifies a transport, not task-input meaning. There is no rendered legend restoring the missing purpose. Generation's abbreviation dictionary is outside the diagram and cannot make the capture preserve this concept. This is not a demand for exact original wording; an equivalent short label would be acceptable, but this one is incomplete.

### F02 — Critical: management meaning removed

Source: `runtime -> worker: events + management RPCs`; expected edge 1.

- `overview.text.none.txt`: `events gRPC` [28,11,11,1].
- `seams.text.none.txt`: `events gRPC` [41,20,11,1].

The return path and its direction are clear. The management role is not. It is missing from all rendered views, not merely abbreviated. The legend in a generation report cannot rescue visible semantic fidelity.

### F03 — High: starts/manages is not uniquely attached

Source: `engine -> backend: starts / manages`; expected edge 3.

- `overview.text.none.txt`: label [14,30,14,1]; the competing routes/heads occupy [9,28,24,3].
- `execution.text.none.txt`: label [23,22,14,1]; competing routes/heads [18,20,24,3].

The text lies to the right of the backend head but directly under the filesystem horizontal route. Blind Stage A correctly left the association ambiguous. The revealed spec tells me what the author intended, not what an unprimed reader can read. The generator's “minor / none effect on meaning” assessment does not override the fixed gate.

### F04 — High: seams mis-associates the HTTP-over-UDS label

Source: `runtime -> daemon: filesystem HTTP over UDS`, and the explicit distinction from worker gRPC.

- `seams.text.none.txt`: label [27,29,16,1], competing branch region [24,27,20,4].

The label starts beside the daemon bend but lies directly below the engine branch's horizontal run. Its final character touches that branch's vertical segment at [43,29,1,1]. I can trace the daemon endpoint, but cannot exclusively attach this interface meaning from the seams capture. Overview's correctly placed label is positive evidence for that view, not a waiver for a required detail view.

### F05 — Medium: user-process specificity removed

Source: `backend -> container: runs user process`; expected edge 4.

- `overview.text.none.txt`: `runs process` [16,36,12,1].
- `execution.text.none.txt`: `runs process` [20,27,12,1].

The action and endpoint meaning remain largely recoverable, so severity is medium, not critical. The user-specific qualifier is nevertheless absent, with no visible key. The rubric preserves label meaning, not just endpoint pairs; severity does not waive that gate.

### F06 — High: unsupported geometric color grouping

Source distinguishes task orchestration, container backends and storage. It does not define the displayed geometric rows as conceptual tiers.

- `overview.ansi.none.txt`, [8,31,63,12]: backend, filesystem and daemon share a green tier, while Task container and Blobnet share a blue tier. The source-related backend/container and filesystem/Blobnet pairs are split across those hues.
- `execution.ansi.none.txt`, [17,23,45,12]: backend/filesystem share teal, container/Blobnet share pink.
- `seams.ansi.none.txt`, [24,31,31,4]: daemon and engine become a pink pair.

The source relation graph justifies the line topology, but not a claim that each row is a source-defined module group. Generation explicitly describes an “adjacent to the storage layer” abstraction for daemon; no corresponding layer exists in the frozen source, and that row includes Container backend. The task asks for internal components and seams, so color should support those conceptual relationships rather than suggest unsupported tiers.

The base hues also change across views: engine pink → lighter pink → amber, daemon green → pink, backend green → teal, container blue → pink. **Stable cross-view identity colors are not a new pass condition here.** These changes corroborate the existing geometric-depth issue; they are not a separate failure by themselves. Likewise, an unselected amber root sharing selection RGB is an observation, not an invented selection-contrast gate.

### F07 — High: overview executed provenance cannot be reconciled

Evidence: `generation.json`, `evidence/commands.md`, `evidence/overview.timeline.txt`, `evidence/manifest.tsv`.

Generation/commands claim overview launch at `08:25:29Z` and captures at `08:25:30Z–08:25:38Z`. The frozen manifest instead records:

| Artifact | Recorded artifact timestamp |
|---|---|
| overview.text.none.txt | 2026-11-02T08:25:01Z |
| overview.ansi.none.txt | 2026-11-02T08:25:24Z |
| overview.ansi.sel-tab.txt | 2026-11-02T08:25:29Z |
| overview.text.sel-tab.txt | 2026-11-02T08:25:44Z |
| overview.text.sel-right.txt and overview.ansi.sel-right.txt | 2026-11-02T08:25:44Z |

The overview timeline is only three unlabelled timestamps. Unlike the other final views, there is no per-view exact launch-command file or retained per-state capture event log. There is also no retained p2Z close event or final pane-list response. Its retrospective cleanup assertion is not enough to establish the missing executed chain.

All capture hashes match; **this is not an allegation that the capture content was fabricated**. The record is contradictory/incomplete and cannot verify the full required workflow. The JSON capture timestamps preserve the manifest values explicitly as *artifact mtimes*, not independently certified capture-event times. No time was invented to fill the gap.

Relevant visual states remain identifiable at overview header [1,1,77,1], selected backend [8,31,19,4], and selected filesystem [31,31,22,4]. Those regions prove actual state appearance, not the disputed event time.

### F08 — Medium: generator state/coordinate records disagree with ANSI

- `seams.ansi.sel-tab.txt`: **modal-daemon**, [24,31,14,4], is selected. Generation says modal-worker.
- `execution.ansi.sel-tab.txt`: **Container backend**, [17,23,19,4], is selected. Generation says Task engine.
- `execution.ansi.sel-right.txt`: **Task container**, [19,31,16,4], is selected.
- Overview's reverse arrowhead is [25,7,1,1], not generation's stated column 24, which is the worker border.

The actual captures, not the self-audit, determine border and routing decisions. Independent inspection recovers these facts, but the submitted workflow record remains wrong. The mistakes do not become observed border defects: the six real selected borders are complete. They do not establish selected-state correctness for the other 11 view/node occurrences.

## Positive evidence and non-failures

### Fit and dimensions

Each final `evidence/<view>.tty-size.txt` says `47 77`. Each of nine ANSI captures decodes to 47 rows × 77 cells. Plain text omits the last blank row; after terminal padding normalization, it matches the corresponding ANSI character grid.

- Overview graph extent: [8,6,63,37].
- Seams graph extent: [23,15,32,20].
- Execution graph extent: [17,15,45,20].
- Controls: [2,41,9,6], clear of every graph.

Four-row native boxes, default viewer launches, and the recorded absence of pan/zoom input support the required natural 100% state. No spec has a zoom override. In Stage A the percentage could not be read from a still; Stage B adds the launch/default/no-manipulation record. Its overview archival limitation is separately recorded under workflow, not silently ignored.

The clipped `scr` at overview [75,1,3,1] and `sc` at execution [76,1,2,1] are viewer-help chrome. No source-required diagram label is clipped. I did not invent a new gate requiring all viewer help text to fit.

### Borders and color continuity

All 17 node occurrences have full top/bottom/left/right sides and all four rounded corners in their **unselected** `none` captures. Across the three captured frames per view, there are 51 box appearances: **45 unselected and six selected**, not selected coverage for every node. Coordinates and per-node base RGBs remain in the unchanged blind report. The former category pass extrapolated beyond these observations and is withdrawn.

`selected-state-coverage.json` independently recounts the same nine final ANSI files. It lists every view/node occurrence, exact rectangle, raw evidence filename/hash, perimeter RGB/boldness, and whether selected evidence exists. Each node occurrence is scoped to its own view; selection of a shared component in another view does not fill the gap. There is no visible handle interruption in the supplied captures, but unobserved selected handles/borders cannot be certified.

Selected outlines consistently change every perimeter cell to **bold** amber RGB (216,166,87):

| Capture | Selected box | Changed perimeter cells |
|---|---|---:|
| overview.ansi.sel-tab.txt | Container backend [8,31,19,4] | 42 |
| overview.ansi.sel-right.txt | Filesystem + volumes [31,31,22,4] | 48 |
| seams.ansi.sel-tab.txt | modal-daemon [24,31,14,4] | 32 |
| seams.ansi.sel-right.txt | Task engine [42,31,13,4] | 30 |
| execution.ansi.sel-tab.txt | Container backend [17,23,19,4] | 42 |
| execution.ansi.sel-right.txt | Task container [19,31,16,4] | 36 |

The six table rows above are the **only selected node occurrences** established by the final raw captures. Selected evidence is absent for the following eleven occurrences:

| View | Node occurrence | Region in existing unselected evidence | Existing selected raw evidence |
|---|---|---|---|
| overview | modal-worker | [11,6,14,4] | None |
| overview | modal-runtime | [10,14,15,4] | None |
| overview | Task engine | [11,22,13,4] | None |
| overview | modal-daemon | [57,31,14,4] | None |
| overview | Task container | [34,39,16,4] | None |
| overview | Blobnet | [60,39,9,4] | None |
| seams | modal-worker | [24,15,14,4] | None |
| seams | modal-runtime | [23,23,15,4] | None |
| execution | Task engine | [20,15,13,4] | None |
| execution | Filesystem + volumes | [40,23,22,4] | None |
| execution | Blobnet | [47,31,9,4] | None |

For each row, the unselected evidence is `<view>.ansi.none.txt` under the reviewed capture root; those boxes also remain unselected in both other final captures. A filename containing `sel-tab` or `sel-right` describes the frame, not every node in it. Thus the every-node selected-state requirement is **blocked**. No selected defect is invented, and no absence of evidence is scored as a defective border.

For the observed states, labels remain cream; source stems and heads remain muted RGB (124,111,100), outside intact borders. No separate handle glyph punctures or recolors a border. All nonselected cells are unchanged relative to the `none` capture. Selection/base hue overlap is not a per-node continuity defect.

### Checks and animation applicability

All three final check stdout/stderr/exit files are present. Stdout reports 8/8, 4/4 and 5/4 nodes/edges, zero flows, and extents 64×38, 33×21 and 46×21. Stderr is empty and every final exit file says `exit=0`. These checks establish preserved executions, not visual correctness.

The source user asks for readable runtime components and RPCs, not animation. `cases.json` and `expected.json` mark modal-runtime optional. All final specs omit flows and headers say `0 flows`; no dots appear. Animation is therefore source-backed N/A, **not blocked and not passed**. No claims about speed, smoothness, direction, or aliasing are inferred from static frames.

## Cleanup and blockers

Seven owned viewer panes are listed in generation records:

| Pane | Retained closure evidence |
|---|---|
| w7E:p2Z | Retrospective assertion only; no per-step event or final pane-list response retained. |
| w7E:p39 | `overview-v2.timeline.txt`: self-closed 08:26:08Z. |
| w7E:p3F | `seams-v1.timeline.txt`: self-closed 08:26:29Z. |
| w7E:p3K | `seams-v3.timeline.txt`: self-closed 08:26:47Z. |
| w7E:p3N | `seams.timeline.txt`: self-closed 08:27:03Z. |
| w7E:p3S | `execution.timeline.txt`: self-closed 08:27:11Z. |
| w7E:p3W | `execution-v2.timeline.txt`: self-closed 08:27:26Z. |

The JSON lists six evidence-confirmed closures and marks cleanup **blocked** for original overview verification. It does not assert p2Z is still alive. I did not inspect live pane state or try to close anything.

Unresolved evidence blockers are **selected-state coverage for the eleven occurrences listed above**, plus the original overview event chronology, exact executed launch/state chain and close verification. Border integrity is blocked solely by absent selected coverage; proven unselected and captured-selected correctness is preserved. Workflow remains **fail**, not merely blocked, because its existing known F07/F08 failures remain; incomplete selected coverage is an additional workflow evidence gap. Overall remains **fail**. No missing model or tool capability was encountered. The existing Python environment has no `jsonschema` package; I installed nothing and used a standard-library validator for the frozen schema's keywords instead.

Potential rendering capability limits are narrowly stated: the **frozen documented spec** exposes no independent semantic group/node-color field and no edge-label anchor field. I did not inspect renderer code or test undocumented options. Those capabilities may be needed for the correction candidates below; their absence from documentation is not proof that every alternative layout is impossible. Animation capability is not a blocker for this case.

## Correction candidates — not applied

### Skill-level candidates

1. Preserve each named relationship purpose during abbreviation. A length preference must not remove task input, management, or user-process specificity. Require a source-to-visible-label meaning check, not just endpoint coverage.
2. Treat ambiguous label placement as a failure even when all strings exist and `--check` is clean. Require blind label-to-edge association in each detail view; never use the spec to resolve an unreadable association after the fact.
3. Choose groups from source concepts before using layout layers as a color mechanism. Do not describe geometric adjacency as a source-defined storage tier. If topology and semantic grouping conflict, make the abstraction explicit rather than claiming automatic layer color proves it.
4. Use one capture/provenance procedure from the first view: exact launch command, frozen spec hash, measured tty, per-state capture times/hashes, actual selected node, and retained close/final-pane-list response. Record artifact modification time separately from capture-event time.
5. Derive state descriptions from observed ANSI, not expected key navigation. Preserve an immutable final spec manifest instead of relying on an intermediate list. Track selected/unselected coverage per node occurrence in each view; an unselected node in a selected frame is not selected-state evidence.

### Renderer-level candidates

1. Place each label in a region visually owned by its route. Penalize placements directly under another route or flush against a foreign stem; an explicit label anchor/leader may be needed for crowded bifurcations.
2. Separate semantic grouping colors from geometric depth if the spec cannot otherwise express source-related component families without damaging directional layout.
3. A clearer selected outline than the unselected root hue could improve interaction, and wrapping/shortening chrome would avoid cut help words. These are observations/candidates, **not additional failed rubric gates** in this review.

The report attributes no gain to an unexecuted correction and no renderer-baseline change to the skill. The captain must gather all eight complete critiques before selecting or applying a new candidate.

## Deliverables

- `docs/visualize-eval/rounds/01/reviews/modal-runtime/reviewer-result.json`
- `docs/visualize-eval/rounds/01/reviews/modal-runtime/critique.md`
- `docs/visualize-eval/rounds/01/reviews/modal-runtime/spec-manifest.json`
- `docs/visualize-eval/rounds/01/reviews/modal-runtime/verification.json`
- `docs/visualize-eval/rounds/01/reviews/modal-runtime/selected-state-coverage.json`
- Original reports preserved under `docs/visualize-eval/rounds/01/reviews/modal-runtime/superseded/`
- Unchanged `docs/visualize-eval/rounds/01/reviews/modal-runtime/observed-first.md`
