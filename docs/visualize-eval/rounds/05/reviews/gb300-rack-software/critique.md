# Round 05 — GB300 rack software — independent Sol critique

## Verdict: **FAIL**, with separate unresolved evidence/source blockers

The candidate is considerably easier to trace than a single dense graph: all 14 visible destination arrows can be followed, all 13 historical component identities appear across four views, and no OOB route touches DCGM. Those successes do not make it green. The explicit one-spot bus requirement is not met, several source facts/protocol qualifications disappear, and the three-node NVSwitch view retains an avoidable crossing. Target-size color/selected-state evidence is also missing.

This review applies the seven frozen categories, not the generator's self-assessment or validator results. Known failures remain failures when other evidence is blocked. No renderer, skill, spec, capture, or expectation was changed; no viewer session, installation, or subagent was run.

### Category matrix

| Category | Decision | Basis |
|---|---|---|
| Semantic fidelity | **fail** | The two-tap bus does not meet the exact split constraint; count/reach and protocol facts are lost; the exporter service role is not expressed correctly. Correct source-driven deletions are accepted. |
| Arrow traceability | **fail** | Endpoints, arrowheads, and label owners are recoverable, but `┬┴` is two attachment points, not the required one split. The gRPC route also has avoidable routing work. |
| Layout fit | **fail** | All graph geometry fits the accepted pinned 77×47 natural-zoom dumps. Nevertheless, v3 has an avoidable bridge and the split set lacks complete source coverage. |
| Conceptual grouping/color | **pass** | ANSI proves source-backed hue families; nearby target geometry and residency anchors agree. Named group blocks are not required by this fixed category. |
| Border integrity | **blocked** | All 17 normal/selected borders are complete and uniform at 83×51; no target 77×47 ANSI/selected evidence exists. Plain text cannot prove target color/state behavior. |
| Workflow evidence | **fail** | Frozen/final identities and blind-first evidence exist, but the attempts ledger has a wrong hash and the recorded abbreviation experiment is not supported by its own rejected specs. Other required evidence is separately missing. |
| Animation | **N/A** (`applicable=false`, `status=null`) | Source and frozen manifest do not require animation. Every supplied sequence is static and contains zero flow-dot glyphs. |

There are six applicable categories: one passes, four fail, and one is blocked. The JSON contains 23 audits: 15 pass, seven fail, and one is blocked. These include positive relationships, the named bus, corrected-away historical claims, and explicit non-relations; the count is not a claim that 23 arrows are drawn.

## Paths, identities, hashes, and blind-first integrity

**Path base:** all evidence inventory paths are relative to the repository root, `/Users/aviral/.herdr/worktrees/dotfiles/fix-visualize-skill`. In the remainder of this report, `B/` abbreviates `docs/visualize-eval/rounds/05/gb300-rack-software/`, and `S` means `docs/visualize-eval/cases/gb300-rack-software/source.md`. References to “original line 283,” etc., identify the excerpt headings in `S`, not physical Markdown line numbers. The actual frozen binary is outside the repository at `/tmp/visualize-eval/round-05/bin/rataflow-view`; its hash records inside `B/evidence/` are inventoried, and its bytes were independently hashed without execution.

- Generator model: `fireworks/accounts/fireworks/routers/deepseek-flash-latest`. The actual generation record names worker `viz-ds05-8`. The result uses the mandated canonical generator ID `viz-ds05-gb300-rack-software`; this is an alias, not a claim that a different worker generated the candidate.
- Actual reviewer session name: **`viz-judge05-gb300`**, obtained from `PI_SUBAGENT_NAME`; actual model `gpt-6.1-sol`, recorded with the required provider-qualified identity **`openai/gpt-6.1-sol`**. No model substitution occurred. The rubric's stale prose reference to an astra critic is superseded by its required-model field, schema, revision note, and this task's Sol requirement.
- Blind record: `docs/visualize-eval/rounds/05/reviews/gb300-rack-software/observed-first.md`.
- Blind SHA-256: **`ef87099f6cf2c1d197e9f3ee7315395d8a463b733b374389d071fc0e75266e05`**. This was saved and hashed before the reveal. It was not modified; its inventory reference has `saved_before_expected_reveal: true` through the result's `observed_first` object.
- Deterministic spec manifest: `spec-manifest.json` in this review directory; sorted list of repository-relative path/actual-SHA-256 pairs. Its SHA-256, used as `spec_sha256`, is **`e3b8cab73fd9e27d3cbfdd0a307adef75a4759629c2b147e300d4378c1a5887b`**.

