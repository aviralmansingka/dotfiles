# gb300-rack-software — round 02 independent Stage-B critique

## Verdict: FAIL

Generator: `viz-ds02-gb300-rack-software`, model `fireworks/accounts/fireworks/routers/deepseek-flash-latest`.
Reviewer: `viz-judge02-gb300-rack-software`, model `openai/gpt-6.1-sol`.

This is a review of the executed round-02 sample, not a comparison with round 01. No earlier-round report or unrelated case source was read. No viewer, fixes, installs, subagents, or commits were used during judging.

| Fixed category | Status | Decision |
|---|---|---|
| semantic_fidelity | **fail** | Required residency owners are not visible; the directed Kubernetes proposition uses the inverse verb. Several protocol/hosting meanings also have uncertain owners. |
| arrow_traceability | **fail** | All geometric routes can be traced, including the genuine shared bus, but two split locations do not satisfy one split in exactly one spot. Four relationship-label owners remain uncertain. |
| layout_fit | **pass** | Both actual views are 77×47 at natural 100%; all displayed boxes, labels and arrowheads fit. No clipping, palette occlusion, pan or zoom is needed. |
| conceptual_grouping_color | **pass** | Related concepts have related hue families and source-consistent proximity. No cross-view hue-stability gate is added. |
| border_integrity | **pass** | Complete, color-continuous normal and selected perimeters are proven for 13/13 node occurrences. |
| workflow_evidence | **blocked** | Final-view provenance and capture closure records are present and hashes verify. Raw rejected-check logs and probe-pane closure/probe records are not retained. |
| animation | **N/A** | Source-backed optional, not requested. The unrequested motion does not obscure labels or arrows. One animated route is stationary and is not credited as demonstrated flow. |

Aggregation is **fail** because known semantic and arrow-category failures remain, regardless of workflow evidence gaps. Three applicable categories pass; two fail; one is blocked. Animation N/A contributes no pass.

## Evidence base and verified hashes

All paths in `reviewer-result.json` are **repository-relative**, based at this checkout. Capture evidence IDs `v1-*` and `v2-*` resolve to `docs/visualize-eval/rounds/02/gb300-rack-software/evidence/<view>/`. Regions are 1-based `[column,row,width,height]`, including the status bar at row 1. Coordinates in this critique refer to the 47-row diagram grid, not shell-transcript line numbers. Motion points are relative to the explicitly timestamped frame in the saved transcript.

The full frozen contract, rubric including its result schema, metadata, dataset manifest, this case's source/expected files, final and rejected specs, generation/attempt records, both capture manifests, checks, validators, and the frozen capture script were read. The previously read actual normal, selected, and timestamped captures remain the visual authority. Generator ledgers, clean checks and validator success are not visual proof.

| Input | Actual verified SHA-256 |
|---|---|
| Frozen candidate `docs/visualize-eval/rounds/02/SKILL.md` | `7d1ff098d3ff460046e794c29925482ffd0ccb8c6fa493bc390758d976b75d70` |
| Retained executed binary `/tmp/visualize-eval/round-02/bin/rataflow-view` | `ee085c0f3a82e9b7d516cde7532f394864b3490c99691cd7ac5b2d36d640e8ea` |
| Frozen rubric | `555e3b1d5881449b79eb1dc1d9538df2c4fe0880aa850becbf9060c1bf42f86f` |
| Dataset `docs/visualize-eval/cases.json` | `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05` |
| This case `source.md` | `10d440af0be8d3730c448e710a48d4dfbd527a966f532084e7f98fd2d4b83fda` |
| This case `expected.json` | `9a947233493973c247544ae6e9c175b940feb9d87fc850d4693565c90042c0ab` |
| Final `v1.json` | `d459325771c09e7402acb88a3c6c670d537c813b4d016962a04e3aaf28c7a04d` |
| Final `v2.json` | `e645856239d27a20b4ffe8c55b12c2dab360ac45454b5af0812eb5ebc4f9a083` |
| Deterministic `spec-manifest.json` | `ec75e75b6dde000a0ce85aab3f9b170631c65baa11114b835ec73969dce2b87a` |
| Immutable `observed-first.md` | `fd99fedc3d00e31a9336006c3c744881ba3c61eb24e727ea619c1ff14d783c38` |

