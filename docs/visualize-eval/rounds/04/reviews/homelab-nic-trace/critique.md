# Independent Sol critique — round 04 — homelab-nic-trace

## Verdict: FAIL

**Five categories fail, one passes, and one is blocked.** Known failures take precedence over incomplete evidence, so the case is **fail**, not merely blocked. None of these decisions relies on an earlier-round verdict. There is no green claim.

The candidate recovers all 14 historical endpoint relationships and the important address/AS identifiers across four readable views. Its static arrows are remarkably easy to follow: no crossings, shared corridors, fake branches, or conspicuous detours. Those strengths do not repair missing historical qualification, away-from-origin animation, a corner-obscuring dot, or the control palette painting over a node.

| Fixed category | Decision | Basis |
|---|---|---|
| `semantic_fidelity` | **fail** | Historical-traceroute qualification is missing from the WAN chain; the WAN router loses its `claimed` marker; source host/link qualifiers and role mappings are omitted. F01–F03. |
| `arrow_traceability` | **fail** | All 16 static routes are traceable, but all 11 animated dots start one cell after their true origin. The rubric explicitly makes this a direction-proof failure. One qualifier has ambiguous ownership. F04–F05. |
| `layout_fit` | **fail** | Actual 77×47 @100% views are proven, but the WAN palette obscures three node-border cells. Fit includes overlay avoidance, not just canvas extent. F07. |
| `conceptual_grouping_color` | **pass** | Source-based virtual, host, physical-interface, edge, provider, overlay, IPv6 and Cloudflare groups use related hues and sensible proximity. ANSI supports this conclusion. |
| `border_integrity` | **fail** | Cloudflare's lower-left outline is incomplete and color-discontinuous in both normal and selected states. Eighteen of nineteen outlines are complete. F07. |
| `workflow_evidence` | **blocked** | Frozen hashes, attempts, capture states, header dimensions and recorded cleanup verify; exact executed invocation/status/stderr provenance and full-cycle motion evidence do not. F08–F09. |
| `animation` | **fail** | Eleven initial-origin mismatches and one observed corner-contact event. Full-cycle evidence is also incomplete. Unequal arrivals are **not** a failure in default constant mode. F05–F06, F09. |

## Review identity, scope, and preserved blind record

- Reviewer: `viz-judge04-homelab-nic-trace`, model `openai/gpt-6.1-sol`. The session's `PI_MODEL` reports `gpt-6.1-sol`; no model was switched.
- Generator: result-schema identity `viz-ds04-homelab-nic-trace`, model `fireworks/accounts/fireworks/routers/deepseek-flash-latest`. The actual generation alias recorded in `generation.json` is **`viz-ds04-3`**, subagent ID `566b35de`. The canonical case-keyed worker ID follows the stage-B instructions; it does not replace or conceal that recorded alias.
- Generator and reviewer are distinct sessions. No reviewer or other child agent was spawned by this judge.
- Blind record: `docs/visualize-eval/rounds/04/reviews/homelab-nic-trace/observed-first.md`.
- Blind SHA-256: **`a498a2866ade2b442dee4eb4a1049f952722f7e9fa52cc7521706786aabf1216`**.
- The blind record was saved and hashed before expectations were revealed. Its bytes remain unchanged. The result inventory includes it and sets `observed_first.saved_before_expected_reveal` to `true`.

**Immutable-record addendum:** the blind record's four UI title widths were transcribed five cells short. The correct 1-based title rectangles are v1 `[2,1,66,1]`, v2-lan `[2,1,70,1]`, v3-overlay `[2,1,74,1]`, and v4-wan `[2,1,70,1]`. This erratum was reported immediately after stage A and is incorporated here without editing the blind file. It does not alter any graph-label coordinate or substantive finding.

The generator narrative's coordinates are generally **zero-based**; all coordinates in this critique, the blind record, and `reviewer-result.json` are **1-based** `[column,row,width,height]` on the individual view's canvas. Frame and viewport metadata lines are excluded from canvas coordinates.

All evidence inventory paths are relative to the repository root, `/Users/aviral/.herdr/worktrees/dotfiles/fix-visualize-skill/`. The external frozen binary was hashed directly at `/tmp/visualize-eval/round-04/bin/rataflow-view`; its identity is represented by repository-relative metadata and `bin.sha256` artifacts, not a fabricated repository-relative binary path.

## Frozen identity and reproducibility checks

The following actual file hashes match the frozen metadata:

