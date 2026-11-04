# modal-runtime — independent Sol review, round 05

## Verdict: **FAIL**

Three applicable categories pass, two fail, and one is blocked. Animation is source-backed N/A. The known semantic and grouping failures determine the overall **fail**; the workflow evidence gap does not turn those failures into an unknown result.

| Fixed category | Decision | Basis |
|---|---|---|
| semantic_fidelity | **fail** | All eight components and eight directed endpoint pairs are present, but source seam qualifiers and an execution verb are lost in shortened labels. |
| arrow_traceability | **pass** | Eight continuous, correctly directed routes; unique heads and certain label owners; no shared route cells, crossings, fake junctions, or conspicuous avoidable loops. |
| layout_fit | **pass** | All three final-spec pinned 77×47 natural-100% dumps show complete graph geometry and labels, with no clipping or palette overlap. Actual live panes remain separately recorded as 83×51. |
| conceptual_grouping_color | **fail** | Storage and orchestration reuse the exact same blue pair, without group titles/enclosures/legend to disambiguate them. |
| border_integrity | **pass** | Actual 83×51 ANSI normal and selected captures prove 11/11 complete, color-continuous node-occurrence borders, with zero palette-overwritten cells. Target-size color evidence is not inferred; it remains a workflow gap. |
| workflow_evidence | **blocked** | Hashes, identities, blind-first record, attempt records, static frames, and manifest cleanup are preserved; target-size normal/selected ANSI or buffer evidence is absent in every view. |
| animation | **N/A** | The frozen source does not request motion. Round-05 scope is static for this case. Five frames per view at both sizes have zero route dots and unchanged displayed payloads. |

## Path, coordinate, and provenance conventions

Every evidence path in `reviewer-result.json` is relative to the repository root (this worktree), **not** to this review directory. Its 82-entry evidence inventory includes actual SHA-256 values for the frozen inputs, each final spec, deterministic spec manifest, blind record, normal/selected/frame captures, raw rejected-attempt checks and statuses, diagnostic captures, validators, and generation records.

Every region is 1-based `[column,row,width,height]` in the **displayed screen**, excluding shell preambles and `frame N at Tms` lines. For multi-frame files, locations refer to frame 0. All five displayed frames are identical for this static case.

The source/expected relation set is qualified historical generated evidence, **not independent verification of Modal's current implementation**. Historical variants do not override the eight fixed required relations. No unrelated historical chat, credentials, other case, earlier-round result, or current renderer source was used.

### Frozen identities and hashes

| Input | Verified SHA-256 |
|---|---|
| Candidate `rounds/05/SKILL.md` | `ff4a9d3f32ba0bf86e54ee6bfbac02fdea3fac3b95b82a958b3411accef0a949` |
| Frozen `/tmp/visualize-eval/round-05/bin/rataflow-view` | `b1ab9f2e78af11c2f2b005eea083a999079d184bf550e8d0b6d9c51867f22404` |
| Frozen rubric | `039b96252d25ad2078a539fdb1d081ebdb6c09d6f7a3487b96ffbbf3b082e292` |
| Dataset manifest `docs/visualize-eval/cases.json` | `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05` |
| Final-spec manifest | `99e54f9cc169d4ae1a5fcc93dcac110f91be3d0667bc3b2760f1d7600fea69fc` |
| Immutable blind record | `b6c99b121354a8a1d4921e7cd748e524db2832236c95b2d0061fd5a8d930cc77` |

All three final-spec hashes match their manifests and generation records. All case source/expected/variant hashes match frozen metadata. The binary itself was hashed but **never executed by this review**. All manifest-listed artifact hashes match. `stage-b-verification.json` records these checks.

The generator's routed identity is **`viz-ds05-7`**, preserved verbatim in `generation.json`; its provider/model is the mandated `fireworks/accounts/fireworks/routers/deepseek-flash-latest`. The JSON result uses **`viz-ds05-modal-runtime`** for `generator.worker_id` because the full-task instructions explicitly prescribe that normalized case identity. This does not claim the actual subagent had that display name.

