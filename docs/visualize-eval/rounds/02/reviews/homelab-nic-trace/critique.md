# homelab-nic-trace — round 02 independent review

## Verdict: FAIL

The captures preserve **all 14 geometric directed relationships**, and every stem reaches its own arrowhead without an invented junction. They do **not** preserve all source meaning. Required identifiers and path/model facts are missing, and three required edge labels have uncertain owners. Reading the source and spec resolves intended ownership, but does not repair what a reader sees.

The seven fixed category decisions are:

| Category | Applicable | Status | Decision |
|---|---:|---|---|
| semantic_fidelity | yes | **fail** | Missing required identifiers, incomplete source meanings, and three uncertain edge-label owners. F1–F5. |
| arrow_traceability | yes | **pass** | 14/14 unique source-to-arrowhead geometric traces, correct directions; no crossing, fake branch, bus requirement, or extra geometric relation. |
| layout_fit | yes | **fail** | Geometric fit passes for every displayed box/label at 77×47/100%, but the fixed category also requires complete source coverage across split views. Required identifiers omitted in F1/F2 have no key or other view. This is the same omission, not clipping or an additional independent defect. |
| conceptual_grouping_color | yes | **pass** | Related concepts share related hue families and proximity within each view; grouping is source-backed rather than merely depth. |
| border_integrity | yes | **pass** | 16/16 complete normal perimeters and 16/16 complete selected perimeters, color-continuous in ANSI. |
| workflow_evidence | yes | **pass** | Frozen hashes verified, independent required models recorded, blind-first record intact, exact command construction and capture/check records retained, cleanup recorded. Limits below are disclosed. |
| animation | **no** | **N/A / null** | Both frozen case manifests say optional; source contains no request for motion. The sample does not earn an animation pass. Unrequested dots do not obscure arrows or labels. |

There are five passing and nine failing full source-relation audit entries. Those failures include semantic label/endpoint losses; **none** means a geometric corridor or arrowhead is missing. Required edges must pass semantics as well as geometry for an overall green case. The case fails regardless of any missing evidence or claimed capability gap.

## Scope, identities, and evidence integrity

All paths in this report and `reviewer-result.json` are **repository-relative**, based at `/Users/aviral/.herdr/worktrees/dotfiles/fix-visualize-skill`. Coordinates are 1-based `[column,row,width,height]`. For frame-addressable evidence aliases, coordinates refer to the named 77×47 diagram frame, not surrounding shell scrollback. Every inventory hash was computed from the actual cited file.

- Generator: `viz-ds02-homelab-nic-trace`, `fireworks/accounts/fireworks/routers/deepseek-flash-latest`.
- Reviewer: `viz-judge02-homelab-nic-trace`, `openai/gpt-6.1-sol`. The judge's actual environment reports provider `openai`, model `gpt-6.1-sol`.
- The generator's cosmetic tab name was `viz-ds02-undefined-3`; frozen metadata and `generation.json` explain the dispatch-label bug. It is not a model substitution or a second generation.
- The inherited `workflow_evidence.pass_iff` text contains `openai/gpt-6-astra`. Round-02 metadata, Stage-B contract, the rubric's required reviewer model, and its result schema explicitly require **Sol**. I follow those round-specific instructions; the frozen rubric was not edited.
- I read no round-01 results and no other case's source/expected files. The required global case manifest and metadata were read, but other cases were not evaluated.
- I opened no viewer, reran no renderer, made no fixes, installed nothing, spawned no subagents, and created no commit.

### Verified input hashes

| Input | Actual SHA-256, matched to frozen metadata |
|---|---|
| `docs/visualize-eval/rounds/02/SKILL.md` | `7d1ff098d3ff460046e794c29925482ffd0ccb8c6fa493bc390758d976b75d70` |
| Frozen renderer bytes at `/tmp/visualize-eval/round-02/bin/rataflow-view` | `ee085c0f3a82e9b7d516cde7532f394864b3490c99691cd7ac5b2d36d640e8ea` |
| `docs/visualize-eval/rounds/02/rubric.json` | `555e3b1d5881449b79eb1dc1d9538df2c4fe0880aa850becbf9060c1bf42f86f` |
| `docs/visualize-eval/cases.json` | `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05` |
| Case `source.md` | `abe8b376eccd7d0027f2985aab55ed656603b2094c275ee66ed223a57421b4c4` |
| Case `expected.json` | `91ef88d09af71cd4583cfd0f1141e10f2fc2efdd3a779f9389f1d67759cd09c7` |

