# Round 03 — GB300 rack software — independent Sol critique

## Verdict: FAIL

The captured candidate is **not green**. The source expressly requests one OOB arrow that splits **at exactly one point** into three destinations. v1 instead has **two separate `┬` junctions and a terminating third drop**. The generator openly records the renderer capability blocker; that honesty does not turn the known failed requirement into a pass or an evidence-only block.

Other failures are three uncertain route-label owners, missing visible residency framing, a source-unsupported color grouping for Fabric Manager, and false cross-view coverage claims in the workflow record. Layout verification remains **blocked**, rather than failed solely because one crossing exists: the app viewport is proven, but separate live-pane dimensions and a reconciled crossing-pair/minimization record are missing. No motion is requested or observed.

### Category matrix

| Fixed category | Decision | Reason |
|---|---|---|
| semantic_fidelity | **fail** | All 13 named concepts appear and corrected exclusions hold, but one-split topology and required residency meaning are not preserved/readable; the FM interface remains unverified. |
| arrow_traceability | **fail** | All 13 drawn destination routes have traceable geometry and intact downward heads, but the required bus split is wrong and three labels do not uniquely identify their routes. |
| layout_fit | **blocked** | Both 77×47 app grids fit at natural 100%, without clipping/occlusion; separate pane measurements are absent and crossing-count/minimization evidence is unresolved. |
| conceptual_grouping_color | **fail** | Most families are conceptual; Fabric Mgr is assigned to `nvswitch`, visually separated from compute-host software without a source-backed printed explanation. |
| border_integrity | **pass** | RGB ANSI evidence proves complete, continuous normal and selected borders for all 13 node occurrences. |
| workflow_evidence | **fail** | Input/artifact hashes and identity are verified and the blind record predates reveal, but v2 coverage claims are false and crossing explanations are unsupported; execution/dimension evidence is also incomplete. |
| animation | **N/A** | The frozen manifest and expected data say optional; source requests placement and readable routing, not animation. The candidate is static. This contributes no pass. |

**Totals:** one passed applicable category, four failed categories, one blocked category, one source-backed N/A. Known failures take precedence over outstanding evidence gaps.

## Identity, path base and frozen-input episode

- Generator: **`viz-ds03-8`**, model **`fireworks/accounts/fireworks/routers/deepseek-flash-latest`**. The actual worker label is supplied by the captain and corroborated by `metadata.json.worker_labels`; a generic task-template name is not substituted.
- Reviewer: **`viz-judge03-gb300`**, model **`openai/gpt-6.1-sol`**. I did not generate the candidate, switch models, or spawn agents.
- Evidence inventory paths in `reviewer-result.json` are relative to this repository/worktree root, `/Users/aviral/.herdr/worktrees/dotfiles/fix-visualize-skill`. Short evidence IDs below resolve to that inventory. All screen regions are 1-based `[column,row,width,height]`. Historical “line 283/284” citations refer to the explicitly labeled **Original line** excerpts in the permitted `source.md`, not current file line numbers.
- The frozen renderer is an external `/tmp/visualize-eval/round-03/bin/rataflow-view` executable. Its actual bytes were hashed without executing it. Its repository-relative `bin.sha256` records and metadata are inventoried; the hash-verification report explicitly names the external path.

### Reviewer identity correction

After stage A, the captain disclosed that the frozen rubric's `required_reviewer_model` and schema const still named round-01 `openai/gpt-6-astra`. Revision 4 corrected those two identity fields to **Sol before any reviewer-result.json existed**; criteria and thresholds were not changed. The current rubric hash matches current frozen metadata. The prose of `workflow_evidence.pass_iff` still contains the stale Astra name because criteria text was kept unchanged. I apply the corrected explicit reviewer requirement and emit my true Sol identity; I neither impersonate Astra nor treat this disclosed clerical repair as a rendering improvement. The episode is preserved in rubric revision 4 and metadata's `frozen_input_corrections`.

### Hashes and blind-first preservation

