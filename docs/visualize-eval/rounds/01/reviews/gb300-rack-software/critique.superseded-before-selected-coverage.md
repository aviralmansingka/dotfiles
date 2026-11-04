# ASTRA Stage B review — gb300-rack-software, round 01

## Verdict: FAIL

The four final views fit their recorded 77×47 terminal grid and have intact, consistently colored node borders. They are not a complete, source-faithful residency/control diagram. Most importantly, the explicitly requested **single OOB trunk splitting once** is replaced with three independent outgoing paths. That known failure remains a failure despite the reported renderer limitation.

Other material failures are missing/misassigned RMS/NMX control semantics, missing visible residency meaning, and two ambiguous edge-label associations already recorded before the source reveal. Workflow evidence is partially blocked, not substituted with assumptions. Animation is source-backed N/A.

**No fixes, new rendering, installs, pane/session operations, commits, or subagents were performed in this review.** No verdict or evidence from cancelled round00 was used. This review evaluates the frozen round01 renderer as its own baseline; it makes no claim of skill-only improvement.

## Category matrix

| Frozen category | Decision | Basis |
|---|---|---|
| `semantic_fidelity` | **FAIL** | All 13 named entities appear, and paid-only software/OOB→DCGM are absent. But the bus contract, NVOS hosting, RMS SSH/SFTP and RMS-owned NMX-C gRPC coverage, residency meaning, and two label associations are incomplete or wrong. |
| `arrow_traceability` | **FAIL** | All 15 drawn route instances have recoverable stems and unique target arrowheads. Nevertheless, the rubric explicitly requires the GB300 named bus, not universal independent corridors. Three ports are not one trunk/split. Missing required control relations also have no traceable rendered route. |
| `layout_fit` | **FAIL** | The physical fit portion passes: complete boxes and full text, no clipping or controls overlap, at recorded natural 100%. The category's additional **complete cross-view source coverage** clause fails. This is not a claim that the captures overflow. |
| `conceptual_grouping_color` | **FAIL** | Source residency groups are not represented consistently. NVOS and its NMX software use different hue families; DCGM, Driver+CUDA, and Fabric Mgr use pink/green/blue without a compute-host annotation. Colors track geometric depth rather than the source-defined grouping. |
| `border_integrity` | **PASS** | Independent raw ANSI audit confirms all 19 node rectangles in both states: 38 complete, uniform-color perimeters. Selected-node borders remain complete and uniformly bold amber. No separate handle glyph, off-color handle cell, border arrow, or border dot is present. |
| `workflow_evidence` | **BLOCKED** | Frozen hashes, correct generator/judge identities, blind-first record, final checks, captures, sizes, timestamps, and cleanup records exist. Exact selected-TXT capture commands and rejected-attempt launch/individual-closure commands are not preserved in the supplied command lists. Files and cleanup summaries do not reconstruct those missing exact commands. |
| `animation` | **N/A** | This source requests readable static residency/control relationships, not animation. `cases.json` and this case's `expected.json` mark motion optional. All four specs omit `flow`, and every capture reports `0 flows`. N/A adds no passed category. |

Overall aggregation is **fail** because known category and required-edge failures exist. Workflow and interface uncertainty cannot downgrade those failures to merely blocked.

There are 20 audit entries: 7 pass, 12 fail, and 1 blocked. These include named-bus/trunk/branch checks and extra apparent relations, so they are **not** a count of 20 distinct drawn arrows. Ten findings comprise four critical and six high entries; some entries describe different rubric consequences of the same underlying defect, not ten independent root causes.

## Evidence, identities, and immutability

All paths in the result evidence inventory are **repository-relative**, based at this dotfiles worktree. Source references such as `source.md#Original line 283 (assistant)` identify the excerpt heading, not physical line 283 in the shortened Markdown file. The binary verification record expresses its external frozen path relative to the repository; the metadata's absolute path is `/tmp/visualize-eval/round-01/bin/rataflow-view`.