The capture, validate, and aggregate harness file hashes also match frozen metadata. I verified all **21** artifact hashes declared by the three capture manifests, all three final-spec hashes, and all **eight** attempted-spec hashes. `generation.md` says “9 recorded attempts”; its listed files and `attempts.json` actually contain 3+3+2 = eight. The actual attempt ledger is authoritative; each view stays within three attempts.

### Sealed blind record

`docs/visualize-eval/rounds/02/reviews/homelab-nic-trace/observed-first.md`

SHA-256: `417a3548103c45046a49e74b5253c0353ee355a5367c8bd817b70eb5789a4b03`

Stage A completed before the expectations were revealed. I verified this hash again in Stage B. The file is unchanged. The complete label-coordinate inventory, all route/bend coordinates, all node perimeter colors, and every sampled dot position remain there; none was rewritten to match the source.

### Deterministic spec manifest

`spec-manifest.json` contains only the three final displayed specs, sorted by repository-relative path. It is UTF-8 JSON with sorted object keys, two-space indentation, and one final newline. These exact bytes are hashed for `spec_sha256`.

Manifest SHA-256: `ba23ccd26157361fb3dbbe612e8b9bdc444cd99ad52d6dcee53aef26b5c94e77`

| Final spec | Actual SHA-256 |
|---|---|
| `docs/visualize-eval/rounds/02/homelab-nic-trace/v1.json` | `097e1b77f7be20d3f1ece744c14cc5f64044484f426d527026df2824540d1084` |
| `docs/visualize-eval/rounds/02/homelab-nic-trace/v2.json` | `1c794901d822ef3da274ce48538b190d19726ab886e8ff4a68dcf4f2e2e08eb1` |
| `docs/visualize-eval/rounds/02/homelab-nic-trace/v3.json` | `32559d5011d59e852d92f02ecd81f3ae9964393a102ffdf20c6bc134622e3afb` |

The manifest, every final spec, and the sealed blind record are included in the result's hashed evidence inventory. Absolute renderer bytes were independently hashed; repository-relative `bin.sha256` records bind each executed capture to that same binary.

## Every required concept and split coverage

The source is a historical interpretation, not verified physical topology. Its explicit router/ONT qualifications take priority over historical generated labels. I do not demand exact wording when the visible abbreviation preserves meaning; for example `ctr veth`, `default 0.5 ms`, and `NAT/DHCP` are understandable in context.

| Source concept | Capture evidence | Assessment |
|---|---|---|
| rack-bench test host `homelab`, not devbox | v1 `homelab host v6 ULA`, [4,27,19,1] | Correct homelab identity; no devbox substitution. The label does not itself name rack-bench residency or hardware/kernel details. |
| bond0 over eno1, 2.5 GbE, 192.168.1.197 | v1 node [29,36,19,1]; edge text [10,32,12,1] | Address present; required physical-link text has uncertain owner, F3. |
| Wi-Fi wlp8s0 .213 as backup, metric 600, not ECMP | v1 node [54,36,20,1], `backup path` [25,30,11,1]; v2 `metric 600` [32,20,10,1] | Backup label preserved, separate independent route retained. Metric owner is insecure, F4. No equal-cost bus is invented. |
| Tailscale 100.113.153.49, UDP over wired path | v1 `tailscale0` [9,36,10,1], `UDP encap` [19,34,9,1] | Address absent, F1; UDP owner uncertain, F3. |
| libvirt VM / NAT bridge / 192.168.122.x | v1 `VM vnet0`, `virbr0`, subnet and `NAT bridge` | Network and NAT relationship readable. Libvirt product name is not expanded, but virbr0/VM/NAT chain is recognizable. |
| container veth / Docker bridge 172.18.2.1 / guest 172.18.2.x | v1 `ctr veth`, `docker0` [35,19,7,1], guest subnet [37,15,10,1] | Guest subnet preserved. Bridge .1 address absent; `docker0` is an unsupported replacement interface name in these source excerpts, F2. |
| Fios router 192.168.1.1, NAT/DHCP, 0.5 ms | v2 router [18,24,30,1], `default 0.5 ms` [17,19,14,1] | Preserved and qualified as `Fios rtr?`. No independent hardware verification is claimed. |
| shared Fios pool 71.251.12.240 / NAT egress | v2 [20,28,17,1] | Preserved as `NAT 71.251.12.240`. |
| qualified ONT / Verizon edge 169.254.3.1, historical inference | v2 [25,32,16,1], v3 [31,12,16,1], dashed adjacent routes | `ONT?` supplies the required identity qualification. Dashed hops do not earn independent topology verification. No explicit historical-traceroute caption is present. |
| Verizon aggregation/edge 100.41.x | v3 `Verizon edge` [33,20,12,1] | Address and aggregation expansion absent, F2; the ledger's claim that latency context abbreviates the address is not a visible key. |
| Verizon backbone AS701 | v3 `AS701` [37,28,5,1] | AS identifier and sequence retained; backbone role/Verizon expansion not displayed. |
| Cloudflare 1.1.1.1 / AS13335 | v3 `AS13335` [36,36,7,1] | AS retained; destination name/IP absent without key, F2. Source prose's AS13335 does not cancel its historical endpoint IP. |
| ULA-only, no global IPv6, no IPv6 internet | v1 `v6 ULA` within [4,27,19,1] | Positive presence of ULA is not the negative/only limitation. F5. |
| collapsed ToR/spine/border/firewall, ONT demarc/MMR analog | no role text or visible legend in v2 | Required source model mapping omitted. JSON group `demarc` is not printed. F5. These roles can be text, not invented nested boxes. |
| bench-internet Fios path: NAT, no committed rate, no v6 | NAT drawn; rate and explicit v6 limitation absent | Partial coverage, F5. No separate benchmark command/host access is required or performed. |

