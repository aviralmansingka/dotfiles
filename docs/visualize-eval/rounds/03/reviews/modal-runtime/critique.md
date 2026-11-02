# Round 03 — modal-runtime — independent Sol critique

## Verdict: FAIL, not green

The final view contains all **8 named components and 8 directed routes**, and its topology is traceable. It nevertheless fails **semantic fidelity**: three route labels have uncertain owners, and the visible seam descriptions lose source-specific information. Independent live-pane width/rectangle evidence is also missing, so layout-fit and workflow-evidence verification are **blocked**, not passed. A known semantic failure remains **fail** despite those evidence gaps.

| Fixed category | Decision | Evidence-based reason |
|---|---|---|
| semantic_fidelity | **fail** | Three ownership ambiguities survived blind review; the worker gRPC specificity and filesystem purpose of the daemon seam are not fully visible. |
| arrow_traceability | **pass** | All eight source stems lead to unique, intact arrowheads in the correct direction. The two opposite worker/runtime routes exist separately. No crossings, shared runs, junctions, or invented topological relation. |
| layout_fit | **blocked** | Existing 77×47 cell captures and the app's natural-zoom viewport line show no clipping or overlay collision, but the required separate actual live-pane width/rectangle was not preserved. |
| conceptual_grouping_color | **pass** | Related runtime, compute, and storage concepts use related hue families and nearby bands. Distinct worker and daemon seams remain distinct. No geometric-depth grouping or source-order violation. |
| border_integrity | **pass** | All four sides and four corners are complete and color-continuous for every node. Select-all covers 8/8 node occurrences and 276/276 perimeter cells. |
| workflow_evidence | **blocked** | Input/capture hashes, identities, blind-first record, commands, combined check streams, states, timestamps, and recorded cleanup exist; separate live-pane width/rectangle evidence does not. |
| animation | **N/A**, applicable=false, status=null | The frozen manifest/expected data mark this case optional, and the source requests no animation. All five captured frames are static with zero dots. N/A adds no metric pass. |

**Three applicable categories pass; one fails; two are blocked; animation is N/A.** Required-edge audit: **3 pass, 5 fail** after semantic meaning/ownership is included; all eight pass topology-only tracing. Severity never waives a gate.

## Identity, scope, and evidence base

- Generator: `viz-ds03-7`, model `fireworks/accounts/fireworks/routers/deepseek-flash-latest`. The generation record identifies a fresh isolated session `01a19bf8-4e50-72fb-bfb2-fd05315f87d9` and normalizes the provider/model components to that endpoint.
- Independent reviewer: `viz-judge03-runtime`, model `openai/gpt-6.1-sol`.
- Round integer: **3**.
- Final artifact: one spec, `docs/visualize-eval/rounds/03/modal-runtime/specs/v1.json`; no multi-spec manifest is needed.
- All evidence paths in `reviewer-result.json` are **repository-relative**, rooted at this dotfiles worktree. Regions are **1-based `[column,row,width,height]` terminal cells**, with the viewer header as row 1. Region findings reference the final normal ANSI capture, not shell-transcript row numbers.
- Capture metadata gives the interval **2026-11-02T11:16:45Z–2026-11-02T11:16:49Z**; inventory timestamps preserve that interval and do not invent per-capture wall-clock instants. Frame times are the recorded relative 0/100/200/300/400 ms.
- Read only this case, the shared frozen rubric/metadata/manifest, the frozen skill, and the capture helper whose bytes match frozen metadata. No unrelated chat, credentials, other case artifacts, or earlier-round verdicts were read. No viewer sessions, fixes, installs, commits, or subagents were run.
- Source excerpts and `expected.json` explicitly call the relations historical generated claims, not independently verified runtime facts. This review checks fidelity to those qualified requirements; it does not claim fresh Go/Rust source verification. Later historical simplifications in `historical-variants.json` do not authorize dropping components or a return edge. No unnamed third seam was invented.

### Blind-first record and immutability

`docs/visualize-eval/rounds/03/reviews/modal-runtime/observed-first.md`

```text
0df06b3e8e071f612639d7f9e0693ea2ac00555a2ff3b5916883f718a6293ef0
```

