# Round 05 — homelab-nic-trace — independent Sol critique

## Verdict: FAIL

This is not a green case. The four-view candidate preserves all 14 historical directed links and their numeric identifiers, and its arrows are readable. It nevertheless has known target-size layout and border failures and loses or ambiguously expresses required source meanings. Incomplete workflow records are **blocked**, not silently passed. Known failures take precedence over the blocked category in the overall verdict.

No viewer session, host probe, repair, install, commit, or subagent was run during review. Only this review directory and a temporary offline report helper were written.

### Category matrix

| Fixed category | Applicability | Decision | Reason |
|---|---|---|---|
| semantic_fidelity | applicable | **fail** | ONT demarc/MMR role is absent; Fios identity and the border/firewall expansion are not readable; the isolated IPv6 limitation does not unambiguously preserve ULA-only versus no global IPv6. |
| arrow_traceability | applicable | **pass** | All 15 drawn arrows, including the disclosed address attachment, have identifiable stems, unique downward heads, correct directions, clear labels and near-minimal visible routes. No crossings or fake junctions. |
| layout_fit | applicable | **fail** | v2 is 80 columns; v4 is 48 rows. Both final-spec-named 77×47 dumps show overflow. v4 truncates the negative-facts annotation and clips box borders. |
| conceptual_grouping_color | applicable | **pass** | libvirt, Docker, NIC and historical-transit concepts use related nearby hue families. No tier reorder or geometry-only grouping. Bordered group headings are not an extra fixed-rubric requirement. |
| border_integrity | applicable | **fail** | All 20 normal and 20 selected borders are sound at 83×51, but target v4 loses annotation and cf border cells and its overflow UI overwrites the annotation side. |
| workflow_evidence | applicable | **blocked** | Frozen identities, manifests, attempts and static captures exist, but raw rejected/probe command/status records, target selected ANSI, and verbatim cleanup probes are incomplete. |
| animation | **N/A** | null | This source never requested animation; the frozen case index and expected data say optional. The fully static candidate has zero dots in every captured frame. |

Totals: **2 passed, 3 failed, 1 blocked applicable categories; 1 source-backed N/A.** Severity never waives a failed gate.

## Paths, identities, and frozen hashes

All evidence paths in `reviewer-result.json` and this critique are **repository-relative**, rooted at `/Users/aviral/.herdr/worktrees/dotfiles/fix-visualize-skill`. The binary's absolute path is recorded in frozen metadata and the generator bundle, but its inventory witness is the repository-local binary-hash record. The binary was independently hashed, not executed.

- Candidate skill: `ff4a9d3f32ba0bf86e54ee6bfbac02fdea3fac3b95b82a958b3411accef0a949`.
- Frozen renderer: `b1ab9f2e78af11c2f2b005eea083a999079d184bf550e8d0b6d9c51867f22404`.
- Rubric revision 6: `039b96252d25ad2078a539fdb1d081ebdb6c09d6f7a3487b96ffbbf3b082e292`.
- Dataset index: `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05`.
- Deterministic four-spec manifest: **`500ef7160e9d9b00b15f44a5768abb1287b31342ab728349d58fb9f1176cb69d`**. This is the result's `spec_sha256`, not a concatenation of invented digests.
- Blind record: **`46149b2e86c4bb8d4fbbf2afabdb8d087698ea1a026588c8a88fba9a087568d4`**. It is included as evidence ID `blind`, with `observed_first.saved_before_expected_reveal: true`. It has not been modified.

The skill, renderer, rubric, dataset index, source, expected data and historical-variant hashes all match frozen metadata. All four final spec hashes match their manifests. Every original per-view manifest artifact hash verifies, and every restored rejected spec matches its attempts-ledger hash. The review inventory additionally hashes the final target-size text dumps and the complete retained attempt records; it does not pretend those dumps were in the original per-view hash manifests.

The actual generator was **`viz-ds05-3`**, provider `fireworks`, model `accounts/fireworks/routers/deepseek-flash-latest`, as stated in generation records and the reveal. Following the full task's case-key convention, the result uses `generator.worker_id = viz-ds05-homelab-nic-trace`, with the full provider-qualified model. That is a reporting key for the actual worker, not evidence of another generator session.

The actual reviewer session identifies itself as **`viz-judge05-homelab`**, `PI_MODEL=gpt-6.1-sol`; the result uses that actual name and model `openai/gpt-6.1-sol`. There was no model switch. A stale `openai/gpt-6-astra` string remains in the rubric's workflow prose; the same frozen rubric's required reviewer model, schema and clerical revision, plus the full task, explicitly require Sol. The review follows those corrected identity fields rather than inventing an Astra run.

