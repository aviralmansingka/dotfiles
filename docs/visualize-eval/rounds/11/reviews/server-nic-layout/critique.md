# Independent review: server-nic-layout, round 11

**Verdict: FAIL.** Semantic defects remain, and workflow evidence is blocked. There are eight distinct historical source relations, rendered as nine arrow occurrences because NIC → gateway appears in two views. This is not nine distinct historical relations. All nine route occurrences have traceable endpoints and directions; that does not make their labels semantically correct.

All paths in this report and `reviewer-result.json` are relative to the repository root. Coordinates are 1-based `[column,row,width,height]` in frame 0 of the relevant `pinned/vN-77x47.txt`, counting the application header as row 1. `observed-first.md` was saved before the reveal and remains unchanged; SHA-256 `f1a0af99510b18a6ea4c1bfe3d9cbcc669593ffa22f403c181ef8a94103f7086`.

## Category decisions

| Category | Decision | Basis |
|---|---|---|
| Semantic fidelity | **fail** | The missing-hop caveat is changed and narrowed; trace observations are assigned to specific segments without support; `no cable seen` asserts an observation not in the source; AS132717 is placed in the gateway box instead of on the site/server context. |
| Arrow traceability | pass | All nine occurrences are traceable, no crossings or fake branches, distinct ports. An accurately traceable arrow can still bear an incorrect or over-specific semantic label. |
| Layout fit | pass | All final pinned dumps show 77×47 at 100% natural, full boxes and labels, no overflow banner; live app header reports 82×51. V2's 75-column extent is a fragile but currently passing fit. Semantic coverage is judged separately, not waived by fit. |
| Conceptual grouping/color | pass | Related NICs and ISP nodes share respective hue families; singletons are distinct within each view. No group outline or title is painted. `nics` and `target` share green across separate views, but are never competing groups in the same view; no independently required cross-view hue uniqueness is established. |
| Category fit | pass | The named `identity-probe-maps` family and source-backed evidence are plausible: identifiers and qualifiers dominate eight relations over nine historical nodes. The three chains/star views and borrowed fan ordering are visible; deviations and reasons are documented. Under round 11's softened hint rule, explained deviations do not fail this category. Semantic omissions remain independently material. |
| Border integrity | pass | Normal and select-all ANSI cover all 12/12 node occurrences with complete, continuous per-node borders; palette does not overlap. Select-all does not prove separate interactive selection tests. |
| Workflow evidence | **blocked** | The actual dataset-manifest hash differs from frozen metadata. The log covers and hashes eight `--check` commands, not the separately described draft visual probes, manual probe or failed captures. The live v1 third frame is truncated, although pinned v1 has three complete static frames. |
| Animation | N/A | The case manifest says optional and the source requests no animation. Complete pinned frames show no dots in all three views; speed and origin are inapplicable. |

## Semantic findings

1. **Critical defect — missing-hop conclusion (F1).** The source states, “A missing hop proves nothing about Layer 2.” V3 places `7.1 ms · h3 mute ≠ L2` at `[41,23,21,1]`. The `≠` reads as a positive non-equivalence/denial, not the epistemic statement that no Layer-2 conclusion follows; it also limits the statement to hop 3. This matters because the human specifically asked whether invisible switches are L2 rather than L3. A better faithful caption would say the absence does not establish L2, without asserting its opposite.
2. **Critical defect — unsupported segment attribution (F2).** V3 attaches `h3 mute` to Airtel → backbone `[41,23,21,1]` and `h5 -80% h6 mute` to backbone → Cloudflare `[41,31,28,1]`. The source gives hop-number observations, not the devices or these segment associations. A hop token does not undo a graphical edge attachment. Generator explicitly discloses the inferred anchoring; disclosure does not make the picture source-backed.
3. **Critical defect — unsupported negative observation (F3).** Source reports seven ports dark and warns that inactivity does not prove no cable. V1 says `no cable seen · unproven` `[42,15,24,1]`; `unproven` qualifies the cable conclusion, but `seen` still asserts a specific observation of cable absence that the source does not report. Dark/inactive with cable status unknown preserves the distinction.
4. **Critical defect — AS placement (F4).** `.57 Arista L3 leaf · NxtGen AS132717 Bengaluru` `[16,12,46,1]` puts the site AS in the gateway's box. Source states both servers are at NxtGen Cloud (AS132717), Bengaluru; it does not establish the gateway's AS ownership. It is possible to read the second clause as site context, but its placement in the gateway node encourages attribution to that node and leaves server2's AS/site context unexpressed. The generator acknowledges the misplaced attribution.

