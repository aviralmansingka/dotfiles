# Independent review — server-nic-layout, round 02

## Verdict: FAIL

The sample is not green. The two views have readable, complete boxes and nine independently traceable arrow occurrences, but their union loses source content and leaves one required relationship label's owner uncertain.

**Judge:** `viz-judge02-server-nic-layout`, `openai/gpt-6.1-sol` (actual session reports `PI_MODEL=gpt-6.1-sol`). **Generator:** `viz-ds02-server-nic-layout`, `fireworks/accounts/fireworks/routers/deepseek-flash-latest`. Frozen metadata and generation records explain the original `viz-ds02-undefined-4` tab label; the corrected case identity is not a second generator.

This is the new round-02 renderer baseline, not a skill-only improvement measurement. No round-01 result or earlier renderer comparison was read or credited. The rubric's isolated `gpt-6-astra` wording in `workflow_evidence.pass_iff` is stale: its required model field, embedded schema, frozen metadata, and stage-B contract explicitly require Sol, which is the reviewer used here.

All evidence paths in the JSON report are relative to the repository root. Capture coordinates are 1-based `[column,row,width,height]`, including the viewer header as row 1. Timestamped frame coordinates restart at each frame's viewer header, not at the top of the surrounding shell transcript.

## Seven-category decisions

| Category | Status | Decision |
|---|---|---|
| `semantic_fidelity` | **fail** | The public address-prefix key is absent; server2's model is omitted; `same /29` has an uncertain owner. Eight source endpoint pairs exist, but JSON coverage is not complete visible semantic coverage. |
| `arrow_traceability` | **pass** | Nine route occurrences representing eight source relations have complete stems and unique correctly directed arrowheads. Zero crossings, bridges, shared runs, outside-box junctions or fake branches. Label ownership is separately defective, not geometric endpoint tracing. |
| `layout_fit` | **fail** | Geometric fit passes for both 77×47, natural-100% captures. The category also explicitly requires complete source coverage across split views, which the missing address/model content violates. **The corner-touching label is not what fails this category.** |
| `conceptual_grouping_color` | **pass** | ANSI demonstrates related port, host and transit hue families and meaningful local placement/order. No source bus or tier is misrepresented. Cross-view hue stability is not a separate gate. |
| `border_integrity` | **pass** | 11/11 normal and 11/11 all-selected node borders have complete sides/corners and continuous per-node color. Zero uncheckable node occurrences in these states. |
| `workflow_evidence` | **pass** | Frozen input/artifact hashes verified; proper separate generator/reviewer identities; immutable blind record; recorded commands, merged check output/exit, captures, timestamps, dimensions and cleanup. The documented independent-pane rectangle limitation is reported, not hidden. |
| `animation` | **N/A** | `applicable=false`, `status=null`: the frozen case manifest and expected file mark animation optional, and the supplied task does not request it. The six volunteered animated routes **do not establish direction or slow cadence**. They earn no animation pass. |

There are four passed categories out of six applicable categories. A source-content defect can fail both semantic fidelity and the layout category's explicit split-coverage clause without being counted as two separate findings. Findings F1–F3 are the distinct defects; the record does not add a duplicate layout finding merely to inflate severity counts.

## Stage-A record and verified identity

`observed-first.md` remains exactly as saved before expectations were revealed:

`4d5c10e3851453b825e6bd625ac97b0561248f5c1d0bea9c86521be1bea333b8`

Its coordinates, one uncertain label owner, zero clipping/crossings, complete selected borders, and two-position motion observations are unchanged. Stage B applies the revealed rubric and source; it does not rewrite observations to match expectations.

### Reproducible input hashes

These are actual SHA-256 values, recomputed from the named bytes and compared with frozen metadata/manifests:

| Input | SHA-256 |
|---|---|
| Frozen `rounds/02/SKILL.md` | `7d1ff098d3ff460046e794c29925482ffd0ccb8c6fa493bc390758d976b75d70` |
| Frozen executed binary | `ee085c0f3a82e9b7d516cde7532f394864b3490c99691cd7ac5b2d36d640e8ea` |
| `rounds/02/rubric.json` | `555e3b1d5881449b79eb1dc1d9538df2c4fe0880aa850becbf9060c1bf42f86f` |
| `cases.json` | `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05` |
| Case `source.md` | `235d296fef435710c8a49bcd247455c8c82b844e71726f146c4cedf227d0308b` |
| Case `expected.json` | `ada8d8b1b8a3dfda4221b22fd1bb785327d6eeda69834c35ab5ab17b0678afb4` |
| Final `server-nic-layout/v1.json` | `da86859d62efecd2c25ab261c2ddb7644fefd8ae6cfeec3b16bed07661c637d0` |
| Final `server-nic-layout/v2.json` | `8f4ccba2eacadae5c1a24157a44c42ced9ba87d304c0d3e5be5f96022e7cdfa7` |
| Review `spec-manifest.json` | `32d783a9801c305d12fb0d69d9d9444e2ba7cee2921cb6d95a36fbfb76698de7` |

The spec manifest is a deterministic JSON array of path/hash objects, sorted by repository-relative spec path, serialized with sorted keys and a final newline, without a timestamp. `reviewer-result.json.spec_sha256` hashes that file, not a spec concatenation or an unverified generator assertion. The JSON evidence inventory includes this manifest and both specs individually.

The executable lives outside the repository at `/tmp/visualize-eval/round-02/bin/rataflow-view`; it was rehashed **without executing it**. Repository-relative `evidence/v1/bin.sha256` and `evidence/v2/bin.sha256` attest its executed absolute path/hash. All seven artifact hashes in each final capture manifest were verified. The superseded capture's artifact hashes and archived a4 spec hash were also verified for provenance and cleanup, not scored as a final view. The frozen capture/validate/aggregate script hashes match metadata. No current renderer source tree was substituted for executed evidence.

## Source and concept comparison

The `expected.json` file explicitly calls its relations historical generated references, not independent fact verification. The source's qualifications therefore override its old `no cable`, `free`, and `ToR` wording.

| Source concept or qualifier | What the capture shows | Assessment |
|---|---|---|
| server1, Dell R7725, public `103.19.91.58` | `server1 R7725 .58` at v1 `[29,20,17,1]` | Host/model recognizable, but full public address cannot be recovered: F1. |
| server2, also Dell R7725, public `103.19.91.59` | `server2 .59` at v1 `[12,36,11,1]` | Identity is shortened without a prefix key, and the shared model association disappears: F1/F2. |
| Eight physical interfaces, exactly one active; seven dark | `7 of 8 ports dark`, `eno16595np0 25GbE`, `only uplink` | Count, active identifier and speed are visible; no false cable-absence assertion. |
| Dark ports do not prove no physical cable | Dashed dark→server1 link, `no link seen` | Correctly qualified. Do not require the obsolete `no cable` label. |
| `/29` with gateway `.57`, server1 `.58`, server2 `.59`, remaining `.60-.62` | Abbreviated nodes and `same /29` | Most address suffixes survive, but the prefix is absent and the subnet label's server2 ownership is uncertain: F1/F3. |
| Remaining addresses are not proven free by failed probes | `.60-.62 (free?)`, dashed link and `free?` | Appropriate uncertainty; no claim of proven availability. |
| Gateway at 0.1 ms, Arista vendor evidence, routes at L3 | `Arista .57 L3`, `def gw 0.1ms` | The qualified role and measurement are visible. Omitting an unproven ToR role is correct, not a missing required concept. |
| NxtGen AS132717 | `Arista .57 AS132717` | Complete operator AS identifier retained across the split. Site prose is not substituted for a missing route. |
| Public L3, no NAT, no IPv6 | `no NAT, no v6` | Negative qualifiers preserved. They do not identify the missing public-address prefix. |
| Airtel transit 14.143.x, then Airtel backbone 14.141.x | `Airtel 14.143.x`, `AirtelBB 14.141.x`, with 1.8/7.1 ms labels | Correct observed order; `AirtelBB` is a recoverable backbone abbreviation. |
| Cloudflare 1.1.1.1 AS13335 | `CF 1.1.1.1 AS13335`, `8.3 ms` | Destination/AS and extracted-edge measurement survive. The source prose separately says 8.6 ms; see the qualification below. |
| Invisible intermediate fabric is not proof of L2 or known spine/leaf topology | `1.8 ms unseen` on the gateway→Airtel gap; no invented hidden switch nodes | Terse but appropriately does not invent topology or assert L2. |
| One observed upstream ISP/path | One unbranched gateway→Airtel→AirtelBB→Cloudflare path | Observed chain is preserved; this is not proof of every physical device or all possible transits. |