| Input | Verified SHA-256 |
|---|---|
| Frozen candidate skill | `cf796bcdc527897687ec2ca19844f399c921252409b9ca7ad04fbfa1b6cc659c` |
| Frozen renderer executable | `b242b6a28e2e27934b06b7a297be638c143e5c99680495e104380cd8d9ee80f7` |
| Corrected frozen rubric | `5519fd84f6b75973dbf7b5f5544c909a8f32a8841a876c8e7af00a1fcb119335` |
| Frozen case manifest | `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05` |
| v1 final spec | `c798ed30eccca73502abdf6bd71ad098a93368f971f637a54ea8b1caf5bf0f07` |
| v2 final spec | `c660806f0e4547e7aca587de341bd71e65a0a0cce996f539f8ad460d329f04a0` |
| Deterministic spec manifest | `b68605ae03fbc8ec9b86e6b63b0681745d2c6d482600aa799435a69cbd431e6d` |
| Immutable stage-A blind record | `374994fd9a796073edf0906ea60604b723f4cd8ffb4e8854e73ee59b3eaa065f` |

`spec-manifest.json` contains the two final repository-relative spec paths in sorted order, with actual hashes; its file hash is `spec_sha256`. Both specs and the manifest are in the inventory. `observed-first.md` is inventoried as `blind`, with `saved_before_expected_reveal: true`. It was not changed after saving; its hash was verified before and after stage-B artifact generation.

All **29 frozen/manifest/attempt/blind hash comparisons** matched. The inventory has 37 files. Matching hashes identify the evidence; they do not validate its semantic claims. No current renderer source or earlier round was used as substitute evidence, and no renderer improvement is attributed to the skill.

## Applying the qualified source, not the old generated graph

The semantic oracle is the specific corrections and fixed constraints, not an earlier assistant diagram:

1. **Original line 277:** RMS is an OOB client on a management node; OOB hardware reachability is not DCGM's local NVML or in-band exporter path.
2. **Original line 283:** controller API calls and shared physical drops are distinct. In particular RMS reaches the NVSwitch through **NVOS, not its BMC**. The specific nuance overrides the same excerpt's earlier broad device-class wording. I do not require a guessed direct RMS → NVSwitch BMC software-control edge or adopt the generator's claimed need for an external supervisor fact to resolve that nuance.
3. **Original line 284:** one OOB stem must split once into Compute BMC, NVSwitch BMC, and Power shelf. A continuous bus is not enough if it splits at two different positions.
4. **Fixed constraints:** NVOS hosts NMX-C/T; DCGM reads the driver through NVML; compute software resides on compute hosts, not GPU dies; historical Driver → FM must not become an invented deploys/manages dependency.

Accepted source coverage/abstractions:

- All 13 audited named concepts are visible across the final views; none of Mission Control, UFM, NetQ, BCM or NGC is drawn. No gated-image-free claim is made.
- No OOB → DCGM or inter-BMC/device-to-device relation is drawn. The historical OOB → NVOS software-control edge is correctly absent under the specific correction; NVOS instead receives the RMS control arrow.
- The two views divide the control/OOB side and the in-band stack. There is no omitted required cross-view connecting arrow between those independently described chains. The controller edges are covered **in v1 only**, not repeated in v2.
- The source's explicitly requested three-device split scopes the audited bus. CDU/PDUs and optional physical-network details are recorded as deliberate abstractions in the ledger; I do not invent an extra five-destination requirement or demand the paid/Slurm nodes return.
- `NVUE REST+gRPC` is a source-backed compressed label. SSH/SFTP is retained in the plain-text generation ledger; the control arrow ends at NVOS and the hosting arrow identifies NMX-C/T. This compression is not the decisive failure.

## Findings and classifications

### F1 — critical defect, with an unresolved renderer capability blocker

**Evidence:** `v1_ansi`, regions `[13,23,36,5]`, `[16,25,1,1]`, `[34,25,1,1]`; `generation` admits the limitation. **Source:** Original line 284 and expected constraints.

The shared stem starts at `(13,23)`, turns right at `(13,25)`, reaches the first `┬` at `(16,25)`, then a second `┬` at `(34,25)`, then turns down at `(48,25)`. These are two separate branch points and a final destination. The bus is genuine and connected; it is not three independent accidentally touching arrows. Nevertheless, **it fails the explicitly demanded one-point split**. This is a known observable failure of semantic topology and arrow traceability, even if no skill-only repair can express the requested shape.