| Input | Verified SHA-256 |
|---|---|
| Candidate `rounds/04/SKILL.md` | `ac431c6d3035e466e29136f36d9579c551c2e070a354dc5df72999b1bb1beb3c` |
| Frozen renderer binary | `0da16d8d8ed46e2a25eb773fc71ecad4de9e310cd33e303a4c7fe77231ad95bc` |
| Round-04 rubric | `18412615f82841b34cf131976c6b5f4b00cd4fc031a710cdfc81058e2dd68d10` |
| Dataset `cases.json` | `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05` |
| This case's source | `abe8b376eccd7d0027f2985aab55ed656603b2094c275ee66ed223a57421b4c4` |
| This case's expected relations | `91ef88d09af71cd4583cfd0f1141e10f2fc2efdd3a779f9389f1d67759cd09c7` |
| This case's historical variants | `d70fd9d33cc1966bc015b6bc4d84176984979cac15b9cb7d1d89165e1bc7fc1f` |
| New deterministic spec manifest | **`da6c2cd61d642c3752eeebe09156b6851977e0f31a5d2c6d60dd91aa67af220c`** |

`spec-manifest.json` contains sorted pairs of repository-relative spec paths and actual SHA-256 values. Its hash is the result's `spec_sha256`. Each of the four final specs and the manifest itself appears separately in the evidence inventory. Their hashes agree with the original capture manifests:

| Final view | Spec SHA-256 |
|---|---|
| v1 | `62b7d422292799f591c09328b69df9cfdfa63a18c806a007d1ce9abfe50c1d99` |
| v2-lan | `341c30f13c4bad79e5e49227fb58fbba97df639ea36ea41932456475cee729f1` |
| v3-overlay | `0ad360e08757b87c8ce57ee22626882363d76495947a22b0ec10920f147ca8d2` |
| v4-wan | `198f2eb19ac4537530f001de6e1173d25af2bec45489e8f123cb65c01f9f8b83` |

All artifact hashes listed in all four original manifests verify. The three late-added pinned motion dumps are not in those manifests, but their actual hashes match the separately frozen values in `generation.json`. Their provenance distinction is explicit; their correct hashes do not prove that they cover a full cycle.

`generation.json` has a stale `round: "03"` field, with an explicit adjacent explanation that generation used the round-04 directory, skill and frozen binary. `attempts.json` says round 04. The verified frozen hashes support round 04; the reviewer result uses integer `4`. This clerical discrepancy is not treated as evidence of a different renderer run or a model substitution.

## Source coverage and semantic fidelity

The source is historical evidence, not permission to SSH, probe a host, or treat an assistant's old device-role interpretation as verified network topology. Only the supplied excerpts, expected data and historical variant were read. No historical chat was opened.

### What is actually preserved