The task is NIC and observed egress layout, not a host-provisioning inventory or an explanatory lesson. The absence of `no GPUs`, `no rack-bench`, uptime, site-city prose, and the full VXLAN/ICMP explanation is not independently scored as missing topology. In contrast, the required server2 node explicitly includes its model in the extracted reference, and the supplied host public address is layout identity, not unrelated prose.

**Historical RTT discrepancy:** the source's narrative says Cloudflare 8.6 ms while the extracted relationship list/expected edge says 8.3 ms. The capture follows the extracted 8.3 ms. No later human numerical correction resolves the discrepancy in the frozen material. Accordingly e8 passes for the required direction/destination/order and extracted label, not as independently verified latency. I do not silently invent a numerical correction or access the historical chat/remote machine to resolve it.

## Concrete defects

### F1 — Critical: public-address identity lost

No visible text in either view contains `103.19.91`. All local addresses are suffixes without a displayed key. `same /29` supplies prefix length, not prefix value. The source's `103.19.91.58/29` therefore cannot be reconstructed from the capture alone.

Evidence: v1 server1 `[29,20,17,1]`; local server2/gateway/pool text across `[12,36,55,1]`; v2 NIC `[30,8,15,1]` and gateway `[30,16,19,1]`. These are legible but incomplete identifiers, not clipping. The ledger's assertion that a public address is “drawn” does not put the prefix on-screen.

Affected required relationships: e3, e4 and e5. This also breaks the layout rubric's complete split-source-coverage clause. A compact full-prefix/CIDR key or a complete anchor address must actually be visible in a future sample; a key in generation notes is insufficient.

### F2 — Critical: server2's source-backed model association omitted

The only server2 occurrence is `[12,36,11,1]`, `server2 .59`. The source says both servers are Dell R7725, and the historical node reference explicitly includes R7725 on s2. Server1's separate `[29,20,17,1]` label cannot communicate that server2 shares its model.

Calling the model a duplicate in a generator ledger is not visible abbreviation. A common-model key could legitimately avoid repeated text, but none is present. This also contributes to the split-coverage failure.

### F3 — High: the `same /29` label does not reliably belong to its intended link

The text occupies v1 `[22,34,8,1]`. Its intended server2→gateway corridor lies on row 36, with rightward arrow `(29,36)`. Immediately to the text's right, separated by one blank cell, is the **different** NIC→gateway downward arrow `(31,34)`.

A reader can trace server2's geometry but cannot reliably know whether the subnet qualifier belongs to it or the descending NIC link. This was already recorded blind. The spec's `s2 -> gw` assignment proves intention only. Semantic fidelity/e4 fail for this uncertain ownership; the arrow-traceability category remains a geometric pass.

## Per-edge and cross-view audit

`reviewer-result.json.edge_audit` records all eight required source relations with source references, observed paths, status and capture regions. There are nine visible route occurrences because e3 is intentionally duplicated, not a ninth invented relationship.