- Generator: `viz-ds01-gb300-rack-software`, `fireworks/accounts/fireworks/routers/deepseek-flash-latest`, as recorded in frozen metadata and this case's generation record.
- Reviewer: `viz-judge01-gb300-rack-software`, `openai/gpt-6-astra`, verified against this session's `PI_SUBAGENT_NAME`, `PI_PROVIDER`, and `PI_MODEL` environment variables.
- Blind observation hash was checked **before** reading the Stage B task/source, then checked again after report generation. The file was not edited:
  `5d6e0e1910c3fc208810f32c3f92d2a670a5e848d26ca5abce16c326bcaf4e67`.
- Actual candidate, frozen binary, rubric, dataset manifest, source and expected hashes match frozen metadata:

| Input | Verified SHA256 |
|---|---|
| Candidate skill | `9c5cea272a88300644cacda52c853c7c9169eeec91f0355d3460ee8741308d92` |
| Frozen renderer | `4a883e73b822f009c504bd21d0c2fc383067bf1b83b9791ccbda431912e3a1d8` |
| Rubric | `60997237bd996f1e1b6a16e0b68133859b9f03fd83c85e7f508e286743240f5d` |
| Dataset (`cases.json`) | `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05` |
| Case source | `10d440af0be8d3730c448e710a48d4dfbd527a966f532084e7f98fd2d4b83fda` |
| Case expected data | `9a947233493973c247544ae6e9c175b940feb9d87fc850d4693565c90042c0ab` |
| Sorted final-spec manifest | `2cf54fa71d9aa8bae75220998ccc84c4f11a69bde1901d6d0fe2a148194c9197` |

The manifest includes each of the four final specs, with actual SHA256, in sorted repository-relative path order. Each spec and the manifest also have separate evidence inventory entries. Final spec/check/capture hashes were compared with the generation record. Independent ANSI parsing and border assertions reused only this judge's own Stage A decoder, not the generator's audit program or conclusions.

The supplied generation prose is useful for source qualifications and execution provenance; it cannot turn an unreadable capture relation into a passed relation. Source snippets were read as evidence only. No original chat, credentials, other case content, current renderer source, or earlier round content was read.

## Actual viewport, state, and fit evidence

`captures/dims-probe-raw.txt` records `47 77`, corroborated by the captured `stty size` transcript. Each final ANSI capture independently decodes to 47 rows of 77 cells. TXT files omit only the last all-blank row and trailing padding; all their displayed cells agree with ANSI. The pane split JSON reports **49 widget rows**, not 49 PTY rows. The review's `live_pane` reports the measured PTY dimensions **77 columns × 47 rows**, not the widget count.

At blind Stage A, no numeric 100% readout was visible, so scale was not independently certified from image content alone. Stage B adds the frozen launch records, default viewer invocation, and explicit no-pan/no-zoom/no-fit record. That provenance supports the natural-100% capture designation used here; no numeric zoom indicator or new rendering is claimed.

| Final capture basename | Graph and edge-text extent `[c,r,w,h]` | Selected node | UTC capture timestamp |
|---|---|---|---|
| `v1-a4` | `[5,16,68,17]` | Compute BMC | `2026-11-02T08:26:44Z` |
| `v2-a2` | `[19,18,40,13]` | Compute BMC | `2026-11-02T08:27:32Z` |
| `v3-a3` | `[6,20,67,10]` | NVSwitch BMC | `2026-11-02T08:28:12Z` |
| `v4-a2` | `[21,7,36,36]` | DCGM | `2026-11-02T08:29:04Z` |

Each basename has final `-unselected` and `-selected` `.txt` and `.ansi` files in `rounds/01/gb300-rack-software/captures/`. Timestamps come from the preserved generation record, not filesystem mtimes. Selected/unselected samples are static states, not motion samples.

Controls occupy `[2,41,9,6]`. In v4 the full Fabric Mgr bottom border is `[23,42,12,1]`; 12 blank columns separate its left border from the control box. No control occlusion exists. Headers end at `drag pan`, `drag`, or a trailing separator; that partial help/status suffix is not a clipped required software or relation label.

All four preserved final checks report exit 0, no warnings, and extents 69×18, 41×14, 68×11, and 37×37 at `2026-11-02T08:29:32Z`. Those checks corroborate input validity and extent, **not** the bus, semantic label ownership, residency, or conceptual grouping.