Additional source details—ASUS bare metal, Linux 7.0, `~/rack-bench`, Oct 11 runs, and WNC OUI—are not printed either. The verdict does not depend on elevating these incidental context details into additional critical topology defects. The contrast to another 4-ISP/2-MMR design is not a demand to import that other topology into this case.

### Cross-view relationship coverage

- v1 contains e1–e8.
- v2 contains e9–e11. Its `bond0` and `wlp8s0` anchors correspond to v1's same interface names with LAN IPs.
- v3 contains e12–e14. `ONT? 169.254.3.1` repeats exactly between v2 and v3.
- All 14 directed geometric source relationships appear exactly once. There is no missing seam link and no extra apparent geometric relation. Shared node occurrences are anchors, not extra links.
- This is **complete relationship geometry**, not complete source-fact coverage. Missing identities and path/model facts have no supplied fourth view or same-view key. A narrative coverage map cannot substitute for visible coverage.

## Full per-edge audit

The source relation order below is the `expected.json` order. Each route's exact first cell, every bend, and terminal arrowhead is recorded in the sealed Stage-A file and repeated in `reviewer-result.json` with capture regions. Routes are independent links, not a named bus.

| Edge | Source-required direction and label | Actual capture trace / meaning | Full source-relation status |
|---|---|---|---|
| e1 | VM → virbr, `192.168.122.x` | v1 down (10,14), one-cell jog at row 16, ▼ (11,17); label attributable | pass |
| e2 | virbr → host, `NAT bridge` | v1 down/left/down, ▼ (4,25); distinct from adjacent Docker route | pass |
| e3 | container → Docker bridge, `172.18.2.x` | v1 straight down, ▼ (35,17); target's bridge address/source interface identity lost, F2 | fail |
| e4 | Docker bridge → host, `docker bridge` | v1 down/left/down, ▼ (6,25); label clear but source bridge address/identity incomplete, F2 | fail |
| e5 | Tailscale → host, `overlay` | v1 leaves left, follows full column-1 corridor, ▶ (2,27); overlay address missing, F1 | fail |
| e6 | Tailscale → bond0, UDP encapsulation | v1 right stem (20,36) to ▶ (27,36); required UDP text is near a different arrow, F1/F3 | fail |
| e7 | host → bond0, `eno1 2.5 GbE` | v1 down/right/down, ▼ (29,34); physical-link label between two routes, F3 | fail |
| e8 | host → Wi-Fi, `backup path` | v1 upper long run to ▼ (54,34); label attributable | pass |
| e9 | bond0 → router, default gateway 0.5 ms | v2 down/left/down to ▼ (18,22); label and qualified router clear | pass |
| e10 | Wi-Fi → router, `metric 600` | v2 down/left/down to ▼ (20,22); metric sits against wired-route bend, F4 | fail |
| e11 | router → qualified ONT, NAT out | v2 dashed route to ▼ (25,30); NAT pool IP and uncertainty visible | pass |
| e12 | ONT → Verizon aggregation/edge, `4.5 ms` | v3 dashed route to ▼ (33,18); target's 100.41.x/aggregation meaning absent, F2 | fail |
| e13 | aggregation/edge → AS701 backbone, `6.6 ms` | v3 solid route to ▼ (37,26); correct geometric chain; address/role text incomplete, F2 | fail |
| e14 | AS701 → Cloudflare, `6-9 ms` | v3 down/left/down to ▼ (36,34); AS13335 lacks source endpoint name/IP, F2 | fail |