| Edge | Visible stem → unique head | Relation decision |
|---|---|---|
| e1 dark→server1 | v1 column 29, rows 15–17 dashed → `▼` `(29,18)`, target top row 19 | Pass with qualified `no link seen`. |
| e2 server1→NIC | v1 column 29, source bottom row 22 → `▼` `(29,26)`, target top row 27 | Pass, `only uplink` and 25GbE retained. |
| e3 NIC→gateway | v1 column 29 rows 31–32, elbows `(29,33)` and `(31,33)` → `▼` `(31,34)`; v2 column 30 rows 11–13 → `▼` `(30,14)` | Endpoint/direction/RTT/no-NAT/no-v6 visible, but full network identity missing: fail F1. |
| e4 server2→gateway | v1 source border `(23,36)`, stem columns 24–28 → `▶` `(29,36)`, target border `(30,36)` | Geometric pass; relation audit fail for F1/F2/F3. |
| e5 spare→gateway | v1 source border `(51,36)`, dashed stem columns 50–46 → `◀` `(45,36)`, target border `(44,36)` | Uncertainty and geometry pass; pool identity incomplete: fail F1. |
| e6 gateway→Airtel | v2 column 30 rows 19–21 → `▼` `(30,22)` | Pass; no invisible switches invented. |
| e7 Airtel→backbone | v2 column 30 rows 27–29 → `▼` `(30,30)` | Pass. |
| e8 backbone→Cloudflare | v2 column 30 rows 35–37 → `▼` `(30,38)` | Pass for extracted relation, with historical RTT discrepancy noted. |

All source stems are adjacent to the correct source box boundary, and each arrowhead is adjacent to its distinct target boundary. At the v1 gateway, incoming top/left/right routes terminate separately; there is no outside-box shared junction. The dogleg has two elbows on one route, not an interedge touching bend or bridge. There are no extra apparent source-target relations to add as `unexpected_link` audits.

No source-named bus is required for this case. Independent /29-member links must not be converted into a shared physical bus merely to exercise `trunks`. The generator's rejected optional trunk preflights do not establish a required capability blocker.

## Settle the corner-touching layout caveat

**No: this contact does not break the geometric layout gate.** `free?` is at v1 `[46,35,5,1]`, ending column 50. The spare box's intact upper-left corner is the separate cell `(51,35)`. No label character or border cell is overwritten; no label is clipped, fused with another label, or obscured by the control palette. The rubric does not impose a one-cell whitespace margin. It would be an invented pass condition to fail layout merely for adjacent occupied cells.

The blind record reported one label-to-border contact and zero fused text labels. It did not report the label touching *both* neighboring box borders: the gateway corner is at column 44, with column 45 blank before `free?`. Generator prose calling it flush with both borders is not capture evidence.

Nevertheless the full `layout_fit` category is **fail** for its separate, explicit complete-source-coverage requirement (F1/F2). This distinction is deliberate: box/label geometry fits, but the split does not preserve all required visible content.

## Border and grouping evidence

Normal and all-selected ANSI captures cover every node occurrence: six in v1 plus five in v2. Across those 11 nodes, 436 perimeter cells were checked per state (872 normal-plus-selected cells). All 44 sides and all 44 corners per state are complete. Each normal node has one perimeter color; every selected perimeter is continuously bold RGB `(216,166,87)`. There are no handle-related interruptions visible. All-selected evidence does not test solo-selection interaction, but the rubric does not add that as another gate.

Normal border colors substantiate real concept families, not just declared `group` fields:

- v1 ports: gold `(216,166,87)` and `(228,184,111)`;
- v1 hosts: teal `(125,174,163)` and `(147,194,183)`;
- v2 transit pair: teal `(125,174,163)` and `(147,194,183)`;
- fabric gateway: pink `(211,134,155)`;
- pool/internet: olive `(169,182,101)` within their respective views.

Source-defined placement/order is respected: the host/NIC assembly and local peers lead into an ordered upstream chain. Reusing a hue for different concepts in different views is not the forbidden geometric-depth grouping claim. The rubric explicitly says cross-view per-node hue stability is not a separate gate. A user-specified hue override is therefore not required to pass this case.

## Settle the motion caveat