| Required meaning / identifier | Readable capture evidence | Assessment |
|---|---|---|
| Correct test host and rack-bench residency | v1 `homelab ~/rack-bench` `[31,32,20,1]`; v3 same label `[49,22,20,1]`; LAN `homelab ASUS/Linux7` `[29,12,19,1]` | Correct host, not devbox; path and ASUS present. Hardware/OS qualification is incomplete below. |
| Wired primary `bond0`, `eno1`, 2.5 GbE, `.197` on /24 LAN | LAN `bond0 192.168.1.197/24` `[5,20,22,1]`; `eno1 2.5 GbE` `[11,16,12,1]` | Preserved in interface-CIDR form. `192.168.1.0/24` need not be redundantly printed to recover the LAN network. |
| Wi-Fi backup, `.213`, metric 600, failover rather than ECMP | LAN `wlp8s0 .213 failover` `[53,20,20,1]`; `backup path` `[37,16,11,1]`; `metric 600, not ECMP` `[32,24,20,1]` | Route, source-backed address shorthand and failover qualifiers are preserved. Explicit `Wi-Fi`/`wifi` label is absent. |
| Gateway address and RTT | `192.168.1.1` `[12,24,11,1]`; `claimed Fios rtr 0.5ms` `[29,28,22,1]` | Combined source-edge meaning is recoverable from edge plus target node. LAN role claim is qualified. |
| NAT/DHCP, Fios pool IP | WAN `Fios rtr: NAT, DHCP` `[34,8,19,1]`; `pool 71.251.12.240` `[13,12,18,1]` | Behaviors and address preserved. The exact whole-home sharing wording is not printed; this is compressed into the single egress/pool depiction. |
| Claimed ONT `169.254.3.1` | WAN `claimed ONT 169.254.3.1` `[9,16,23,1]` | Claimed device identity is explicitly preserved. It does not qualify the whole downstream chain. |
| Verizon aggregation prefix | `VZ agg 100.41.x` `[9,24,15,1]` | Exact historical range preserved. `VZ` is abbreviated provider text. |
| Verizon backbone AS | `VZ bbone AS701` `[9,32,14,1]` | Exact AS preserved. |
| Cloudflare identity/address | `CF AS13335 1.1.1.1` `[9,40,18,1]` | Provider abbreviated to `CF`; AS and address are fully readable, despite the outline collision. The full word `Cloudflare` is not printed. This is not a missing AS/IP or a missing node. |
| Hop RTTs and sequence | WAN `4.5ms` `[11,20,5,1]`, `6.6ms` `[11,28,5,1]`, `6-9ms` `[11,36,5,1]` | Values and directed ordering preserved; historical interpretation qualifier is not. |
| libvirt VM, vnet0, virbr0 NAT, `192.168.122.x` | v1 labels `[53,16,8,1]`, `[53,24,17,1]`, `[55,20,13,1]`, `[38,28,11,1]` | Preserved. |
| Docker/container veth, bridge `172.18.2.1`, `172.18.2.x` | v1 `ctr veth` `[9,16,8,1]`, `dkbr 172.18.2.1` `[9,24,15,1]`, segment `[11,20,10,1]`, `docker bridge` `[14,28,13,1]` | Preserved. |
| Tailscale address, overlay, UDP encapsulation on wired path | v3 `tailscale0 100.113.153.49` `[9,22,25,1]`, `overlay` `[37,20,7,1]`, `UDP encap` `[36,24,9,1]` → `bond0 192.168.1.197` `[49,27,19,1]` | Preserved, with individually traceable overlay and encapsulation relations. |
| ULA-only IPv6, internet unreachable | WAN dashed arrow `ULA only, no route` `[38,12,18,1]` → `v6 internet` `[59,16,11,1]` | Preserved as an explicitly negative relation, not invented working IPv6 connectivity. |
| One ISP / Fios path; no committed rate | LAN `Fios path: 1 ISP` `[29,36,16,1]`; `no committed rate` `[31,32,17,1]` | Both visible. The latter's ownership is a recorded defect, not a dropped qualifier. |

Important address recovery is real: **`100.113.153.49`, `172.18.2.1`, `100.41.x`, `AS701`, `AS13335`, `1.1.1.1`, `71.251.12.240`, and `no committed rate` are all readable.** No prior-round score is used to claim improvement; these are present-tense observations of this sample.

There is no source basis to reject `.213` merely for not expanding it: the historical reference itself uses that shorthand. Likewise, the overlay's omission of `/24` does not lose the LAN mask because the interface is repeated with `/24` in the LAN view. Common provider abbreviations remain less explicit than full names, and the frozen skill asks for same-view abbreviation keys; the exact AS/IP identities nevertheless survive. I do not count the Cloudflare node or Verizon range as absent.

### F01 — critical semantic defect: uncertainty is not carried through the WAN view

The source's fixed constraint is explicit: traceroute hops and MAC-vendor roles are historical interpretations, **not verified physical topology**. The WAN view shows four solid, animated links from the router through the ONT, Verizon aggregation/backbone and Cloudflare. Its only role qualifier is `claimed` on the ONT. There is no `historical`, `traceroute`, or unconfirmed-hop legend; no historical-qualified edge label; and no dashed traceroute chain. The WAN router is simply `Fios rtr: NAT, DHCP`, without the `claimed` word visible on its LAN counterpart.

A historical qualification elsewhere in `generation.json` is not visible diagram content. Even perfect cross-view entity matching cannot transfer a missing path-wide qualification automatically. A visible historical-hop label/legend or appropriate uncertainty styling with textual qualification could preserve the source meaning; one exact drawing style is not the issue. The only dashed relation in this sample is the *negative IPv6 route*, which does not qualify the solid WAN links. This is a source-to-meaning defect, not missing capture evidence.

### F02 — high semantic defect: source qualifiers/identifiers are missing

The captured `homelab ASUS/Linux7` does not state **bare metal** or the exact **Linux 7.0** version. Vendor and OS text cannot prove physical rather than virtual residency. **WNC OUI**, the source identifier supporting the claimed router interpretation, is absent. The wireless interface is never explicitly labeled **Wi-Fi**; its interface name plus failover text preserves backup routing but asks the reader to infer the medium.

