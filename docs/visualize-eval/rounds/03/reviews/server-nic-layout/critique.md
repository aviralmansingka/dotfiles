# server-nic-layout — round 03 independent Sol review

## Verdict: FAIL

The three supplied drawings are legible, static, and unclipped. Their colors and selected borders are supported by ANSI evidence. They are not semantically complete or consistently source-directed: v1 reverses the gateway/member arrows, server2 loses its R7725 association, definitive historical claims conflict with the qualifications in v3, and the traceroute explanation is missing. There is also an avoidable two-crossing braid in v3. Missing independent live-pane width evidence blocks the workflow category; it does not replace the known failures with a blocked overall verdict.

Reviewer: **`viz-judge03-server` / `openai/gpt-6.1-sol`**. Generator: **`viz-ds03-4` / `fireworks/accounts/fireworks/routers/deepseek-flash-latest`**. These are the specific identities supplied for this case, rather than the generic worker-name templates in the task file. No model substitution or subagent was used.

All evidence paths in `reviewer-result.json` are relative to the repository root, `/Users/aviral/.herdr/worktrees/dotfiles/fix-visualize-skill`. The renderer's absolute path is an input recorded in metadata, not a repository-relative evidence entry. Evidence IDs below resolve to the hash-bound inventory in that JSON.

## Blind-first seal

Stage A completed before the expectations were revealed. Its file was not modified during stage B:

- File: `docs/visualize-eval/rounds/03/reviews/server-nic-layout/observed-first.md`
- SHA-256: `0df34f03cd764bd77bdd6e16e465f1fbcde122058ef739fdd4bdde045fea17dc`
- Evidence ID: `blind`
- `observed_first.saved_before_expected_reveal`: **true**

The schema permits that boolean in the `observed_first` object, not as an extra property on an evidence item. The evidence description also explicitly records `saved_before_expected_reveal: true`.

The blind observations remain the basis for the measured coordinates, 16 node occurrences, 13 visible arrowheads/connections, 27 graph labels, 2 independent crossings, 2 intentional bus junctions, zero uncertain label owners, zero clipping, 16/16 selected perimeters, and zero dots/motion. Stage B adds source comparisons; it does not rewrite those observations.

## Category matrix

| Fixed category | Decision | Evidence and reason |
|---|---|---|
| `semantic_fidelity` | **fail** | F01–F05 and F08: reversed bus arrows, missing server2 model, contradictory qualification, omitted mechanisms/residency, and an undisclosed latency conflict. Readability does not make those meanings correct. |
| `arrow_traceability` | **fail** | All 13 visible connections are mechanically traceable, including the two explicit bus spurs and the v3 bridges. The category also requires correct direction. Three v1 heads point opposite the required member-to-default-gateway direction. |
| `layout_fit` | **fail** | All actual grids fit 77×47 at natural 100%, with complete labels and no overlay occlusion. However, split-view source coverage is incomplete and v3 has an avoidable two-crossing braid. Independent pane width is separately missing under workflow. |
| `conceptual_grouping_color` | **pass** | Gold primary-host hardware, distinct neighboring subnet roles, the related pink Airtel transit pair, and gold observations versus a teal claim are concept/role groups supported by ANSI. No source-fixed group/tier was reordered to earn this pass. Cross-view hue stability is not added as a new gate. |
| `border_integrity` | **pass** | All sides/corners and per-node color continuity are complete in ordinary and selected ANSI, covering 6/6 + 5/5 + 5/5 = **16/16** node occurrences. |
| `workflow_evidence` | **blocked** | Frozen hashes, separate identities, blind seal, captures, check outputs/exit statuses, timestamps and close confirmations are retained. Every final manifest nevertheless has `pane_cols:null` and `pane_rect:null`; no independent live-pane width can be supplied. |
| `animation` | **N/A** | The source does not request animation; `cases.json` and `expected.json` mark it optional. Specs disable dots; frames at 0/100/200 ms show none. No full-cycle animation claim is made. |

Applicable categories: **2 pass, 3 fail, 1 blocked**. Animation adds no pass. Severity never waives a failed category.

## Concrete findings

Coordinates are 1-based `[column,row,width,height]`, with the app status row included as row 1. Every finding has capture-linked regions in the JSON.

### F01 — Critical: the shared bus reverses the source relations

Source relations are NIC → gateway, server2 → gateway, and pool → gateway. In `ansi-v1`, the gateway has the stem, and the heads point **into the members**:

- NIC: intact `◀` at (48,28).
- server2: intact `◀` at (26,28).
- Pool: intact `▶` at (51,28).
- Bus/branch region: **[26,28,26,8]**; source stem begins beside the gateway on row 35.

This is genuinely one corridor with junction spurs, not three lines being mislabeled as a bus. Its explicit `┴` at (28,35) and `├` at (49,29) are readable. That successful shape does not authorize reversing the required arrow direction. The generator's own audit calls the dominant direction wrong; calling it “minor” does not change the rubric severity.

`ansi-v2` does correctly draw 103.19.91.58 → 103.19.91.57 with `0.1 ms`, in **[23,11,7,4]**. This does not erase the inverse route in v1, and it never supplies correctly directed server2/pool routes. The JSON audits both the required relations and the three extra reverse apparent relations.

### F02 — Critical: server2 has no R7725 association

`server1 R7725` is explicit at [13,20,13,1]. `server2 .59` occupies [14,28,11,1], inside border **[13,27,13,4]**. No capture gives server2 the model or supplies a common model legend. It is not valid to apply server1's model label to server2 by proximity. The source explicitly associates **both** hosts with the R7725.

This is a fresh source comparison, not an inherited verdict from another round.

### F03 — Critical: qualification is contradictory across views

- `ansi-v1` **[52,27,14,4]** says `.60-.62 free` on a solid bus, without a local hypothesis marker.
- `ansi-v2` **[22,15,34,4]** says `Arista ToR 103.19.91.57 AS132717` definitively.
- `ansi-v3` correctly says `ToR role?` at **[33,16,9,1]** and `free?` at **[35,28,5,1]**, both into `still unproven`.

The human corrections require historical claims to stay qualified. v3's qualifiers are useful and individually pass their relation audits, but the earlier views do not identify their definitive labels as the hypotheses those qualifiers are disputing. Generation prose saying “claimed, not proved” is not visible qualification. By contrast, v1's dashed `no cable` plus v3's explicit cabling question makes the cabling inference recoverably uncertain; that relation is not failed merely because it came from a historical attempt.

### F04 — Critical: uncertainty does not substitute for its source explanation

The final v3 graph is **[13,13,52,24]**. It contains the quiet/lossy hop observation and `layer 2?` → `still unproven`, but none of these source mechanisms/alternative relations:

1. VXLAN/MPLS outer-TTL/tunnel-endpoint handling can hide L3 fabric hops.
2. ICMP suppression/rate-limiting can explain silence or loss.
3. Other switches may be off the path if the gateway peers directly with Airtel.
4. Between .57 and Airtel, bridging, tunneling, and silence are indistinguishable from this trace.

The probes show 85×23 and 112×18 layouts too wide, then 61×23 with `hides fabric` skipped (3/4 labels). Those are evidence of three unsuccessful layouts, not proof of renderer impossibility. The actual omissions are known defects, not missing evidence that could be marked pass or a capability blocker that could waive semantics. No unseen spine/leaf boxes were invented; that constraint is respected.

### F05 — Medium: the latency discrepancy becomes an unqualified range

`ansi-v2` **[32,36,10,1]** prints `8.3-8.6 ms`. Source prose reports 8.6 ms; the historical relation reports 8.3 ms. Both numbers survive, but the conflict does not. An ordinary range can assert a measurement interval, which is not the same as two disagreeing source statements. This is a localized label-meaning defect. It is not a reason to declare the historical assistant's number independently authoritative, and not an evidence gap: the actual label is readable.

### F06 — Medium: two v3 crossings are avoidable without reordering

The bridge cells are (45,17) and (46,16), inside **[45,16,2,2]**. They form the tight OUI/dark-route braid recorded before reveal. With the bridge convention, both routes remain traceable, so I do not invent an additional untraceability defect.

The existing capture shows an empty column-44 corridor from rows 14–17, with `ToR role?` ending at column 41. Turning the OUI route there, before the dark route's column-45 vertical, would remove both crossings while preserving every source box, source order, target port order, label, and distinct relation. This is a geometric observation of available cells, not a new viewer run or an executed fix.

The rejected top-to-bottom capture reduced the reported count to one but joined `free?layer 2?` on a line. Rejecting that version was appropriate. A lower count never excuses label loss; the chosen version still has avoidable crossings.

### F07 — High evidence gap: the independent live-pane width is missing