**The alternating samples do not establish direction or slow cadence for any of the six animated routes.** They show count and safe sampled positions, not a proven slow directed traversal.

| Captured route | Dot positions at 0/100/200/300/400 ms |
|---|---|
| v1 server1→NIC | `(29,24)`, `(29,25)`, `(29,24)`, `(29,25)`, `(29,24)` |
| v1 NIC→gateway | `(29,32)`, `(30,33)`, `(29,32)`, `(30,33)`, `(29,32)` |
| v2 NIC→gateway | `(30,12)`, `(30,13)`, `(30,12)`, `(30,13)`, `(30,12)` |
| v2 gateway→Airtel | `(30,20)`, `(30,21)`, `(30,20)`, `(30,21)`, `(30,20)` |
| v2 Airtel→backbone | `(30,28)`, `(30,29)`, `(30,28)`, `(30,29)`, `(30,28)` |
| v2 backbone→Cloudflare | `(30,36)`, `(30,37)`, `(30,36)`, `(30,37)`, `(30,36)` |

Exactly one dot is visible per animated route in every sample: 30 route/frame observations, zero sampled count violations. All six sequences repeat every 200 ms in the sampled record. The apparent return could be a reset, aliasing or a reversal; the evidence cannot decide. It is not legitimate to infer forward motion merely from a downward arrowhead or `dots: 1` in JSON.

No sampled dot occupies a corner, bridge, junction, arrowhead, border, or label. In particular `(30,33)` is the **straight cell between** the two v1 elbows, not a corner. Zero such observed violations is not a proof about every instant between frames.

The files named `*-frames.ansi` have ANSI shell prompts but no SGR sequences in their diagram-frame bodies. Animated-frame color is unproved. Normal/selected snapshots independently prove the audited border colors, so this omission does not invalidate their border evidence.

**Animation status is N/A, not pass:** `cases.json` identifies this case as `animation: "optional"`, `expected.json` repeats it, and `source.md` asks for a layout without a motion request. The rubric allows an explicit source-backed N/A and says unrequested motion must not damage labels or traceability; that damage is not observed. If slow directed animation were required, these captures would be insufficient and should be blocked for direction/cadence evidence, not waved through because the dot count is one. N/A here earns no category pass and is not used to waive any required-animation case.

## Fit, workflow and cleanup evidence

Both normal ANSI captures contain 47 rows, each exactly 77 cells after removing SGR. Headers say `77x47 @100%`. Both frame transcripts contain the actual startup line:

`viewport: 77x47 zoom: 1.00 natural`

The manifests' `viewport_line` is null because the ordinary alternate-screen snapshot erases that line; it is present in the retained command/frame transcript. v1 content occupies columns 11–67, rows 11–38. v2 content occupies columns 29–49, rows 7–42. The control box `[2,41,9,6]` does not occlude either diagram. No pan or zoom is needed for the shown content.

**Independent live-pane dimensions:** `pane_rows=47` is recorded; `pane_cols=null` and `pane_rect=null` in both final manifests. `live_pane` is therefore null in the result, because that schema does not permit a partially known dimensions object. This is separate from the directly measured 77×47 application capture. Frozen metadata documents the unfocused-tab rectangle lookup limitation and accepts the app token/startup line as authority for this baseline. This review does not invent a live pane width or an outer border rectangle.

### Executed evidence and reproducibility

`generation.json`, the final manifests and the hash-matching frozen capture helper bind these executed argv forms to the fixed executable and spec bytes:

- `/tmp/visualize-eval/round-02/bin/rataflow-view --check <absolute-case-path>/v1.json` and the equivalent v2 command, with full stdout+stderr merged into `check.txt` and exit 0 in each manifest;
- the same absolute binary and spec for the normal pane run;
- the same absolute binary and spec plus `--select-all` for selected ANSI;
- the same absolute binary and spec plus `--frames 5 --step-ms 100` for timestamped evidence.

