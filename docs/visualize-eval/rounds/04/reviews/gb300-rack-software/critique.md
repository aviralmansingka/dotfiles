# gb300-rack-software — round 04 independent Sol review

## Verdict: FAIL

**Two of seven applicable categories pass. Five fail.** Known visual defects remain failures even where other evidence is incomplete. There is no green approval.

| Fixed category | Decision | Basis |
|---|---|---|
| `semantic_fidelity` | **fail** | Required NVSwitch protocol coverage drops SSH/SFTP and does not clearly distinguish NVUE REST from NMX-C gRPC (F01). Off-rack management placement remains implicit in role/availability labels rather than visibly identified (F09). Human corrections and the three-way OOB split are otherwise preserved. |
| `arrow_traceability` | **fail** | Static stems and heads are readable, but the Power shelf branch takes an avoidable reverse-and-cross detour (F02); six frame-0 dots miss their true arrow origins (F03). |
| `layout_fit` | **fail** | All diagram content fits the measured target at 100%. The one avoidable v1 bridge nevertheless fails the category's crossing-minimization requirement (F02). |
| `conceptual_grouping_color` | **pass** | Related hardware, switch software, Kubernetes stack and host software use related hue families and appropriate proximity, not arbitrary depth colors. |
| `border_integrity` | **pass** | Normal and selected ANSI prove complete, color-continuous borders on all 17 node occurrences, including all selected perimeters. |
| `workflow_evidence` | **fail** | Named-final v2/capture mismatch (F05); missing exact command/status records, imperfect initial-frame provenance, and an unrecorded claimed second probe cleanup (F06–F08). Verified hashes and validator passes do not erase these. |
| `animation` | **fail** | Six observed origin violations (F03). Supplied samples also do not cover full constant-speed cycles (F04). No same-arrival requirement applies. |

## Evidence, paths, hashes, and identities

Every evidence path in `reviewer-result.json` is **repository-relative to the dotfiles checkout root**, `/Users/aviral/.herdr/worktrees/dotfiles/fix-visualize-skill`. Source references use the source excerpt's **Original line** identifiers, not unrelated chat files. Capture regions use 1-based `[column,row,width,height]`, including the app status row. For sequences, a location refers to the frame grid, not the physical line number in the concatenated file; F03 refers specifically to frame 0.

The evidence inventory includes 55 actual files with computed hashes: frozen inputs, this case's source/expected/variants, all seven attempted specs, all attempt checks, capture manifests and binary-hash records, normal/selected/frame captures, validator outputs, generation records, geometry probe, immutable blind record, and the final-spec manifest. No other case or earlier-round output was reviewed.

Verified against frozen metadata:

- Candidate skill: `ac431c6d3035e466e29136f36d9579c551c2e070a354dc5df72999b1bb1beb3c`.
- Actual frozen renderer executable: `0da16d8d8ed46e2a25eb773fc71ecad4de9e310cd33e303a4c7fe77231ad95bc`.
- Rubric: `18412615f82841b34cf131976c6b5f4b00cd4fc031a710cdfc81058e2dd68d10`.
- Dataset manifest: `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05`.
- Case source, expected data, and historical variants also match their frozen hashes.
- Every artifact hash recorded in the three capture manifests matches the actual file.

### Immutable blind record

`docs/visualize-eval/rounds/04/reviews/gb300-rack-software/observed-first.md`

SHA-256: **`74ca1317722c595c086a6619115ca62ea78aafc690bfeddf494ca29c9e9ed5f3`**.

It was saved and hashed before the expectation reveal and was not modified afterward. The result records `observed_first.saved_before_expected_reveal: true` and includes its actual hash in the evidence inventory. Stage B reconciles those observations; it does not rewrite them.

### Multiple-spec identity

`spec-manifest.json` contains sorted repository-relative path/actual SHA-256 pairs for the three **named final** specs. Its SHA-256, used as `spec_sha256`, is:

**`491adbbd8530fd031dedf9ea6b9497b3cdf7cdf90f580603b55f454e2cb96bf1`**.

This intentionally does not substitute the captured a3 file for the named final v2. That a3 spec is separately hashed in the evidence inventory.

The generator model is the required `fireworks/accounts/fireworks/routers/deepseek-flash-latest`; the reviewer is `openai/gpt-6.1-sol`. The result uses the full task's prescribed canonical generator ID `viz-ds04-gb300-rack-software`. The captain supplied the actual generator session label `viz-ds04-8`; this is an identity-label distinction, not a different model or a fabricated second generator. The actual judge session label, confirmed through `PI_SUBAGENT_NAME`, is **`viz-judge04-gb300`**, and that exact actual label is used in the reviewer field rather than inventing a longer session name. Generation and judgment are separate sessions. No subagents were spawned by this judge. The stale `gpt-6-astra` phrase inside the workflow category prose does not supersede the rubric's corrected required reviewer model, metadata, and schema constant.

