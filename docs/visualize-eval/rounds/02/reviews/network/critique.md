# Network — round 02 independent full review

## Verdict: FAIL

Two categories fail: **semantic_fidelity** and **animation**. Five pass. The final graph has all six required concepts and all seven required endpoint pairs, but the `session` label cannot be assigned uniquely from the capture. Three short animated routes repeat a two-position cycle every 200 ms instead of communicating slow directed traffic. Zero illegal dot positions does not establish readable animation.

This review is specific to the frozen round-02 renderer and candidate. No earlier-round score or renderer output was used. Generator: `viz-ds02-network`, `fireworks/accounts/fireworks/routers/deepseek-flash-latest`; reviewer: `viz-judge02-network`, `openai/gpt-6.1-sol`. Metadata explains the generator tab's original cosmetic name `viz-ds02-undefined-2`. The rubric's workflow prose retains an old Astra name; its required model, result schema, metadata and stage-B contract explicitly require Sol, which is the reviewer used here.

All evidence paths in `reviewer-result.json` and this report are relative to the repository root. Locations are 1-based `[column,row,width,height]`. For timestamped evidence entries, locations address the named frame's 77×47 viewport, not the surrounding shell transcript.

## Frozen blind record and verified identities

`observed-first.md` was saved before expectations were revealed. Its SHA-256 remains:

`34635aebb6fa253a585280dd95364320b3f1f2ad9650a237c279420ef6b6d4e8`

It was not edited during stage B. The deterministic `spec-manifest.json` contains only the final v1/v2 specs, sorted by repository-relative path. Its SHA-256, used as `spec_sha256`, is:

`62fded1cd6c2da97d0068800604f475d4285fc59084831329747d6f5a9fd996e`

`hash-verification.json` records 41 successful comparisons covering the immutable blind record, candidate skill, actual frozen binary bytes, rubric, dataset manifest, this case's source/expectations, frozen harness hashes, all three capture bundles' artifact bindings, preserved attempt specs and final specs. The binary was hashed, not run. Candidate/binary/rubric/dataset identities in the result come from frozen metadata and match actual bytes. The archived pre-split manifest points at a filename subsequently revised; its captured spec hash correctly matches `attempts/v1-attempt2-allinone.json`. This is documented provenance, not an extra final view or a missing final spec.

## Seven-category decisions

| Category | Status | Decision |
|---|---|---|
| semantic_fidelity | **fail** | Every concept, speed string and endpoint pair appears, but `session` has two plausible visual owners. Required labeled relation e5 is not securely communicated. |
| arrow_traceability | **pass** | All seven independent strokes have unique stems and arrowheads. No route crossing, bridge, shared run, fake branch or actual route junction. The adjacent bend pair does not connect. |
| layout_fit | **pass** | Both final app viewports are 77×47 at natural 100%; all boxes and full strings are visible without pan, zoom or control-panel occlusion. Geometric cross-view coverage is complete. Label ownership fails semantics, not clipping. |
| conceptual_grouping_color | **pass** | WAN/Firewall are nearby amber-family boundary concepts; Redis/DB are adjacent related teal-family state concepts in the application view. Web is separate. No per-node cross-view hue-stability condition is imposed. |
| border_integrity | **pass** | Normal and selected ANSI proves complete, color-continuous perimeters for 8/8 node occurrences, including every corner. Select-all covers 8/8 selected borders. |
| workflow_evidence | **pass** | Frozen input/binary/spec/artifact hashes, separate named generator/judge, blind-first record, commands, check output/exit records, final text/ANSI/selection/motion captures and cleanup records are preserved. The frozen pane-column lookup limitation is disclosed, not hidden. |
| animation | **fail** | One dot per route is sparse and no dot covers a forbidden cell, but e1/e2/e5 cycle through two cells every 200 ms; the sampled result alternates rather than showing slow, legible directed travel. |

### Fit and pane-measurement qualification

Both normal and selected ANSI arrays measure 77 columns × 47 rows; each final frame's title says `77x47 @100%`. Both captured startup transcripts contain `viewport: 77x47 zoom: 1.00 natural`. v1 graph bounds are columns 21–56, rows 11–38; v2 bounds are columns 28–50, rows 19–30. All graph content clears the control panel at `[2,41,9,6]`.

The manifests separately report `pane_rows: 47`, `pane_cols: null`, `pane_rect: null`; **an independent Herdr rectangle is unavailable**, so `live_pane` is null in the result rather than inventing 77 columns for that field. Frozen round-02 metadata explicitly identifies this focused-tab lookup defect and accepts the app viewport token/startup line as measured size authority. Fit passes on that authority plus the capture arrays, not on `--check`, whose viewport is `unknown`. This does not prove a parent-tab width or an even-split ratio from a saved rectangle. The recorded command uses `--ratio 0.5`; the missing independent rectangle remains an evidence limitation, not an unsupported graph-rendering capability or a waived clipped-item failure.