### Crossing/junction/branch findings

No route-route crossing, bridge, shared corridor, or T/four-way junction appears. Every arrowhead is retained in the motion samples too. The nested runs are tight but still traceable:

- v1 NAT row 23, columns 4–11; Docker bend (6,24) directly below the upper run. Its right/down opening does not connect upward. Arrows (4,25) and (6,25) are separate.
- v2 wired row 20, columns 18–31; wireless bend (20,21) directly below it. The arrows at (18,22) and (20,22) remain separate.
- The adjacent same-route bend pairs at v1 (10,16)/(11,16) and v3 (36,33)/(37,33) are one-cell jogs, not branches.
- Host fan-in/fan-out and Tailscale's two outgoing routes meet **at boxes**, not at invented corridor junctions. No single-trunk requirement is asserted by this source, so not using `trunks` is correct here.

## Concrete defects

### F1 — critical — missing overlay address

Source/expected require `100.113.153.49`. The v1 Tailscale box [8,35,12,4] contains only `tailscale0` [9,36,10,1]. The full 77×47 view has no address key. The generator admits the drop, but that admission is not the evidence: the capture and blind inventory show it missing. A layout attempt budget explains why the generator stopped; it does not waive semantic fidelity.

### F2 — critical — other source endpoint identifiers/roles erased

- Docker bridge [34,18,9,4] says `docker0`, not the source bridge address `172.18.2.1`. The guest `172.18.2.x` label does not state the bridge's .1 address.
- Verizon node [32,19,14,4] says `Verizon edge`, with no `100.41.x` or aggregation key.
- Cloudflare endpoint [35,35,9,4] says `AS13335`, with no Cloudflare/`1.1.1.1` key. AS701's explicit backbone role is similarly not expanded.

Abbreviation may shorten wording, but an external ledger is not a same-view definition. These are endpoint meaning losses, not hidden text recovered by panning.

### F3 — high — v1 physical/encapsulation labels not securely owned

The blind record identified both before the source reveal:

- `eno1 2.5 GbE` [10,32,12,1] lies exactly between the Wi-Fi horizontal on row 31 and wired horizontal on row 33. Its intended owner is e7, not e8, but the capture does not state a placement convention or otherwise attach it uniquely.
- `UDP encap` [19,34,9,1] ends one cell before e7's down arrow (29,34). Its intended e6 is the horizontal row-36 segment from Tailscale into bond0. A row-35 box top also intervenes beneath part of the label.

Both endpoint routes remain geometrically traceable. The failure is preserving which hop carries which technology, not the existence of an arrowhead.

### F4 — high — v2 metric can be assigned to the primary link

`metric 600` [32,20,10,1] begins immediately after the wired/default-route corner (31,20). The intended Wi-Fi route is one row lower, on row 21. The source requires metric-based Wi-Fi backup, not an ambiguous metric on the wired primary. `backup path` in another view helps identify Wi-Fi's broad role but does not locally label this metric unambiguously. The JSON owner declaration confirms intent only.

### F5 — critical — negative reachability and model/path meanings dropped

`v6 ULA` in the host label [4,27,19,1] is weaker than “ULA-only, no global IPv6, no IPv6 Internet.” Having a ULA address does not by itself exclude also having global IPv6. The router box [17,23,32,4] contains NAT/DHCP but no collapsed-fabric roles, and the ONT [24,31,18,4] has no visible demarc/MMR analogy. No view supplies “no committed rate.”

These source facts do not require asserting false edges. They can be node/path text or a visible key. Their deletion is not justified by the absence of a special blocked-path style or property channel. The generator's `demarc` group is not visible text and cannot carry the analogy for the reader.

## Fit and borders: what passes, and what does not

All three ordinary ANSI grids independently measure **77 columns × 47 rows**. Each header says `77x47 @100%`; the associated frame scrollback records exactly:

`viewport: 77x47 zoom: 1.00 natural`

Every displayed box, label, and route fits without pan or zoom. The v1 return corridor reaches column 1 but is intact. Lowest node borders end at row 38 in v1/v3, row 34 in v2. The palette [2,41,9,6] does not cover content. Zero items are clipped or occluded. The full `layout_fit` category nevertheless fails its explicit **complete-source-coverage** clause: fitting an abbreviated subset cannot repair omitted required identifiers. This does not create a second underlying defect count for F1/F2.

