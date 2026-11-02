# Independent Sol review — round 05 / datacenter-redundancy

## Verdict: FAIL

There are known source-tier and edge-label-owner failures. Missing workflow evidence is also blocked; it does not replace those known failures with a softer overall status. The candidate is not green.

| Fixed category | Decision | Main reason |
|---|---|---|
| `semantic_fidelity` | **fail** | Human correction 248 is not drawn: border leaves and rack leaves need a common vertical level, with both spines above them. |
| `arrow_traceability` | **fail** | The 28 independent physical links are traceable, but five required edge-label occurrences have uncertain owners. No recorded impossibility exception applies. |
| `layout_fit` | **fail** | Static graph geometry fits the pinned target; six fan bridges are justified. The required source-tier arrangement is nevertheless absent. |
| `conceptual_grouping_color` | **fail** | Conceptual hue grouping itself is reasonable, but the category also explicitly requires source-defined tiers to be respected. The same missing elevation fails that clause. |
| `border_integrity` | **pass** | All 22 node occurrences have complete ordinary and selected RGB ANSI perimeters; no palette-overwritten border cells. |
| `workflow_evidence` | **blocked** | Admitted exploratory probe panes lack preserved command/status, pane-id, pane-list, and raw cleanup records. |
| `animation` | **pass, applicable** | The human explicitly prohibited flowing dots. Every supplied capture has zero `●` glyphs. This is a verified prohibition, not an N/A motion waiver. |

Two applicable categories pass, four fail, one is blocked. There is no N/A category. Of 28 required relation audits, 23 pass and five fail label ownership. Six additional apparent-connection candidates are explicitly resolved as crossings, not extra real relations.

## Scope, identities, and evidence base

All paths in `reviewer-result.json` and this critique are repository-relative, based at `/Users/aviral/.herdr/worktrees/dotfiles/fix-visualize-skill`. The frozen executable is the one external path, `/tmp/visualize-eval/round-05/bin/rataflow-view`; its hash is represented by the result's `renderer_sha256` and repository-owned capture-time `bin.sha256` evidence files, not a fabricated repository path.

- Generator: **`viz-ds05-5`**, `fireworks/accounts/fireworks/routers/deepseek-flash-latest`, as confirmed by the captain. The latest explicit identity instruction takes precedence over the full-task template's generic worker-name pattern. `generation.json` identifies a fresh isolated DeepSeek worker but does not itself name its session tab.
- Reviewer: **`viz-judge05-datacenter`**, `openai/gpt-6.1-sol`. The actual worker name and model were checked from `PI_SUBAGENT_NAME` and `PI_MODEL`; no model was switched.
- No subagents, fixes, installations, commits, or new viewer/pane sessions were run by this reviewer.
- Only this case, its authorized source excerpts and historical variants, the frozen round inputs, and the dataset manifest were read. No unrelated historical chat or credentials were accessed. The dataset manifest lists other cases, but their case contents and reviews were not read.
- Historical assistant diagrams are context for the 28 required relations, not independent verification of a real datacenter. Human corrections 248 and 270 override their old geometry.

### Immutable blind-first record

`observed-first.md` was saved before the expectations were revealed and remains byte-for-byte unchanged:

```text
7571e62e237412f9f84fe58774de9bdd11e0dc26f7da91eccce98570f7734502
```

The evidence inventory includes its actual hash, and `observed_first.saved_before_expected_reveal` is `true`.

**Arithmetic addendum only:** the node-border table in that record totals **452** perimeter cells (156 + 160 + 136). Its prose says 448. This clerical error does not change any per-node rectangle, continuity finding, selected coverage, or category result. The blind record was not edited to apply the correction.

### Verified frozen inputs