## Source reconciliation and complete relationship audit

The source explicitly says historical generated arrows are **not an independent semantic oracle**. Source Original 283 distinguishes RMS NVOS/NMX control from the NVSwitch BMC power/serial path. Original 284 demands exactly one OOB trunk splitting once into three recipients. These override the historical `oob -> nvos` relation.

`reviewer-result.json` contains **17 audit entries**: the 14 visible destination relationships, the explicitly corrected historical OOB/NVOS absence, and two bus-level topology/stem audits. They are not 17 claimed physical edges. Every visible source stem, target head, direction, route, label owner, crossing, and junction is described there and in the immutable coordinate ledger.

### What is correctly preserved

- All 13 concept identities appear across the actual three views, with four intentionally repeated identities yielding 17 node occurrences. No paid-only Mission Control, UFM, NetQ, or gated NGC product is drawn.
- v1 RMS is a `Redfish client` of physical `OOB LAN 1/10/25G`, not a false claim that RMS is itself the network.
- The hardware recipients do not gain links to one another. There is no false OOB-to-DCGM relationship or BMC-to-NVOS dependency.
- v2 has four separate controller API paths, plus `NVOS (tray) -> NMX-C/T` explicitly labeled `hosts`.
- v3 shows Kubernetes hosting the GPU Operator, the Operator deploying host DCGM as a DaemonSet, DCGM feeding the exporter at `:9400`, and DCGM performing `NVML reads` against the host driver. No deploys/manages meaning is invented for the read edge.
- The dashed `Driver+CUDA (host) -> Fabric Mgr (host)` route is labeled `host-local`. The supplied prose explicitly states that the interface is unstated and points back to the excerpts. It is accepted only as qualified host-local/co-residency semantics, **not** independent proof of a particular driver/Fabric Manager API or deployment dependency. The source allows supported host semantics rather than requiring an invented historical chain meaning.

### The OOB split passes topology, not economy

The blind observation was correct: the junction is **`┼` at `(32,32)`**, with one incoming north arm and three outgoing arms. East goes to Compute BMC, south then left to NVSwitch BMC, and west/up/east/down to Power shelf. The `⌒` at **`(32,30)`** is a non-connecting crossover, **not a second split**. The explicit one-split demand passes. A universal independent-route-per-edge rule must not reject this valid bus.

However, F02 is a separate real defect. The Power branch goes from `(32,32)` to `(30,32)`, up to `(30,30)`, right across the incoming rail to `(54,30)`, and down to head `(54,33)`. Its 31-step path exceeds the endpoint Manhattan distance of 23 and includes a loop-like reversal. No node obstacle fills that zone. A one-junction fan-out assigning the left arm to NVSwitch, the downward arm to Compute, and the right arm to Power can avoid this crossing without changing source groups or tiers. The current drawing remains traceable if the reader knows the bridge glyph, but the source's simplification request and round-04 route-economy gate still fail.

Checks report **1/0/0 bridges** and **0/0/0 touching-bend collisions**, matching the observed inter-edge geometry. The two tiny adjacent-bend pairs in v3 are on the same routes, not unrelated crossing collisions. The v1 `routes: 1/1 near-minimal` line counts its one ordinary edge; it does not establish the economy of the three trunk destination paths. Passing that line cannot excuse the bus detour.

### Deliberate OOB → NVOS absence: pass

The captures themselves prove only absence: v1 has OOB but no NVOS, v2 has NVOS but no OOB, and v3 has neither. The generator's **reason** is in `generation.json`, not discoverable in the pane pixels. Once that reason is compared with Original 283/284, the omission is correct: NVOS control comes from RMS, while the named OOB bus has exactly the three requested hardware endpoints. It is neither a missing required edge nor evidence of an unseen fourth branch.

### Protocol loss: F01

The v2 control label at **`[18,27,13,1]`** reads `NVUE/NMX gRPC`. The source's southbound table names **NVUE REST, SSH/SFTP, and NMX-C gRPC**. SSH/SFTP is not visible anywhere; the generator admits dropping it for width. The expression also does not explicitly separate the REST and gRPC protocols. The fixed constraints require preserving these source protocols. Recording the discarded fact in a ledger is honest, but does not make the captured required label complete.