It was saved and hashed before expectation reveal. Its actual hash was rechecked during stage B and is unchanged. The result inventory includes it as evidence `blind`, and `observed_first.saved_before_expected_reveal` is **true**. No stage-A observation was rewritten after seeing expectations.

The stage-A bend paragraph contains a stray initial count of 17 followed by an explicit correction and the complete list of **16** bends. The enumerated coordinates support 16, which is the final scorecard count. This arithmetic clarification is made here, not by changing the blind file.

### Reviewer-identity mismatch episode — resolved before result creation

**Found by `viz-judge03-runtime` during stage B; corrected by the captain.** The captain reported that round 03 had been frozen from a stale master rubric: `required_reviewer_model` and the embedded result-schema reviewer constant still named the round-01 value `openai/gpt-6-astra`. This contradicted the actual Sol judging process, the task instructions, round-03 metadata, and (as reported by the captain, not independently reread here) the round-02 frozen copy.

- Rubric initially read: `545707a79f2bb098a3d1504ccb3095943eb9e6c452c931a50ebcbc9dbf8fcdc3`.
- Corrected round-03 rubric, independently obtained from `shasum -a 256`:
  `5519fd84f6b75973dbf7b5f5544c909a8f32a8841a876c8e7af00a1fcb119335`.

I stopped and asked rather than falsifying identity. The captain corrected the field and schema constant and updated metadata before any `reviewer-result.json` existed. The seven category criteria text did not change. The workflow category's prose still contains the old Astra wording because criteria text was kept unchanged; actual identity follows the explicit Sol task, corrected identity field, and corrected schema constant. This is a disclosed clerical input correction, not a substituted judge, rubric weakening, or candidate success. **No identity was falsified.** The result uses the corrected full rubric hash, and validates against its schema without overriding the reviewer constant or any other constraint. There is no remaining model-capability blocker.

## Highest-impact concrete findings

### F1 — high — dispatch label can attach to the daemon route

Required relation: **modal-runtime → Task engine: dispatches tasks** (`expected.json`, historical edge index 2).

- `task dispatch`: **`[23,22,13,1]`**.
- Engine-bound arrow: **`[21,22,1,1]`**.
- Runtime fan region: **`[20,19,26,4]`**.

The label starts beside the engine arrow but sits immediately **below the daemon-bound horizontal run** on row 21. Its entire text lies under that wrong route. Both routes are individually traceable, yet the label's meaning is not uniquely bound to the task-engine relation. This was observed blind and was also disclosed by the generator. Knowing the expected edge or reading JSON does not make the captured label ownership reliable.

The existing check says labels are off route cells. That establishes no overwrite, **not correct ownership**. This is a semantic failure, not a clipped-label failure or an invented extra topological edge.

### F2 — high — backend lifecycle label has the same wrong-run adjacency

Required relation: **Task engine → Container backend: starts/manages** (historical edge index 3).

- `starts/manages`: **`[20,30,14,1]`**.
- Backend-bound arrow: **`[18,30,1,1]`**.
- Engine fan region: **`[18,27,24,4]`**.

The label sits beside its intended arrow, but much of it is directly below the **filesystem-bound** horizontal run on row 29. The adjacent storage action already has its correct `mount+snapshot` label above that run. The lifecycle label can therefore be attached to storage rather than backend. That ambiguity was saved blind, not inferred after reading the audit. The storage route itself remains a passing required relation; its proximity is the context for the failed backend-label ownership.

### F3 — medium — task/control text is crowded against the opposite seam

Required relation: **modal-worker → modal-runtime: task input + control RPCs** (historical edge index 0).

- `task+ctrl RPC`: **`[23,12,13,1]`**.
- Opposed seam region: **`[21,11,32,3]`**.

The label starts to the right of the downward route at column 21 but ends at column 35, immediately touching the upward return line at column 36. A consistent right-of-route reading suggests its intended owner, but the crowded two-route seam remains ambiguous on position alone. The blind record flagged it explicitly. `events+mgmt RPC` at **`[38,12,15,1]`** has the clearer right-side association to the return route. The two arrows themselves are not merged, missing, or reversed.

### F4 — medium — abbreviated seam descriptions lose source specificity

The full source constraint names **worker gRPC**, and the daemon relation names **filesystem HTTP over UDS**.