This judge's actual `PI_SUBAGENT_NAME` is **`viz-judge05-runtime`**, and `PI_MODEL` is **`gpt-6.1-sol`**. The result therefore records actual reviewer name `viz-judge05-runtime` and model `openai/gpt-6.1-sol`, rather than inventing a longer alias. The generator did not judge itself, and this judge did not switch models or spawn subagents. The stale `openai/gpt-6-astra` phrase in the workflow prose is superseded by the rubric's corrected required reviewer model, result schema, and explicit full-task identity rule.

## Blind-first seal and addendum

`observed-first.md` was saved before the reveal and remains **byte-for-byte unchanged** at the SHA-256 above. The result references it as evidence `observed-first` and sets `saved_before_expected_reveal: true`.

Two counting corrections belong **only in this addendum**, not in the immutable record:

1. Its individual perimeter tables total **374**, not 372, cells per state. Both the normal and selected state audits cover those 374 cells.
2. Its listed labels comprise **eight unique node names**, not seven. There are still **eleven node occurrences** across the three final views.

These corrections do not change any recorded coordinate, border observation, route observation, or category decision. The blind record's absent `routes: N/M near-minimal` diagnostic is now explained by the frozen metadata and executed check outputs: this build does not emit it. I judge the visible route economy rather than invent a missing required diagnostic gate.

## Required relation and cross-view audit

All eight unique components are drawn: modal-worker, modal-runtime, Task engine, Container backend, Task container, Filesystem+volumes, Blobnet, and modal-daemon. The whitespace removal in `Filesystem+volumes` preserves the two component terms. No extra visible relationship was found.

The table uses pinned 77×47 coordinates. Full 83×51 equivalents, bends, label bounds, node rectangles, colors, and selected-state details remain in the blind record and JSON edge audits. Every route below has certain ownership, no crossing/junction, and one visible arrowhead.

| Edge | Source fact → rendered wording | First drawn route cell → head | Source-relation decision |
|---|---|---|---|
| e1 worker→runtime | task input + control RPCs; fixed constraint identifies worker gRPC → `task+ctrl RPC` | v1 (31,24) → `▶` (46,24), target left border x47 | **fail meaning**, pass endpoints/direction/trace: generic RPC omits gRPC specificity. |
| e2 runtime→worker | events + management RPCs; worker gRPC → `events+mg RPC` | v2 (32,26), bends (45,26)/(45,29), → `▶` (46,29), target x47 | **fail meaning**, pass endpoints/direction/trace: unexplained `mg` and generic RPC do not preserve the source seam specificity. |
| e3 runtime→engine | dispatches tasks → `task dispatch` | v3 (30,15) → `▼` (30,18), target top row19 | **pass**: meaning preserved by a clear action-noun paraphrase. |
| e4 engine→backend | starts / manages → `starts+manages` | v3 (30,23), bends (30,25)/(10,25), → `▼` (10,26), target top row27 | **pass**: both actions retained. |
| e5 backend→container | runs user process → `user proc` | v3 (10,31) → `▼` (10,34), target top row35 | **fail meaning**, pass endpoints/direction/trace: `runs` is missing. |
| e6 engine→filesystem | mounts / snapshots → `mount+snapshot` | v3 (32,23), bends (32,25)/(50,25), → `▼` (50,26), target top row27 | **pass**: both actions retained. |
| e7 filesystem→blobnet | image + volume data → `image+vol data` | v3 (50,31) → `▼` (50,34), target top row35 | **pass**: both payloads retained; `vol` is recognizable in the filesystem/volumes context. |
| e8 runtime→daemon | filesystem HTTP over UDS → `HTTP over UDS` | v2 (32,24), bends (45,24)/(45,19), → `▶` (46,19), target left border x47 | **fail meaning**, pass endpoints/direction/transport/trace: filesystem interface qualifier is missing. |

Four edge audits pass the full required relation meaning; four fail only on their documented label-specificity/action omissions. These failures are not claims of reversed or physically untraceable arrows.