| Input | Verified SHA-256 |
|---|---|
| Candidate skill | `ff4a9d3f32ba0bf86e54ee6bfbac02fdea3fac3b95b82a958b3411accef0a949` |
| Frozen executable | `b1ab9f2e78af11c2f2b005eea083a999079d184bf550e8d0b6d9c51867f22404` |
| Frozen rubric | `039b96252d25ad2078a539fdb1d081ebdb6c09d6f7a3487b96ffbbf3b082e292` |
| Dataset manifest | `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05` |
| Source excerpt | `a3051af3eeeec31aee53558dafbbea5d061dc74253618fd6940eba5c39b5bb98` |
| Expected relations | `926e866fbdbb3eaac5b7a21360905d1f621a7a6386139afab303e8ba7e62ed47` |
| Historical variants | `a5753817a621b846abcb4105d028dbd0d0152214495f5b225044b3882f4f34b9` |
| Sorted final-spec manifest | `82b065262467dd46367ca2d1c31c99421713b363a73be40fa55f77d66ee8e62a` |

Each final spec's actual hash matches its capture manifest and accepted attempt. All manifest-listed artifact hashes match. Each rejected draft's hash matches `attempts.json`. Comparing each refused draft to its accepted draft confirms that only `direction` changed; accepted draft bytes equal the corresponding final spec. Accepted raw check files equal the successful capture checks.

`spec-manifest.json` is a deterministic list sorted by repository-relative path, containing each final spec and its actual SHA-256. Its hash is the result's `spec_sha256`, and the manifest plus each individual spec are included in the evidence inventory.

## Source coverage and relation audit

The source requires 18 distinct identities and 28 independently drawn connections. The candidate shows 22 node occurrences because Core 1/Core 2 repeat across v1/v2 and Spine 1/Spine 2 repeat across v2/v3. No ISP identity is hidden inside an illegible compressed label.

| View | Source relations | Visible independent links | Visible graph labels | Receiving boxes with two heads |
|---|---|---:|---:|---:|
| v1, WAN/MUX/core | e1–e8 | 8 | 12: 8 node + 4 edge | 4 |
| v2, core/FW/BL/spine | e9–e20 | 12 | 20: 8 node + 12 edge | 6 |
| v3, spine/rack-leaf/rack | e21–e28 | 8 | 14: 6 node + 8 edge | 4 |
| Total | e1–e28 | **28** | **46** | **14** |

The machine-readable result contains a separate audit for every required relation, with source reference, observed endpoints, complete orthogonal route vertices, head coordinates, crossing participation, label treatment, status, finding ids, and native/pinned evidence regions. It also audits all six possible apparent bridge connections and rejects them as extra relations.

All 28 heads are intact right-facing `▶` glyphs. There are no source-to-source joins, shared independent-link runs, named buses, actual branch tees, missing arrows, or reversed audited endpoints. The generator states in `generation.json` and `generation.md` that arrows trace a physical link from the first-listed endpoint to the second-listed endpoint and do not establish one-way traffic. That satisfies the request to state the convention; no new on-pane legend requirement is invented.

The four ISP links remain unlabeled, correctly avoiding a made-up protocol. `x-connect`, `active`, `standby?`, `ECMP`, and `dual` all remain legible. `standby?` retains the standby role with a visible qualification in this explicitly historical, non-independently-verified topology; I do not count the question mark as a separate invented endpoint or protocol. The problem with some repeated labels is their visual allocation, not their spelling.

The generator's meaning ledger has incorrect e-number ranges in several prose rows. I used the actual expected relation order and the captured paths, not those erroneous range claims. The final coverage does not lose physical edges because of that bookkeeping error.

## Concrete defects

### D1 — Missing corrected physical tier arrangement

**Classification:** known semantic defect, critical; also fails the source-tier clauses of layout and conceptual grouping. **Related capability blocker:** B1.

The explicit correction in source original line 248 requires border leaves and rack leaves at the same height, with the spines above them. The candidate separates the two leaf classes into different views and puts every chain left-to-right. It provides no fabric view that demonstrates that corrected relationship.

Native observations:

- v2 BL 1/BL 2 boxes: [47,19,6,5] and [47,29,6,5]. Spine boxes are to their right at column 65, not above both leaf classes.
- v3 Spine 1/Spine 2: [20,19,9,5] and [20,29,9,5]. Leaf 1/Leaf 2: [38,19,8,5] and [38,29,8,5]. Corresponding row centers are equal; the spines are left of, not above, the leaves.
- Evidence regions: `text-v2` [47,19,27,15], `text-v3` [20,19,26,15]. Pinned equivalents subtract (3,2).

All concepts and physical links existing elsewhere does not draw this required tier fact. A ledger entry saying it was dropped is an honest disclosure, not a pass. The frozen engine's top-down failures explain the compromise but do not waive a human correction.

Conceptual hue assignment itself is not the failure: named source concepts have related hues and are near their peers. The fixed `conceptual_grouping_color` criterion also requires source-defined tiers to be respected, so D1 fails that category too. This is one defect contributing to multiple category decisions, not three independent defects.

### D2 — Two middle `x-connect` labels lack distinct owners

**Classification:** medium arrow/label-owner defect, e6 and e7.

Both labels occupy the same outside flank of the ascending diagonal:

- `text-v1` [40,21,9,1] and [40,28,9,1].
- The ascending MUX 2 → Core 1 route runs at column 49. The descending MUX 1 → Core 2 route runs at column 51.
- Both strings end at column 48. Neither provides a clear attachment to the right-hand route.

Both routes are followable, but the reader cannot uniquely assign the two repeated occurrences one per edge. A common word on both edges is not an exception to the owner rule. The generator recorded zero ambiguity and did not establish that no unambiguous position existed. There is visible unused space on the other flank of the middle corridors; this is not a documented impossibility case.

### D3 — `active` locally appears owned by the standby bend

**Classification:** high role-bearing label-owner defect, primarily e13; competing visual owner e16.

- `text-v2` label [36,29,6,1] ends at column 41.
- The next cell, (42,29), is the standby FW2 → BL 2 route's ordinary `╰` corner.
- The intended solid FW1 → BL 1 rising route is farther away, in column 44.
- Combined evidence region: `text-v2` [36,29,10,2], pinned [33,27,10,2].

The immediate adjacency is a stronger cue for the wrong role-bearing route. This fails e13's label-owner audit even though its solid line can still be followed. e16 retains its own clearly placed `standby?` text and separately traceable physical route, so its endpoint/own-label audit passes with a caveat rather than inventing a missing standby link.

### D4 — Two middle `ECMP` labels lack a one-to-one allocation

**Classification:** medium arrow/label-owner defect, e17 and e20.

- `text-v2` [55,23,4,1] and [54,29,4,1].
- Both labels lie to the left of the rising BL 2 → Spine 2 corridor at column 60.
- The other diagonal is column 62. The row-23 label sits beside the bridge-bearing horizontal segment; the row-29 label sits beside the same route's vertical run.

The first occurrence could also be read as being below the outgoing upper route. That competing reading is precisely the ambiguity: the reader is choosing a plausible label assignment, rather than seeing an explicit owner. The generator's clean-check claim provides no documented unavoidable-placement exception. By contrast, v3 places its middle `ECMP` and `dual` labels on opposite outer flanks, and their owners read clearly.

**Total uncertain owner occurrences: five** — two `x-connect`, one `active`, two `ECMP`. The `standby?` and `dual` strings themselves have readable owners.

## Six bridges / six touching bends

**Classification:** justified local fan crossings, not six avoidable-crossing defects. Touching bends alone are not additional crossings.

| View | Bridge, native | Crossing pair | Adjacent opposing bends, native |
|---|---|---|---|
| v1 | (51,19) | e7 over e6 | (51,18) `╮` / (52,18) `╭` |
| v2 | (26,23) | e12 over e9 | (26,22) `╮` / (27,22) `╭` |
| v2 | (44,29) | e16 over e13 | (44,30) `╯` / (45,30) `╰` |
| v2 | (62,23) | e20 over e17 | (62,22) `╮` / (63,22) `╭` |
| v3 | (35,23) | e23 over e22 | (35,22) `╮` / (36,22) `╭` |
| v3 | (53,23) | e28 over e25 | (53,22) `╮` / (54,22) `╭` |