The spec manifest contains sorted repository-relative final-spec path/hash pairs. Its digest is `spec_sha256`; it is not a concatenation of spec hashes. Every manifest-listed capture artifact and every attempt-spec hash also matched its recorded digest. All evidence inventory hashes were computed from actual bytes. The frozen capture, validator and aggregation script hashes matched metadata; these scripts were not executed to produce new diagram evidence.

The blind file was saved and hashed before expectations were revealed, and its exact bytes remain unchanged. `saved_before_expected_reveal` is therefore true. The frozen rubric's prose contains an obsolete Astra reviewer name; its required-model field, round-02 metadata, and the explicit stage contracts require Sol. This review uses Sol. Metadata also explains the initial `viz-ds02-undefined-8` tab-label bug; the corrected case-specific worker identity is used without inventing another generator.

## 1. Semantic fidelity — fail

### What the captures preserve

All 13 named reference nodes appear, once each across the two final views. The paid-software exclusions hold: there is no Mission Control, BCM, UFM, NetQ, or NGC node. Nothing advertises a gated NGC image as freely available. The source's central correction is preserved: **no OOB route reaches DCGM or crosses into the GPU Operator chain**.

Visible RMS southbound paths reach Compute BMC, Power shelf, NVOS, and NMX-C/T. The two Redfish/HTTPS labels have recoverable local owners. DCGM's driver link says `NVML read`, rather than deploys/manages, and the exporter link shows `metrics :9400`. The endpoint traces are real, not inferred from JSON.

### F1 — critical: residency is not actually shown

The task asks where the software resides, and the fixed constraints explicitly locate Driver/CUDA/DCGM/Fabric Manager on **compute hosts**, not GPU dies. Source line 277 places nv-rms on a **management node**. The live captures contain the component names but no visible management-node/off-rack owner, NVSwitch-tray owner, or compute-host owner:

- v1: `nv-rms` at [3,14,6,1]; NVOS at [38,24,4,1]; NMX-C/T at [69,33,7,1]. Full relevant graph region: [1,13,76,23].
- v2: DCGM at [29,24,4,1], Driver+CUDA at [43,32,11,1], Fabric Mgr at [26,40,10,1]. Full graph region: [23,7,32,36].

The `mgmt`, `nvsw`, and `inband` group strings are not displayed. Generation titles and claims that grouping “draws” host residency are not what the reader sees. Related hues earn the color-category pass, but they cannot identify an unnamed physical owner. This is **missing residency**, not a claim that a GPU-die box was wrongly drawn; no GPU-die box appears.

### F2 — critical: the Kubernetes edge reads backward

The captured path is **Kubernetes → GPU Operator**, from stem (26,11) to downward arrowhead (25,14), with `deployed in` [28,12,11,1]. Reading the arrow as a directed proposition says “Kubernetes deployed in GPU Operator.” The source establishes the opposite residency: GPU Operator is deployed over/in Kubernetes. The historical endpoint order need not be discarded; its label must be forward-compatible, such as “hosts.” The present verb-direction combination does not preserve label meaning. Region: `v2-text` [25,11,14,4].

### Qualified facts and scope decisions

- **Driver+CUDA ⇢ Fabric Mgr:** accepted as a qualified residency-only association. The saved ANSI visibly uses dashed `╎`/`╌` strokes and the text `co-resident`, [30,36,11,1]. This does not claim an interface, protocol, deploys, or manages dependency. It is not penalized merely because the source does not establish such an interface. The shared compute-host owner is still missing under F1.
- **Historical OOB → NVOS:** its omission is accepted. The historical unlabeled edge is not a semantic oracle; the later human correction names exactly three physical OOB destinations and the qualified source separates RMS→NVOS control from OOB→NVSwitch-BMC hardware access. This does **not** establish that NVOS is physically unreachable over an OOB network; it simply means a further direct interface claim is not required by the corrected diagram.
- **Earlier context details:** the captures omit the 18-tray count, CDU/PDU wording, switch-pair/subnet detail, and explicit local/no-network wording on NVML. These losses are not repaired by a generator ledger. However the latest human instruction names exactly three bus destinations, so I do not invent extra required bus branches to CDU/PDUs or count their absence as additional arrow failures. Compact explanatory labels/captions could preserve this context without changing the three-way split.
- **NMX hosting and protocols:** intended facts are source-backed, but intended JSON ownership cannot resolve the four placement ambiguities recorded blind. These are detailed under F4.