Verified frozen hashes:

| Input | SHA-256 |
|---|---|
| Candidate skill | `ff4a9d3f32ba0bf86e54ee6bfbac02fdea3fac3b95b82a958b3411accef0a949` |
| Renderer binary | `b1ab9f2e78af11c2f2b005eea083a999079d184bf550e8d0b6d9c51867f22404` |
| Rubric | `039b96252d25ad2078a539fdb1d081ebdb6c09d6f7a3487b96ffbbf3b082e292` |
| Dataset manifest (`cases.json`) | `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05` |
| GB300 source | `10d440af0be8d3730c448e710a48d4dfbd527a966f532084e7f98fd2d4b83fda` |
| GB300 expected data | `9a947233493973c247544ae6e9c175b940feb9d87fc850d4693565c90042c0ab` |
| GB300 historical variants | `fd9892244406ec1b2b09ee2cc7adb2af5534ebb52ede5036664f238b776eff31` |

All four final-spec hashes agree with their manifests. All 28 per-view manifest artifact hashes match. All four pinned target-dump checksums pass `shasum -a 256 -c`. The inventory contains 80 evidence entries, including the blind record, manifest, individual final specs, frozen inputs, captures, checks, generation records, validators, attempts, and probes. Historical variants were read only to distinguish their old generated claims from later corrections; they were not used as independent fact verification. No other case captures or earlier-round judgments were read.

## Coordinates and unchanged blind observations

Unless explicitly marked otherwise, coordinates are 1-based `[column,row,width,height]` on **frame 0 of the pinned 77×47 target canvas**, excluding the leading viewport/frame metadata. The subsequent two target frames are identical. Add `(3,2)` to graph coordinates to locate the corresponding content in the 83×51 ANSI snapshots; this translation does not apply to the UI widget or title. The blind record lists every graph/UI label verbatim, every node border rectangle/color, and every arrow's stem, bends, and head.

The reveal changes the assessment against requirements, **not** those observations:

- 17 node occurrences; 14 destination arrows (11 ordinary edges plus three bus destination legs); 29 graph labels.
- No uncertain graph-label owner; no clipped graph item; two clipped UI quit hints at target width.
- One bridge, at v3 `(40,21)`; zero touching-bend connections. The adjacent lower v3 corner glyphs remain distinguishable.
- Two v1 junction glyphs, `(56,24) ┬` and `(57,24) ┴`.
- No flow-dot glyphs in any original five-frame or target three-frame sequence. Static title separators `·` are not flow dots.
- At 83×51, every perimeter of every node is complete: 17/17 selected node occurrences, 498 normal and 498 selected border cells checked, zero mismatched or palette-overwritten border cells. Normal group hues differ; selected borders are uniformly bold RGB `(216,166,87)`.
- No group block, group title, group legend, or caption is visible. The group information is hue-based.

## Findings and source-based adjudication

### F01 — **Critical defect:** the main bus splits at two spots

**Evidence:** `B/evidence/v1/v1-target-77x47-frames.txt`, `[56,24,2,1]`; `B/evidence/v1/check.txt`; blind record. Source: `S`, original line 284 (user), and fixed constraints.

The route leaves OOB LAN once, but the lower branch attaches to `┬` at column 56 and the upper branch attaches to `┴` at column 57. The straight continuation reaches NVSwitch BMC. This is a connected shared bus with three correct endpoints, so it is not three accidental overlapping independent arrows. It also is **not** one split in exactly one spot. The one-column separation is small enough to look like a compact fork, but that preserves connectivity rather than the user's expressly requested junction structure.

The generator's own check agrees: `2 branches, 2 junctions`. The raw alternatives explain the tradeoff, not an exception to the gate: the rejected top-bottom attempt has 14 bridges and a 15-cell shared run; the rejected left-right arrangement has four bridges and a five-cell shared run. A preserved alternate dump has one junction and three bridges. The permutation summary reports further failures. None demonstrates the required clean one-split rendering. An exhausted three-check budget is not proof of impossibility and does not convert the shipped two-tap view to a pass.