The generator's ledger explicitly admits dropping WNC OUI and bare metal. That is honest accounting, not semantic preservation. These are not problems to repair by inventing new topology; they are missing annotations. The task's exact-identifier/qualifier audit cannot be marked fully green.

### F03 — critical semantic defect: source role mappings were deliberately dropped

The source maps the Fios router to a collapsed **ToR/spine/border/firewall** and the ONT to a **demarc/MMR analog**. None of those role meanings appears in the captures. `Fios path: 1 ISP` preserves the single-provider fact, but not these source role meanings. The ledger's rationale that preserving an analogy would require non-existent physical nodes is not sufficient: roles can be annotated on real nodes without inventing hardware.

The Oct 11 run date and the separate 4-ISP/2-MMR comparison design are also absent. I record those as omitted background, rather than demand unrelated comparison nodes or count run accounting as a missing topology relationship. The failures above concern the target router/ONT's source-stated roles.

## Per-edge audit and cross-view coverage

`reviewer-result.json.edge_audit` audits all 14 source relations plus both apparent extra relations, with endpoint labels, source stems, every bend, target arrowheads, directions, label rectangles, and finding IDs. It uses the source `box` → final spec `h` alias explicitly. The blind record supplies the complete coordinate polylines and ordinary bend inventory.

| Edge | Source relation / displayed view | Static trace | Final edge decision |
|---|---|---|---|
| e1 | VM → virbr0, `192.168.122.x`, v1 | Unique downward head `(53,22)` | pass |
| e2 | virbr0 → host, libvirt NAT, v1 | Unique downward head `(33,30)` | pass |
| e3 | container → dkbr, `172.18.2.x`, v1 | Unique downward head `(9,22)` | pass |
| e4 | dkbr → host, Docker bridge, v1 | Unique downward head `(31,30)` | pass |
| e5 | Tailscale → host, overlay, v3 | Unique rightward head `(47,22)` | fail: origin; corner dot |
| e6 | Tailscale → bond0, UDP encap, v3 | Unique rightward head `(47,27)` | fail: origin |
| e7 | host → bond0, eno1/2.5 GbE, LAN | Unique downward head `(5,18)` | fail: origin |
| e8 | host → Wi-Fi, backup, LAN | Unique downward head `(53,18)` | fail: origin; explicit medium qualifier absent |
| e9 | bond0 → router, gateway/0.5 ms, LAN | Unique downward head `(29,26)` | fail: origin |
| e10 | Wi-Fi → router, metric 600 / not ECMP, LAN | Unique downward head `(31,26)` | fail: origin |
| e11 | router → ONT, NAT/pool, WAN | Unique downward head `(9,14)` | fail: origin; incomplete historical qualification |
| e12 | ONT → Verizon aggregation, 4.5 ms, WAN | Unique downward head `(9,22)` | fail: origin; incomplete historical qualification |
| e13 | aggregation → backbone, 6.6 ms, WAN | Unique downward head `(9,30)` | fail: origin; incomplete historical qualification |
| e14 | backbone → Cloudflare, 6–9 ms, WAN | Unique downward head `(9,38)` | fail: origin; historical qualification; destination border |
| x1 | router → v6 internet **negative** relation, WAN | Dashed, explicit no-route label; downward head `(59,14)` | pass, source-backed derived relation |
| x2 | router → Fios-path summary, LAN | Unique downward head `(29,34)` | fail: origin; qualifier ownership |

Totals: **5 pass, 11 fail, 0 blocked edge audits**. Every required static link is present in a capture; a failing edge is not being called missing simply because its animation or qualification fails.

The host's repeated name/path and bond0's repeated full address make the virtual/LAN/overlay seams recoverable. LAN's `claimed Fios rtr` and WAN's `Fios rtr: NAT, DHCP` map to the same source router. This seam preserves edge endpoint identity but loses visible uncertainty in the WAN view. The `Fios path: 1 ISP` summary is a coarse-grained source-backed answer node, not an invented new physical network hop; the WAN view expands the egress chain. No source-defined bus is requested in this case, and none is invented.

### F04 — medium defect: `no committed rate` ownership

Measured directly from LAN text and pinned frames:

- Label `[31,32,17,1]`, middle `(39,32)`.
- Own vertical route `(29,32)`: **10 cells** from the midpoint.
- Competing Wi-Fi→router run at `(39,25)`: **7 cells** from the midpoint.
- The label's leftmost cell is only **2 cells** from its own route; this makes the intended assignment locally recoverable but does not remove the center-based ownership ambiguity.