### The anti-parallel pair: preserved across views, not an additional defect

The fixed source constraint explicitly allows worker→runtime and runtime→worker **separately**, or an explicitly bidirectional labeled relation. It does not require co-location in one panel.

- v1 label `task+ctrl RPC`: `[32,23,13,1]`; head `[46,24,1,1]` enters modal-runtime.
- v2 label `events+mg RPC`: `[32,27,13,1]`; head `[46,29,1,1]` enters modal-worker.
- Both panels repeat the full modal-worker/modal-runtime names, and `generation.json` explicitly maps e1 to v1 and e2 to v2. The dispatch continuation is similarly anchored by the repeated full runtime name in v3.

Thus the split imposes comparison cost but **preserves the bidirectional endpoint/direction relationship** under the actual rubric. It is not an invented one-way abstraction, dropped reverse relation, or reason to fail traceability. The very thin two-node v1 is also not a standalone rubric defect.

The generator's shared-corridor/missing-label warning refers to **rejected** candidate `v1-a2`, not a hidden defect in final `v1-a5`/`v2-a4`. Its diagnostic does show `task+ctrl RPC`, no visible `events+mg RPC`, an overlapping anti-parallel corridor, and a bridge. `attempts/v1-a2/check.txt` reports 2/3 labels, one skipped and one bridge. The rejected lr alternative `v1-a3` has two bridges and one ambiguous owner. Those raw records support why a split was tried; they cannot substitute for or contaminate final-view judgment.

## Findings, classification, and ownership

### F01 — defect, medium: worker seam specificity lost

Category: semantic_fidelity. Edges e1/e2.

Pinned label regions: v1 `[32,23,13,1]`; v2 `[32,27,13,1]`. Live equivalents: v1 `[35,25,13,1]`; v2 `[35,29,13,1]`.

`task+ctrl` is understandable task/control compression, and the direction makes its incoming task role clear. However `RPC` does not retain the source fixed constraint's **gRPC** qualifier. The reverse label additionally uses **`mg` without a key** for management. Reading the generator's ledger supplies those meanings externally, but the rendered panels do not. This is localized semantic weakening, not a missing endpoint pair or a new demand for verbatim source strings.

**Skill-level correction candidate:** prioritize the source protocol and meaningful action terms over a universal 14-character label budget; allow a same-view key or another honest split. Abbreviations must remain interpretable without the generation JSON.

### F02 — defect, medium: `user proc` removes execution semantics

Category: semantic_fidelity. Edge e5.

Pinned v3 label `[12,32,9,1]`; route `[10,31,1,4]`. Live label `[15,34,9,1]`.

The source says **runs user process**. A directed arrow plus `user proc` names a process but does not establish *running* rather than monitoring, creating, or sending data to it. The generator's statement that the arrowhead “carries the verb” is not sufficient: a head carries direction.

Rejected internals candidates `v2-a1/a2/a3` retained `runs user proc` but reported one ambiguous owner each. They demonstrate a real placement problem, not permission to erase the action. The final text is geometrically unambiguous but semantically weaker.

**Skill-level correction candidate:** preserve `runs` in the meaning ledger and treat its deletion as failure, not a successful warning fix. Split further or disclose an honest unsatisfied relation if the renderer cannot fit it.

**Renderer-level correction candidate:** reserve relation-label corridors with ownership-safe spacing so that action-bearing labels do not compete with the sibling branch. This is suggested by frozen executed attempts, not inferred from current source code.

### F03 — defect, medium: daemon seam loses its filesystem qualifier

Category: semantic_fidelity. Edge e8.

Pinned v2 label `[32,23,13,1]`; head/corridor region `[45,19,2,6]`. Live label `[35,25,13,1]`.

`HTTP over UDS` correctly distinguishes this route's transport from worker RPC routes; it does **not** identify the **filesystem** daemon interface required by the source. No filesystem label or same-view key exists in v2. Direction and transport pass, but exact interface meaning is incomplete.