Generator claims that each trunk branch receives its own junction and a branch cannot also be the trunk's terminal `to`. Those are reported capability limitations, not independently exercised here. The captured sequential taps independently establish the failure. Do not hide it behind `trunks: 1` or an overall blocked status.

### F2 — high defect: three uncertain label owners

**Evidence:** `blind`, `v1_ansi`, `v2_ansi`.

| Label occurrence | Actual proximity | Why it fails |
|---|---|---|
| `Redfish/HTTPS` `[14,27,13,1]` | Begins immediately right of the OOB Compute arrow at `(13,27)`; true RMS Compute arrow is `(11,27)`. | Physical reachability appears to own a controller API label. |
| `Redfish/HTTPS` `[25,16,13,1]` | Lies between row-15 NVOS and row-17 Power horizontal runs. | Protocol owner cannot be established from proximity alone. |
| `Prometheus :9400` `[26,30,16,1]` | Between arrowheads `(24,30)` and `(43,30)`, one blank cell from each end. | Can label the exporter or driver path despite the JSON choosing exporter. |

The routes themselves can be traced; these are not claims of missing arrowheads. But semantic route ownership is part of readable relationships. `labels: ... 0 on route cells` does not test this failure mode.

### F3 — high source/interface blocker; dashed bends are not a new defect

**Evidence:** `v2_ansi`, `[26,31,29,12]`, `[31,36,9,1]`, `[26,37,18,2]`; expected constraints.

`hosts FM?` clearly owns Driver+CUDA → Fabric Mgr. The vertical straight cells are `╎` and horizontal straight cells are `╌`; both bends and the `▼` head are solid. The question mark and long dashed runs make uncertainty visible. The rubric does **not** separately require dashed arrowheads/corners, so I do not manufacture a dashed-continuity failure.

The unresolved issue is semantic: Driver+CUDA is not a compute-host box. Both programs running on compute hosts does not establish that the driver stack **hosts** FM. The source supplies no such interface fact. Because the diagram visibly marks it tentative, audit this edge as **blocked**, not as a verified fabricated dependency. The JSON also records the extra apparent hosting interpretation as an `unexpected_link`, explicitly the same route rather than a second drawn arrow. This is why 17 audit records do not mean 17 visible edges.

### F4 — high defect: required residency is not visible

**Evidence:** `v1_ansi` `[12,10,9,4]`; `v2_ansi` `[23,7,32,36]`; source task and fixed constraints.

No printed management-node/off-rack or compute-host framing identifies where the software resides. The pane titles are filenames, not the descriptive titles in generation.json. A hidden `group: inband` cannot tell the viewer that DCGM/driver/FM run on compute hosts. No GPU-die label makes a false die-residency claim, but absence of that false claim is not evidence that the requested positive residency fact is communicated. The task was software placement, not just thirteen component names.

### F5 — high defect: source-unsupported grouping in v2

**Evidence:** `spec_v2`, `v2_ansi` `[23,31,32,12]`.

Five in-band nodes use related golden borders; compute-host Fabric Mgr is separately teal and assigned `nvswitch`. The placement source includes it among compute-host software. No visible legend states an alternative functional grouping interpretation. v1's management/OOB/NVSwitch colors are otherwise related to source concepts. This finding is about grouping within v2, **not** a new cross-view exact-hue-stability gate.

### F6 — high workflow defect: false cross-view coverage claims

**Evidence:** `generation`, `generation_md`, and the complete `v2_ansi` `[1,1,77,47]`.

The ledger/audit/coverage map claim RMS controller edges and NVOS → NMX-C/T repeat in v2, even mentioning a v2 RMS node. They do not. v2 contains only Kubernetes, GPU Operator, DCGM, dcgm-exporter, Driver+CUDA and Fabric Mgr. Required controller relations exist in v1; their global absence is not alleged. The failed condition is the accuracy of the preserved coverage map.

### F7 — medium diagnostic/evidence finding

**Classification:** evidence gap for unreconciled counts/minimization; defect in the generator's explanation.

**Evidence:** `v1_check`, `v1_ansi` `[13,25,36,3]`, `attempts`, `generation`.

The check reports **3** crossings. Blind inspection finds **one** independent crossing/bridge, `⌒` at `(46,25)`, and **two** intentional `┬` bus junctions. The generator describes all three as controller links crossing the bus, which is not what the capture shows. There is no preserved executed diagnostic enumerating the counted pairs. I do not assert the implementation necessarily has a counting bug or silently equate junctions with crossings.