The generator records the defect, names its owner, preserves the qualifier, and preserves two rejected rewrites that yielded 90-column extent. This is materially better evidence than silently dropping a required limitation. It is still an acknowledged placement defect. The round task's narrow exception requires no unambiguous placement to exist and that situation to be recorded. Two overflowing node-label rewrites show those attempts failed; they do not prove that no unambiguous layout or split existed. I do not waive the gate, nor convert a recorded failed placement into a missing source fact.

There are zero other owner-ambiguous labels, zero labels on route cells, zero skipped labels, zero route crossings/bridges/touching bends, zero line junctions, and no avoidable loop visible in these captures. Ordinary bends are not miscounted as crossings. The paired routes use separate box ports with a blank cell between close runs.

## Motion assessment

The source and frozen dataset mark this case's animation **optional**. The static v1 decision is therefore allowed, and the absence of its frames dump is a **known temporal evidence gap, not a violation of a requested v1 animation**. The whole animation category is nevertheless applicable because the candidate enabled dots on the other three views. Unrequested flair must obey the same origin, speed, and non-occlusion rules.

| View | Animated routes | Pinned frames | Count correctness | First-cell origins | Observed corner events |
|---|---:|---:|---|---|---:|
| v1 | 0 | none | No dots in static capture | N/A | N/A |
| LAN | 5 | 0–20 at 100 ms | Exactly 5 every frame | **0/5** | 0 |
| Overlay | 2 | 0–20 at 100 ms | Exactly 2 every frame | **0/2** | **1** |
| WAN | 4 | 0–20 at 100 ms | Exactly 4 every frame; dashed v6 has none | **0/4** | 0 |

There are **231 dot appearances across 63 complete pinned frame views**, exactly one per animated route per frame. No sampled dot obscures a node border, text label, or bridge. There are no periodic dot trains. All animated arrowheads remain visible. This sparse count evidence passes; it does not establish correct origins or a full clean cycle.

### F05 — high defect: eleven initial-origin mismatches

The rubric defines the origin as the **first drawn cell after the source port**, not the first interior cell eligible under a different renderer definition. For example:

- LAN host→bond0: origin `(29,15)`, frame-0 dot `(29,16)`.
- LAN router→Fios path: origin `(29,31)`, dot `(29,32)`.
- Overlay upper/lower routes: origins `(35,21)` / `(35,23)`, dots `(36,21)` / `(36,23)`.
- WAN ONT→aggregation: origin `(9,19)`, dot `(9,20)`.

The blind record lists every one of the 11 comparisons. These are preserved frame-0 observations, not conclusions inferred from JSON. Captured checks say `origins: 5/5`, `2/2`, `4/4`, with zero dot violations. The generator itself describes first *allocated* dot cells beyond the visible stems. That definition does not meet the fixed rule. The checks are false positives for the human-visible invariant.

This is one underlying defect affecting both `arrow_traceability` and `animation`, not 11 unrelated implementation defects. Its affected-route count is eleven. The static arrowheads remain traceable, but the rubric explicitly withholds animated direction proof when a dot starts away from its arrow origin.

### F06 — medium defect: overlay dot overwrites a corner

In `evidence/v3-overlay/v3-overlay-frames-pinned.txt`, **frame 20 at 2000 ms**, the upper dot is at **`(46,22)`**. The standalone normal capture shows `╰` at exactly that cell. The dot replaces the bend, immediately before the rightward arrowhead `(47,22)`.

This is a directly observed corner-contact event on e5, not arrival at the arrowhead. The generator's blanket claim that no sampled dot sits on a corner is contradicted by its own capture. The check's zero violations does not overrule it.

### Default speed and F09 — incomplete full-cycle evidence

All motion specs use default constant speed; none requests same-arrival. On long straight segments, frame 2→10 shows four cells of advance in 800 ms:

- LAN host→bond0 `(28,17)` → `(24,17)`.
- LAN host→Wi-Fi `(32,17)` → `(36,17)`.
- LAN bond0→router `(6,25)` → `(10,25)`.
- LAN Wi-Fi→router `(52,25)` → `(48,25)`.
- Both overlay routes `(37,21/23)` → `(41,21/23)`.
- WAN router→ONT `(33,13)` → `(29,13)`.