**Skill-level correction candidate:** retain the interface role as well as transport; do not treat a transport-only label as a complete seam description.

### F04 — defect, high, with an executed-build capability gap: storage/orchestration hue collision

Category: conceptual_grouping_color.

Live v3 ANSI border regions:

- modal-runtime `[32,13,15,4]` and Filesystem+volumes `[52,29,20,4]`: identical `(125,160,184)`.
- Task engine `[32,21,13,4]` and Blobnet `[52,37,9,4]`: identical `(151,184,206)`.
- Container backend/Task container form a distinct pink pair `(211,134,155)` / `(226,156,175)`.

The members within each source concept have reasonable proximity. Nonetheless storage and orchestration have the **same** hue family, despite different declared groups. There is no group title, enclosing group block, or legend; the viewer can see only hue. The check's `groups:` line is not a rendered legend, and rank depth is not a conceptual grouping explanation.

The frozen skill's promise that the engine draws bordered named blocks is not supported by any final capture. This is an **advertised capability blocker/gap**, not a reason to mark the known color failure “blocked.” The rubric does not independently mandate titled rectangles, so their absence is not added as a new pass condition; the actual failure is misleading grouping.

**Renderer-level correction candidate:** make distinct declared groups distinguishable, and either implement or stop advertising named enclosures. Do not attribute prospective renderer fixes to the skill.

**Skill-level correction candidate:** capability-preflight the executed build; do not assert that a non-rendered group title or a diagnostic line makes membership visible. Do not claim geometry alone rescues a hue collision. Cross-view per-node hue stability is explicitly **not** scored as a separate gate.

### F05 — evidence gap, high: target-size ANSI and selected states missing

Category: workflow_evidence — **blocked**, not pass.

Every actual normal/selected ANSI header has region `[1,1,70,1]` and says **83×51 @100%**. Each pinned text header at the same region says **77×47 @100%**, and its preamble says `viewport: 77x47 zoom: 1.00 natural`.

The frozen metadata explicitly accepts pinned final-spec dumps as **fit proof** when pane size is larger. That correction does not manufacture target-size color or selection captures. No 77×47 normal ANSI/buffer or selected ANSI/buffer evidence exists for **any** of v1/v2/v3. The 83×51 select-all captures prove 11/11 selected node occurrences only at their actual measured size.

**Workflow correction candidate:** preserve target-size normal and selected color/buffer evidence in addition to the pinned text frames. This review did not open a new viewer to repair the gap. A validator's `PASS select_all_artifact` is not proof that the artifact is at the target size.

## Fit, borders, crossings, and motion detail

- Dedicated live ANSI normal/selected buffers decode to exactly **83 columns × 51 rows**. Manifest pane columns/rectangle are null, but the actual app header and buffer dimensions prove the live size. The noninteractive check's `viewport: unknown` is not used as fit proof.
- Pinned dumps are from the **final** specs, at 77×47 natural 100%, not rejected candidates. They show no overflow banner, clipped border, hidden declared node, obscured label, or palette overlap. v3's rightmost node border is column68 and its last graph row is38, clear of the palette at rows41–46.
- All 11 node occurrences have complete four-sided rounded borders in normal and selected live captures. Their **374 perimeter cells per state** are uniformly colored per node. Every node has its own selected border captured in the simultaneous select-all set. Zero palette-overwritten cells were found. Text-only target evidence proves glyph completeness but cannot prove target color continuity; workflow remains blocked for that reason.
- Checks report zero bridges and zero touching bends in every final view, matching visible routes. The final graphs contain **eight ordinary, separated route bends**, not eight crossings. Two intentional node fan-outs use different ports; there are no route-level trunk junctions or shared runs. The source requires independent links, not a bus.
- No route takes a conspicuous loop or doubles back unnecessarily. v2's two elbows are monotonically right/up/right or right/down/right; v3's two branches go down/left/down and down/right/down toward their child columns. No near-minimal diagnostic is emitted by this frozen build, and its absence does not create a new rubric condition.
- The source task has no motion request, expected/cases mark animation optional, and round-05 scope says dots only where the source animated. All edges explicitly set `dots:0`. All five frames at 0/100/200/300/400ms, in every view at both sizes, have **zero graph-body dot glyphs** and identical displayed payload bytes. Header middle dots are separators, not flow dots. Origin/corner/speed/arrival tests are N/A.
- Full live transcript chunks are not literally identical after frame4: frame markers differ, shell text surrounds the run, and the terminal adds a trailing blank separator. The **displayed content** is identical. Pinned frame payloads and their blank separators are identical. These boundary facts are preserved rather than misreported as motion.

