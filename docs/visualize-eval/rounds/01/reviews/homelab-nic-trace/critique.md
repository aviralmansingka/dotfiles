# Stage B critique — homelab-nic-trace — round 1

## Verdict: FAIL

**Selected-state coverage correction:** the original review incorrectly treated sound observed perimeters as complete selected-state coverage. Only 3 of 16 node occurrences are shown selected. `border_integrity` and `workflow_evidence` are therefore **blocked**, not pass. The original files are preserved byte-for-byte as `reviewer-result.superseded-selected-coverage.json` and `critique.superseded-selected-coverage.md` in this review directory. The blind record is unchanged; no new rendering or source changes were made.

The sample has complete visible boxes, readable individual strings, qualified router/ONT identities, and the correct **structural** inventory of 13 reference nodes and 14 directed relations across three views. It does not meet the frozen rubric: label meaning/source coverage is incomplete; some labels cannot be assigned uniquely to a route; touching bends and moving dots create false route continuity; and layer colors do not consistently represent source concept groups.

This is an independent Astra judgment, not acceptance of the generator's clean checks. No fixes, renderer executions, pane operations, installs, or subagents were performed. No renderer gain is credited to the skill: round01 is a separately frozen renderer baseline. Cancelled round00 contributes no evidence or score.

## Provenance and path convention

All report/evidence paths are relative to the repository root. The only external executed-input path is the frozen binary `/tmp/visualize-eval/round-01/bin/rataflow-view`, recorded in metadata and independently hashed without execution. Its fingerprint is preserved in the repository-relative `hash-verification.json` evidence record.

- Generator: `viz-ds01-homelab-nic-trace`, `fireworks/accounts/fireworks/routers/deepseek-flash-latest`, recorded isolated session `01a19b5b-df9f-71fc-8aa3-540bc3465404`.
- Reviewer: `viz-judge01-homelab-nic-trace`, `openai/gpt-6-astra`. Current environment independently reports that name, model and provider.
- Blind observation SHA256 verified before Stage B and left unchanged: `0485b74aac7129fdd5771c4ae12bdb6319b4615d1e5122ea3c992984219fdced`.
- Candidate skill: `9c5cea272a88300644cacda52c853c7c9169eeec91f0355d3460ee8741308d92`.
- Frozen renderer: `4a883e73b822f009c504bd21d0c2fc383067bf1b83b9791ccbda431912e3a1d8`.
- Rubric: `60997237bd996f1e1b6a16e0b68133859b9f03fd83c85e7f508e286743240f5d`.
- Dataset manifest: `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05`.
- Deterministic sorted spec-pair manifest: `8631a1f0dd2f47e662ed11eb851e77a1bc1eec48764d5bddc34e90e6449cbb0e`.

All 56 checked input/final-evidence hashes match their frozen records. The JSON result inventories 61 evidence items with actual hashes, including all final raw captures and frames, source/expected data, commands, sizes, checks, blind observations, and independent verification artifacts. No sibling case or previous-round content was reviewed.

## Category matrix

| Frozen category | Decision | Basis |
|---|---|---|
| semantic_fidelity | **Fail** | F1–F3: address/role meaning and an egress limitation are missing from the pane; view2 label ownership is ambiguous. Correct edge JSON does not supply missing visual meaning. |
| arrow_traceability | **Fail** | F4–F5: touching independent bends and dot-covered corners produce false continuations in views 1 and 2. |
| layout_fit | **Fail** | Geometric fit passes. The frozen category also requires complete source coverage across split views; omitted required meaning is not rescued by a smaller spec or an off-pane glossary (F7). |
| conceptual_grouping_color | **Fail** | F6: related Verizon hops get unrelated hues by depth; repeated host/NIC concepts change hues across views without a semantic key. |
| border_integrity | **Blocked** | All observed perimeters are sound, but only 3 of 16 node occurrences have selected-state evidence. The other 13 cannot pass by extrapolation from unselected borders. |
| workflow_evidence | **Blocked** | Hashes, identities, blind-first record, commands/checks, timestamps, dimensions and cleanup remain supported; required every-node selected-state coverage is missing. |
| animation | **N/A**, not a pass | `cases.json` and this case's `expected.json` explicitly say optional; the quoted user asked for a layout, not animation. Unrequested motion damage is still failed under traceability. |