The four short routes alternate between their two interior cells and reset; their endpoint displacements alone do not prove the same unwrapped travel distance. The generator's equal-speed examples omit the short LAN router→Fios route. Adjacent-frame repeats and short-route alternation are consistent with the default sampled cadence, but the complete per-route full-cycle proof is not present.

The longest routes have **not crossed** by 2000 ms. At frame 20, LAN host→bond0's dot is `(19,17)` while its head is `(5,18)`; WAN router→ONT's dot is `(24,13)` while its head is `(9,14)`. The upper overlay dot has only reached its last bend; the lower remains `(45,25)` above its target row. None of the 11 route dots occupies an arrowhead anywhere in this 2-second sample.

**This is an evidence gap for full-cycle behavior**, not a failure for unequal arrival times. Constant mode correctly allows long routes to finish later, and there is no source-backed same-arrival requirement. The fixed skill's statement that “21 frames at 100 ms steps covers one crossing of the longest route” is not true for these routes at the stated constant rate. A fixed duration inherited from same-arrival mode is not an adequate default-speed evidence window.

## Geometry, hue grouping, and borders

### Measured dimensions versus diagnostic extent

The live app title tokens in all four captured views say **`77x47 @100%`**. Normal and selected ANSI files decode to exactly **47 rows of 77 cells**. Plain-text files omit trailing spaces/final blank row and therefore have only 46 lines; that does not mean the pane was 46 rows high.

The manifests separately report `pane_rows: 47`, `pane_cols: null`, `pane_rect: null`, `viewport_line: null`, and measured header token `77x47 @100%`. The rubric explicitly accepts the running app's measured header token, so `live_pane` is recorded as **77×47**, with no invented rectangle. The headless check logs say `viewport: unknown zoom: 1.00 natural`; they are not the independent source for pane dimensions. The pinned dumps additionally print `viewport: 77x47 zoom: 1.00 natural`.

| View | Original capture window, UTC | Extent from check | Tight graph bounds, 1-based |
|---|---|---|---|
| v1 | 2026-11-02 12:46:06–12:46:09 | 67×24 | columns 8–70, rows 15–34 |
| LAN | 2026-11-02 12:46:14–12:46:18 | 74×32 | columns 4–73, rows 11–38 |
| Overlay | 2026-11-02 12:46:19–12:46:23 | 63×11 | columns 8–69, rows 20–29 |
| WAN | 2026-11-02 12:46:23–12:46:27 | 67×40 | columns 8–70, rows 7–42 |

No label or edge is viewport-clipped or shown as reachable only by pan/zoom. Nevertheless, WAN fails the no-overlay-occlusion gate.

### F07 — medium defect: palette overwrites three Cloudflare perimeter cells

Cloudflare outline: `[8,39,20,4]`. Palette outline: `[2,41,9,6]`. Intersection: **`[8,41,3,2]`**, six cells including interior space. Three actual node-perimeter cells are overwritten:

| Cell | Node border should be | Visible replacement | ANSI foreground |
|---|---|---|---|
| `(8,41)` | left side `│` | palette top `─` | `(168,153,104)` |
| `(8,42)` | lower-left `╰` | palette-label `]` | `(235,219,178)` |
| `(10,42)` | bottom side `─` | palette side `│` | `(168,153,104)` |

Surviving normal node-border cells have RGB **`(169,182,101)`**. In the selected capture those surviving cells become selected accent **`(216,166,87)`**, but the overwritten palette cells do not. The `CF AS13335 1.1.1.1` label is intact on row 40; its top/right borders and bottom-right corner remain intact. Its left/bottom outline is not complete or color-continuous. The orphaned node-colored dash at `(9,42)` between overwritten cells makes the collision visible rather than repairing it.

This one composition failure affects **both fit and border integrity**. It is counted once in findings, not hidden by two green validators. `--select-all` coverage is **19/19 represented node occurrences, 18/19 fully visible selected perimeters**. All-selected evidence does not prove 19 separately exercised interactive selection actions; that is not required here.

### Grouping/color pass

Normal ANSI colors corroborate concept grouping rather than geometric-depth grouping:

- v1's virtual-network nodes are in related gold hues; the host is teal. The first VM uses selected accent in the normal state.
- LAN's bond0/Wi-Fi pair use related teal shades; router/Fios summary use related pink shades; the selected host is accent.
- WAN's ONT/Verizon aggregation/backbone share related teal shades across successive depths, while IPv6 and Cloudflare have distinct concept colors.
- Overlay source, host and physical bond0 are distinct concepts. Their explicit layers preserve the two source relations; they are not claimed as one depth-derived group.