## 2. Arrow traceability — fail

The blind trace remains intact: **14 geometric arrow connections / arrowheads**, comprising six individual rack-control paths, three OOB bus destinations, and five in-band paths. Counting route systems instead gives twelve: six rack-control paths, one bus, five in-band paths. The result contains 22 audit entries: those physical relations, the shared trunk/source-stem audit, corrected historical/negative relations, and four explicitly alternative apparent label readings. The latter are **not four extra geometric arrows**.

### The 13 crossings are distinguishable, not automatic failures

The 13 visible `⌒` cells are at:

`(6,19), (8,19), (10,19), (11,19), (10,20), (38,20), (52,20), (6,21), (10,21), (16,21), (52,28), (69,28), (52,29)` in v1.

They are horizontal nonconnecting overpasses. All source stems and unique arrowheads remain followable when that convention is applied. The adjacent `(10,19)/(11,19)` overpasses and contacts near `(10,20)/(11,20)` and `(37,20)/(38,20)` are cramped and invite a mistaken merge at first glance, but I do not label a link untraceable merely because this bridge convention takes careful inspection. The blind file records every crossing and close contact, and the per-edge JSON audit preserves the source-to-head traces. There are no v2 crossings.

### F3 — high: one bus, but not one split

This caveat is settled explicitly:

- One source stem leaves OOB LAN at **(19,27)**.
- It bends at **(19,29)** into a single continuous horizontal bus.
- There are real `┬` branch junctions at **(22,29)** and **(40,29)**, eighteen columns apart.
- The first branch reaches Compute BMC via head **(19,31)**.
- The second reaches NVSwitch BMC via head **(34,31)**.
- The rail continues to Power shelf via head **(54,31)**.

Thus **the junctions are traceable as one shared bus, not three independent lines that happen to touch**. But the user says “split in exactly one spot”; two distinct degree-three tap points are not one three-destination split point. This fails the literal source requirement even though the shared-wire meaning is recoverable. Evidence: v1 [19,27,36,5], specifically [22,29,19,1]. A `trunks` field and clean check do not satisfy the geometry by declaration.

### F4 — high: all four uncertain label owners remain uncertain

| Label | Bounds | Competing visible owner |
|---|---|---|
| NVUE REST/SSH | [15,18,13,1] | Between the RMS→Power-shelf run at row 17 and RMS→NVOS run at row 19. |
| NMX-C gRPC | [53,19,10,1] | Directly abuts the unrelated Power-shelf vertical at column 52; intended NMX route runs below and turns at column 69. |
| hosts | [53,27,5,1] | Also abuts the Power-shelf vertical; intended NVOS→NMX route runs one row below. |
| 1/10/25G Eth | [26,28,12,1] | Immediately abuts the NVOS outgoing bend at (38,28), while the physical OOB bus is one row below. |

These placements are particularly damaging here: the source requires the reader to distinguish **physical reach**, **controller APIs**, and **software residency**. A label that can read as the wrong one of those relations does not pass because every character was placed off a route cell. None is a fused text word, and none is clipped. Their ambiguity is an ownership/meaning defect.

## 3. Layout fit — pass

The actual text/ANSI grids and selected-state grids are **77 columns × 47 rows**. Both motion transcripts retain the exact app line:

`viewport: 77x47 zoom: 1.00 natural`

The status bars also show `77x47 @100%`. v1's graph occupies columns 1–76, rows 13–35; the column-1 border is complete. v2's graph occupies columns 23–54, rows 7–42; Fabric Mgr has its full bottom border. The control palette occupies [2,41,9,6] without overlapping either graph. There are zero clipped items and zero fused labels. No pan or zoom is needed.