**Classification:** known rendered defect, primarily renderer-level trunk planning. It also violates semantic fidelity to the source-named bus. Unsupported one-hub capability in this arrangement is a remaining limitation, not permission to weaken the request.

### F02/F03 — **High defects:** protocol facts were shortened away

**F02 evidence:** v2 target `[33,27,13,1]`, exactly `Redfish shelf`; compare `[33,23,13,1]`, `Redfish/HTTPS`. Source: original line 283 southbound table.

The shelf endpoint and Redfish application protocol are clear. The HTTPS transport is not stated on that hop, nor is a visible key provided. The full expansion in `generation.json` is useful disclosure, but it is not a complete rendered label or an on-view key. The compute edge's suffix cannot silently act as a qualifier shared by the other route.

**F03 evidence:** v3 target `[30,20,9,1]`, `NVUE REST`, and all four final views. The same source table also explicitly lists **SSH/SFTP** for RMS-to-NVSwitch tray access. Those interface facts disappear everywhere. They are not a duplicate just because they share the same controller and destination class. Keeping the REST and NMX-C gRPC paths is good but incomplete.

**Classification:** skill/spec-level meaning-preservation defects. Neither narrowing is licensed by the human corrections. A label-width limit or a missing legend feature cannot turn a missing protocol into preserved coverage.

### F04 — **Medium defect:** the 18-compute-BMC fact is lost

**Evidence:** v1 target `[61,16,11,1]`, `Compute BMC`; rejected v1 specs include `Compute BMC x18`. Source: original lines 271 and 277.

A class node is a sensible abstraction; it need not be expanded into 18 individual boxes. Nevertheless, the numeric multiplicity disappears from all visible views. The source's later “three things” refers to three destination classes, not to a change from 18 compute controllers to an unspecified number. Documenting that the suffix was removed to fit explains the loss; it does not preserve the identifier/count.

**Classification:** skill/spec-level defect, not an invented reversed link.

### F05 — **Critical defect:** other stated OOB reach has no cross-view coverage

**Evidence:** v1 target `[32,15,42,20]` and the complete four-view set. Source: original lines 271/277 name the **CDU controller and PDUs** as OOB endpoints.

The main bus must remain exactly the three classes requested in original line 284. That is not an instruction to erase the other stated reach facts from every view or qualified companion. The generator's deliberate-drops ledger conflates the main bus's composition with total source coverage. A separate ancillary qualification/detail need not add a fourth or fifth branch to that main bus. There is no such visible coverage here.

**Classification:** missing source concepts/relationships, skill/spec-level. This is different from dropping an erroneous old edge.

### F06 — **Medium defect:** the exporter serving role is not faithfully assigned

**Evidence:** v4 target `[35,30,12,1]`, `serves :9400`, on DCGM → dcgm-exporter; exporter label `[48,32,13,1]`. Source: original line 277's Out row.

The source says **dcgm-exporter serves Prometheus metrics on :9400**. The candidate puts `serves :9400` on a directed arrow whose source is DCGM and target is the exporter. The port survives, but the label does not establish the source-backed server ownership; read as an action from source to target, it assigns the role to DCGM. A historical unlabeled DCGM → exporter arrow is not verification of this added verb. This is not an uncertain geometric label owner: the owner is clearly that edge; the problem is its action meaning.

**Classification:** localized skill/spec-level semantic defect. It does not invalidate the separately correct local `reads NVML` path.

### F07 — **Medium defect:** v3's bridge is avoidable without changing source tiers

**Evidence:** v3 target `[40,21,1,1]`, the `⌒` bridge; source-port/bottom-dogleg region `[40,19,3,12]`; v3 check; `B/probes/v3-lr-dump.txt`.

The bridge is clear and does not imply a connection. All three arrows can be traced. The generator's stronger claim that a rank-0-to-rank-2 edge must cross this way is not supported by the captured geometry: the NVOS-bound path leaves the **right** source port at column 42 and moves left across the NMX-bound path leaving column 40. Reversing those two exit-port assignments can keep every node in its current tier and retain both NMX target ports while avoiding that crossing. The long route currently needs a lower two-column dogleg to return to the column-42 target port as well.