The independent virtual attachments appear Docker-left/libvirt-right, but the source imposes no left-to-right sibling order for them. The WAN hop sequence is preserved. Cross-view per-node hue stability is not an extra gate. Edge lines and arrowheads are muted `(124,111,100)`; selection and dots use the accent. Normal and selected ANSI prove colors; plain text alone would not.

## Workflow evidence, gaps, and cleanup

The result's **96 evidence inventory entries** hash the actual repository-relative inputs, all final specs, deterministic spec manifest, captures, original manifests, validators, generation notes, all raw attempts and selected frame-specific references. Duplicate frame references point into existing files; they are not new captures. The optional `build-review.py` helper only assembles/validates review artifacts and hashes frozen files. It does not run the renderer, alter candidate content, or regenerate evidence.

### Verified workflow strengths

- Actual frozen candidate/binary/rubric/dataset/source/expected/variant hashes match metadata.
- All four final spec hashes and all original manifest artifact hashes verify.
- Pinned dump hashes match generation's separately recorded hashes.
- All **14 distinct attempted specs** are present and match `attempts.json` hashes: 3 v1, 3 LAN, 2 overlay, 3 WAN, plus 3 superseded combined-view probes.
- All their referenced raw check-output files are present. The three verification-rerun check outputs are byte-identical to their corresponding original check outputs.
- The overwritten initial v1 draft is explicitly marked reconstructed from the same session's edit history; its raw check output is preserved. Reconstruction is disclosed, not mistaken for an independently captured original file history.
- Original live text, ANSI and all-selected ANSI exist for every final view. All original check exits are recorded as 0 in manifests; LAN nonetheless warns about ownership and its validator correctly reports two failures.
- The blind-first sequence and independent required reviewer model are preserved.
- No pane art or ANSI render was pasted into chat by this judge.

### F08 — blocked workflow proof

The bundle does **not** preserve exact executed command lines for each candidate check/capture/pinned recapture, rejected/probe process exit statuses, or a separate stderr record/explicit combined-stream declaration. Raw `*-check.txt` files contain renderer stdout beginning with `viewport: unknown`; they do not contain command/status wrappers. Final manifests provide final check exit 0 and timestamps, but not the missing rejected/probe invocation/status records.

The candidate skill contains example commands; the current capture script could suggest likely commands. Neither proves what was actually executed. I did not replay a command or use the mutable harness to fill this gap. The absolute pinned-recapture time is also not preserved; the motion files have valid relative timestamps and their late-added provenance is declared.

The verification-rerun index points once to absent **`specs/v2.json`**. Its actual archived counterpart `attempts/specs/v2-combined-a3.json` and byte-matching raw check survive. This is an index/provenance defect, not a missing final diagram or unrecorded extra candidate.

These are **evidence blockers**, not proof that tools/models were unavailable. Known semantic, origin, corner and overlay defects remain failures despite these gaps. A schema/validator PASS cannot supply missing process provenance.

### Other evidence gaps, precisely scoped

1. **v1 temporal dump absent:** documented static choice, permitted by optional source animation. No requirement to invent animation or a synthetic temporal proof for this view. Not a blocker to static labels/borders/fit review.
2. **Original in-pane frame-0 streams truncated:** all three original motion streams have an initial partial frame and first labeled frame 1. Complete pinned frame-0 evidence exists at 77×47; it is the basis for the initial-origin findings. Do not count the cropped originals as complete frame 0.
3. **Full cycle missing:** the complete pinned streams cover only 0–2000 ms, insufficient for seven long routes. F09 blocks a full-cycle equal-speed/non-occlusion proof. Actual origin/corner defects are already visible; the missing tail cannot erase them.
4. **Motion color states:** pinned full-frame motion is text; separate normal/selected ANSI proves those states' colors, not color continuity in every animation frame. Static border failure is already ANSI-proven.

No unsupported file format or required-model substitution was encountered. The unresolved blockers are missing workflow and full-cycle evidence, not inability to read the supplied captures.

### Cleanup records

| View | Original owned pane | Recorded result |
|---|---|---|
| v1 | `w7E:pD0` | `confirmed_closed` |
| LAN | `w7E:pE1` | `confirmed_closed` |
| Overlay | `w7E:pE2` | `confirmed_closed` |
| WAN | `w7E:pE3` | `confirmed_closed` |