## Source hierarchy and complete coverage audit

The latest explicit human requests and fixed qualified constraints control this review:

1. Free/bundled software only; no paid-only Mission Control/UFM/NetQ or claim that gated NGC images are freely available.
2. OOB is physical hardware-control reachability, not an API service or the DCGM in-band path.
3. The human specifically requested **one OOB trunk splitting once** into the three device classes. Independent-port routing is not an allowed equivalent.
4. Preserve NVOS hosting NMX-C/T and RMS's NVSwitch/NMX control, using the qualified source protocols.
5. DCGM reads via NVML, exporter serves metrics, and host colocation must not become a fictitious deploys/manages dependency.
6. Management-node and compute-host residency must be understandable. Software must not be implied to live on the GPU die.

The historical 11-edge list is not an independent truth oracle. In particular, this review does **not** demand a direct RMS→NVSwitch BMC control edge from the older broad wording: the later nuance says NVSwitch control goes through NVOS, with BMC used for OOB power/serial. The historical OOB→NVOS link is unresolved, not automatically true. Ancillary CDU/PDU mentions are not turned into extra mandatory branches in conflict with the explicitly fixed three-branch request.

### Required entity coverage

| Source entity | Displayed views | Meaning/residency result |
|---|---|---|
| nv-rms | v1, v2 | Client/API role shown; off-rack management-node residency not shown. |
| OOB LAN | v1, v3 | Named physical-network endpoint shown; required bus shape missing. |
| Compute BMC | v1, v2 | Hardware endpoint present; API label association ambiguous in v2. |
| NVSwitch BMC | v1, v3 | Power/serial endpoint present and separate from NVOS. |
| Power shelf | v1, v2 | Endpoint and RMS Redfish control shown. |
| NVOS | v2, v3 | NVUE control destination shown; hosting relationship mislabeled. |
| NMX-C/T | v3 | Combined name present; hosting and RMS gRPC caller ownership not represented correctly. |
| Kubernetes | v4 | Relation to GPU Operator shown. |
| GPU Operator | v4 | DaemonSet deployment of DCGM shown. |
| DCGM | v4 | NVML reads shown; compute-host residency missing and output label misplaced. |
| dcgm-exporter | v4 | Node and incoming path present; ownership of `serves :9400` ambiguous. |
| Driver+CUDA | v4 | Local read target and pairwise colocation shown; compute-host location not identified. |
| Fabric Mgr | v4 | Pairwise `same host` relation shown; which host not identified. |

No paid-only product appears, no entitlement claim is made, and **no OOB→DCGM** route exists. Separate views keep OOB and the in-band stack apart. These are positive observations, but they do not cure the other failed conditions.

### Per-relation decisions

Exact stem/bend/arrowhead coordinates and all capture locations are in `reviewer-result.json#edge_audit`; unchanged full node/color inventories are in `observed-first.md`.

| Audit ID / relation | Decision | Reason |
|---|---|---|
| `rms-oob-client` | Pass | `client`, clear rightward arrow into OOB LAN. |
| `oob-named-bus`, `oob-single-trunk` | Fail | Three source ports; no outgoing shared trunk or unique split. |
| `oob-compute-branch` | Fail | Correct endpoint/arrow, but independent source path instead of requested bus branch. |
| `oob-nvswitch-branch` | Fail | Correct endpoint in v1 and repeated v3 detail, but no required common split. |
| `oob-power-branch` | Fail | Correct endpoint/arrow, but no shared split. |
| `rms-compute-api` | Fail | Route recoverable; lower `Redfish` ownership is ambiguous. |
| `rms-power-api` | Pass | Upper `Redfish` clearly labels this route. |
| `rms-nvos-nvue` | Pass | Correct RMS→NVOS route labeled `NVUE REST`. |
| `rms-nvos-ssh-sftp` | Fail | No rendered SSH/SFTP coverage in any view. A separate arrow is not mandatory, but visible protocol coverage is. |
| `rms-nmx-grpc` | Fail | No correctly attributed RMS/NMX gRPC control relation. |
| `historical-oob-nvos` | Blocked | `reach hist.` is an explicitly unconfirmed historical interface; no independent source verification. |
| `nvos-hosts-nmx` | Fail | Captured edge says `NMX-C gRPC`, not hosting. |
| `extra-nvos-grpc` | Fail | Apparent NVOS-as-client gRPC relation replaces the required hosting relation. |
| `kubernetes-gpu-operator` | Pass | `hosts` supported by “over Kubernetes”; no invented deployment protocol. |
| `gpu-operator-dcgm` | Pass | `DaemonSet`, correct direction. |
| `dcgm-exporter` | Fail | `serves :9400` lies under the other branch. |
| `dcgm-driver-nvml` | Pass | `reads NVML`, correct caller/read direction; not deployment/OOB. |
| `apparent-driver-metrics` | Fail | Misplaced label can read as a second DCGM→Driver+CUDA annotation; not a second drawn path. |
| `driver-fabric-colocation` | Pass | `same host` expresses pairwise colocation, not deploys/manages. Missing host identity is a separate residency defect. |