Result: **0 passed applicable categories, 4 failed applicable categories, 2 blocked applicable categories, 1 source-backed N/A**. Required relation audits: **8 pass, 6 fail**. Four additional *apparent* joins/port continuations are audited as traceability defects, not promoted to four proven extra topology edges. Findings: one critical, five high, one medium. No known failure is downgraded to blocked.

## Source qualifications and concept coverage

The human chose the rack-bench homelab, not the devbox. The source expressly treats traceroute and MAC-vendor roles as historical interpretations. The rendered `Fios router?`, `ONT?`, and `(hop)` tags satisfy that qualification. I do not verify these device identities, convert the chain into a proven physical topology, or claim the millisecond labels are independently measured per-link transit times.

| Source concept | Actual display and coverage |
|---|---|
| homelab rack-bench host | `homelab host` repeats in v1/v2. Host identity is recognizable; rack-bench role is not displayed. No devbox substitution is visible. |
| VM vnet0 | Exact label in v1, `[24,15,10,4]`. |
| virbr0 libvirt NAT | `virbr0 NAT`, v1 `[23,23,12,4]`; libvirt role omitted. |
| container veth | `Container veth`, v1 `[40,15,16,4]`; capitalization is harmless. |
| docker bridge 172.18.2.1 | `docker0 172.18`, v1 `[40,23,16,4]`; bridge relation exists, but address is irrecoverably shortened without the report. |
| tailscale0 100.113.153.49 | `tailscale0 .49`, v2 `[2,20,16,5]`; full overlay address cannot be inferred from a suffix or from the general Tailscale prefix. |
| bond0 192.168.1.197 over eno1 2.5 GbE | `bond0 .1.197`, v2 `[63,20,14,5]` and v3 `[24,3,14,4]`; wired edge string exists but its association is weak. No visible LAN prefix key restores the address. |
| wlp8s0 Wi-Fi .213, backup metric 600 | `wlp8s0 .213`, v2 `[63,26,13,4]` and v3 `[47,3,13,4]`; `backup` and `metric 600` preserve standby semantics across the split. Explicit Wi-Fi role is omitted. Nothing positively claims ECMP. |
| Fios gateway 192.168.1.1, qualified role | `Fios router? .1.1`, v3 `[21,11,19,4]`; qualification survives, address prefix does not. |
| Claimed ONT 169.254.3.1 | `ONT? 169.254.3.1`, v3 `[22,19,18,4]`; identity qualified and address complete. |
| Verizon aggregation / edge 100.41.x | `VZ agg 100.41.x (hop)`, v3 `[19,27,23,4]`; acceptable source-backed shorthand and hop qualification. |
| Verizon backbone AS701 | `VZ backbone AS701 (hop)`, v3 `[18,35,25,4]`; source meaning and order preserved. |
| Cloudflare 1.1.1.1 | Complete label, v3 `[21,43,20,4]`. |
| Historical egress scope and addressing | ULA-only IPv6/no global IPv6 internet, shared NAT public address `71.251.12.240`, and LAN `192.168.1.0/24` context are not displayed in any view. `NAT out` preserves only the NAT relationship, not all these facts. |

F2 is critical because suppressing the explicit no-global-IPv6 limitation removes a source egress/reachability concept, not because the judge demands an invented IPv6 topology edge. A qualified annotation could preserve it without claiming a new physical relationship. The source's OS/run dates and datacenter-model analogy are contextual prose, not extra node/edge requirements invented for this review. The required address and egress meaning cannot be waived merely because `expected.json` labels its edge list a historical reference.

The generator's private abbreviation table supplies missing meanings only after reveal. It is not present in the raw pane. In particular, `docker0 172.18` is not a unique abbreviation for `172.18.2.1`, and `.49` does not specify `100.113.153.49`.

## All source-relation audits

All coordinates use **1-based `[column,row,width,height]` capture regions**, not graph/world coordinates. Full bend traces, edge-label rectangles, source references and findings are in `reviewer-result.json` and the unchanged blind report.