v2 has zero crossings both visually and in its check. The attempt ledger summarizes v1 improvement from 7 to 3, but the earlier checks are not raw preserved transcripts. It also does not establish that the remaining visible overpass is avoidable or unavoidable under all source-compatible placements. Therefore minimum/avoidance is **unproven**, not a speculative extra layout failure. No reordered source group or merged independent link is accepted to reduce the number.

### F8 — high evidence gap: separate actual pane dimensions

**Evidence:** both manifests, frame startup lines and full grids.

Both normal/selected ANSI grids are exactly **77×47**; the titles say `77x47 @100%`; each command's startup transcript says `viewport: 77x47 zoom: 1.00 natural`. All boxes/labels fit, and the bottom-left controls do not occlude Fabric Mgr even though they share rows.

However, `pane_cols` and `pane_rect` are null in both manifests; `pane_rows` alone is 47. The generator's `measured_pane: 77x47` is not a separately preserved measurement. The check's own line is `viewport: unknown zoom: 1.00 natural`. Accordingly the result distinguishes **verified app viewport** from **unknown independently measured live pane** (`live_pane: null`). Validator `viewport_proven` is not a replacement for that requirement.

### F9 — high execution-evidence gap

Final check output and manifest exit 0 exist. Separate stderr/explicit-empty-stderr records do not, and the direct-check command in generation.json uses `<spec>`. Exact final render/selected/frame commands are recoverable from their transcripts, but raw rejected-check output/error/exit transcripts are not; attempts.json only summarizes them. Complete check/execution evidence cannot therefore be claimed. These gaps would block workflow if it had no known failures; F6/F7 already make workflow fail.

## Every visible arrow: source, head and audit outcome

The detailed `edge_audit` contains full polylines, route-label meaning/owner, source references, crossings/junctions and located findings. All visible heads are intact downward `▼`, directly above the target border. No source/reverse heads appear.

| View | Relation | First drawn source-stem cell | Target head | Audit |
|---|---|---|---|---|
| v1 | RMS → OOB LAN | `(15,14)` | `(13,18)` | pass |
| v1 | RMS → Compute BMC | `(13,14)` | `(11,27)` | fail: label owner |
| v1 | RMS → Power shelf | `(17,14)` | `(46,27)` | fail: label owner; bridge at `(46,25)` |
| v1 | RMS → NVOS | `(19,14)` | `(63,27)` | pass |
| v1 | OOB → Compute BMC | common stem `(13,23)` | `(13,27)` | fail: single-split requirement |
| v1 | OOB → NVSwitch BMC | common stem `(13,23)` | `(28,27)` | fail: single-split requirement |
| v1 | OOB → Power shelf | common stem `(13,23)` | `(48,27)` | fail: single-split requirement |
| v1 | NVOS → NMX-C/T | `(63,32)` | `(13,35)` | pass |
| v2 | Kubernetes → GPU Operator | `(26,11)` | `(25,14)` | pass |
| v2 | GPU Operator → DCGM | `(25,19)` | `(29,22)` | pass |
| v2 | DCGM → dcgm-exporter | `(29,27)` | `(24,30)` | fail: label owner |
| v2 | DCGM → Driver+CUDA | `(31,27)` | `(43,30)` | pass |
| v2 | Driver+CUDA → Fabric Mgr | `(43,35)` | `(26,38)` | blocked: unsupported host/interface claim |

The aggregate named bus has its own failed audit; two qualified historical absences and the extra apparent hosting interpretation are also audited. These are additional semantic audit records, not extra drawn edges.

Every non-box bend is enumerated in the immutable blind record's route polylines. The tight v1 NVOS jog `(19,16) ╰` / `(20,16) ╯` / `(20,15) ╭`, the v1 Compute jog `(10,26) ╰` / `(11,26) ╮`, and the v2 K8s jog `(25,13) ╭` / `(26,13) ╯` are same-route bends, not fake inter-route branches. The two OOB `┬` glyphs are intentional bus branches; the `⌒` is not a connection. Separate DCGM stems at columns 29/31 have no shared junction.

## Borders, selection and motion evidence