Each adjacent 2-by-2 fan preserves all four required links between two source boxes and two target boxes. With the displayed fixed local left-to-right corridor and port order, its cross-row links exchange vertical order and need one crossing. There is exactly one such crossing per fan: 1 + 3 + 2. No pair crosses twice and there is no self-crossing.

This is a minimum for the displayed local layered arrangement, **not** a claim that K2,2 is a nonplanar graph. Exterior routes or a more expressive layout could remove a bridge, but that is not an evidenced shorter obstacle-safe alternative in this frozen arrangement. Reordering source groups, merging relations, reversing endpoints, or deleting labels is not an admissible crossing improvement. No such shortcut is credited here.

The preserved top-down attempts are genuine evidence:

- `checks/v1-a1-tb-check.txt`: refused `mux2 -> core1`.
- `checks/v2-a1-tb-check.txt`: refused `core2 -> fw2`, `fw1 -> bl1`, `bl2 -> sp2`.
- `checks/v3-a1-tb-check.txt`: refused `sp2 -> leaf1`, `leaf2 -> rack2`.

Each has exit 1 recorded in `attempts.json`. Only `direction` changed before the corresponding lr attempt succeeded. This supports the reported limitation of these frozen drafts and the lr workaround. It is not an exhaustive proof that every conceivable future split or renderer could never draw the required arrangement.

The bridge convention distinguishes crossings from connections. The nearby rounded bends are crowded but not actually tee junctions. All six apparent connection candidates are explicitly audited as non-relations. There is no source-named bus to preserve in this case, and none is drawn.

### Route economy

All observed route chains are monotone in each coordinate between their endpoints. Some cross-row routes have four bends rather than two, but do not backtrack in distance. There is no conspicuous loop or avoidable length detour in the captured paths. The long v1 diagonals reflect the vertical separation of their endpoints.

The frozen build prints no `routes: N/M near-minimal` line. The frozen metadata specifically records that this diagnostic was removed from the build and from the pre-generation validator requirement. I do not convert its absence into a new unsupported feature or an automatic route-economy failure; direct route tracing remains the evidence.

## Dashed standby limitation

**Classification:** observed renderer-style capability limitation; not a separate missing-link failure or evidence gap about what the reader sees. The source did not demand that every rounded corner itself use a special dashed glyph, so I do not add that as an eighth rubric gate.

All four standby connections have clearly broken `╌`/`╎` straight runs and literal `standby?` labels. The two bent links have eight ordinary, solid-looking corners:

- e12: (24,30), (24,23), (27,23), (27,22).
- e16: (42,22), (42,29), (45,29), (45,30).

Their bridge cells at (26,23) and (44,29) are ordinary `⌒`. ANSI shows the same RGB (124,111,100) used on solid route segments, without a differentiating dash attribute on these glyphs. In particular, e12's final `╭▶` and e16's final `╰▶` have no dashed straight cell. The final approach looks solid if examined alone. Long broken segments and the owned standby text retain the role overall.

This limitation compounds D3's misleading active-label adjacency, but does not justify pretending the actual standby paths are absent or merged. The result records it as B4. Uniform dashed appearance through bends would need renderer work, not a speculative JSON field. A source-backed standby node role or visible legend would be a candidate presentation improvement; this review did not apply one.

## Borders, selected states, and conceptual colors

**Classification:** demonstrated pass for border integrity; no palette-overwrite defect.

All 22 occurrences have complete four-sided, four-corner borders. Every ordinary perimeter has one foreground RGB and background RGB (40,40,40), with no foreground outlier. All 452 perimeter cells were counted from the actual per-node rectangles.

