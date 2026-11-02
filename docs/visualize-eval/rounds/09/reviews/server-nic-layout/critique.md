# Round 09 independent review — server-nic-layout

**Verdict: FAIL.** The three captures fit the pinned target and the edges themselves are drawable and traceable. They do not fully preserve the source's identity and gateway semantics, and one edge label fails the ownership rule. This is not an evidence-only red case. All paths in this review and `reviewer-result.json` are repository-relative unless explicitly identified as a frozen absolute binary path.

| Category | Decision | Basis |
|---|---|---|
| semantic_fidelity | **fail** | Gateway role, Dell/NxtGen identifiers and invisible-hop qualification absent; full cross-view key is not shown; conflict not conveyed in drawing. |
| arrow_traceability | **fail** | All eight stems/arrowheads are traceable, but v3 `same /29` is closer to the other route. The standing ownership rule fails the view. |
| layout_fit | **fail** | All three final-spec target dumps fit, but the category also requires complete cross-view source coverage, which is missing. Fit itself passes. |
| conceptual_grouping_color | **pass** | Related node colors and proximity; stable sibling order; no group boundaries, as required. |
| category_fit | **fail** | Correct `identity-probe-maps` family and stated evidence, but required ledger-first capture coverage is incomplete. |
| border_integrity | **pass** | ANSI shows complete continuous normal and selected borders for 11/11 occurrences. |
| workflow_evidence | **pass** | Frozen inputs, blind-first record, eight wrapper records, three passing validators, measured live captures, frames and closure evidence. |
| animation | **N/A** | Static source; manifest says optional, not requested. No dots in captured frames. |

## Critical and high findings

1. **F1 — critical semantic defect: gateway role and device/provider names.** All three gateway occurrences say `.57 Arista (OUI) AS132717`, but none says gateway, default gateway, routed gateway, or ToR. The fact that an OUI alone does not prove the ToR role is not a reason to erase the separately sourced gateway role. See v1 [28,37,27,4], v2 [29,13,27,4], v3 [28,29,27,4]. `R7725` appears on both servers, but `Dell`/`PowerEdge` and `NxtGen` do not appear in captures. ASN and model number alone do not explicitly convey the source's named identities.
2. **F2 — high ownership defect:** in v3, the solid server2 route starts at x15, the dashed spare route at x46, and `same /29` occupies x30–37 on row 25. The closest competing route is the dashed one. At row 27 the solid bends to x29 and the dashed bends to x31, separated by empty x30; arrowheads at (29,28) and (31,28) remain distinct. Thus routes are traceable and do not cross, but label ownership is visually uncertain. `check.txt` reports `0 ambiguous owners`; an independent visual rule overrides it. Neither draft records proof that no unambiguous placement exists. Region [15,25,32,4].
3. **F3 — critical semantic defect:** v2's `.57` → Airtel hop [30,17,27,4] is rendered as plain solid `transit 1.8ms`, with no visible `L2? no hop`-type qualification and no caveat that a missing hop does not prove L2; the source says intervening fabric may bridge, tunnel, or remain silent. A caveat need not invent an invisible switch. Solid route alone should not be read as establishing a directly visible physical adjacency.
4. **F5 — high semantic defect:** the generator's key `103.19.91.0/29` lives only in `generation.json`; v1 shows abbreviated `.58/29` [43,33,22,1] and `.57`, while v3 shows the full prefix on the .59 and .60–.62 members [15,22,53,1]. The repeated Arista label helps join views but does not explicitly tell a reader that the abbreviated hosts share those full octets. Server1's full `103.19.91.58/29` is not present in a capture. The join relies on inference across views.
5. **F6 — high category-fit defect:** `generation.json` has a ledger, but the actual identity-map recipe requires each source identifier and qualifier to be mapped to a named view **and proved in the capture**. Dell, NxtGen, gateway role, the missing-hop caveat and explicit complete /29 join do not meet that bar. Several non-relational source facts, including bare metal, Bengaluru, no GPUs, no rack-bench and uptime, are explicitly dropped in the generator ledger rather than rendered; the omission-risk diagnosis did not result in complete coverage.

**F4 — medium defect, source conflict:** primary excerpt line 120 gives Cloudflare 8.6 ms, while the historical relationship-fact list gives 8.3 ms. The captured `8.6 ms` [44,33,6,1] is directly supported; choosing it is not an invented measurement. The generator discloses the contradiction honestly in `generation.json`, but a reader of the artifact sees neither the alternative nor the 8.3–8.6 ms uncertainty. A qualified range or equivalent visible conflict indication preserves both claims without presenting either as independently verified fact.

## Relation audit and shape

The machine-readable result contains all eight audited relations with 1-based capture regions. In short: r1 `dark → server1` dashed `no link seen` correctly avoids asserting no cable; r2 `server1 → NIC` correctly says only uplink and 25GbE; r3 `NIC → .57` carries `.58/29`, no NAT/v6 and 0.1 ms but omits the destination's gateway role; r4 `server2 → .57` is drawn but its `same /29` label owner is ambiguous; r5 `.60–.62 → .57` is dashed, says `free?` and `no probe reply`, correctly distinguishing an unanswered probe from verified free addresses; r6 `.57 → Airtel` lacks the missing-hop caveat; r7 Airtel → backbone and r8 backbone → Cloudflare are traceable, with the 8.6/8.3 qualification noted above. The identity defect at the repeated target also applies to all uses of that target. There are no extra visible edges or invented switches.