The physical outer live-pane rectangle is **not independently recorded** in any final manifest: `pane_rect=null`, `pane_cols=null`, `pane_rows=47`. `generation.json` reports an outer 79×49 pane from a 159×49 tab, but this is a generator report, not retained raw dimensional evidence. Therefore `live_pane` is **null** in the result, not an invented 79×49. Frozen metadata explicitly documents that the header/startup measurement is authoritative despite the harness's unfocused-tab rectangle lookup. The app grid is measurable, so this limitation is not a new fit/evidence blocker.

All 16 normal node perimeters have complete sides/corners with one RGB foreground throughout each perimeter. All 16 selected perimeters preserve geometry and use bold RGB (216,166,87) continuously. The ordinary node colors and exact box bounds are in the blind table. The count is **16/16**, including repeated interfaces/ONT across views, not merely unique semantic concepts. Simultaneous `--select-all` does not prove per-node navigation, drag handles during an interaction, or hover behavior; none is supplied or inferred. No drawn handles are missing or discontinuous in the captured states.

## Conceptual grouping and uncertainty

Visible hues/proximity support the source concepts:

- v1 VM/container amber; related virtual bridges teal; host pink; Tailscale green; NIC pair blue.
- v2 related NICs are neighboring amber shades, router teal, qualified ONT pink.
- v3 Verizon edge/AS701 are neighboring teal shades, ONT amber, destination pink.

This grouping is not credited merely because `group` fields exist. The ANSI perimeter colors show it. NIC hue changing between v1/v2 and ONT hue changing between v2/v3 are **not separate failures**, per the Stage-B contract. The same-view functional families and source sequence remain clear.

`Fios rtr?` and `ONT?` preserve required uncertainty about inferred hardware identity. Dashed router→ONT and ONT→Verizon links are actually visible. The source does not independently verify the historical traceroute topology; the diagram must not be cited as such. A stronger historical-hop caption would improve fidelity, but the main missing-fact findings already establish the failure without treating every solid ISP segment as independently verified hardware.

## Motion settled against the now-revealed source

The frozen case manifest and `expected.json` mark animation **optional**. The source request asks to visualize the layout, not to animate it. The rubric allows a source-backed N/A; I use `applicable=false`, `status=null`. This adds **no animation pass** to the metric.

The two stationary-in-sample routes remain exactly as observed, and are not rewritten as successful motion:

- e1 / blind route A: dot at **(10,15)** in every frame, 0/100/200/300/400 ms. Relevant frame region [10,15,1,1] in each v1 frame.
- e14 / blind route N: dot at **(37,32)** in every v3 frame at those same relative times. Region [37,32,1,1].

Other short sequences also limit claims: e3 toggles (35,15)/(35,16), e12 toggles (31,16)/(32,17), and e13 returns to (33,24) at 400 ms after progressing right. Nine other routes show forward progress along a portion of their route, not a full transit. The generator statement “one dot per route, so motion is provable” overclaims what dot counts alone prove.

Every route has exactly one dot per sampled frame; zero observed dots occupy a corner, bridge, junction, border, or arrowhead. There is no multi-dot spacing to measure within a route. Unrequested motion does not erase required text or geometric traceability. Those facts satisfy the non-damage requirement, not a requested-motion gate. The sample cannot establish behavior between frames or live wall-clock smoothness. Stationary samples may reflect route quantization or sampling; the captures alone cannot establish the implementation cause.

## Workflow, commands, timestamps, and cleanup

The frozen capture script was hash-verified against round metadata and read in full. It constructs the exact check command from the manifest's absolute binary/spec paths, merges stdout and stderr into `check.txt`, records `check_exit`, and runs ordinary / `--select-all` / `--frames 5 --step-ms 100` commands. Those exact viewer arguments also appear in each saved frame scrollback. The three check files contain their full captured combined output; all three manifest exit statuses are zero. Their `viewport: unknown` check output is not substituted for actual pane measurement.

| View | Check window (UTC) | Capture window (UTC) | Pane | Recorded cleanup |
|---|---|---|---|---|
| v1 | 2026-11-02T10:01:58Z–10:01:58Z | 2026-11-02T10:01:58Z–10:02:02Z | `w7E:p7G` | `confirmed_closed` |
| v2 | 2026-11-02T10:03:30Z–10:03:30Z | 2026-11-02T10:03:30Z–10:03:34Z | `w7E:p7Y` | `confirmed_closed` |
| v3 | 2026-11-02T10:02:24Z–10:02:24Z | 2026-11-02T10:02:24Z–10:02:28Z | `w7E:p7N` | `confirmed_closed` |