## Workflow, attempt accounting, and cleanup

The generation bundle preserves **ten** raw check/status records and seven rejected compositions. All ten preserved status files say `exit=0`; rejected warnings still make those attempts unsuitable. The final three checks have zero warnings and agree with their attempt copies. All recorded spec hashes match. Diagnostic frames preserve the investigated overflow/ownership/shared-route problems. The generator's “one final attempt per view” accounting does not erase its seven earlier trials; no extra attempt-limit gate is invented from that relabeling.

All three offline validator outputs say “all checks passed.” They establish neither semantic equivalence nor target-size ANSI evidence and therefore do not override F01–F05.

Capture windows are preserved in each manifest. Pinned dump times are relative frame times only; no UTC timestamp is invented. Normal/selected live capture metadata records the actual manifest capture window, not a fabricated per-state instant.

Cleanup basis:

| Final view | Owned pane | Frozen cleanup record |
|---|---|---|
| v1 | `w7E:pGX` | manifest `confirmed_closed`; generation reports subsequent `herdr pane get` → gone |
| v2 | `w7E:pGY` | manifest `confirmed_closed`; generation reports subsequent `herdr pane get` → gone |
| v3 | `w7E:pGW` | manifest `confirmed_closed`; generation reports subsequent `herdr pane get` → gone |

The result records cleanup **done** on those primary manifest records and reported reprobes. This review created no pane, ran no live cleanup probe, and claims no independent current liveness observation.

## Unresolved blockers and next-review boundary

1. **Required evidence blocker:** missing target-size normal/selected ANSI or buffer captures in all three final views (F05).
2. **Known renderer capability gap:** the frozen build does not draw the group enclosures/titles advertised by the skill; it also produces the measured hue collision (F04). The collision is a known failed category, not a missing-evidence excuse.
3. **Not an unresolved blocker:** keeping both worker/runtime directions in one panel. Separate explicitly covered views satisfy the source constraint; rejected same-view failures do not require inventing a stricter co-location gate.
4. **No model or readable-format blocker:** the mandated DeepSeek/Sol identities are supported, the frozen binary exists and hashes correctly, and every inspected evidence format is readable.

Correction candidates above are recommendations only. No skill, renderer, spec, capture, expected data, or blind observation was changed. No new viewer sessions, installs, commits, or subagents were used. The captain must gather all eight complete case critiques before revising the skill.

## Deliverables and offline verification

- `reviewer-result.json` — seven fixed categories, eight required-edge audits, five evidence-linked findings, blockers, cleanup, 82 hashed evidence entries, and overall fail.
- `spec-manifest.json` — sorted final repository-relative spec paths and actual SHA-256 pairs; SHA-256 is used as `spec_sha256`.
- `stage-b-verification.json` — frozen input/capture/spec hash checks, ten raw status checks, static payload checks, reviewer identity, and stage-A arithmetic/count addendum.
- `observed-first.md` — unchanged blind record, saved before expected reveal.

Offline verification ran with `uv run --no-project python /tmp/viz-runtime-stageb.py`. The helper validates the result against every keyword used by the embedded frozen result schema with a standard-library validator, checks evidence references, verifies all input/artifact/spec hashes, verifies eight distinct required-edge audits, and rechecks the unchanged blind hash. The `jsonschema` package was unavailable; none was installed. The helper did not execute the renderer.