All 15 actually drawn route instances can be traced. None has a missing source stem, reversed arrowhead, actual crossing, or shared run. Ports abut intact outlines; source borders are not replaced with tee glyphs. At v1 `[56,19,3,1]`, `╮╰▶` places unrelated bends next to one another. Their strokes do not join. This near-junction is **not** the required intentional branch.

## Concrete findings

Coordinates are 1-based `[column,row,width,height]` and apply to both state captures unless stated otherwise.

### F01 — Critical: requested bus replaced by independent routes

**Category:** arrow traceability, with semantic consequences. **Evidence:** `v1-a4-unselected.ansi`, `[29,16,44,17]`; near-corner region `[56,19,3,1]`.

The three source stems are at `(38,17)`, `(38,19)`, and `(38,21)`. They turn down at columns 57, 56, and 54, then end at Compute BMC, NVSwitch BMC, and Power shelf. The larger OOB node is not a trunk segment, and its three ports do not form a single outgoing split. This directly violates human excerpt 284 and the rubric's explicit GB300 exception. A reported lack of renderer support explains the limitation; it cannot make this output compliant.

### F02 — Critical: NVOS hosting changed into a gRPC-looking call

**Category:** semantic fidelity. **Evidence:** `v3-a3-unselected.ansi`, `[36,21,37,9]`; label `[47,26,10,1]`.

The visible NVOS→NMX-C/T route says `NMX-C gRPC`. Nothing on that route says hosting, and the two nodes have different hue families. The required host relationship and the RMS southbound protocol are different facts. The report title “NVOS hosting NMX-C/T” does not repair the displayed edge.

### F03 — Critical: missing RMS NVSwitch/NMX control coverage

**Category:** semantic fidelity. **Evidence:** v2 `[22,18,37,13]`, v3 `[36,21,37,9]`.

`NVUE REST` is shown from RMS to NVOS. `SSH/SFTP` is absent. `NMX-C gRPC` appears only on the wrong host-to-component relation in v3, which has no RMS node. Two adjacent view concepts are not automatically a cross-view caller relation. Protocol names in a generator source-pointer description are not rendered coverage.

### F04 — High: Compute BMC's Redfish label cannot be assigned reliably

**Category:** semantic fidelity. **Evidence:** `v2-a2-unselected.ansi`, route/label region `[20,22,18,6]`; label `[25,26,7,1]`.

The Compute branch bends left across columns 20–23. The intended label starts at column 25, under the Power shelf branch. Both `Redfish` labels can therefore read as annotations on the Power shelf route. Stage A recorded this ambiguity before the JSON revealed the intended ownership. Identical text on two edges does not make ownership by elimination a reliable visual reading.

### F05 — High: exporter service label appears under Driver+CUDA route

**Category:** semantic fidelity. **Evidence:** `v4-a2-unselected.ansi`, `[22,27,24,8]`; label `[29,30,12,1]`.

The exporter route's horizontal span is columns 22–27. `serves :9400` begins at column 29, directly below the Driver+CUDA route. This is not an arrowhead-over-text defect; it is an association defect. The actual exporter service responsibility remains ambiguous, and a false second annotation on the driver route is plausible. The review does not declare that plausible reading a separate definitely drawn arrow.

