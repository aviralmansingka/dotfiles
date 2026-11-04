# Round 13 — homelab-nic-trace independent verdict

**Overall: FAIL.** The wide capture shows a clean, traceable host → bond0 → Fios router → ONT → Verizon edge → backbone → Cloudflare chain. Its gateway and three subsequent latency claims are readable in sequence. The Wi-Fi, overlay, and local paths are separate and all 14 required directed relations are present. This is nevertheless not complete semantic coverage, and the narrow-pane evidence shows real readability and border defects.

| Category | Status | Decision |
|---|---|---|
| semantic_fidelity | fail | Required source facts and qualifiers dropped: DHCP, shared pool IP, AS13335, ONT demarc/MMR, no committed rate, Oct 11 rack-bench context, and explicit no global-v6/internet reachability. The brief retains every source fact. Diagram-level `historical hops` does not explicitly qualify the MAC-vendor router/ONT device-role interpretations. |
| arrow_traceability | pass | All 14 directions and owners readable in the full natural capture; 0 crossings, ambiguous owners and unrelated-node near-misses. No added apparent route. |
| layout_fit | fail | Branch B is structurally appropriate and the natural 215×45 dump proves the 210×38 canvas and the three reported extents, but the branch cannot excuse dropped required facts. Branch A is not claimed and the pinned 77×47 dump clips. |
| navigation_clarity | fail | Titles and distinct descriptions correctly name their diagrams, and the coverage map locates every edge. All descriptions clip in both the actual 68×44 pane and the 77×47 dump, contrary to the explicit no-clipping rule. The overflow overlay also obscures the secondary drawing at 68 columns. |
| conceptual_grouping_color | fail | The same captured purple rgb(138,115,206) is used for distinct, adjacent uplink and gateway groups in egress; no recorded justified shared-family choice. Separately, complete cross-diagram hue proof is missing for gateway and secondary host. |
| category_fit | fail | Identity-probe-maps is defensible: source and capture are identifier/qualifier dense; borrowed chain habit is visibly applied. But the identity recipe requires every identifier and qualifier covered, and several are deliberately dropped, without a renderer-impossibility yield. |
| border_integrity | fail | The normal and selected 68×44 captures show the overflow overlay overwriting the secondary host's border. Full selected and normal ANSI color continuity is unproved for offscreen nodes; the plain 215-wide capture cannot establish it. |
| workflow_evidence | blocked | Triage is honest and attempts, checks, dimensions, frames, hashes and pane closure are recorded; however ANSI/selected evidence does not cover every node occurrence or prove the hidden hues and border states. The validator's pass does not establish that visual coverage. |
| animation | N/A | The source never asks for animation; cases.json marks it optional. All routes are static, consistent with the annex and frames. |

## Source audit of the drops

- **DHCP and 71.251.12.240:** The source explicitly attributes DHCP and the shared public pool IP to the Fios router. The concern that an *edge* label could misidentify the ONT hop is reasonable; it does not justify omitting router properties. A router annotation or adjacent explanatory line would preserve the fact without inventing an edge.
- **Cloudflare AS13335:** Explicitly stated in the WAN-path source; it is not redundant with `1.1.1.1`. A claimed width tradeoff does not prove the fact is unrenderable or waive identity coverage.
- **ONT demarc/MMR analogy:** The source explicitly names the analog as a historical interpretation. It can be marked as such rather than discarded because it is not a separate edge. Similarly `no committed rate` is a sourced limitation, not an invented edge; lack of an edge does not prevent a text annotation.
- **Oct 11 and v6:** The host/rack-bench run date is explicitly given, though it is ancillary to troubleshooting. `v6 ULA-only` is present, but it does not explicitly state no global IPv6 or unreachable v6 internet. `historical hops` marks the hop chain but does not explicitly qualify router/ONT device identity from MAC vendor inference.
- Metric 600 and Wi-Fi failover are preserved. The chain keeps 0.5, 4.5, 6.6 and 6–9 ms, associated with the correct historical relations. `gw` abbreviates `default gw`, so default-route specificity is less explicit; it does not reverse the edge.

## Triage and shape

The eight provoked/used entries consist of four annex answers, three attributed to the brief, and one own judgment. The annex text matches modulo typographic dash normalization; no fabricated live dialogue is claimed. Local separation and qualifier retention come from the brief, route-label placement is a presentation decision motivated by the brief, and static motion is a supported own judgment rather than a new source fact. Some repeated motion/qualifier prompts are close to settled, but they do not establish padding or dishonesty. The single-view probe actually measures 293×15; the three-diagram choice is justified by source separation and the recorded geometry. The fact the canvas is still 210 columns wide and needs panning should not be conflated with a 77-column fit. The claim that *every identifier* was retained is contradicted by the generator's own drops.

## Evidence and corrections

Evidence paths in `reviewer-result.json` are repository-relative. Regions use 1-based screen coordinates in the cited frame, excluding its viewport/frame metadata. The blind file remains unchanged. Pane `w7E:pZT` is recorded confirmed closed. The measured 68×44 live pane and 77×47 pinned dump are distinct from the 210×38 canvas extent and 215×45 natural wide dump.

Skill-level candidate: enforce an identifier/qualifier ledger before declaring convergence; put historical identity qualifications and path limitations in the drawing; shorten or wrap descriptions to remain readable in a narrow pane. Engine/evidence-level candidate: capture a full-canvas ANSI/buffer and selected state or documented pan coverage, keep overflow UI off graph borders, and avoid indistinguishable families for adjacent tags. Do not infer unseen colors from group membership.

Schema caveat: the frozen revision-11 result schema hardcodes `viewport` to 77×47 and disallows both `viewport.note` and a top-level `blind_observation_sha256`. The requested 210×38 object and extra field would fail that schema. The machine result therefore records the **verified pinned viewport** 77×47, and records the branch-B canvas extent in its layout reason, while the blind SHA is in the `blind` evidence entry. This is not a claim that the diagram fits 77×47. Also, the requested dataset hash contains `...e8672...`, but the actual `cases.json` hash and frozen metadata both contain `...e8692...`; the result records the verified actual hash rather than inventing one.