- `task+ctrl RPC`: **`[23,12,13,1]`**.
- `events+mgmt RPC`: **`[38,12,15,1]`**.
- `HTTP over UDS`: **`[27,20,13,1]`**.

The visible worker labels say only `RPC`: they do not specify gRPC. `HTTP over UDS` preserves the distinct transport and does not falsely call it worker gRPC, but it drops the daemon seam's **filesystem purpose**. A reader cannot recover that purpose just from the label or the generic name `modal-daemon`.

This is **not** a rule that every original word must be copied literally. `ctrl`, `mgmt`, `vol`, and `task dispatch` are meaningful abbreviations/paraphrases; `user process` on the backend-to-container arrow also communicates the execution relation in context. The problem is losing protocol/function specificity, not changing wording. The generator's prose expansions are outside the diagram and do not supply an on-view key. This narrower source-meaning loss is separate from the three ownership defects.

## Required-edge audit

IDs match the generator ledger, not final JSON array order. The complete machine-readable audit gives source references, stem-to-arrowhead descriptions, regions, findings, and status for every relation. The following summarizes the same decisions. All routes have **zero crossings and no drawn junctions**.

| ID | Source-required directed meaning | Captured stem → arrowhead | Label decision | Final edge status |
|---|---|---|---|---|
| e1 | worker → runtime; task input + control RPCs | `[21,11]` down, left offset on row 13, `▼ [20,14]` above runtime | Task/control text crowded against return route; gRPC unspecified | **fail** F3/F4 |
| e2 | runtime → worker; events + management RPCs | `[34,16]` right to column 36, up to row 8, `◀ [34,8]` into worker | Owner clear; gRPC unspecified | **fail** F4 |
| e3 | runtime → engine; dispatches tasks | `[20,19]` down, right offset on row 21, `▼ [21,22]` above engine | `task dispatch` below wrong daemon-bound run | **fail** F1 |
| e4 | engine → backend; starts/manages | `[21,27]` down, left to column 18 on row 29, `▼ [18,30]` | Lifecycle label below neighboring storage run | **fail** F2 |
| e5 | backend → container; runs user process | `[18,35]` down, right to column 20 on row 37, `▼ [20,38]` | `user process [20,36,12,1]`; execution meaning and owner readable | **pass** |
| e6 | engine → filesystem; mounts/snapshots | `[23,27]` down, right to column 41 on row 29, `▼ [41,30]` | `mount+snapshot [25,28,14,1]` above its own run | **pass** |
| e7 | filesystem → Blobnet; image + volume data | `[41,35]` down, right to column 48 on row 37, `▼ [48,38]` | `image+vol data [34,38,14,1]` immediately left of its own arrow; readable despite tight gap | **pass** |
| e8 | runtime → daemon; filesystem HTTP over UDS | `[22,19]` down, right to column 45 on row 21, `▼ [45,22]` | Transport and owner clear; filesystem purpose absent | **fail** F4; F1 contextual |

**No extra apparent topological relation was observed**, so no invented `unexpected_link` audit row was added. The two node-level fans are separate source ports, not shared buses. The adjacent bends `╮` at `[21,21]` and `╰` at `[22,21]` point away from each other; they are one cross-route touching-bend pair, not a joined branch. There are no bridge glyphs, shared corridors, or source-required trunks in this case.

## Fit, layout order, and evidence blocker B1

What the existing evidence proves:

- Normal and selected ANSI files each have exactly **47 rows × 77 cells**.
- Header token: **`77x47 @100%`**.
- The saved frame transcript contains **`viewport: 77x47 zoom: 1.00 natural`**.
- Visible graph bounds: **`[17,7,45,36]`**, columns 17–61 and rows 7–42.
- Every box, label, and arrow is fully visible. The control legend **`[2,41,9,6]`** does not overlap the graph. No pan or zoom is needed to read the captured view.
- Observed crossing count: **0**, agreeing with `check.txt`. Zero is the minimum possible count; no avoidable crossing remains. The source defines no fixed left/right sibling order, and the visible logical bands preserve the required relationships without merging them. The attempt history does not show a source-group/tier violation to lower crossings.
- Offline check extent **46×37** is not the exact nonblank captured bounds (**45×36**) and does not itself prove fit. Its viewport line says `unknown`.

What remains missing:

- `manifest.json`: **`pane_cols: null`**, **`pane_rect: null`**, `pane_rows: 47`.
- `viewport_line` is also null in that manifest, though the existing transcript supplies the app's viewport line.
- The generation record's assertion `77 columns x 47 rows` does not add an independent pane-layout measurement. The app/capture cell grid cannot be silently substituted for the explicitly required separate actual live-pane rectangle.

Accordingly the result honestly sets `viewport.verified: true` for the observed app viewport but **`live_pane: null`**, and blocks layout-fit/workflow verification. This is an **evidence capability gap**, not a claim that clipping occurred or the renderer cannot fit. No new session or retrospective measurement was run to repair it.

## Grouping and full border/state audit

All graph-node labels and their coordinates appear verbatim in the immutable blind record. The following compact border inventory supplies conceptual/color evidence as well as geometry:

| Concept | Border bounds | Normal continuous RGB |
|---|---|---|
| modal-worker | `[20,7,14,4]` | `(216,166,87)` gold |
| modal-runtime | `[19,15,15,4]` | `(125,174,163)` teal |
| Task engine | `[20,23,13,4]` | `(147,194,183)` related teal |
| modal-daemon | `[44,23,14,4]` | `(211,134,155)` pink |
| Container backend | `[17,31,19,4]` | `(169,182,101)` green |
| Task container | `[19,39,16,4]` | `(189,201,124)` related green |
| Filesystem + volumes | `[40,31,22,4]` | `(125,160,184)` blue |
| Blobnet | `[47,39,9,4]` | `(151,184,206)` related blue |

Every listed node has complete top, bottom, left, right, and rounded corners with no endpoint overwriting its border. Node text uses RGB `(235,219,178)` and edges are muted RGB `(124,111,100)`. Runtime/engine, backend/container, and filesystem/Blobnet are source-related pairs; proximity and hues support the grouping rather than equating geometric depth with concept.

The **single simultaneous select-all ANSI capture covers all 8/8 node occurrences** in the sole final view. Every one of the **276 perimeter cells** is bold with RGB `(216,166,87)`. The worker's normal foreground is already the same gold, but its full-border bold transition proves the selected styling. This does not claim eight separate interactive selection actions, keyboard navigation testing, or captured drag-handle behavior. No such actions were run by the judge.

## Motion applicability and sample limits

The modal-runtime dataset entry (`cases.json`, case index 6) and `expected.json` mark animation **optional**. The supplied user request asks for readable seams, modules, and RPC paths, not motion. That supplies the source-backed N/A reason rather than assuming optional means an untested requested animation.

Frames **0, 1, 2, 3, 4** at **0, 100, 200, 300, 400 ms** have identical graph text after removing SGR and capture-only trailing whitespace. Every route has **0 dots in every frame**, and no motion appears. The spec/check likewise declare no active flow. Origin, spacing, direction, corner/bridge/arrowhead dot occupancy, and synchronized arrival are **not applicable**, not passes. Five-frame samples cannot prove full-cycle animation; none is claimed here.

## Workflow, provenance, and cleanup

The final evidence inventory includes the actual hashes of all case inputs, final/attempt specs, generation/attempt records, normal and selected captures, frame transcripts, check and validator outputs, capture manifest, candidate skill, corrected rubric, dataset, binary hash record, and immutable blind observation.

Independently verified identifiers:

| Input | SHA-256 |
|---|---|
| Frozen candidate skill | `cf796bcdc527897687ec2ca19844f399c921252409b9ca7ad04fbfa1b6cc659c` |
| Frozen renderer executable | `b242b6a28e2e27934b06b7a297be638c143e5c99680495e104380cd8d9ee80f7` |
| Corrected frozen rubric | `5519fd84f6b75973dbf7b5f5544c909a8f32a8841a876c8e7af00a1fcb119335` |
| Frozen dataset manifest | `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05` |
| Single final spec | `ab0fe1d35c3742ab58fde65dcf284aa758d68faa91a517358323cca5285608f0` |
| Capture helper, identical to frozen executed helper hash | `2a804dea703e5a9da9cdd788d4eb89690860a02606ec681948670dfe19e8e069` |

All metadata case-input hashes, manifest artifact hashes, and three recorded attempt hashes matched actual files. The frozen binary was hashed **without execution**. The renderer is its own baseline; this review attributes no renderer gain to skill quality.