| Directed source relation and meaning | View | Source stem; target arrowhead | Decision |
|---|---|---|---|
| vm → virbr: `192.168.122.x` | v1 | `[25,19,1,2]`; `[24,22,1,1]` | Pass: isolated left jog, label clearly attached. |
| virbr → box: `NAT bridge` | v1 | `[24,27,1,2]`; `[23,30,1,1]` | Fail: touching bridge arrival bends, F4. |
| ctr → dkbr: `172.18.2.x` | v1 | `[41,19,1,3]`; `[41,22,1,1]` | Pass: direct drop with clear label. Node-address loss remains F1. |
| dkbr → box: `docker bridge` | v1 | `[41,27,1,2]`; `[25,30,1,1]` | Fail: independent bend indistinct from neighboring virbr bend, F4. |
| ts → box: `overlay` | v2 | `[18,23,1,1]`; `[30,21,1,1]` | Fail: neighboring upper-source bend plus ambiguous label binding, F3/F5. |
| ts → bond0: `encap over UDP` | v2 | `[18,21,1,1]`; `[62,21,1,1]` | Fail: outer skip route has packed bends at both ends; `UDP encap` ownership unclear, F3/F5. |
| box → bond0: `eno1 2.5 GbE` | v2 | `[45,21,1,1]`; `[62,23,1,1]` | Fail: neighboring opposing bends plus label between runs, F3/F5. |
| box → wlp: `backup path` | v2 | `[45,23,1,1]`; `[62,27,1,1]` | Fail: label is clear, but its down-turn touches the lower bond arrival, F5. |
| bond0 → rtr: `default gw 0.5 ms` | v3 | `[25,7,1,1]`; `[22,10,1,1]` | Pass: distinct wired route. |
| wlp → rtr: `metric 600` | v3 | `[48,7,1,2]`; `[24,10,1,1]` | Pass: distinct leftward backup route, label directly above its run. |
| rtr → ont: `NAT out` | v3 | `[22,15,1,2]`; `[23,18,1,1]` | Pass: qualified roles, isolated path. |
| ont → vzagg: `4.5 ms` | v3 | `[23,23,1,2]`; `[20,26,1,1]` | Pass: historical annotation preserved, no crossing. |
| vzagg → vzbb: `6.6 ms` | v3 | `[20,31,1,2]`; `[19,34,1,1]` | Pass: source order and hop tags preserved. |
| vzbb → cf: `6-9 ms` | v3 | `[19,39,1,2]`; `[22,42,1,1]` | Pass: clear isolated final route; palette stays left. |

There are no source-named buses here. The real fan-outs have separate departure ports: Tailscale to host/bond, and host to wired/backup. The real fan-ins terminate at distinct arrowheads on host, bond and router. A shared corner contact is not an authorized bus junction.

### Extra apparent connections, not invented edges

- **v1 selected `[23,29,4,2]`:** the virbr and docker arrival bends appear joined when adjacent gold dots replace corner direction. Upstream connectivity at this local contact remains unknown in that instant. No new virbr→docker edge is asserted.
- **v2 frame02 `[28,21,3,1]`:** the upper Tailscale encapsulation source appears able to continue into the host arrow instead of bypassing it.
- **v2 unselected `[60,21,3,1]`:** the upper host run appears able to continue into the upper bond arrow that actually belongs to the outer Tailscale route.
- **v2 frame02 `[59,23,4,1]`:** the backup run appears able to continue into the lower bond arrow instead of descending toward Wi-Fi.

Other frames expose enough bends to reconstruct the intended paths, as Stage A recorded. That does not eliminate a false-continuity defect in the displayed changing states. None of these is scored as a critical invented topology relation; they are high-severity failures of reliable arrow interpretation.

### Label association remains uncertain after reveal

`overlay` at v2 `[20,22,7,1]` is between both Tailscale runs. `eno1 2.5 GbE` at `[47,22,12,1]` is between both host runs. `UDP encap` at `[51,20,9,1]` sits above a different horizontal route while also adjacent to its intended outer descent. The intended assignments are now known from JSON; the original blind ambiguity remains. By contrast, shortening `encap over UDP` to `UDP encap`, or `backup path` to `backup`, is not itself a semantic defect.

## Dimensions, complete borders and color

Actual terminal content was measured separately before each launch: `stty size` is `47 77` in all three command/size records. This is the `live_pane` dimension reported in JSON; target viewport is separately recorded as 77×47, natural100%. The generation narrative claims a 79×49 outer Herdr rectangle including chrome, but that is not substituted for the measured terminal area. The frozen launch records no fit, pan or zoom input; all actual ANSI grids are 77×47.