By contrast, `power/serial` on RMS → NVSwitch BMC names the source-backed function without inventing an unprovided transport. The shared `Redfish/HTTPS` rail label has a clear common-rail owner. `Redfish power` identifies the power control relation; its HTTPS expansion is in the supplied prose. Those are not independently treated as false or ambiguous relations.

### Residency visibility and controller labels: F09, with limits

There are **no visible residency enclosures or region titles**. No rubric requires rectangles specifically, so the mere absence of frames is not an invented automatic failure. The host suffixes on DCGM, exporter, driver/CUDA and Fabric Manager, plus `NVOS (tray)` and the `hosts` edge, do convey useful residency. Their related colors also satisfy grouping.

The remaining source-required off-rack management placement is not explicit: v1 says `nv-rms (mgmt)` at **`[13,13,13,1]`**, while v2 says `nv-rms (src build)` at **`[3,17,18,1]`**. `mgmt` names a role; `src build` names availability. Neither explicitly says off-rack or identifies the management host's physical placement. The `off-rack mgmt` group name and descriptive view title exist only in metadata, not the capture. This is the localized residency defect F09; a visible source-backed caption or location label could address it without adding an enclosure feature.

The two controller labels are **not contradictory**, and no identical-label-across-views gate is imposed. Together they preserve different facts about the same `nv-rms` identity. The source-build qualifier usefully avoids implying that entitlement-gated images are freely available. The final-spec/capture mismatch below is a different issue.

## Motion: actual origin defects, incomplete cycles, no same-arrival gate

Animation is optional in the frozen case manifest. v1 legitimately has no dots and needs no fabricated rail animation. But six routes actually animate: four in v2 and two in v3. Their presence means their behavior must be evaluated; the case cannot receive animation N/A merely because the source did not request motion.

In all 21 target-size samples, v2 has exactly one dot on each of its four animated routes; v3 has one on each of its two. No captured dot covers a label, border, corner, bridge, junction, or arrowhead. There are 84 v2 and 42 v3 dot appearances in the complete supplemental sequences. Initial shared eligible-cell progress is visible. Frames 0 and 10 show five eligible-cell advances per route; v3's first corner is skipped, so raw Manhattan displacement there is six cells rather than five.

**F03 — six known defects:**

| View | True first drawn exterior cells | Frame-0 dots |
|---|---|---|
| v2 | `(22,14)`, `(22,16)`, `(22,18)`, `(22,20)` | `(23,14)`, `(23,16)`, `(23,18)`, `(23,20)` |
| v3 | `(13,19)`, `(35,27)` | `(13,20)`, `(35,28)` |

All six dots start one drawn cell late. `origins: 4/4` and `origins: 2/2` in the checks disagree with the captures. The generator acknowledges the discrepancy. Round 04 defines the actual first drawn cell after the source port, not the internal half-cell phase. This fails animation and the explicit animated-arrow origin/direction condition.

**F04 — evidence gap, not an invented timing defect:** the supplied target-size sequences end at 2000ms before any dot reaches a head. They do not establish full-cycle behavior. Constant speed is the default, and different-length routes may correctly finish at different times. Neither the source nor user requests same-arrival here, so lack of synchronized arrival is **not** a failure. What is missing is the mandated full constant-speed cycle. The known origin defects still make the category **fail**, not merely blocked.

The frozen skill's Step 8 assertion that “21 frames at 100 ms … covers one crossing of the longest route” is not true for these constant-speed routes. It appears to have preserved an unsuitable fixed-duration capture assumption.

## Fit, grouping, and border evidence

The live app header tokens are `77x47 @100%` in all three views. All supplemental direct dumps say `viewport: 77x47 zoom: 1.00 natural`. The independent no-focus geometry probe records a **79×49** half-pane rectangle, consistent with a 77×47 interior. Individual capture manifest rectangles are null; I do not misrepresent the separate probe as three separately measured rectangles. The rubric expressly accepts the running app's measured token, so this is not a fit blocker.

All diagram boxes, labels, and heads fit without pan, zoom, or occlusion. v2's tight one-column right margin is not itself a violation. Only two UI quit hints end at `q qu`; no required diagram label is truncated.

Normal ANSI shows complete, consistent RGB perimeters for all **17/17** node occurrences. The three selected ANSI captures show all **17/17** complete borders simultaneously in bold RGB `(216,166,87)`. All sides and four corners were checked cell-by-cell, not inferred from text. This proves selected-border coverage, not individual hover/drag interactions or arbitrary unseen states. The source-concept hue families and proximity pass grouping; cross-view hue stability is not an extra gate.