Selected ANSI stills prove 8/8 v1, 8/8 v2, and 6/6 v3 perimeters in bold RGB (216,166,87), with no overwritten palette cells. This is valid all-selected coverage; it is not a claim to have observed 22 independent interactive selections or drag-handle operations.

The pinned v1 lowest ISP border is at row 41 and columns 19–25. The toolbar also begins at row 41 but occupies columns 2–10. They do not overlap. Pinned v2 and v3 boxes likewise avoid the toolbar. No corner or side is hidden by UI.

Teal is reused for firewall/spine groups in v2 and for spine/rack-leaf groups in v3. Those are related source network concepts; the fixed rubric does not require every source group to have a globally unique hue. BL 1's ordinary color matches the selection hue, but selection also adds bold. These are palette limitations, not proof of a border repaint or an independent source-grouping failure. Cross-view per-node hue stability is not added as a gate.

The spine-number ordering changes between v2 and v3. The source fixes tiers, not an explicit top-to-bottom numeric ordering of the two same-tier spine identities. I do not invent a separate ordering failure merely because the generator listed that change as D2.

## Target fit and animation evidence

### Dimensions and fit

Actual live panes are **83×51**, supported by the running app's header token, not by invented geometry. The manifest pane rectangle/columns are null; that missing secondary measurement does not erase the measured application header. `live_pane` is recorded as 83×51, separately from the target.

Each final spec also has a pinned direct dump with `viewport: 77x47 zoom: 1.00 natural`, five timestamped frames, and the final spec name in its header. Frozen metadata explicitly records the pre-generation acceptance of pinned final-spec dumps when live panes are larger. On that basis, `viewport.verified` is true for target render geometry; it is **not** a claim that a live pane measured 77×47.

| View | Captured check extent | Visible graph rectangle at 77×47 |
|---|---|---|
| v1 | 45×39 | [19,8,40,34] |
| v2 | 68×20 | [8,17,63,15] |
| v3 | 49×20 | [17,17,44,15] |

Every graph node, label, source stem, and arrowhead is visible at natural 100%; zero graph items are clipped or require pan/zoom. The three pinned copies in the view bundles are byte-identical to their originals under `evidence/v*-pin77/`.

Some fixed UI header strings are truncated: native v2/v3 and all three pinned headers. The exact visible text is preserved in the blind record. This does not hide a required node/edge label or lose source topology; I do not use incidental shortcut-header truncation to invent a graph fit failure. The actual layout failure remains the missing required tier arrangement.

### Zero flowing dots

**The explicit no-dots demand passes.** The source's original line 134 says to remove flowing dots, and `cases.json` plus `expected.json` mark this case's animation off.

All supplied text and ANSI capture files were scanned for `●`; every count was zero. All five native and all five pinned frame screens per view show stable graph glyphs at 0, 100, 200, 300, and 400 ms. All 28 spec links use `dots: 0`, consistent with the actual captures and checks.

No dot sits on a label, origin, corner, bridge, junction, or arrowhead, because no dot exists. Constant speed, synchronization, origin occupancy, and full-lap arrival evidence are inapplicable to these explicitly static links. The fixed workflow requirement for at least three timestamped frames on static views is met, with five per view.

## Evidence gaps and cleanup

### E1 / B2 — Exploratory probes cannot be audited

`generation.json` says that a few no-focus exploratory panes were opened to measure the viewport, that each was closed, and that a pane list showed none remained. However the bundle has no corresponding probe log, complete probe ids, raw probe commands/status outputs, verbatim close results, or preserved pane-list output. An assertion about those actions does not supply their raw records.

Rejected tb candidates are **not** missing: their specs, raw refusal text, hashes and registered exit statuses are all preserved. Final rendering commands are echoed in native frame transcripts; pinned/validator command forms are recorded in generation metadata. These successes do not supply the separate missing probe trail.

Known final capture pane ids:

- `w7E:pHR` — v1, manifest says `confirmed_closed`.
- `w7E:pHS` — v2, manifest says `confirmed_closed`.
- `w7E:pHT` — v3, manifest says `confirmed_closed`.