## Blind record versus revealed evidence

Stage A could read only captures and specs. It correctly recorded that the actual hash-bound final pane evidence is **83×51**, that the checks say `viewport: unknown`, and that the one then-pinned attempt dump was **rejected `v4-a1.json`**, with four edges rather than the final five. It also inspected additional final-named `vN-77x47.txt` files without accepting their filenames as provenance.

Stage B adds `generation.json`, `generation.md`, and `attempts.json`. These identify the four **final** target dumps and state the direct command form:

`COLUMNS=77 LINES=47 /tmp/visualize-eval/round-05/bin/rataflow-view --frames 5 specs/<view>.json`

Each dump's own viewport line says `viewport: 77x47 zoom: 1.00 natural`, and each title names the appropriate final spec. These revealed links support judging their geometry; they do not change the saved blind observations or the actual 83×51 pane measurements. v1/v3 look fitted in those direct dumps, whereas v2/v4 visibly fail. The rejected attempt is not substituted for any final view.

Missing selected ANSI at 77×47, exact raw target command/exit records and absolute target-dump capture times remain evidence gaps. `viewport.verified=false` denotes the incomplete full required target evidence set; it does not deny that the direct dumps report 77×47. `live_pane` separately records the observed 83×51.

## Findings and classification

Coordinates below are 1-based `[column,row,width,height]` **screen** coordinates, not line numbers in the surrounding transcript. Evidence IDs resolve to hashed repository-relative paths in the JSON inventory. Findings deliberately separate defects from missing evidence and operational limitations.

| ID | Classification | Severity | Concrete observation |
|---|---|---|---|
| F1 | defect | high | `v2-target` [48,2,29,1] reads `graph overflows · drag to pan`; extent 80×24 exceeds width by 3. All four node labels remain readable in this dump, so three clipped label columns must not be invented. |
| F2 | defect | high | `v4-target` [23,2,30,1] cannot show the full `no v6 (ULA), no committed rate`; warning [48,2,29,1] replaces its last five characters. cf [26,45,20,3] has no visible bottom border. Extent 34×48 exceeds the target height. |
| F3 | defect | high | Target v4 annotation top border is hidden at the header, its right side at [53,2,1,1] is replaced by overflow UI, and cf lacks its lower side/corners. This is **not** a control-palette overwrite. Larger selected capture [29,47,20,4] proves the cf border only at 83×51. |
| F4 | defect | critical | `v4-text` ONT [30,24,25,1] says `ont 169.254.3.1 · claimed` but carries no demarc/MMR role. A single chain is not an abbreviation for that source concept. The router [30,16,28,1] has `ToR/spine/BF` without a readable expansion of border/firewall, and Fios is absent. |
| F5 | defect | high | `v4-text` [25,3,32,8] places the negative-facts annotation immediately over wlp with no connector or host/egress scope. `no v6 (ULA)` does not clearly say ULA is present but global IPv6/internet is absent. No false arrow is demanded as a remedy. |
| E1 | evidence gap; verification blocker | high | Raw attempt checks exist, but none of the eleven check text files preserves the actual command plus exit status and stderr boundary. Reconstructed specs have matching hashes, which cannot reconstruct absent process status. The asserted group-heading capability probe has no saved probe capture. |
| E2 | evidence gap; verification blocker | high | Only 83×51 normal/selected ANSI exists; final 77×47 evidence is text. Target-dump raw command/time/exit records and verbatim pane close/re-probe transcripts are absent. Manifests report cleanup, and no leak is alleged. |

E1 has a concrete retained draft witness in `rejected-v4-a1-target` [24,5,19,4], but missing command/status records have no honest on-screen coordinate; the critique therefore names the corresponding attempt files and their missing record fields rather than fabricating screen locations for absent logs.

### Source meaning and identifiers

The numeric/interface coverage is strong. The immutable blind tables give every visible graph label and its rectangle, not just labels the generator calls important. In particular:

- v1: `vnet0`, `virbr0`, `veth`, `192.168.122.x`, `172.18.2.x`, bridge address `172.18.2.1`, homelab/ASUS/Linux 7.0.
- v2/v3: `tailscale0 100.113.153.49`, `bond0 192.168.1.197`, `192.168.1.197/24 · eno1`, `2.5 GbE`, rack-bench host identity, `wlp8s0 192.168.1.213`, backup, metric 600.
- v3: router `192.168.1.1`, `NAT+DHCP`, `def gw 0.5 ms`, pool `71.251.12.240`.
- v4: `169.254.3.1`, `100.41.x`, `AS701`, `1.1.1.1`, `AS13335`, `4.5 ms`, `6.6 ms`, `6-9 ms`.

Router `claimed` is visible at v3 [51,30,7,1] and v4 [51,16,7,1]; ONT `claimed` is at v4 [48,24,7,1]. Historical qualifiers are the readable abbreviation `hist` at [39,28,4,1], [39,36,4,1], and [39,44,4,1], reinforced by three dashed routes. The literal full word `historical` need not be demanded when these explicit uncertainty markers already preserve its meaning. The source does not require pretending inferred WNC/ONT roles are verified physical hardware, and the candidate does not do so.

The source's Wi-Fi distinction is substantially expressed by **backup + metric 600** versus the wired default path. There is no ECMP claim or shared trunk. I do **not** create a separate failed category merely because the literal phrase `not ECMP` is missing. Likewise, one drawn ISP chain does not itself invent redundancy. However it cannot communicate the separate **ONT demarc/MMR analogy**, which is a real source role and is missing (F4).

The annotation's label has a clear **box owner**. Its **scope** is uncertain. These are different questions: uncertain label owners remain zero; there is one scope ambiguity. At 83×51 both negative facts are fully readable, but their IPv6 qualification is ambiguous and their host/egress applicability is not encoded. At 77×47 even the trailing rate word is lost. The generator's private abbreviation/meaning ledger is not an on-view legend.

`rtr -> pool` is the sole additional drawn edge. The source explicitly supplies the household's shared egress address, and the target is visibly labeled `pool`, not a new router/ISP. I accept this disclosed **address-property attachment** rather than falsely treating it as an invented network hop. The audit also records the annotation/wlp apparent association as **blocked scope**, not a real sixteenth arrow.

## Complete directed relation audit

All route coordinates below use the 83×51 normal view. Each full label rectangle and route rectangle is also in the machine-readable audit. Each arrowhead is immediately above its target box, and each stem starts immediately below its source box. The target dumps preserve these stems, heads and edge labels; v4's missing cf bottom border is separately failed.

| Required edge | View | Observed route and label | Decision |
|---|---|---|---|
| e1 vm → virbr | v1 | Stem (64,21), head (64,24); `192.168.122.x` [51,22,13,1]. | pass |
| e2 virbr → box | v1 | (64,29) → (64,31) → (39,31) → head (39,32); `NAT bridge` [47,30,10,1]. | pass |
| e3 ctr → dkbr | v1 | Stem (10,21), head (10,24); `172.18.2.x` [12,22,10,1]. | pass |
| e4 dkbr → box | v1 | (10,29) → (10,31) → (37,31) → head (37,32); `docker bridge` [17,30,13,1]. | pass |
| e5 ts → box | v2 | Stem (32,21), head (32,24); `overlay` [34,22,7,1]. | pass |
| e6 ts → bond0 | v3 | Stem (26,17), head (26,20); `encap over UDP` [28,18,14,1]. | pass |
| e7 box → bond0 | v2 + v3 | (32,29) → (32,31) → (5,31) → head (5,32); `2.5 GbE` [16,30,7,1]; `eno1` on the same addressed bond0 in v3 [51,22,4,1]. | pass |
| e8 box → wlp | v2 + v4 | (34,29) → (34,31) → (59,31) → head (59,32); `backup` [43,30,6,1]; same wlp continues to gateway with metric 600 in v4. | pass |
| e9 bond0 → rtr | v3 | Stem (26,25), head (26,28); `def gw 0.5 ms` [28,26,13,1]. | pass |
| e10 wlp → rtr | v4 | Stem (30,11), head (30,14); `metric 600` [32,12,10,1]. | pass |
| e11 rtr → ont | v4 | Stem (30,19), head (30,22); `NAT out` [32,20,7,1]; claimed device identities. | pass |
| e12 ont → vzagg | v4 | `╎` (30,27–29), head (30,30); `4.5 ms hist` [32,28,11,1]. | pass |
| e13 vzagg → vzbb | v4 | `╎` (30,35–37), head (30,38); `6.6 ms hist` [32,36,11,1]. | pass |
| e14 vzbb → cf | v4 | `╎` (30,43–45), head (30,46); `6-9 ms hist` [32,44,11,1]. | pass |
| Extra e15 rtr → pool | v3 | Stem (26,33), head (26,36); `NAT egress` [28,34,10,1]; source-backed address attachment. | pass |
| Extra apparent annotation scope | v4 | Limits bottom row 6 next to wlp top row 7, but no stem/head/connector. Not counted as a drawn edge. | blocked |