V1 and v2 each have four nodes and three downward edges; v3 has three nodes, two independent arrows converging on the same box. Maximum outgoing fan is one, no anti-parallel pair occurs, no route crosses, and there are no fake junctions. Offsets make one horizontal jog per non-aligned hop; v1's middle hop is straight. These short jogs are readable and not independently judged avoidable detours. The cross-view repeated `.57 Arista (OUI) AS132717` node joins the gateway occurrences, subject to the address-key defect above.

## Family and recipe

The correct family is **identity-probe-maps**, the same as the generator's choice. In `generation.json` → `classification.evidence`, the line is:

> eight relations over nine boxes whose content is identifiers and qualifiers, not phases: eno16595np0, 25GbE, 103.19.91.58/29, .57/.59/.60-.62, AS132717, AS13335, 14.143.x/14.141.x, plus measured hop latencies 0.1/1.8/7.1/8.6 ms and qualified states (7 ports dark, 'free?', OUI-derived vendor, 'no probe reply'). E = N, so omission is the only real failure mode.

The example identifiers and qualifier-heavy structure support the family; the literal `E = N` statement is arithmetically inaccurate (8 edges, 9 nodes), although the tie-breaker correctly states E = N − 1. The classification alone does not pass its recipe. Captures do prove many listed facts: 7 dark ports, both R7725 suffixes, NIC and speed, .59 and .60–.62, free?, no probe reply, both ASNs, both Airtel address fragments and 0.1/1.8/7.1/8.6 ms. They do not prove all listed or sourced facts, including the omitted names and qualifications above.

`generation.json` documents two combined-view drafts: v1-a1 tb cannot route s2→gw; v1-a2 lr cannot route spare→gw. Their exit-1 raw records are retained. These show those two arrangements failed, not that every possible combined layout is impossible. The split itself is not rejected; it does not excuse incomplete cross-view content or r4 label ownership. The r4 ownership defect has no recorded impossibility yield.

## Fit, color, motion, and workflow

- Live application headers say **82×51 at 100%**, not the target. `pinned/v1-77x47.txt`, `v2-77x47.txt`, and `v3-77x47.txt` each directly dump the corresponding final spec at `viewport: 77x47 zoom: 1.00 natural`, with no overflow or clipped graph content. This meets the pinned fit-proof ruling. The fit category nevertheless fails its separate complete-coverage requirement.
- Checks say zero bridges, zero touching bends and zero ambiguous owners. Independent coordinate inspection agrees on crossings and disagrees on v3 ownership. The absence of a `routes:` line is expected. No source groups are painted as enclosure boxes. `server1` uses blue shades, `prefix` orange shades, and `nxtgen`/`transit` green-family shades; the nxtgen gateway and first transit node share one exact RGB, but the actual source grouping remains readable through proximity and related member hues.
- Normal ANSI and `--select-all` ANSI show all sides/corners and uninterrupted per-node color, with no palette occlusion. Select-all simultaneously covers all 11 occurrences; it is not evidence of isolated per-node selection interactions.
- Five 82×51 text and ANSI frame bodies per view, 0–400 ms, are byte-identical after excluding frame headers and shell context; pinned 77×47 dumps also show five static frames. No route has a dot. Animation was not requested in the source; the frozen manifest marks it optional. No speed, origin, or arrival claims are inferred from a static view.
- `attempts-log.jsonl` has eight wrapper check records; all sixteen raw stdout/stderr SHA-256 values were independently verified. All three preserved validators report 33/33 passes, including `attempts_records_complete`. Those validators check the evidence contract, not whether the semantics are correct. Rejected drafts and their captures are retained.
- Frozen skill, rubric, dataset index, case source/expected/variants, and the binary were hashed against `metadata.json`; all matched. The deterministic sorted spec manifest is `spec-manifest.json`, SHA-256 `82e8c8bf737439856f0ba1a1ff4225d36e560d9384e98c21155c924de50757be`. The saved stage-A record remains unchanged at SHA-256 `fdfc011762e9ba79e36ee9cdf4fb4fc433b32a33f0390b88680b7931ee914a49`, and is inventoried as saved before reveal.
- Cleanup records report `w7E:pNQ`, `w7E:pNR`, `w7E:pP1`, `w7E:pNS`, `w7E:pNY` closed. This review opened no panes. Generator `viz-ds09-4` used `fireworks/accounts/fireworks/routers/deepseek-flash-latest`; reviewer `viz-judge09-server-nic-layout` used `openai/gpt-6.1-terra:high`.

## Correction candidates and blockers

**Skill-level candidates:** preserve named role and vendor/provider identities as literal capture text; make the /29 cross-view join explicit; keep missing-hop and qualified-address caveats visible; carry competing latency measurements as a qualified source conflict; require a ledger entry to point to readable capture text, not merely generation notes or assumptions from model/ASN. Audit each label against nearby competing routes after capture, not just checker statistics.

**Renderer-level candidates:** improve label-slot ownership detection and placement around converging routes, or expose a controllable alternate slot. Treat a label nearer another route as ambiguous even when its cells do not overlap any route. This is a potential renderer defect, but the present evidence does not establish that the desired result is impossible with the renderer.

**Capability blockers:** none established. Missing semantics and ownership are known defects, not unsupported-tool/model blockers. Full independent physical verification of the historical network is outside this frozen case and was not attempted.