The result lists these known owned and closed ids. Its cleanup status is **blocked**, because the admitted additional probes are not fully inventoried or independently proved closed. No probe id or close output is fabricated. This judge opened no panes and did not run any cleanup command.

### Other limits, not silent passes

- Pinned dumps are plain text. Ordinary and selected color continuity is proved by the native ANSI stills, not by fabricated pinned RGB evidence.
- The files named `v*-frames.ansi` have no SGR color sequences inside their frame screens. They prove glyph stability, not per-frame RGB continuity. Native ordinary/selected ANSI stills do contain RGB evidence.
- Pinned absolute capture timestamps are unrecorded; their actual relative timestamps are preserved. Native capture/check windows are recorded in manifests and the evidence inventory.
- The generator reports no node-height control for original line 166. This is B3, a reported capability gap, not a demonstrated smaller-height feature. No arbitrary numerical box-height threshold or unsupported renderer gain is credited.
- No frozen renderer capability is inferred from the current source tree. The executable hash and preserved executed output, not current code, identify this sample.

These gaps are not used to make D1–D4 disappear. Known failures keep the overall verdict at fail.

## Correction candidates — no changes made

### Skill / generator / evidence procedure

1. Treat the corrected spine/leaf elevation as a required source fact, not a fact that a coverage table may drop while claiming the topology is complete. If unsupported, disclose the failed subset and capability blocker without a green claim.
2. Remove the skill's implication that engine-owned label slots and `0 ambiguous owners` automatically guarantee visible ownership. Require the critic to compare distances to competing routes. v1's two middle `x-connect` strings and v2's `active`/middle `ECMP` placements are concrete counterexamples.
3. Preserve raw logs for every exploratory probe, including its exact command, pane id, status, pane-list result and close result. The final three capture manifests alone cannot account for unnamed probes.
4. Keep the successful source-backed choices: dots explicitly off, no shared redundancy bus, all four ISP names, complete 28-edge coverage, stated physical-link arrow convention, and target-size pinned dumps with the actual live size recorded separately.
5. A shorter or extra split may improve label ownership only if it keeps all required links, qualifiers, tiers and cross-view coverage. Reordering source groups or weakening labels to reduce a check count is not an admissible repair.

### Renderer capabilities

1. Support the required common leaf level and spines-above constraint without reversing audited endpoint semantics. The three frozen tb refusals and lr compromise identify the concrete missing capability to address.
2. Reserve edge-label positions based on competing-route ownership, not only collision-free text cells. Candidate empty outer-flank positions are visible in the captures; the active label needs separation from the standby corner, not merely a clean text rectangle.
3. Consider more separation around the six opposing-bend clusters while preserving near-minimal independent routes. Do not merge them to make the drawing look simpler.
4. If uniform dashed style is needed, provide dash-aware corner/bridge/endpoint treatment or a role key that remains clear locally. Do not claim an unsupported dashed-corner field exists.
5. Expose a supported node-height control if the smaller-box request must be met directly. No current renderer improvement is credited to the candidate skill.

The captain must gather all eight complete independent critiques before revising the skill. This review neither performs a repair nor carries any earlier-round verdict into round 05.

## Deliverables and verification

- `observed-first.md` — immutable pre-reveal record; hash above, unchanged after stage B.
- `spec-manifest.json` — verified sorted three-spec manifest; SHA-256 above.
- `reviewer-result.json` — exact seven-category schema shape, actual identities, 60 hashed evidence entries, 28 required relation audits plus six apparent-connection audits, five findings, capability/evidence blockers, and cleanup record.
- `critique.md` — this explanation of the independent verdict.

The result was checked against every keyword used by the frozen embedded result schema with an offline standard-library validator: required/additional properties, references, oneOf/allOf, types, enums/constants, lengths, uniqueness, numeric minima and hash patterns. Evidence ids, spec hashes, relation counts and the blind-record hash were also checked. No package was installed to validate it.