- v1 graph bounds: `[22,15,34,20]`.
- v2 graph bounds: `[2,18,75,12]`; rightmost border is column76.
- v3 graph bounds: `[18,3,42,44]`; bottom border is row46.
- Controls: `[2,41,9,6]`, clear of the graph in all views.

The generator's statement that row46 is the last row with no bottom margin is inaccurate: ANSI includes blank row47. Text strips that final blank row. Header help tails are incomplete, but no displayed graph label is physically clipped. The layout category failure is **only its explicit complete-source-coverage conjunct**, not an invented overflow, minimum-margin, identical-orientation, or straight-edge requirement.

Independent `cell-audit.json` validates **80 repeated perimeter observations**, not complete per-node selected-state coverage. Reinspection of the existing raw ANSI confirms sound unselected borders for all 16 node occurrences and sound selected borders for only these three:

| Selected occurrence | Exact repository-relative raw evidence | Capture region |
|---|---|---|
| v1 homelab host | `docs/visualize-eval/rounds/01/homelab-nic-trace/captures/v1-selected.ansi` | `[22,31,14,4]` |
| v2 bond0 .1.197 | `docs/visualize-eval/rounds/01/homelab-nic-trace/captures/v2-selected.ansi` | `[63,20,14,5]` |
| v3 bond0 .1.197 | `docs/visualize-eval/rounds/01/homelab-nic-trace/captures/v3-selected.ansi` | `[24,3,14,4]` |

Each listed selected perimeter is uniformly bold gold. No other node in those captures is selected. Every supplied `vN-unselected.ansi` and `vN-frame01.ansi` through `vN-frame03.ansi` is unselected; animation repetition does not expand selected-state coverage.

**Missing selected occurrences (13):**
- v1: VM vnet0 `[24,15,10,4]`, Container veth `[40,15,16,4]`, virbr0 NAT `[23,23,12,4]`, docker0 172.18 `[40,23,16,4]`.
- v2: tailscale0 .49 `[2,20,16,5]`, homelab host `[31,20,14,5]`, wlp8s0 .213 `[63,26,13,4]`. The host selected in v1 does not cover its v2 occurrence.
- v3: wlp8s0 .213 `[47,3,13,4]`, Fios router? .1.1 `[21,11,19,4]`, ONT? 169.254.3.1 `[22,19,18,4]`, VZ agg 100.41.x (hop) `[19,27,23,4]`, VZ backbone AS701 (hop) `[18,35,25,4]`, Cloudflare 1.1.1.1 `[21,43,20,4]`.

No dot or arrow occupies any observed node border cell. No distinct selection handle glyph is visible; rendered attachment positions are intact in the states supplied. These observations do **not** prove the missing selected states. Border integrity is blocked for missing evidence, not failed for an observed border defect. No additional hover/drag state is imposed, and no new capture was requested or produced.

Local families are useful: virtual endpoints gold, virtual bridges teal; wired/backup NIC peers pink in v2. But v3's source-related Verizon hops are green `(169,182,101)` and blue `(125,160,184)` at `[19,27,23,4]` and `[18,35,25,4]`. Their distinction follows serial depth, not a source-defined semantic family. The repeated host changes pink→teal; repeated NICs change pink→gold. Source order is correct, but the conceptual color gate fails at medium severity. Color continuity is sound within every observed individual border; the complete border category remains blocked by missing selected-state coverage.

## Optional animation

Actual frame timestamps, from the frozen command logs:

| View | Frame01 / Frame02 / Frame03 UTC |
|---|---|
| v1 | 2026-11-02 08:30:09 / 08:30:10 / 08:30:11 |
| v2 | 2026-11-02 08:29:38 / 08:29:39 / 08:29:40 |
| v3 | 2026-11-02 08:29:54 / 08:29:55 / 08:29:56 |

Four local paths, three host/NIC paths, and five WAN paths have changing dots. The two Wi-Fi backup relations have no flow dots. Dot positions stay away from labels and node borders. Dots do replace route turns, which causes F4/F5. The skill/spec's `flow: 0.25` is configuration, not actual-render proof of slow speed. At one-second sampling and with repeated dots, phase aliases; neither unique particle direction nor measured speed is certified. This does not block an optional-animation case or earn it an animation pass.