## Required-relation audit and cross-view coverage

The seven `edge_audit` entries in the JSON contain source references, stems, turns, arrowhead coordinates, directions and findings. There is no extra apparent endpoint relation needing an eighth edge audit.

| ID | Required relation | Final view | Stem → arrowhead | Outcome |
|---|---|---|---|---|
| e1 | WAN → Firewall, `1 GbE` | v1 | `[35,15]` → `[35,18]` downward | endpoint/label pass; short-cycle animation fails |
| e2 | Firewall → Core switch, `10 GbE` | v1 | `[35,23]` → `[35,26]` downward | endpoint/label pass; short-cycle animation fails |
| e3 | Core switch → Web tier, `10 GbE` | v1 | `[37,31]` → `[48,34]` down/right/down | pass |
| e4 | Core switch → Redis, `25 GbE` | v1 | `[35,31]` → `[22,34]` down/left/down | pass |
| e5 | Web tier → Redis, `session` | v2 | `[29,23]` → `[31,26]` down/right/down | **fail: required label ownership ambiguous**; short-cycle animation also fails |
| e6 | Web tier → DB tier, `queries` | v2 | `[31,23]` → `[43,26]` down/right/down | pass |
| e7 | Redis → DB tier, `fill` | v2 | `[37,28]` → `[41,28]` rightward | pass; short three-cell animation loop noted |

The split itself loses **no node or directed endpoint pair**: e1–e4 are in v1, e5–e7 in v2, exactly once each. Web tier and Redis occur in both views and are the joins for the end-to-end chain. WAN → Firewall → Core switch → Web tier → DB tier and the distinct core-to-Redis and web-to-Redis relations can be followed across the two views. No source bus exists, so independent arrows are correct; no dashed uncertainty styling is requested. Unused trunk/dashed schema capabilities earn no credit and create no failure.

The generator's coverage map is explicit, and the captures independently confirm all endpoint pairs. Nevertheless **complete readable labeled-relation coverage does not pass**: e5's `session` meaning is not uniquely attached. This distinction is why the split is not condemned merely for using two views, yet the case is not certified semantically complete.

## Explicit settlement of the three disputed points

### 1. `session` owner: still ambiguous after reveal — F1, high severity

In `evidence/v2/v2-text.txt`, `session` occupies `[33,25,7,1]`. The expected owner is e5, Web tier → Redis. That route's final bend is `[31,25]`, with an intervening blank `[32,25]`. However e6, Web tier → DB tier, runs horizontally directly above the entire word on row 24. The word can naturally read as an additional label under e6. `queries` at `[34,23,7,1]` is clearly over e6, but a second nearby label on the other side of a line is not inherently impossible. Only the expected data/spec tells the reader conclusively that `session` must label the short left-hand route.

The blind record already identified this uncertainty. The reveal establishes the intended owner, not a new visual separator. **Do not retroactively mark the capture unambiguous.** The endpoint stroke itself remains followable, so this is a labeled-meaning failure rather than an untraceable-arrow failure. It is high, not critical: the underlying endpoint relation is present, but reliable attribution of a required label is lost.

### 2. Adjacent cross-route bends: close but not a fake junction

In v2, `╰` at `[31,24]` belongs to e6, and `╮` at `[31,25]` belongs to e5. They occupy one vertically adjacent pair, region `[31,24,1,2]`. Their openings face away from each other: the upper bend joins above/right, the lower left/below. No connecting vertical stroke joins the pair, and there is no junction glyph. Both arrows can be traced from their distinct source ports to their distinct arrowheads. Therefore **arrow_traceability passes**; adjacency alone is not a new rubric prohibition. The crowding helps explain F1 but is not counted as a second independent defect or an invented branch.

### 3. Two-view coverage: topologically complete, semantically incomplete for one label

All seven required relations have their correct visible endpoint pairs and arrowhead directions, including both independent Redis inputs. Every full label string is visible. e5's ownership failure means the statement “every required labeled relation is completely readable” is false. No relation was silently dropped to make the split fit. No requirement demands one frame containing the entire graph, so the generator's reported single-frame difficulty is **not a required capability blocker**.

## Animation findings — F2, medium severity

The evidence contains five actual-render frames per final view at 0, 100, 200, 300 and 400 ms. Every route has exactly one dot in every frame: 35 route/frame observations. Illegal corner/bridge/junction/arrowhead occupancy is zero. That agrees with the blind scorecard's narrowly defined zero dot violations; it does not imply the animation category passes its directional/slow-motion requirements.

- **e1:** `[35,16]`, `[35,17]`, `[35,16]`, `[35,17]`, `[35,16]`.
- **e2:** `[35,24]`, `[35,25]`, `[35,24]`, `[35,25]`, `[35,24]`.
- **e5:** `[29,24]`, `[30,25]`, `[29,24]`, `[30,25]`, `[29,24]`.