All thirteen reference node identities and the supported relationship endpoint pairs are covered by the split. No missing cross-view seam is disguised as a clean individual view. Missing residency text and wrong/ambiguous relationship meanings are semantic/traceability failures, not evidence of geometric clipping.

**Actual live pane rectangle is separately unknown:** both capture manifests have `pane_rect: null`, `pane_cols: null`, `pane_rows: 47`. Therefore `live_pane` is null in the schema rather than an invented 77×47 pane rectangle. Frozen metadata documents this unfocused-tab harness limitation and explicitly accepts the app viewport measurements. This limitation does not reverse the measured-fit pass.

## 4. Conceptual grouping and color — pass

The **normal ANSI**, not merely `nodes[].group`, proves related hues:

- OOB LAN and its three hardware endpoints use teal-family borders: RGB (125,174,163), (147,194,183), (99,151,141), and (168,211,200), respectively. They sit near the physical bus in the rack-control view.
- NVOS and NMX-C/T use pink-family RGB (211,134,155) and (226,156,175), in the same view with their hosting path.
- nv-rms is separately amber RGB (216,166,87), above the hardware/control destinations.
- The compact in-band chain uses related gold/amber shades across five layers, rather than assigning a different conceptual family to each geometric depth.

The group names are not displayed; this contributes to the missing **named physical residency** under F1, but there is no separate frozen color requirement for a rendered legend. I also do not impose a global cross-view hue-stability rule. In particular, similar amber hues in different views are not independently grounds for color failure.

## 5. Border integrity — pass

All **13/13 normal borders** and **13/13 selected borders** have complete sides/corners and internally continuous per-node foreground color. All selected borders are bold RGB (216,166,87). nv-rms and Kubernetes already have that foreground in their normal state, but the ANSI bold attribute distinguishes selection. Selection is captured simultaneously for all nodes; this does not prove isolated interaction sequences, dragging, or undisplayed handles. No handle state is credited because no handles are visible.

The timestamped `frames.ansi` diagram portions contain no SGR color styling. Therefore temporal color continuity is unproven, but the actual normal and selected snapshots do prove the displayed states required here. No border defect is inferred from a filename or a plain-text frame.

## 6. Workflow evidence — blocked

### Verified and sufficient for the final-view claims

- Frozen candidate, rubric, dataset, this case's source/expected files, all attempt/final specs, capture artifacts, and retained binary hashes match.
- The required model identities are recorded, with the tab-label correction explained by frozen metadata.
- Stage A was truly completed before reveal, and the blind digest remains unchanged.
- Both final `check.txt` files retain the full merged stdout/stderr; the hash-verified capture script uses `2>&1`, and both manifests record `check_exit: 0` and check windows.
- Actual normal text/ANSI, select-all ANSI, and five timestamped motion frames per view are present. Both validator outputs are preserved but do not override this review.
- Capture windows are 2026-11-02T10:01:06Z–10:01:10Z for v1 and 10:01:23Z–10:01:27Z for v2.
- Capture panes **w7E:p7A** and **w7E:p7D** have `confirmed_closed` manifests.

### F5 — high evidence gap, not an invented visual defect

The rejected attempts have only summarized check strings in `attempts.json`. Their full stdout/stderr and complete exit records are absent. The accepted-design placement permutations are described but do not have all intermediate bytes/logs retained. No new checks were run to recreate them.

Geometry-probe panes **w7E:p72**, **w7E:p74**, and **w7E:p75** are reported closed by the generator, but no retained close/probe record independently verifies those three closures. The result therefore includes all five generator-owned pane IDs but only the two manifest-proven IDs in `closed_pane_ids`; cleanup verification is blocked. This does **not** assert that the three panes remain alive. Pre-existing **w7E:p6R** is explicitly not owned and is excluded. The judge created no panes and did not probe or modify live sessions.

The frozen requirement includes full check evidence and cleanup of all owned panes, including unsuccessful work. Final-view evidence is good, but I cannot promote missing failed-attempt/probe records into proof. Hence workflow is blocked rather than silently passed. This does not soften the known semantic and arrow failures.

## 7. Animation — source-backed N/A; stationary-route caveat settled