Timestamp windows are recorded windows, not invented per-selected-state wall-clock instants. Motion frames have their own exact relative timestamps. The harness performs close then `pane get` and records `confirmed_closed` on failure to find the pane. `generation.json` additionally records both geometry preflight panes (`w7E:p6V`, `w7E:p6W`) and the superseded v2 capture (`w7E:p7M`) as confirmed closed. Raw close/get stdout for those three is not separately retained; the cleanup status reflects preserved operational records, not a judge rerun. The judge owned no panes.

Validator output is retained and hashed. Its three 24-pass runs do not override the missing source facts, label-owner ambiguity, or stationary motion samples. Likewise, clean checks prove neither visual grouping nor border continuity. This review uses actual ANSI/text captures for those decisions.

## Blockers and correction candidates — not fixes

### Hard capability blockers: none established for this case

`reviewer-result.json` has `blockers: []`. The case is red because of known failures, not because an unsupported mandatory tool/model prevented judgment. I do **not** accept the generator's claimed missing blocked-path/property/trunk features as mandatory capability blockers:

- No blocked-path glyph is required to say “no IPv6 Internet”; text can state a negative without an invented edge.
- Node/edge labels can carry role/property text; missing a dedicated annotation field does not prove those facts are impossible to show honestly.
- The source requires two separately labeled primary/failover links, not a universal LAN trunk. Not using a trunk preserves the correct directions and avoids inventing a NIC-to-NIC relation.

These claimed gaps do not excuse omissions or turn a known fail into blocked. An impossible-fit claim would need evidence that source-preserving compositions cannot work, not merely one wide attempt. No such exhaustive claim is established here.

### Skill-level candidates

1. Enforce the meaning ledger as a **visible coverage** check: every required identifier/negative limitation needs a captured label or same-view key. “Recorded in generation.json” is not drawn coverage.
2. Protect source labels before spending attempts on compactness. A fitting layout that silently loses addresses is not a successful final attempt. Prefer source-preserving subdivision over deleting Tailscale/bridge/ISP addresses.
3. Require a blind label-owner check, especially between parallel runs. Preserve wired speed, UDP encapsulation, and Wi-Fi metric as distinct hop meanings, not just distinct JSON edges.
4. State historical inference/negative path properties directly in labels. Do not equate ULA presence with absence of global IPv6, or hidden group names with a printed demarc role.
5. Require motion claims to cite displacement, not counts. For an optional-motion case, N/A is honest; two stationary samples must not be sold as proof of smooth movement.

### Renderer/harness-level candidates

1. **Label attachment:** the current rendered placement leaves F3/F4 labels equidistant from or touching a different route. Better anchors, route-aware exclusion spacing, or explicit readable leader/placement controls are useful renderer candidates. This is an observed rendering weakness, not proof that no skill-level composition can avoid it.
2. **Single-dot short-route sampling:** inspect why e1/e14 show no sampled displacement and e3/e12/e13 repeat tiny subsets before claiming the renderer baseline delivers visibly moving dots on every route. Implementation cause is unproved; no current-source inspection substitutes for executed frozen evidence.
3. **Evidence harness:** resolve the owned pane explicitly for an independent outer rectangle, retain raw close/get proof for preflight/superseded panes, and preserve true ANSI motion-frame styling if motion-state color claims are needed. The documented width gap does not invalidate measurable app fit in this round.
4. These are next-revision candidates only. I changed no skill, renderer, spec, capture, expected data, or harness. Renderer baseline gains already present in this round are not credited as skill gains.

## Deliverables and verification

- `observed-first.md` — unchanged sealed blind record.
- `reviewer-result.json` — round integer 2, required normalized worker/model identities, all seven categories, all 14 required source-relation audits, five evidence-linked findings, cleanup records, and actual input/spec/evidence hashes.
- `spec-manifest.json` — deterministic sorted final-spec path/hash pairs.
- `critique.md` — this report.

The result was checked against every keyword used by the embedded `result_schema` with a dependency-free standard-library validator (no packages installed). Evidence IDs, file hashes, manifest/spec consistency, source edge count, and blind-record immutability were also verified. Missing text was not inferred from JSON, no new render was made, and no round-01 result was consulted.