The remaining checked qualifier text is present: v1 shows `(MAC OUI, role unproven)`, NIC name and speed; v2 shows `no NAT/proxy/v6`, `free · unprobed`, and server2 `R7725`; v3 shows `L3 leaf`, dashed `bridge|tunnel|silent`, h5 loss/h6 silence, and `8.3-8.6 ms`. The dash and three alternatives retain uncertainty about the fabric; `free · unprobed` qualifies a free-address claim. The two gateway wordings vary across views, with OUI caveat present only in v1; the shared `.57 Arista` prefix identifies the recurring gateway but users viewing v2 alone do not see the caveat. Full `.57` gateway role is recoverable from the v1 `default gw` and shared context, rather than from a standalone full `103.19.91.57` label. Abbreviations and the two latency values should not be mistaken for independent measurements.

## Relation audit

| Relationship | Capture and direction | Decision |
|---|---|---|
| dark → server1 | v1 dashed down, ▼ `[39,18]` | fail: unsupported `no cable seen` observation (F3); arrow itself clear |
| server1 → active NIC | v1 down, ▼ `[39,26]` | pass |
| NIC → gateway | v1 down, ▼ `[39,34]` and v2 right, ▶ `[44,23]` | pass; two occurrences of the same relation, complementary labels |
| server2 → gateway | v2 right, ▶ `[44,25]` | pass |
| free block → gateway | v2 dashed right/up/right, ▶ `[44,27]` | pass; free is qualified |
| gateway → Airtel | v3 dashed down with jog, ▼ `[39,18]` | pass; three unobserved-fabric alternatives |
| Airtel → backbone | v3 down with jog, ▼ `[38,26]` | fail: caveat and unsupported hop placement (F1, F2); route clear |
| backbone → Cloudflare | v3 down, ▼ `[38,34]` | fail: unsupported hop placement (F2); route clear |

No extra apparent route or undocumented junction is present. V2 has three independent sink ports, not a bus split. V1/v3 have no crossing; v2 has closely spaced but separate bends. Zero observed bridge crossings and touching bends agree with checks; no label owner is uncertain in the captures. Full per-edge regions and evidence IDs appear in `reviewer-result.json` and the blind record.

## Evidence gaps and provenance blockers

- **Frozen dataset identity:** metadata records `cases_sha256` = `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05`; the actual `docs/visualize-eval/cases.json` hashes to `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05`. Individual case source, expected and historical-variant hashes, skill, rubric and renderer match metadata. The result records the actual dataset hash and does not silently substitute the recorded one. Obtain frozen bytes or corrected provenance before claiming reproducibility.
- **Incomplete probe records:** eight logged candidates have matching spec, stdout and stderr hashes, and all three supplied validator outputs report pass. Yet `attempts.json` explicitly says candidate drafts were judged from 77×47 dumps; those draft dumps, their commands and raw output are not preserved in `attempts-log.jsonl`/`recorded/`. The described manual probe and initial failed captures are also not preserved there. An all-pass validator cannot prove that unlisted probes were recorded. This is an evidence gap rather than a claim of a renderer defect.
- **Frames and dimensions:** live v1 frame 2 stops mid-server border at 24 of 51 rows; `--frames` output for the final spec at pinned 77×47 contains all three complete identical frames. Live v1/v2/v3 headers say 82×51; manifests record null pane rectangle and columns, and report the header token. Pinned final-spec dumps independently satisfy the explicit target-fit rule. Null rectangle alone does not fail fit.
- Cleanup: three successful bundle manifests report pane closure (`w7E:pTR`, `w7E:pTX`, `w7E:pWD`); generation reports closing manual probe `w7E:pTH`. This reviewer opened no panes. Failed-capture pane identities and their separate cleanup evidence are not provided.

## Correction candidates, not repairs

- **Skill/generation:** make the fact ledger retain epistemic scope; put hop-number/loss facts in an unanchored trace note unless segment assignment is sourced. Use the precise “missing hop does not prove L2” qualifier. Do not turn dark interfaces into an observed absence of cables. Associate AS and site with the supported server/site facts, not a gateway node, and preserve the OUI caveat where gateway identity is presented.
- **Evidence harness:** preserve raw command, exit and output for every actual draft visual probe and failure, and capture complete final frames before closing. Repair or document pane-rectangle targeting without substituting hardcoded geometry. Resolve the frozen dataset hash mismatch before comparing rounds.
- **Renderer:** no renderer defect is established by these static, fully traceable layouts; no renderer performance or improvement claim follows from this review.

Reports: `docs/visualize-eval/rounds/11/reviews/server-nic-layout/reviewer-result.json`, `spec-manifest.json`, and this critique. Spec-manifest SHA-256: `fbefb7dca0dc15907cf4a9a0d59fec43cc94c3741660958222f397058f6015f0`.