## Workflow defects and evidence blockers

- **F05 — defect / binding blocker.** The named final `v2-mgmt-api.json` is rejected v2 attempt 1, hash `ef9dcfb927a6bfdf22eba4d028aad51c48a9abe20771b97e337fe83c669847c1`. The actual v2 captures and manifest show shipped a3, hash `ae706bef201671ef2eb665c51b6116d5afdfb3f9ce7151cb620dc8b69fae4000`. This review judges those actual a3 captures and explicitly does not claim they establish the named final's fit, label ownership, or source-build qualifier. The blind stage found the mismatch independently.
- **F06 — evidence gap.** All seven attempt specs and raw check text are retained, within the three-per-view budget. However exact executed command transcripts and raw numeric exits/stdout/stderr accounting for rejected/probe attempts are absent. Successful capture manifests give exit 0 and timing windows; the rejected v1-a3 error has no preserved numeric exit. Prose outcome descriptions and assertions about absolute binary paths are not the complete command/status record required by the rubric.
- **F07 — evidence gap.** The original v2/v3 live frame artifacts begin with truncated, unheaded initial frames. Complete frame 0 is supplied by pinned direct text dumps. The v1 supplemental single static frame is readable but unlisted in its manifest. This review hashes all those actual files without inventing generator-time wall clocks or retroactively repairing the manifest.
- **F08 — cleanup evidence gap/blocker.** Three evidence pane IDs (`w7E:pDN`, `w7E:pDX`, `w7E:pDQ`) and one probe (`w7E:pDY`) have confirmed-close records. Generation claims **five** panes, including two probes, but only one probe ID/close is preserved. The second probe's ownership and close cannot be verified. No leak is alleged. The pre-existing parent pane `w7E:pDH` is not generator-owned and is excluded. Cleanup is therefore `blocked` for the complete five-pane assertion, even though all four identifiable owned panes are closed.

Validator logs say all checks passed in all three views. They establish that the harness accepted those manifests, not that the displayed dots originate correctly, that the bus route is economical, or that the named final v2 was shown.

No required model or final bus-rendering capability is missing. Rejected LR trunk routing is a recorded capability limitation of that attempt, not a blocker to representing the source in TB. Static trunks are also not a blocker because rail motion was never required. The unresolved blockers concern evidence binding, complete motion sampling, executed-command records, and the fifth cleanup claim.

## Correction candidates — not performed

### Skill / generation discipline

1. Carry every required protocol and location fact into readable labels or source-backed accompanying captions; a ledger admission is not visible coverage. Do not require enclosure geometry where labels would suffice.
2. Resolve final-spec naming deterministically before capture. The reported final file and the captured/shipped file must have the same actual hash.
3. Replace the fixed 21-frame constant-speed assumption with route-length/rate-derived capture duration, including a complete cycle. Keep same-arrival explicitly opt-in.
4. Compare frame-0 dots against actual exterior origin cells, rather than trusting `origins: N/N`. Reject a known discrepancy even when the validator is green.
5. Preserve executed commands, numeric statuses, and every created pane ID/close result, including probes and failures. Register supplemental evidence in capture manifests at generation time.

### Renderer / checker / harness

1. Emit the frame-0 dot on the actual first drawn arrow cell and test that visible position; align the checker with rendered cells rather than internal phase assumptions.
2. Audit declared trunk branch paths for route economy and crossings, not only ordinary `edges`. Prefer a simple one-junction fan-out without reversing a branch across the source stem.
3. Preserve complete initial live frame headers/grids and correct per-pane geometry/probe accounting. The accepted app header already proves fit; losing provenance is a separate harness issue.

The frozen renderer is its own baseline. No renderer gain is credited to the skill, and no fix, new viewer, install, commit, source change, or subagent was used in this review.

## Deliverables and verification

- `observed-first.md` — immutable blind record; original hash retained.
- `spec-manifest.json` — deterministic sorted named-final-spec hash pairs.
- `reviewer-result.json` — all seven fixed categories, 17 per-relation/bus audits, 9 evidence-linked findings, blockers, cleanup, and 55 hashed inventory entries.
- `critique.md` — this report.

The JSON is validated locally against every keyword used in the frozen embedded result schema, with no dependency installation. Evidence references, edge/finding references, manifest hashes, frozen hashes, capture artifact hashes, and the immutable blind-record hash are checked. This is a red case; the captain must still gather all eight complete critiques before any skill revision.