## Workflow and cleanup

Final `--check` logs preserve command, UTC, merged stdout/stderr and exit0: extents are 35×21, 76×12, 43×45 with no reported warnings. These establish executed check outcomes only, not visual success. Final capture commands plus the preserved capture script identify text/ANSI reads, timestamping, one Tab-selected node per view, measured size and self-closing viewer invocation. They do not establish selection coverage for every node occurrence; this evidence gap blocks workflow_evidence despite the otherwise supported provenance and cleanup.

Generation records these owned panes closed: `w7E:p34`, `w7E:p3T`, `w7E:p45`, `w7E:p4D`, `w7E:p4N`, `w7E:p4S`, `w7E:p4V`. Final command logs record quit/self-closing cleanup; the generation manifest additionally records cleanup of earlier attempts and no failures. This is a frozen-record audit, not a live assertion based on newly queried panes. The reviewer owned no panes. No raw art was pasted into a narrative chat reply.

## Correction candidates — not applied

**Skill-level candidates**

1. Preserve addresses, role words, and egress limitations in a source-to-visible-concept ledger as well as an edge ledger. Abbreviate only when a visible key makes the original meaning recoverable. Keep historical qualifiers.
2. Treat printed-but-unassigned edge labels as defects. Require a blind reader to bind each label to a unique stem/route before consulting JSON.
3. Test opposing adjacent bends in several animation states. Distinct ports and no shared cells are insufficient. If a split is needed, preserve every relation and make repeated concepts explicit.
4. Do not promise conceptual grouping merely from geometric `layers`. Check source families across serial hops and repeated views; record an unsupported color-control need instead of relabeling geometry as semantics.
5. Optional motion may be omitted if it destroys traceability. For required-motion cases, require evidence that resolves motion rather than inferring direction/speed from aliased samples.

**Renderer-level candidates**

1. Separate opposing bends with visible route clearance, or give crossings/near-contacts an unambiguous rendering treatment. Investigate F4/F5 locations, not only shared-cell counts.
2. Preserve corner direction when drawing moving dots, so a dot cannot erase the cue that prevents a false continuation.
3. Associate labels with an unambiguous segment/leader instead of placing them at equal distance between independent routes.
4. Decouple source concept color families from layout depth and preserve concept identity across split views. The frozen documented skill interface demonstrates layer-driven color only; a separate grouping capability has not been demonstrated in these inputs.

These are distinct candidates, not claims that a skill-only edit can repair renderer-level behavior. No new requirement is imposed for single-view rendering, uniform orientation, perfectly straight paths, or a larger margin.

## Blockers and next boundary

Selected-state captures for the 13 occurrences listed above are missing. That evidence gap blocks border_integrity and workflow_evidence; it is not proof of a rendering capability failure or a broken selected border. Model identities, frozen hashes, existing final captures and cleanup records remain supported. The overall verdict remains FAIL because the four known category failures are unchanged. The frozen color interface's ability to express ordered same-family hops independently of layers is **unresolved**, not established unsupported from these captures alone. Animation rate/direction remains unmeasured, but applicability is explicitly N/A. None of these uncertainties hides the known failures.

The captain must gather all eight complete critiques before proposing or applying a new skill candidate. This review makes no changes and no cross-case score claim.

## Deliverables

- `docs/visualize-eval/rounds/01/reviews/homelab-nic-trace/reviewer-result.json`
- `docs/visualize-eval/rounds/01/reviews/homelab-nic-trace/critique.md`
- `docs/visualize-eval/rounds/01/reviews/homelab-nic-trace/spec-manifest.json`
- `docs/visualize-eval/rounds/01/reviews/homelab-nic-trace/hash-verification.json`
- `docs/visualize-eval/rounds/01/reviews/homelab-nic-trace/cell-audit.json`
- Unchanged `docs/visualize-eval/rounds/01/reviews/homelab-nic-trace/observed-first.md`
- Superseded original `docs/visualize-eval/rounds/01/reviews/homelab-nic-trace/reviewer-result.superseded-selected-coverage.json`
- Superseded original `docs/visualize-eval/rounds/01/reviews/homelab-nic-trace/critique.superseded-selected-coverage.md`