### F06 — Critical: names retained, required residency meaning omitted

**Category:** semantic fidelity. **Evidence:** v1 `[5,18,8,4]`; v3 `[36,21,37,9]`; v4 `[21,23,36,20]`.

The source asks where the software resides. `nv-rms` is not labeled as residing on an off-rack management node. The NVOS/NMX hosting distinction is absent from the display. No v4 label identifies a compute host or includes DCGM in a host group. `same host` binds only Driver+CUDA/Fabric Mgr and leaves the host unnamed. There is no literal GPU-die falsehood, but omission of the requested location meaning still fails. A rendered container is one possible solution, not a mandated new pass condition; clear supported text could carry the same facts.

### F07 — High: hue families show graph depth, not required residency groups

**Category:** conceptual grouping/color. **Evidence:** v3 `[36,21,37,9]`; v4 `[21,23,36,20]`; compare OOB at v1 `[29,16,9,7]` and v3 `[6,20,9,5]`.

NVOS is light teal `#93c2b7`; its hosted NMX-C/T is pink `#d3869b`. NVOS instead shares teal-family color with NVSwitch BMC. DCGM is pink, Driver+CUDA light green, Fabric Mgr blue. No host annotation qualifies that visual separation. OOB changes from teal to amber when it becomes a root in another view. Stable colors across every view are not a new independent requirement here; the changes support the diagnosis that the current color meaning follows geometric layer, not a disclosed source residence scheme.

Selection makes one node bold amber `#d8a657`, the same hue as an unselected root. That reduces hue-only selection distinction, but the border remains uniform and bold. This is not used to fail border integrity or to create an extra rubric category.

### F08 — High, unresolved: qualified historical OOB→NVOS interface

**Category:** semantic fidelity. **Evidence:** `v3-a3-unselected.ansi`, `[15,22,21,6]`; source and generation qualifications.

The visible route to NVOS is labeled `reach hist.`. The generator's accompanying prose explicitly says unconfirmed and cites the corrected distinction. That qualification is acknowledged; this review does not pretend the old graph independently proves the interface, or assert that the interface is definitely impossible. Its audit remains **blocked** until source-backed facts resolve it. The abbreviation alone does not explain uncertainty to the capture-only reader.

### F09 — High: split views lack complete source coverage

**Category:** layout fit, specifically its coverage clause. **Evidence:** v2 `[19,18,40,13]`, v3 `[6,20,67,10]`, v4 `[21,7,36,36]`.

Every shown box fits. Missing RMS control protocol ownership and software residency nevertheless mean the four-view split does not preserve the complete source. This is the same underlying missing coverage identified in F02/F03/F06, applied to the frozen layout category; it is not a new claim of geometric failure.

### F10 — High evidence blocker: exact command coverage is incomplete

**Category:** workflow evidence. **Evidence:** `generation.json#views/commands`, `#prior_attempts`, and `#cleanup`; no capture-coordinate region applies to absent command records.

The command lists preserve final viewer launch, unselected TXT/ANSI reads, selected ANSI reads, and `q`. They do not record selected-TXT read commands. They also summarize rejected viewer attempts and cleanup without their exact launch/individual-closure command records. Existing state files prove the display states, not which missing commands were executed. This narrowly blocks the strict exact-command gate. It does not allege a model substitution, fabricated file, missing final frame, or proven pane leak.

## Capability and evidence blockers

1. **Required named bus:** Frozen output demonstrates three independent ports, while the captured feature probe rejects `style` and lists edge fields `from`, `to`, `label`, `flow`. The generator records no trunk/junction primitive. No executed successful shared-bus capability evidence exists. The failed `style` probe alone is not an exhaustive proof that every possible representation is impossible; no new probes were run. The known rendered failure remains red regardless.
2. **OOB→NVOS interface:** Qualified source evidence does not establish this historical physical reachability claim. Keep its audit blocked pending authoritative clarification; do not promote it merely to retain an old edge count.
3. **Command provenance:** Preserve the missing selected-TXT and rejected-attempt command records if they exist. New captures or retrospectively invented commands cannot repair provenance of this frozen sample.