This is geometric inspection of the frozen capture, **not** a new tested layout or claim of an executed fix. The left-right probe also having a bridge proves only that orientation alone did not fix the routing. It does not make the crossing obstacle-forced.

**Classification:** renderer-level port-order/routing-economy defect. It fails crossing minimization in layout and route economy for the gRPC edge. Traceability at the existing bridge remains successful.

### F08/F09 — **High evidence gaps:** target color and target selected-state coverage

**Evidence:** all four pinned target dumps versus their 83×51 ANSI/selected captures; especially target v4 Fabric Mgr `[17,39,12,4]` and 83×51 selected Fabric Mgr `[20,41,12,4]`.

The live panes actually measure **83×51**. The frozen metadata explicitly permits final-spec pinned 77×47 dumps as fit proof; I accept that correction and do not invent an additional live-target-pane requirement. All four target files name the proper final spec, state `viewport: 77x47 zoom: 1.00 natural`, and contain three static frames.

However, those dumps are **plain text**. They show full target geometry and rule out the widget replacing target border glyphs; they do not prove target color continuity or selected-state behavior. The only normal/select-all ANSI evidence is from the larger live panes. Thus 17/17 selected occurrences are proved at 83×51, but independently captured target selected coverage is **0/17**. There is no observed palette-overwrite defect to repair; the missing evidence must not be passed as if it existed.

**Classification:** workflow evidence gap and blocked target border-integrity verification, not a proven border-color defect.

### F10/F11 — **Medium workflow defects:** the preserved record contradicts two claims

**F10:** `B/attempts.json`, v2 attempt 3, declares:

`fa5c790f1c76f9a8dd390ce1df7482652c0142f3614cc60285952408cabffc42`

The actual preserved attempt spec and final spec hash to:

`fa5c790f1c76f9a8dd390ce1ed7482652c0142f3614cc60285952408cabffc42`

The final manifests and generation record have the correct hash. This is a localized attempts-ledger reproducibility error, not an unidentified final artifact. No canvas coordinate honestly represents a JSON hash error; the result cites the precise document field rather than inventing one.

**F11:** The generator says rejected v2 attempts had duplicate `Redfish/HTTPS` labels, motivating `Redfish shelf`. In fact, **both preserved rejected specs already contain `Redfish shelf`**, one `Redfish/HTTPS` label, and a third dashed `BMC path` edge. The shipped spec removes that third edge. The raw checks demonstrate ambiguity in the rejected four-node fan; they do not substantiate the claimed duplicate-label experiment or establish that dropping HTTPS was necessary. The final shortened label is at v2 target `[33,27,13,1]`.

**Classification:** known workflow defects. Removing the contradicted BMC API edge is still source-correct; the false rationale is not needed to justify that deletion.

### F12 — **High evidence gap:** incomplete raw invocation and auxiliary cleanup records

The bundle preserves eight attempt specs and check outputs, with budgets 3/3/1/1, plus probe files. Final manifests record check exit zero and timestamps. Those are real evidence. But rejected checks do not carry a per-invocation expanded command/exit-status/full-stderr record; the permutation table is a summarized count/error report, not full raw output for every probe. Generic commands containing `<view>` are not a substitute for missing raw invocations. Five additional pane closures appear only as narrative assertions, without verbatim close/probe results.

**Classification:** missing workflow evidence. I do not infer nonzero exits, leaked panes, or malicious fabrication from missing records. Since F10/F11 are already known workflow failures, this gap does not downgrade that category to “merely blocked.”

### F13 — **Source blocker:** the dashed driver → Fabric Manager relationship remains unverified

**Evidence:** v4 target `[18,35,13,4]`: three `╎` strokes, a complete downward `▼`, and `unconfirmed`. Source: fixed constraints and the historical-relations caveat.

This is an honest uncertainty marker, not an invented `deploys`/`manages` dependency. The authorized excerpts nevertheless do not establish a positive Driver+CUDA → Fabric Mgr interface fact. The edge audit is **blocked**, not source-verified pass and not a proven false-dependency defect. Its geometry and uncertainty can pass while the relationship's fact verification cannot. More viewer captures would not resolve missing source authority.

