# Independent review — homelab-nic-trace, round 09

**Verdict: fail.** The drawn routes and border evidence are strong, but the required source semantics are incomplete, the identity-map coverage recipe is not met, and one gutter label is nearer a different route than its own. Paths throughout the accompanying JSON and this critique are repository-relative. Regions are 1-based `[column,row,width,height]` in the indicated 82×51 capture.

## Category decisions

| Category | Decision | Basis |
|---|---|---|
| semantic_fidelity | fail | Router border role, essential bench answer no committed rate, shared Fios pool address, several qualifiers and identities are missing or weakened; `gw 0.5 ms` is misassociated by proximity. |
| arrow_traceability | fail | All 14 directed stems and heads are visible and geometrically traceable, but e9 label is closer to e10 than e9 and therefore fails the explicit ownership rule; no exception was recorded. |
| layout_fit | fail | All three final-spec 77×47 pinned views fit geometrically with no clipped graph labels, but this category also requires complete source coverage across the split, which is absent. Live captures measure 82×51. |
| conceptual_grouping_color | fail | Four supported logical hue families, no group boxes, and reasonable tiers; however bond0/wlp reverse left-to-right sibling order in v2 versus v3. The round contract requires a stable sibling order. |
| category_fit | fail | Correct family `identity-probe-maps`, supported source-backed line and recorded yields, but coverage-first recipe fails: ledger itself records drops, and captures omit required identifiers and qualifiers. |
| border_integrity | pass | All 17/17 normal and select-all node occurrences have complete sides/corners and continuous ANSI foreground colors. Select-all is simultaneous, not separate interaction evidence. |
| workflow_evidence | pass | Frozen inputs, separate generator/reviewer, blind-first record, three capture bundles, pinned final dumps, nine wrapper records, validators, and cleanup are documented. Initial 182-byte capture race disclosed and recaptured; its overwritten bytes are not preserved, a limited evidence gap, not a missing final capture or missing recorded probe. |
| animation | N/A | `cases.json` marks this case optional; source is historical topology without a request for animated flow. No dots. Three frame rows are text- and ANSI-identical for each view. |

## Source fidelity and meaning

The source requires the rack-bench host rather than devbox, physical/virtual/overlay/egress, and the explicitly qualified historical interpretations. The 14 historical relations are present with their correct geometric endpoints and direction, including independent wired and Wi-Fi port stems, and `box`/`ts` join v1 and v2; `bond0`/`wlp` join v2 and v3. Contrary to `generation.json`'s join mapping, v1 does not contain bond0 or wlp. Nothing here turns a historical attempted relationship into independent physical verification.

Critical missing meaning:

1. **Router border/collapsed-fabric role**: source explicitly maps the Fios router to ToR, spine, border, and firewall in one box. The visible `rtr 192.168.1.1 claimed, no v6` at v3 [27,14,30,1] does not say Fios, border, firewall, collapsed fabric, or any equivalent. It is not merely dispensable style commentary: the source asks for this datacenter-role mapping. The claimed status helps uncertainty, but does not restore the identity or role.
2. **Bench answers**: `NAT out` and `no v6` are visible, although the latter omits ULA-only and could overstate the condition. `no committed rate` is absent, so the required third bench answer cannot be extracted. No label says these are the host's bench answers. The generator's D3 is a required source fact, not an acceptable abstraction.
3. **Shared Fios pool address 71.251.12.240**: absent. The D1 concern about host ownership is valid but does not justify dropping an explicitly required identity; label it as shared-home pool, not a host-owned IP. LAN `192.168.1.0/24` and DHCP are likewise absent. D2 drops both the required collapsed role and ONT demarc/one-ISP contrast; the multi-ISP numerical comparison is contextual rather than another network edge, but omitting the entire analogy removes requested meaning.
4. `claimed` is visible on both router and ONT, but the historical nature of the inference is not explicit in the views; `Fios?` and `hist` or equivalent would retain both who and how certain. `wlp8s0 .213` does not identify Wi-Fi, `ts0` does not explicitly name Tailscale, `virbr0 NAT` does not say libvirt, `VZ` is unexplained, and `backup path` plus `metric 600` do not state `not ECMP`. Identifiers are abbreviated without a visible key. Source-provided 192.168.1.0/24, ULA-only, and the Fios/WNC inference are not captured. The pinned all-edge-gutter attempt that failed is not proof that individually chosen label gutters or an additional fact view cannot carry them.