No required directed edge is missing or reversed. The semantic failure is not a fabricated missing-edge count: source roles and qualifications are additional meanings that also have to pass.

There are **0 visible crossings, 0 bridges, 0 touching-bend collisions, 0 route junctions and 0 shared-run cells**. Eight ordinary bends occur on the four monotonic two-bend routes. v1's converging lines retain blank column 38 between their inward bends/heads; v2's fan-out retains blank column 33 between its two independent ports. A box-level fan-out or convergence is not a branch junction on a common line. No source-named bus is required for this case, so no trunk is demanded.

The lack of a `routes: N/M near-minimal` check line is documented as an intentional frozen-binary omission after the revert. It is **not** itself a capability blocker or invented failure. Visible routing is economical; no unjustified loop or obstacle-free backtrack was found.

## Borders, hues, and motion

The normal/selected ANSI grids have 51 rows × 83 cells. After stripping ANSI and right padding, their geometry agrees with the text captures. Across all four views, 972 node perimeter positions per state were checked. Every normal node border is color-continuous; every selected node border is bold RGB (216,166,87). **Selected occurrence coverage is 20/20**: 5/5, 4/4, 4/4, 7/7. The evidence is selected-all, not 20 separately observed interactive selection transitions.

No node-border cell is overwritten by the **control palette** at 83×51. In target v4 the separate **overflow warning**, not the bottom-left palette, overwrites part of the annotation's right border. The clipping/header issue also removes the annotation upper border and cf lower border. Correct larger-pane color continuity cannot repair missing target cells, and text cannot prove target selected-state color continuity.

The generator's D7 describes selection as color-only. That is not an independent defect under this rubric: ANSI is expressly accepted, and the selected evidence also adds bold. Plain-text equality does not invalidate valid ANSI selection evidence. Similarly, its D3 about absent group titles identifies a skill/capability mismatch but does not fail conceptual grouping when hue families and proximity are actually correct.

The frozen case manifest and expectations say animation optional, and the source contains no requested motion. Each view has five timestamped pane frames at 0/100/200/300/400 ms, and five in its direct target dump. The diagram grids are unchanged. All 15 routes have dot counts `[0,0,0,0,0]`; zero dot glyphs or violations were found. Mid-dot label/header separators and fixed dashed glyphs are not animated dots. Origin/arrival `0/0` results are vacuous, not animation passes. A full lap is inapplicable to this static case.

## Structural limitation: credit the honest stop, do not waive the gate

The retained records support a specific layout limitation of the **executed split**:

- v2 checked candidates were 82×24 with an ambiguous owner, then 80×24, then 80×24. Shortening labels did not remove the two-node/two-label fan-out width.
- Final v4 is a six-rank chain: `wlp → rtr → ont → vzagg → vzbb → cf`. Its height is 48 rows. Removing the annotation in v4-a3 left 34×48, demonstrating that the chain, not the negative-facts annotation, sets the height.
- Rejected v4-a1 measured 31×40 with four edges. It lacked e10 (`wlp → rtr`) and had overlapping annotation boxes. Rejecting it was correct: a smaller graph with a missing relation is not a successful repair.
- The tested rank spacing is consistent with eight rows per rank: five ranks fit in 40 rows, six consume 48. A target 47-row view cannot contain that unchanged six-rank layout at 100%.
- The frozen skill asks for two to four views. A fifth view splitting WAN transit is therefore outside the tested allowed plan. Moving e10 to v3 was argued to recreate a wide two-node rank; it was not a successful executed remedy.

This is an **operational/layout blocker** for the tested plan and a known failed gate, not permission to ship green. Neither the remaining view budget nor a spent three-candidate budget weakens the rubric. The generator disclosed the miss and retained source links instead of deleting e10, which is the correct behavior when blocked.

The records do **not** prove a universal impossibility theorem for every allowed orientation and split. All final views are tb; no complete lr alternative was executed here. The frozen skill actually recommends lr for five-plus layers. Without an executed alternative, I cannot promise that direction fixes this label-heavy chain, or assert that no four-view encoding could ever fit. No new sessions were run to decide that question.