The generation record supplies the exact final `--check`, hash, capture-helper, and validator commands. The helper's actual byte hash matches the frozen `metadata.harness` hash; reading that identified helper established that `check.txt` preserves **stdout+stderr together via `2>&1`**, rather than inventing a missing-stderr blocker. Its output is the existing execution evidence, not a new run. `check_exit: 0` and the check interval **11:16:45Z–11:16:45Z** are recorded. Current renderer source was not used to substitute for executed evidence.

The validator reports 28 passes. That does not prove perceptual label ownership or independent pane geometry. `attempts.json` lists three recorded spec attempts; `generation.json` openly discloses 15 additional layout/check probes and abandoned split probes. They are provenance, not an invented eighth category or reason to reject the artifact merely for process. The fixed rubric contains no independent probe-count pass condition.

**Cleanup:** generator-owned pane **`w7E:pBF`** is named in both the generation cleanup record and capture manifest, each recording **`confirmed_closed`**. The hash-verified helper closes the pane and uses a subsequent get failure as the closure probe. Cleanup is recorded **done**. The judge opened no panes, and did not replay closure or any historical source command. No pane art was pasted into chat replies.

## Correction candidates — no changes made

These are candidates for the captain after **all eight critiques** are gathered, not fixes performed by this judge.

### Skill/spec-level

1. Make **visible owner assignment** an explicit pre-acceptance question, not merely an audit-table declaration: without JSON, can a reader bind each label to exactly one route? Reposition/split the view when a label lies under another edge's long run or touches an opposite seam.
2. Retain **protocol and functional qualifiers** on the view: the worker seam is gRPC; the daemon seam is filesystem HTTP over UDS. A short-label budget must not force away required meaning. Use a source-backed on-view key or a complete split/coverage map instead of prose-only expansion.
3. Preserve what works: two separate opposite worker/runtime arrows, all eight components, independent compute/storage links, conceptual hue families, zero crossings, and no unrequested motion. Do not merge relations to recover whitespace.

### Renderer-level candidates

1. Investigate **owner-aware label placement/scoring**, not only route-cell collision counts. The frozen artifact demonstrates that zero label-on-route cells can coexist with a label immediately under the wrong route. Favor dedicated clearance or explicit owner cues while preserving target arrowheads and natural-size fit.
2. Investigate placement of the adjacent runtime bend pair so independent routes are easier to distinguish at a glance. This is a readability improvement candidate, **not a failed topological branch** in this case.
3. Do not attribute these to current-source code behavior without a new frozen executed sample; this review observed artifacts, not unexecuted fixes.

### Harness/evidence-level

1. Fix the pane-rectangle lookup or add an independently captured actual pane-width measurement to the execution bundle; preserve it separately from app viewport size.
2. Keep input identity consistency checks before freezing: metadata, required reviewer model, result schema, and task must agree. The disclosed stale-Astra episode was resolved without relaxing criteria or inventing identity.

## Verification of this review

- Rehashed the blind file and confirmed the original stage-A SHA-256 unchanged.
- Verified candidate, binary, corrected rubric, dataset, this case's source/expected/variants, final spec, recorded attempts, capture-helper, and all manifest-listed artifact hashes.
- Ran an offline **standard-library Python schema checker via `uv run --no-project python`**. It covers every schema keyword used by the frozen result schema (`$ref`, types, required/additional properties, constants/enums, allOf/oneOf, string patterns/lengths, numeric minimum, array bounds/uniqueness/items). No dependency was installed and no identity/schema override was used. **All constraints passed.**
- Also checked evidence/finding references, eight unique required-edge audits, region bounds within 77×47, and known-failure aggregation.
- No new viewer sessions or renderer tests were run. The only files written in the repository are the permitted review deliverables; helper code stayed under `/tmp`.

## Unresolved blockers and outcome

- **B1:** separate actual live-pane width/rectangle evidence is missing. It blocks two evidence-dependent categories; it does not erase the observed semantic defects.
- **No unresolved required model/rendering capability blocker.** Static node/edge rendering exists; neither a source bus nor animated cycle is required here.
- **Overall remains FAIL.** The captain must gather all eight complete critiques before revising the skill again.