## Ownership ruling

At v3 row 9 the bond0 stem is column 24; the wlp stem is column 48; `gw 0.5 ms` spans columns 35–43. Its nearest label cell is 11 columns from its own bond0 stem but only 5 from the other stem, without a leader. `metric 600` [55,9,10,1] lies to the right of Wi-Fi. Ordering gives a plausible intended assignment, and the actual e9 route itself is traceable to rtr [27,12,1,1], but the explicit rubric says a label as close or closer to another route fails unless an unambiguous placement was impossible and recorded. No such ownership-specific yield is recorded. Thus the checker's `0 ambiguous owners` does not establish visual ownership; the blind concern is upheld. e9 is failed rather than claiming the physical route is reversed. No bridge, crossing, merged branch, or touching bend is visible.

## Category fit and documented yields

The dominant family is correctly `identity-probe-maps`: the source has a deep egress chain with dense identifiers and qualifications, one weakly connected world, no anti-parallel pair, no source motion, 14 historical relations and 13 identities. The generator's evidence line is in `ledger.md` Step 0 before the ledger, and in `generation.json` classification; `13 of 14 nodes` is internally inconsistent with its own 13-node/14-edge audit. The ledger is presented as pre-spec, although timestamps do not independently prove order. It records many identifiers before layout, but knowingly drops required facts, so correctness of classification and measured geometry yields cannot cure the unapplied coverage recipe.

Recorded (not rerun) yields: LR chain 189×9; 8-node host 66×62; all-edge label-slot host fails to route. The TB split and staircase preserve a long chain, and v2 is sparse; those shapes are not independent defects. A failed all-slot draft does not prove every fuller layout is impossible. Four group hues are pink virtual, olive overlay, teal physical, gold egress; there are no group enclosures. Physical peer order reverses from wlp/bond in v2 to bond/wlp in v3, contradicting stable sibling order; per-node shade changes alone would not fail.

## Evidence, frames, and cleanup

Final spec hashes and deterministic sorted manifest are in `spec-manifest.json`; its SHA-256 is `adab253c3ea68f6ac908e8b00ae5e369ebed70df68307c649cb16257553ad614`. The immutable blind file hash is `e615ae704b07cc0e5d1b58b03a5d5ad5fde703175003323a6107e91e99f16f7d`. All artifact hashes in the three capture manifests and all nine recorded stdout/stderr hashes independently matched. The three validators report all checks passed, including record completeness; their semantic and owner checks do not override the findings above. The first v1 pane-read race is disclosed but the 182-byte failed read was overwritten, so its actual bytes cannot be rechecked.

For each view, the three 51-row frame blocks at 0/100/200 ms have identical SHA-256 in both plain text and ANSI. ANSI hashes per view are respectively `7ca7792bc362a9d72c04a21fb7c4fb93b40ca0b832c4f10edf3148c25b0fe329`, `59424f6c40d9c8e3883876ec747269da92fb25903edc9a44c613a575c1587abc`, and `3a24baceb073ed739c793c6f2d7388fedc0c6aae7dbbd3f08bfc55dea66542db`. This verifies equal captured terminal cell/color streams, not literal screenshots or pixel rasterization; no pixel images were supplied. The pinned dumps show the same three static frames at 77×47. V1's header is clipped at `q qui` in the 77-column dump, but graph labels and borders fit; it is UI chrome, not a clipped graph item under the fit gate.

Manifests report panes `w7E:pNK`, `w7E:pNN`, `w7E:pNP` confirmed closed. No reviewer pane was opened. No source host was probed. No unresolved renderer capability blocker is established: the record demonstrates individual failed layouts, not impossibility of preserving the omitted facts.

## Correction candidates, not fixes

- **Skill/generator:** make coverage-first ledger reject drops of source-named roles, pool identity, rate and qualifiers; add concise view-local annotation/key where required, explicitly label historical inferences and Wi-Fi/not-ECMP, and verify source coverage across joins. Require stable group sibling order and visually audit label-to-route proximity rather than accepting checker output as semantic proof.
- **Renderer/tooling:** detect gutter labels whose nearest cells are closer to an unrelated route; expose clear association or leader placement and enforce stable group sibling order across split layouts if the specification supports it. These are candidates, not established unsupported-capability blockers.