The actual absolute spec base in the captured commands is `/Users/aviral/.herdr/worktrees/dotfiles/fix-visualize-skill/docs/visualize-eval/rounds/02/server-nic-layout/`. Commands wrap in the scroll capture but their binary/spec/options are retained. The frozen helper defines the exact split/read/close/probe operations; neither passing `--check` nor 24/24 validator messages is counted as visible correctness.

| Pane | View/state | Recorded capture window UTC | Cleanup |
|---|---|---|---|
| `w7E:p7E` | final v1 | 2026-11-02 10:01:35–10:01:38 | `confirmed_closed` |
| `w7E:p7F` | superseded v2 | 2026-11-02 10:01:50–10:01:54 | `confirmed_closed` |
| `w7E:p7T` | final v2 | 2026-11-02 10:02:39–10:02:43 | `confirmed_closed` |

The frozen helper closes each pane and checks that `herdr pane get` fails before recording `confirmed_closed`. These are preserved generator cleanup records, not a claim that this judge reran live pane probes. The reviewer opened no panes and has none to clean up.

## Blockers and correction candidates

### Blockers

**No confirmed required renderer-capability blocker for this case.** JSON `blockers` is empty. Known semantic failures remain failures; they are not relabeled blocked. Animation is source-backed optional, so its unresolved direction/cadence evidence is a limitation rather than a mandatory capability gap. The unresolved historical RTT discrepancy is recorded without fabricating an authoritative value.

The generator's per-trunk-branch label/style limitations and per-group hue-override wish do not block these required independent links or the passing observed grouping. A feature's presence or absence in a schema is not a substitute for judging the rendered sample.

### Skill/generator correction candidates, for after all eight critiques

1. Carry full network identity into the capture: preserve `103.19.91.58/29`, or add a visible same-view address-prefix key before shortening suffixes. A ledger must distinguish visible abbreviation from omitted information.
2. Preserve the server2-to-R7725 association, either explicitly on its node or through a visible common-model key. Do not call a property duplicated when its association with a second subject disappears.
3. Audit edge-label ownership against the actual neighboring arrows. Move/split the local segment view or change available spacing so `same /29` clearly belongs to the server2 link. A zero-on-route label count does not prove ownership.
4. Treat motion checks as temporal evidence. Do not claim the active route's direction or cadence from count-only, two-position samples, and do not imply server2 has no traffic merely because its optional animation was disabled.
5. Retain the good qualifications: `no link seen`, `free?`, no asserted ToR role from OUI, and no invented invisible switches.

### Renderer/harness correction candidates, not established blockers

1. Consider edge-label placement that favors unambiguous association, not merely unoccupied cells: the current `same /29` placement abuts another edge's head. First determine whether spec placement/spacing suffices; these captures do not prove a missing renderer capability.
2. Investigate the frozen frame-dump/live-motion relationship. All six `--frames` sequences alternate between two positions despite 100 ms sampling. A future evidence mode should show enough progression to establish direction/cadence, not just claim that the interval eliminates aliasing. No renderer cause is asserted from captures alone.
3. Preserve SGR colors inside timestamped diagram frames if animated color continuity is to be audited.
4. Fix the documented pane-rectangle lookup to select the owned pane explicitly, recording true live-pane columns and rows separately from app viewport tokens.

No correction, new viewer session, install, subagent, commit, renderer edit, skill edit, source edit, or graph edit was made in this review. The captain must gather all eight complete critiques before revising the skill.

## Deliverables and verification

- `observed-first.md`: unchanged blind record and verified original hash.
- `spec-manifest.json`: deterministic sorted final spec path/hash pairs.
- `reviewer-result.json`: round integer 2, correct model/worker identities, all seven category keys, 45 hashed evidence entries, eight required-edge audits and three concrete findings.
- `critique.md`: this report.

The JSON result was checked against every keyword used by the embedded `result_schema` with a dependency-free standard-library validator run through `uv`. Evidence IDs, in-viewport regions and all inventory hashes were checked. No package was installed. Hash verification is workflow evidence only; visible category decisions come from the preserved captures.