`docs/visualize-eval/cases.json` labels this case `animation: optional`; `expected.json` agrees; the complete source excerpts request no animation. Accordingly animation is **not applicable**, status null, not a bonus pass.

The supplied motion still receives an obstruction audit:

- v1: six dots per frame, one on each individual animated route; no moving dot on the bus or its destination legs.
- v2: five dots per frame, one on each route.
- Across five frames each, **55 route/frame samples** contain zero observed dot-count violations and zero dots on a corner, bridge, junction, border, or arrowhead. Labels remain unobscured.
- Kubernetes→GPU Operator remains at **(26,12)** at 0,100,200,300,400 ms. It is **stationary in the complete supplied sample**. I do not claim a direction, cadence, or actual moving dot for that route.
- Other routes advance toward their target arrows, with a visible wrap on GPU Operator→DCGM at 400 ms. v1 bends/bridge avoidance create nonuniform geometric jumps; notably RMS→NMX-C/T moves from (10,18) to (11,22) in the first 100 ms. Single-dot count is not proof of uniform slow speed.

The stationary route would need attention if visible flowing animation were required. Here motion was unrequested and does not damage labels or traceability, so it does not create an animation-category failure. This is not a waiver of a required-animation gate in another case.

## Corrections to consider after all eight critiques are gathered

No correction was implemented during this review.

### Skill/spec-level candidates

1. Preserve visible residency: name management host, NVSwitch-tray software, and compute-host residency in compact visible labels or dedicated views, rather than treating invisible group names as a substitute.
2. Read each edge as a sentence in the arrow direction. Replace the inverse `deployed in` label on Kubernetes→GPU Operator with a forward-compatible verb, without changing the underlying supported relation.
3. Require an actual single-owner label check. Separate API overlays from physical reach if needed, carry the same endpoints explicitly, and do not delete a required relation to make a clean check. A label's off-route placement does not prove ownership.
4. Use explicit capability preflight for **one n-ary split point**, not merely “supports trunks.” The frozen skill already describes one junction per branch spur; it should not promise the stricter source shape with that primitive.
5. Preserve context abbreviations and source qualifiers visibly where they matter; a ledger that explains omitted text is not an on-screen key. Retain dashed, qualified treatment for uncertain non-interface relations rather than inventing deploys/manages semantics.
6. Retain raw checks/exit codes and pane-close/probe records for every owned experiment, not just final captures. The two existing final bundles should remain unchanged as executed evidence.

### Renderer/harness-level candidates

1. **Required capability gap:** expose/render a single n-ary junction with one incoming trunk and three distinguishable destination branches. The executed per-spur-junction bus does not achieve the requested shape. Frozen skill documentation and the generator's limitation report support this gap in the supported primitive; the capture proves the failed output. I did not test alternate renderer encodings and do not claim impossibility for every conceivable workaround.
2. Improve label anchoring/leader clearance relative to *competing* routes, not only route-cell collision. All four ambiguous labels pass the current off-route checks.
3. Keep short-route animation visibly moving without placing dots on forbidden cells; check timestamped displacement, not only `dots: 1`. This sample's stationary route is an observed limitation, not a required-animation blocker for this case.
4. Have the frozen capture harness preserve the owned pane's actual rectangle by ID, raw rejected-run records, and probe-close records. Preserve frame SGR if temporal color is to be judged.

The generator's other claimed gaps are **not accepted as blockers here**: a negative-link schema field is unnecessary to prove the absence of OOB→DCGM; a rendered group legend is not an additional color gate; and one over-wide 13-node attempt does not prove that a single frame is universally impossible. Split views are allowed when coverage is explicit.

## Deliverables and validation

- `observed-first.md` — unchanged pre-reveal evidence.
- `spec-manifest.json` — deterministic sorted final-spec path/hash inventory.
- `reviewer-result.json` — all seven categories, 22 edge/apparent-relation audits, five evidence-linked findings, blockers and qualified cleanup records.
- `critique.md` — this review.

The result was checked offline against every constraint keyword used by the embedded result schema using a dependency-free validator. Evidence IDs, finding/edge references, and actual file hashes were also checked. No package was installed. This validation establishes report structure and evidence binding, not diagram correctness.