Each two-position sequence repeats every 200 ms, with a sampled return toward the source every other step. A cyclic reset is not an invented reverse network relation, but on these tiny routes it occupies half the visible transitions and reads as rapid alternation, not slow traffic flowing along a line. This is a known sampled quality failure, not a claim about unseen sub-frame behavior.

The longer v1 fan-out routes progress outward one straight cell per 100 ms after skipping a corner. v2 e6 advances right one cell per 100 ms. e7 advances across `[38,28]`, `[39,28]`, `[40,28]`, then resets at 300 ms; the dot remains before, not on, arrowhead `[41,28]`. These longer/three-cell samples do not repair the failed required short routes. No transit speed is interpreted as a physical link-speed measurement: 1/10/25 GbE stay visible as text, and uniform intended `flow` does not replace the measured motion audit.

The timestamped diagram blocks in `*-frames.ansi` do not retain foreground-color SGR on diagram cells, despite ANSI in surrounding shell text. Static normal/selected ANSI therefore proves colors; timestamped text proves positions/cadence. Motion-frame color continuity and full traversal of long paths remain unproved, but the known animation failure already controls this category. No false claim of color-per-frame proof is made.

## Borders, groups and non-defects

All eight node perimeters are intact and color-continuous in normal and selected states. Selected-state evidence is simultaneous select-all, not eight separate individual-focus sessions. Normal WAN and v2 Web tier have the selection hue without bold; select-all makes all perimeter cells bold. This is visible state evidence, not a claim about untested drag handles.

Related WAN/Firewall borders are `(216,166,87)` and `(228,184,111)` in v1. Related Redis/DB borders are `(125,174,163)` and `(147,194,183)` in v2, and those two boxes sit adjacent. These are actual source-role groupings, not grouping inferred from row depth. A Redis occurrence changes hue family between the two views; **that is not a failure under the frozen grouping rule**, which does not require global node hue stability.

`fill` at `[37,27,4,1]` directly abuts Redis's top-right border cell `[36,27]`, with the edge directly below. It remains legible and has a readable owner. This is not fused text, a broken border or a separate failed category. Empty space in the small application view and the choice to put Redis left of Web tier in v1 are likewise not frozen-rubric violations.

## Workflow, limitations and cleanup

`generation.json`, `attempts.json`, final manifests, saved check output and validator transcripts record exact absolute-binary commands, per-view capture windows, zero check exit codes and the rejected attempts. A clean validator does not overrule F1/F2. Hash bindings were independently recomputed. The original all-in-one attempt is retained but not substituted for final evidence. The frozen bundle supports reproducible input identity; current renderer/skill source was not treated as evidence that any unobserved feature worked.

Cleanup records cover `w7E:p6X` (archived pre-split), `w7E:p73` (v1), and `w7E:p77` (v2). Each manifest records `confirmed_closed`; generation records the final owning tab returning to its sole agent pane. The reviewer opened no panes and ran no new rendering. This reports the preserved cleanup evidence, not a new live cleanup probe.

**Unresolved mandatory renderer capability blockers: none established.** The case is fail, not green or merely blocked. The missing independent pane rectangle and missing colored motion cells are evidence limitations; neither proves the renderer cannot satisfy a required graph feature. A single all-in-one view is not mandatory. The observed label-placement and short-route-motion problems are renderer-level correction candidates, not proof that no legal spec could avoid them.

## Correction candidates, not changes performed

### Skill-level

- Require the blind label-owner audit to succeed before accepting a split; copying the intended owner into a ledger is not enough. In particular, inspect labels located between parallel or stacked routes, including labels below another edge's long run.
- Evaluate temporal sequences per route, not just one-dot counts or a uniform `flow` number. Flag two-cell 200 ms repeats as not demonstrating the requested slow directional motion.
- Preserve the successful explicit two-view coverage map, concept grouping and separate core/cache versus web/cache links. Do not merge those links or delete `session` to remove crowding.
- Record the pane-rectangle limitation and per-frame color limitation explicitly; do not promote machine-check success to a visual approval.

### Renderer-level

- Consider route-aware label placement that favors the owning segment and penalizes a label sitting immediately under a competing edge. Consider a leader or greater separation if placement alone cannot make ownership unique.
- Consider short-route pacing with a minimum readable traversal/repeat duration while keeping one dot and preserving arrowheads/corners. A constant nominal flow applied to two eligible cells currently produces a visibly rapid reset cycle in these captures.
- Preserve the successful separate ports, intact per-node ANSI borders and semantic hue families; adding white-space rules indiscriminately could regress fit.

### Harness-level, separate from renderer gains

- Resolve the explicit owned pane's Herdr rectangle rather than the focused tab; save both actual columns and rows.
- Preserve per-cell color codes in timestamped diagram blocks if animation-state color is to be audited.

No skill, renderer, spec, expected data, capture, or frozen blind record was changed. No install, new viewer, subagent, or commit was used. All eight complete critiques should be gathered before the captain revises the skill.