Not all generator-listed “blockers” are independent required capabilities:

- A dashed-edge or edge-category primitive is **not mandated** by the rubric. Clear source-backed text and view separation can distinguish physical reachability from API calls.
- A container primitive is **not mandated**. Explicit host/residency labels can carry location facts; absence of a box primitive does not excuse omitting them.
- A negative-edge/annotation primitive is **not required** to obey “never draw OOB→DCGM.” Absence of that route is correctly achieved here.
- Motion is not required in this case, so missing animation frames are not a blocker.

## Correction candidates — analysis only, not applied

These are case-local candidates for the captain's later synthesis. **Gather all eight complete critiques before proposing or applying the next skill candidate.**

### Skill/spec-authoring level

- Treat explicit source-named bus topology as an exception to the frozen skill's universal separate-route language. Preflight required topology against supported capabilities; report unsupported bus semantics without substituting independent fan-out and claiming success.
- Build a coverage list from the latest corrected source, with separate rows for physical drops, management API calls, hosting, local reads, metrics service, and host colocation. Do not use the historical adjacency list as the truth oracle.
- Preserve RMS's actual caller ownership and all source-listed southbound interface coverage across split views. Do not label a hosting relationship with an API protocol to reuse a node pair.
- Make residency visible with supported text and labels, not just generation titles or prose unknown to the diagram reader. A container is optional; the meaning is not.
- Require a blind reader to attach each edge label to its route. In particular, two labels placed above/below the same branch cannot be accepted merely because JSON knows their intended edges.
- Keep unsupported historical interfaces explicitly qualified and blocked. Prefer an unambiguous source-backed uncertainty note over `hist.` shorthand.
- Preserve exact command records for every created attempt and captured state, including selected TXT, plus cleanup evidence. Do not retrofit commands after the fact.

### Renderer-level candidates

- Add a genuine intentional-bus representation with one shared stem and one declared junction, distinct from accidental crossing/shared-corridor detection. This is a capability change and must be evaluated as such, not attributed to skill wording alone.
- Improve label-to-route ownership: constrain placement to an identifiable part of the owning path, or provide a clear association mechanism when a label is displaced. `--check` free-slot availability currently misses the v2/v4 ownership defects.
- Support semantic grouping/color independently of geometric depth, or another supported annotation channel for host/residence groups. A grouping boundary could help but is not the only acceptable representation.
- Keep selection visually distinct from the unselected root palette without disrupting uniform borders. This is a secondary usability candidate, not the basis of the current border verdict.

No speculative renderer code changes or new layout trials were made.

## Cleanup and validation

The generation record reports all nine owned panes closed:

`w7E:p35`, `w7E:p3B`, `w7E:p3D`, `w7E:p3V`, `w7E:p3Z`, `w7E:p43`, `w7E:p47`, `w7E:p4C`, `w7E:p4K`.

Stored split responses corroborate ownership in the generator's `w7E:tR` tab. Final-view records give close timestamps. The record says a final pane list left only the generator's own `w7E:p2Y`. `cleanup.status` is therefore `done` **as recorded**, not an independent live attestation. This judge created no panes and did not query or close any session. Missing exact per-attempt commands remain in the workflow blocker rather than being silently invented.

The JSON was validated against all assertion keywords used by the embedded frozen result schema with an independent standard-library validator (no package installation). Evidence IDs, finding/edge references, evidence SHA256 values, and capture-coordinate bounds were also validated. `observed-first.md` retains its original hash.

### Deliverables

- `docs/visualize-eval/rounds/01/reviews/gb300-rack-software/reviewer-result.json`
- `docs/visualize-eval/rounds/01/reviews/gb300-rack-software/critique.md`
- `docs/visualize-eval/rounds/01/reviews/gb300-rack-software/spec-manifest.json`
- `docs/visualize-eval/rounds/01/reviews/gb300-rack-software/verification.json`
- Existing, unchanged: `docs/visualize-eval/rounds/01/reviews/gb300-rack-software/observed-first.md`