Each original manifest and generation's cleanup section agrees. Rejected candidates are headless-check records; no failed live-pane ownership is listed. The judge created **no viewer pane/session**, issued no cleanup commands, and did not independently reopen/re-probe already closed panes. `cleanup.status` is `done` on the preserved records, not on a new operation invented during review.

## Classification and correction candidates — no fixes performed

| Finding | Classification | Primary level |
|---|---|---|
| F01 WAN uncertainty / router claim missing | critical defect | Skill/spec meaning preservation |
| F02 source host/link qualifiers and evidence identifier missing | high defect | Skill/spec coverage |
| F03 collapsed-fabric / demarc role meanings absent | critical defect | Skill/spec abstraction policy |
| F04 retained but ambiguous `no committed rate` | medium defect | Spec/layout ownership; recording is honest but not a waiver |
| F05 eleven initial-origin mismatches despite full checks | high defect | Renderer/check invariant mismatch; skill must trust captures |
| F06 overlay corner-obscuring dot | medium defect | Renderer motion/check invariant mismatch |
| F07 three palette-overwritten node-border cells | medium defect | Renderer composition/reserved-area handling, surfaced in spec selection |
| F08 exact command/status/stderr provenance absent | high evidence gap / blocker | Capture/workflow harness |
| F09 default-speed full cycle not captured | high evidence gap / blocker | Skill evidence-duration rule and capture harness |

Seven defect findings are recorded once each; F05 and F07 affect multiple categories without duplicate implementation-defect findings. The two evidence gaps are distinguished from observed renderer/spec failures. Severity does not waive any failed gate.

### Skill-level candidates for the captain's later revision

1. Preserve uncertainty **within each split view**. An ONT `claimed` marker and a LAN router marker do not qualify every WAN hop. Require visible historical-traceroute interpretation in the expanded WAN view, and carry the router claim there too.
2. Treat a meaning ledger as an audit, not permission to omit required facts. Preserve bare-metal/precise OS/link-medium qualifiers and meaningful source role annotations; role labels do not require fake physical boxes. Explicitly separate irrelevant run accounting from target-network meaning.
3. Keep required limitations such as `no committed rate` even if placement fails. Record the exact defect and rejected attempts, but do not call the view green merely because the qualifier survived somewhere.
4. Replace the false fixed-window assertion that 21×100 ms covers the longest constant-speed route. Derive the evidence window from the longest route at the shared rate and require every animated route, including short resetting routes, in the speed proof.
5. Read frame 0 and corner frames, not just `origins: N/N` and `dots: 0 violations`. Preserve the first exterior cell and its actual dot coordinate as separate audit fields.
6. Treat the palette area as unavailable content space during candidate selection. A fit/ownership tradeoff can be honestly reported red; it must not silently pass the complete-box requirement.

### Renderer/harness-level candidates

1. Align motion origin eligibility and the `origins:` check with the **first drawn exterior cell**, not the next eligible interior cell.
2. Make corner/junction/bridge avoidance operate on the cells actually painted, then verify against emitted frames. The overlay frame-20 bend is a counterexample to the present check.
3. Reserve or relocate the UI palette, and include palette occlusion in fit/border checks, including all-selected states.
4. Preserve exact argv/environment, stdout/stderr treatment, exit status, capture/recapture timestamps and close-result records alongside each attempt. Keep a complete original frame 0 without relying on a 1000-line pane scrollback tail; include pinned dumps in the finalized artifact inventory.

These are correction **candidates**, not changes made. Renderer-level defects belong to the frozen renderer baseline and are not attributed to a skill-only improvement. The captain must gather all eight complete critiques before revising the skill. No source data, specs, renderer, captures, skill, expectations, installs or commits were changed in this review.

## Deliverables and verification

- `observed-first.md` — immutable pre-reveal record, original hash retained.
- `spec-manifest.json` — deterministic four-spec identity; SHA-256 `da6c2cd61d642c3752eeebe09156b6851977e0f31a5d2c6d60dd91aa67af220c`.
- `reviewer-result.json` — all seven fixed categories, 16 per-edge audits, nine evidence-linked findings, blockers and cleanup.
- `critique.md` — this independent source-to-capture assessment and blind-record erratum.
- `build-review.py` — small reproducible review assembly/hash-verification helper; no viewer invocation.

Verification consists of actual SHA-256 comparisons, JSON/schema checks, 77×47 ANSI-grid decoding, all frame-0/per-frame dot coordinates, label midpoint-distance measurement, ANSI border-color measurements, and preserved artifact/attempt cross-checks. No new viewer was launched and no failed sample was repaired.