Final manifests `manifest-v1`, `manifest-v2`, `manifest-v3` all retain pane row count 47 but null width and rectangle. They also have null `viewport_line`. The frame transcripts do preserve actual runtime `viewport: 77x47 zoom: 1.00 natural` lines, and the ordinary ANSI grids measure 77×47. Thus:

- `viewport.verified` is **true** for the app-rendered viewport.
- `live_pane` is **null**, not a fabricated copy of the app dimensions.
- The workflow category is **blocked**, not pass.

The validator's 28 PASS lines per view accept a header fallback. That does not supply the missing independent pane measurement required by the frozen task. Header regions [2,1,75,1] in all three ordinary captures identify exactly what the fallback proves. A retained Herdr measurement/probe record is the unresolved evidence need; no new session was opened to repair it.

### F08 — Medium: host residency was not encoded by an AS token

Source context associates both bare-metal hosts with NxtGen Cloud in Bengaluru. `AS132717` is printed on the gateway, but bare metal, provider name, location, and their association with the hosts are absent. Host region **[12,19,54,12]** in v1 and gateway **[22,15,34,4]** in v2 show what is actually encoded. The ledger's claim that these facts were “compressed” into the AS token does not preserve their meaning.

Incidental uptime, GPU/software provisioning state, and earlier `/tmp` artifact pointers are not treated as required NIC/egress edges. Their absence is not a new pass condition or an additional defect here.

## Specific disputed self-reports and address/count coverage

| Item | Independent classification |
|---|---|
| Literal `8 physical NICs` is absent | **Accepted abbreviation, not a separate defect.** Seven dark ports attached to server1 plus its one `only uplink` make the count/role decomposition recoverable. The rubric requires preserved meaning, not this exact literal string. |
| Full gateway quad allegedly appears only as `.57` | **Self-report/reveal factual error, not a capture defect.** v2 visibly prints `Arista ToR 103.19.91.57 AS132717` at [23,16,32,1]. It also prints full `103.19.91.58 v4-only` at [29,8,20,1]. Captures override the contradictory generator note. |
| `/29` prefix and host addresses | **Recoverable across the final views.** v1 has `.58/29 no NAT`, `.57`, server2 `.59`, and `.60-.62` on the bus. v2 supplies the full .58/.57 quads, allowing the repeated endpoints to key the prefix. This is weaker than the skill's same-view abbreviation-key advice, but I do not invent a separate rubric gate prohibiting all cross-view recovery. It does not repair reversed heads, the free-address claim, or server2's missing model. |
| `server1 R7725` versus server2 | Host1's model association passes. Host2's does not: **F02, critical defect**. |
| `8.3-8.6 ms` | **F05, semantic defect**, not blocker. Retaining the endpoints does not disclose disagreement. |
| Missing VXLAN/MPLS/ICMP view | **F04, known coverage defect**, not evidence-only uncertainty or proven unsupported capability. Failed attempts and budget exhaustion cannot turn it green. |
| Tall `still unproven` box | Not a separate defect. Its four questions and incoming heads remain readable. Terseness alone is not an added category rule. |
| Missing pane width | **F07, evidence blocker.** No width is invented. |

## Per-relation audit summary

The machine-readable file contains **27 audits**: the eight original relation records, four source-backed qualification relations, three extra reverse bus relations, and twelve host/count/limitation/mechanism associations. Association audits do not claim additional visible arrowheads. The count of visible arrows remains **13**.

| Audit | Decision | Main point |
|---|---|---|
| e1 dark → server1 | pass | Dashed `no cable`; down head (13,18); explicit uncertainty also in v3. |
| e2 server1 → NIC | pass | `only uplink`; down head (32,26); label and target intact. |
| e3 NIC → gateway | fail | Correct downward chain in v2, but opposite bus route in v1. |
| e4 server2 → gateway | fail | Only reverse bus head into server2 is shown. |
| e5 pool → gateway | fail | Reverse bus direction and unqualified `free`. |
| e6 gateway → Airtel | fail | Trace/latency are correct; gateway role label is not qualified as required. |
| e7 Airtel → backbone | pass | Correct 7.1 ms owner, down head (30,30). |
| e8 backbone → Cloudflare | fail | Correct endpoints/head (26,38), but latency conflict converted to range. |
| q1–q4 observations → unproven claims | pass individually | Dashed question labels and heads at (48,14/16/18/20) are traceable; no invented topology. Earlier definitive labels still fail the cross-view semantics gate. |
| extra gateway → NIC/server2/pool | fail | Three actual reverse-direction apparent relations; explicitly audited rather than ignored. |
| Host1 address/model; host2 address | pass | Recoverable address key across views; host1 model explicitly attached. |
| Host2 model | fail | R7725 absent from its association. |
| Eight ports; no NAT/v4-only; single uplink/ISP/no ECMP | pass | Meaning is present without adding literal-text conditions. |
| Host residency | fail | Gateway AS token does not encode host/provider/location/bare-metal residency. |
| Tunnel, ICMP, off-path, alternative-fabric relations | fail | No final view covers them. |