## Accepted omissions and successful corrections

These are not defects and must not be “repaired” by restoring old generated mistakes:

| Deliberate omission / correction | Ruling and source basis |
|---|---|
| Historical `oob → nvos` | **Accepted.** It is an unlabeled generated relation, not an independent fact. Original line 283's nuanced control path and line 284's explicit three-class bus take precedence. RMS → NVOS appears separately with REST. |
| Direct `rms → NVSwitch BMC` API edge | **Accepted.** Original line 283's own final nuance says through NVOS, not the NVSwitch BMC. Its earlier generalized direct-edge sentence does not override that correction. The BMC remains a physical OOB endpoint. |
| Mission Control/UFM/NetQ/BCM and entitlement-gated NGC images | **Required exclusion, satisfied.** No paid-only component is drawn. The candidate does not claim gated images are free. The free-source RMS caveat is recorded in its ledger; lack of an NGC node is not a missing-concept defect. |
| OOB → DCGM | **Correctly absent.** The in-band chain is in a separate view and no route artifact joins the chains. |
| Device-to-device BMC/power links | **Correctly absent.** They share wire/controller, not peer communication edges. |
| Slurm and training/storage fabric nodes | **Accepted.** The source excludes Slurm as adding no distinct edge; drawing a new training topology from negative OOB qualifications would invent relationships. |

The **18-BMC count, CDU/PDU reach, and SSH/SFTP mechanisms are not in this accepted-deletion set**. They are positive facts rather than corrected-away claims. The record's transparent “dropped” annotations do not satisfy the coverage gate.

The following facets pass their directed audits: RMS as OOB client; all three physical destination directions; RMS → Compute BMC `Redfish/HTTPS`; RMS → NVOS REST as one interface facet; RMS → NMX-C gRPC connectivity (though its routing economy fails); NVOS `hosts` NMX-C/T; Kubernetes `hosts` GPU Operator; Operator → DCGM `DaemonSet`; and DCGM → driver `reads NVML`. The result preserves separate semantics, traceability, and route-quality decisions rather than declaring every edge perfect because a path can be followed.

## Grouping, residency, and unsupported group blocks

The source-backed group families are directly visible in 83×51 ANSI: management blue; hardware orange-family shades; NVSwitch software pink; in-band Kubernetes/Operator pink; compute-host software teal. OOB plant has its own teal shade in its own view. The fixed rubric does not require different concepts in different views to have globally unique colors, nor does it require identical per-node hue across views. No new color gate is added.

Related nodes are near one another, and `NVOS (tray)`, `DCGM (host)`, the management labels, and the `hosts` edge anchor the residency interpretation. Nothing labels driver/CUDA as residing on the GPU die. The absent group blocks/titles are a **renderer capability limitation and a false capability promise in frozen skill Step 7**, not by themselves a failure of the actual grouping criterion. Plain-text-only readers receive less residency context than ANSI readers. Target color/state incompleteness remains explicitly recorded under border/workflow evidence, not silently waived by this grouping pass.

## Fit, diagnostics, static frames, and cleanup

| View | Tight target graph rectangle | Recorded check extent | Bridges / touching bends | Measured live pane |
|---|---|---|---|---|
| v1 | `[4,15,70,20]` | 74×24 | 0 / 0 | 83×51 |
| v2 | `[18,18,43,14]` | 48×19 | 0 / 0 | 83×51 |
| v3 | `[24,15,30,20]` | 34×24 | 1 / 0 | 83×51 |
| v4 | `[17,7,45,36]` | 49×40 | 0 / 0 | 83×51 |

At target width the v3 UI title ends `q qu`, and v4 ends `q`; these are two clipped quit hints, not clipped software labels. I record them without making UI-hint completeness an invented independent gate. Every graph box, label, complete route, and arrowhead fits. The target control widget `[2,41,9,6]` does not overlap Fabric Mgr `[17,39,12,4]`.

Every final check has zero skipped/on-route/ambiguous labels and zero dot violations. There is no `routes: N/M near-minimal` line. The blind record correctly noted its absence; the revealed frozen metadata explains that the binary no longer emits it and the validator was changed before generation. I therefore do **not** create a new missing-diagnostic blocker. Visual route economy is still judged, and the v3 defect does not depend on that absent line.