## Workflow evidence and cleanup

Positive evidence:

- Frozen skill, binary and dataset identities verify; separate generator and Sol reviewer identities are preserved.
- The blind-first record is sealed and referenced with its original hash.
- Four final specs, all corresponding text/ANSI/selected captures, checks, validator records and five-frame static captures are present.
- The running app's own `83x51 @100%` header and `viewport: 83x51 zoom: 1.00 natural` transcript line prove actual pane size; no hardcoded pane geometry is substituted.
- Final per-view manifests record `check_exit: 0` and capture windows.
- Eleven attempt check records and restored rejected specs are retained; all declared draft hashes verify.
- v2/v4 validator records honestly fail `viewport_matches_target`; their generator does not claim green.

Blocked evidence:

- Rejected check files contain the check text but no verbatim exact command/status/exit record or distinct stderr evidence. An assertion of success and a reconstructed spec hash cannot supply these missing process records.
- The claimed unrendered-group probe has no preserved actual probe capture; the final captures do show that there are no group headings, but do not retroactively become that rejected probe's raw execution log.
- Direct target dump commands are recorded as templates; their exact per-run wall-clock/exit transcripts are absent. Selected normal ANSI at 77×47 is also absent.
- Cleanup is reported in manifests, not supported by a verbatim close/re-probe transcript. This is a verification gap, **not an allegation of a leaked pane**.

Reported cleanup records:

| View | Owned pane | Preserved outcome |
|---|---|---|
| v1 | `w7E:pGP` | `confirmed_closed` |
| v2 | `w7E:pGQ` | `confirmed_closed` |
| v3 | `w7E:pGR` | `confirmed_closed` |
| v4 | `w7E:pGT` | `confirmed_closed` |

`cleanup.status=done` reports those four manifest outcomes. It does not pretend I ran a fresh close or probe. The review created no live panes. No unsupported model or missing viewer binary was substituted.

## Correction candidates — not implemented

### Skill-level

1. Make the meaning ledger reject semantic loss even when a fact is marked abbreviated: ONT demarc/MMR, Fios identity, border/firewall and ULA-only versus no global egress need readable text or an on-view key.
2. Encode host/egress scope in the negative-facts annotation itself or a supported non-flow annotation mechanism. Do not invent a traffic relation for a limitation.
3. Preflight the full depth/width and the four-view budget before spending candidates. Stop with the exact unsupported split if all tested options overflow. Do not trade a required relation for fit.
4. Make the evidence contract retain actual commands, exit/stderr records, target capture hashes/times, rejected probe output and verbatim cleanup probes. Missing required evidence stays blocked.
5. Remove or qualify promises that `group` draws titled bordered blocks when this frozen binary demonstrably supplies only hue grouping. This is documentation alignment, not permission to weaken the grouping gate.

### Renderer-level

1. Consider a compact rank spacing or composition mode that preserves complete labels and ports for six-rank terminal chains. A new renderer would require its own frozen binary and measured baseline; it is not a skill-only gain.
2. Examine the minimum width of labeled fan-out ranks (observed 80 columns) without merging independent uplinks or dropping identifiers.
3. Keep overflow/header/minimap UI from replacing node labels and borders; a failed fit must remain explicitly failed even if UI placement becomes safer.
4. Consider host-scoped non-edge annotations and, if genuinely needed, observable group-label support. These are capability candidates, not prerequisites added to the fixed rubric.

No correction above was applied. The captain must gather all eight complete critiques before any revision.

## Deliverables and verification

- `observed-first.md` — immutable stage-A record, unchanged original SHA-256 above.
- `spec-manifest.json` — sorted repository-relative path/actual SHA-256 entries for all four final specs.
- `reviewer-result.json` — embedded-schema-conforming result, all seven category keys, 14 required edge audits, the source-backed address attachment, the annotation apparent-scope audit, evidence-linked findings, blockers and cleanup records.
- `critique.md` — this report.

Verification was offline with `uv run --no-project python`: every frozen input and evidence-inventory hash, original artifact manifest, rejected spec hash, evidence reference and coordinate bound was checked. The embedded result schema's used vocabulary was validated with a small standard-library checker (refs, oneOf/allOf, types, required/properties/additionalProperties, enums/const, lengths, patterns, numeric/item bounds and uniqueness); `jsonschema` is not installed, and no dependency was installed. The blind hash was verified unchanged before and after result generation.