Each JSON audit records source references, actual source stem, route bends, target/head, crossings/junctions, labels, 1-based regions and finding IDs where applicable. The detailed blind record gives every visible label, node border and UI label coordinate.

## Fit, color, borders and motion evidence

| View | App viewport | Visible graph rectangle | Check extent | Visible independent crossings | Explicit branch junctions | Check crossing count |
|---|---|---|---|---|---|---|
| v1 | 77×47, 100% | [12,11,54,27] | 55×28 | 0 | 2 | 2 |
| v2 | 77×47, 100% | [22,7,34,36] | 35×37 | 0 | 0 | 0 |
| v3 | 77×47, 100% | [13,13,52,24] | 53×25 | 2 | 0 | 2 |

The natural-zoom runtime line is in each frame transcript, despite the check-only line saying `viewport: unknown`. Nothing requires panning or zooming out in the supplied finals. The lower-left controls do not occlude Cloudflare or any other graph content. A fitted subset is not complete source coverage.

Normal per-node border RGB and all perimeter rectangles are recorded in the blind file. Every selected perimeter is bold RGB(216,166,87), with four complete sides and corners. This is **16/16 node occurrences in simultaneous `--select-all` captures**. It proves each drawn selected border; it does not prove isolated focus, dragging or undisplayed interactive states. No additional handle geometry appears in these captures. No unsupported interaction claim is needed for the drawn-border gate.

All ordinary routes/heads are muted RGB(124,111,100). v2's Airtel pair shares related pinks; v3's observation nodes share golds. These judgments use ANSI, not plain-text inference.

All sampled frames at 0, 100 and 200 ms are identical within each view, including ANSI styles. **No motion appears.** There are no dot violations. Optional-animation applicability is source-backed; three frames would not suffice for a full-cycle origin/arrival verdict if animation had been required.

## Reproducibility, identities and cleanup

Verified actual digests against frozen metadata:

| Input | SHA-256 |
|---|---|
| Candidate skill | `cf796bcdc527897687ec2ca19844f399c921252409b9ca7ad04fbfa1b6cc659c` |
| Frozen renderer binary | `b242b6a28e2e27934b06b7a297be638c143e5c99680495e104380cd8d9ee80f7` |
| Corrected rubric | `5519fd84f6b75973dbf7b5f5544c909a8f32a8841a876c8e7af00a1fcb119335` |
| Source-backed cases manifest | `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05` |
| This case source | `235d296fef435710c8a49bcd247455c8c82b844e71726f146c4cedf227d0308b` |
| This case expected reference | `ada8d8b1b8a3dfda4221b22fd1bb785327d6eeda69834c35ab5ab17b0678afb4` |
| This case historical variants | `40f060941014aeaf83ee591346e9950f71c02bf9a68c5693804877bfbcbd9eb8` |
| Sorted final-spec manifest | `13b72a1312c49d5fe2e15bc4b5aecfeadd25fea0d08cf8a19cb4058336cff033` |

The final-spec manifest contains sorted repository-relative paths and the actual hashes for all three specs. Its digest is `spec_sha256`; it and the individual specs are evidence inventory entries. The inventory has **61 entries**. All **28 artifacts** in the three final manifests plus the preserved rejected capture manifest matched their recorded hashes. Final manifest spec/binary hashes and every recorded attempt hash also matched. No current renderer source was substituted for executed capture evidence, and no renderer gain is credited to the skill.

The actual ordinary/select/frame commands with absolute binary/spec paths are retained in the text frame transcripts. `generation.json`/`generation.md` additionally retain harness/check/validator command templates. Final manifests record `check_exit:0`, full preserved check files, check/capture UTC windows, selection/frame flags, pane identities and cleanup. The record has no separately retained stderr stream or raw close-probe stdout; I do not fabricate either. The short static samples are not presented as an animation proof.

Capture windows and cleanup records:

| Pane | View | Capture window UTC | Preserved cleanup |
|---|---|---|---|
| `w7E:pC4` | v1 | 2026-11-02 11:19:44–11:19:48 | `confirmed_closed` |
| `w7E:pC5` | v2 | 2026-11-02 11:19:54–11:19:58 | `confirmed_closed` |
| `w7E:pC6` | rejected v3 attempt3, context only | 2026-11-02 11:19:58–11:20:02 | `confirmed_closed` |
| `w7E:pC7` | final v3 | 2026-11-02 11:20:25–11:20:29 | `confirmed_closed` |

Cleanup is recorded as done from those preserved manifests and the generator cleanup list. This reviewer owned no panes and did not run a new live cleanup check. The rejected capture is process context, not a fourth final view.

### Reviewer-identity correction episode

The captain disclosed, and metadata revision 4 records, that `required_reviewer_model` and the result-schema reviewer const had retained the stale `openai/gpt-6-astra` value. They were corrected to **`openai/gpt-6.1-sol` before any reviewer-result.json existed**, and metadata now carries the corrected rubric digest verified above. The episode is not concealed as an unchanged byte-for-byte rubric file. Metadata and the captain state that criteria/thresholds were unchanged; no earlier-round files were read to independently compare them.

One stale Astra phrase still remains inside the workflow criterion prose. The explicit corrected required-model field, schema const and task instruction require true Sol identity; they do not ask this reviewer to impersonate Astra. This result reports true Sol. The identity correction is not counted as a semantic improvement or a renderer/skill gain, nor used to waive the pane-evidence blocker.

## Correction candidates — no changes applied

### Skill/generation level

1. Keep direction immutable in the relationship ledger before choosing trunk geometry. A source-backed membership bus can remain a bus, but reversed arrows cannot be passed off as the same relations. If required bus direction cannot be rendered, report that limitation instead of reversing it.
2. Make both host/model associations explicit. Retain an unambiguous visible cross-view identifier/key; a narrative coverage map cannot silently supply a missing association.
3. Put qualification on the actual assertion in each view. A later uncertainty diagram does not label an earlier definitive assertion as hypothetical. Dashed edges and text should agree.
4. Preserve reported-value disagreement as disagreement. Do not manufacture a single authoritative value or an observed range from conflicting point statements.
5. Treat a dropped required ledger fact as a failed coverage item, even with an honest reason. The mechanism explanation needs a genuinely covered view; “recomposed as uncertainty” is not equivalent.
6. Keep semantic role/provider/location distinctions in the coverage audit instead of claiming an AS token encodes them all. Do not impose unrelated historical provisioning details merely to fill a checklist.

### Renderer/routing and evidence-harness level

1. Allocate fan corridors/ports monotonically where possible. The v3 OUI/dark double crossing has a free earlier turn corridor without reordering nodes or merging relations. This is a renderer routing opportunity, not a proven skill-only gain.
2. Report independent crossings separately from declared bus junctions. v1's check count of two otherwise looks like two independent crossings, although only two intentional branch junctions are visible.
3. If converging shared buses are unsupported, expose direction semantics or emit a capability error; do not let a clean routing check certify the opposite meaning. The generator's reported failed opposite-geometry probe is not sufficient evidence here to declare the whole renderer incapable.
4. Retain actual pane rectangles/widths separately from app viewport dimensions, and retain exact check/cleanup command results rather than relying on header fallback and prose. The current missing width is the required evidence blocker.
5. Semantic view titles would improve split-view context, but their reported absence is not a hard blocker: no source-required title field or impossible rendering requirement is proved by this bundle.

No fixes, installs, viewer sessions, commits or subagents were performed. The review wrote only its permitted review-directory outputs and a temporary standard-library assembly/validation helper. No credentials, chat history outside the supplied excerpts, remote hosts, other case source files or earlier-round outputs were consulted.

## Verification and remaining blockers

`reviewer-result.json` was checked locally against every validation keyword used in the frozen embedded schema by a standard-library validator, without installing dependencies. Evidence IDs, finding/edge references, repository-relative inventory paths, all hashes, and capture-region bounds were checked. The blind file hash remained unchanged.

**Unresolved required evidence blocker:** independent measured live-pane widths/rectangles. **Proven required model/tool capability blockers:** none. Attempt-budget exhaustion and known missing content are defects, not capability waivers. The captain must still gather all eight independent critiques before any skill revision; this report neither revises the skill nor claims an aggregate verdict.