The blind record inventories every visible label verbatim with its coordinates and every node rectangle/perimeter RGB. Both normal ANSI captures prove one foreground color around each complete border. Every selected perimeter cell remains the same glyph and becomes bold RGB `(216,166,87)`.

- v1 selected coverage: **7/7** node occurrences.
- v2 selected coverage: **6/6** node occurrences.
- Total: **13/13**, including nodes already golden in the normal state, where bold distinguishes selection.

This proves each node's selected border in a simultaneous all-selected frame. It does not show isolated single selection, dragging, or handle states not drawn in the captures; those unshown behaviors are not invented as additional failures.

Both views have five static frames at **0, 100, 200, 300 and 400 ms**, no dots, and identical grid characters. **No motion appears.** These samples cannot prove a full animation cycle, direction, origin or synchronized arrival, and no such proof is claimed. Animation is explicitly source-backed N/A here, so 0/0 checker lines do not add a pass and a longer cycle is not required. Frame files named `.ansi` have no ANSI style sequences inside their actual grid rows, so they also do not prove color-only behavior over time. Ordinary/selected captures do carry actual color evidence.

## Correction candidates — not changes made

### Skill/spec-level

1. Preserve a literal one-split requirement through capability preflight. If unsupported, report the blocked requirement and failed closest subset; do not call a two-tap bus compliant merely because it uses `trunks`.
2. Inspect label ownership in the rendered cells, not only `labels off routes`. Move controller/API and exporter labels to clearly private route segments without dropping/changing relations or source groups.
3. Put required software residency into visible words or a printed key. Do not rely on a generator-only view title or an invisible group name.
4. Group Fabric Mgr with compute-host software for this placement view, or visibly state a source-supported alternate concept. Do not imply it resides on the NVSwitch by default.
5. Keep the unsupported Driver+CUDA/Fabric-Mgr interface explicitly blocked; common residency is not a hosting relation. Source-backed prose may explain co-residency without inventing a driver-hosts relation.
6. Generate the final coverage map from the actual final specs/captures. Delete false claims of controller-edge duplication in v2 from the future workflow record, not from this frozen evidence.

### Renderer/harness-level

1. **Unresolved required capability:** support one actual split point with three independently traceable destination arms. Sequential branch junctions cannot meet Original line 284; skill prose cannot manufacture that renderer capability.
2. Improve label placement or expose route association so a label cannot be equidistant between two unrelated heads/runs while checks remain green.
3. Explain crossing diagnostics with endpoint/pair coordinates and distinguish intentional junctions from independent overpasses. Do not optimize an unexplained aggregate count by changing source meaning.
4. Preserve independent measured pane columns/rows/rectangle, exact executed check commands, full stdout/stderr/exit records (including explicit empty stderr), and raw attempt outputs. Preserve the app viewport separately.
5. Visible semantic group/residency annotation would avoid relying on hidden metadata; a skill-level explicit label/key is sufficient if available. Do not claim an absent legend already exists.

These are candidates for later work, **not fixes performed by this judge**. Stop/resolve the unsupported mandatory split capability before representing this case as green. The captain must gather all eight complete critiques before revising the skill again.

## Cleanup and verification performed

Frozen v1 manifest identifies owned pane **`w7E:pC1`**, v2 **`w7E:pC3`**, both `confirmed_closed`; generation records agree. The review records cleanup as done on that evidence basis, not as a newly executed close probe. I opened no viewer/pane and made no changes to specs, renderer, skill, captures or expectations.

The stage-B result was checked with a dependency-free standard-library validator implementing **all JSON Schema keywords present in the frozen embedded schema**, then cross-checked for evidence-ID/finding-ID/edge-ID references, capture-region bounds, inventory hashes and unchanged blind hash. No packages were installed. New files are confined to this review directory and a temporary helper under `/tmp`.

### Outputs

- `docs/visualize-eval/rounds/03/reviews/gb300-rack-software/reviewer-result.json`
- `docs/visualize-eval/rounds/03/reviews/gb300-rack-software/critique.md`
- `docs/visualize-eval/rounds/03/reviews/gb300-rack-software/spec-manifest.json`
- `docs/visualize-eval/rounds/03/reviews/gb300-rack-software/hash-verification.json`
- Existing immutable `observed-first.md` remains unchanged.