Each original sequence has five frames at 0–400 ms; each pinned target sequence has three at 0–200 ms. All are static. The source does not require motion, so no full-cycle animation test is applicable, and `0/0` origins/arrivals must not be counted as successful animation evidence.

Final capture records:

| View | Pane ID | Check exit | Capture window, UTC | Manifest cleanup |
|---|---|---:|---|---|
| v1 | `w7E:pH1` | 0 | 2026-11-02 15:58:45–15:58:49 | `confirmed_closed` |
| v2 | `w7E:pH3` | 0 | 2026-11-02 15:58:55–15:58:59 | `confirmed_closed` |
| v3 | `w7E:pH4` | 0 | 2026-11-02 15:58:59–15:59:03 | `confirmed_closed` |
| v4 | `w7E:pH5` | 0 | 2026-11-02 15:59:04–15:59:08 | `confirmed_closed` |

The generator additionally reports closing `w7E:pFX`, `w7E:pG2`, `w7E:pG3`, `w7E:pG5`, and `w7E:pG6`. No preserved verbatim close results support these auxiliary claims. The JSON lists all nine known IDs, credits the four manifest-confirmed closures, and leaves **complete cleanup verification blocked**. It does not assert the other five are still open. The judge owned no viewer panes.

## Correction candidates — proposals only, no changes made

### Skill / generator / evidence harness

1. Treat each positive source fact's fate as a coverage obligation. “Dropped with a reason” is not a waiver. Distinguish retracting an erroneous historical relation from losing counts, ancillary reach, or protocol mechanisms to meet a layout budget.
2. Qualify the actual hop: preserve HTTPS for the shelf and SSH/SFTP for NVOS, and identify the exporter as the :9400 server. If a key or companion explanation is necessary, it must be visible/delivered and source-cited, not merely hidden in an eval ledger.
3. Correct the group-block capability promise and preflight the exact one-hub bus requirement. If the frozen renderer cannot meet it within permitted arrangements, stop with a precise limitation rather than calling adjacent taps an exact split.
4. Capture target normal ANSI plus target select-all ANSI/buffer for every final view. Preserve the actual viewport separately from the live pane dimensions; retain at least three timestamped frames even for static views.
5. Preserve expanded commands, stdout/stderr/status and cleanup results per invocation. Derive hashes directly rather than transcribing them. Keep explanations consistent with the actual rejected specs.
6. Keep unknown historical interface claims explicitly blocked until source verification is available; do not turn a dashed placeholder into a verified dependency.

### Frozen renderer / layout engine

1. Add or enforce a true one-location three-destination hub without silently falling back to per-branch taps when that would violate the source. Reuse the preserved failed and alternative specs as future tests, not as proof that the current candidate passed.
2. Choose source/target port order to avoid avoidable edge swaps, and remove non-obstacle-forced doglegs. The v3 triangle is a concrete regression fixture; fixing it must not reorder source tiers or discard an interface.
3. Named group/title/legend support would close the gap between the skill's promise and actual output and help preserve qualifications. It is a capability proposal, not a new rubric requirement for every graph.

Any future renderer change needs its own frozen executed evidence; improvements cannot be attributed to this unchanged skill candidate. The captain must collect all eight full critiques before revising the skill again.

## Deliverables and verification

- `observed-first.md`: unchanged, saved before reveal, hash verified above.
- `spec-manifest.json`: deterministic sorted final-spec path/hash list; all four specs inventoried individually.
- `reviewer-result.json`: all seven category keys, 23 edge/constraint audits, 13 classified findings, blockers, cleanup, and 80 hashed evidence entries.
- `critique.md`: this report.

The result was checked against every keyword used by the embedded result schema with a local standard-library validator (`type`, `required`, `additionalProperties`, `$ref`, `allOf`, `oneOf`, `const`, `enum`, bounds, uniqueness, and patterns). Evidence IDs and finding references were cross-checked. No validation dependency was installed. Hashes were compared with frozen metadata; the immutable blind record was rechecked unchanged. Validator passes in the candidate bundle were inspected, not substituted for visual judgment.
