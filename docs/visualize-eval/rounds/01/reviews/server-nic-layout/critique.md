# server-nic-layout — round 1 independent Astra critique

## Verdict: FAIL

The two final views preserve a readable eight-link topology, and the measured panes are 77×47. They do **not** preserve all required label/context meaning or source-backed conceptual color groups. The executed-evidence record also misidentifies one selected node. The complete selected-border gate remains blocked by missing captures, not by an observed broken border.

This is the same `viz-judge01-server-nic-layout` judge that completed blind Stage A. Actual environment: `PI_PROVIDER=openai`, `PI_MODEL=gpt-6-astra`, `PI_SUBAGENT_NAME=viz-judge01-server-nic-layout`. Generator identity is `viz-ds01-server-nic-layout`, `fireworks/accounts/fireworks/routers/deepseek-flash-latest`, as recorded in frozen generation provenance. No model substitution occurred in this review.

The Stage A file was hash-verified before source reveal and was not changed:

`d2d88b88beb589f8874a36c369f04183949cd31a2140f097d7bb10b67f3807a2`

## Category matrix

| Frozen category | Decision | Basis |
|---|---|---|
| semantic_fidelity | **FAIL** | F1: AS13335, full public-address context and relevant network qualifiers are absent from the actual views. All eight drawn relationships remain recognizable and properly directed. |
| arrow_traceability | **PASS** | Eight independent stems/routes/heads are recoverable. No crossing, false branch, shared-run ambiguity or invented link is observed. Optional dots obscure bends but not endpoint identity. |
| layout_fit | **FAIL** | F2: The shortened drawings fit, but the frozen gate also requires full labels and complete split-source coverage. Removing label/context content to fit does not satisfy that gate. |
| conceptual_grouping_color | **FAIL** | F3: Hue follows geometric depth rather than related source concepts; related servers, NICs and Airtel stages use unrelated colors. |
| border_integrity | **BLOCKED** | All observed perimeters pass, including four selected node occurrences. Six other node occurrences lack selected-state ANSI/buffer evidence. |
| workflow_evidence | **FAIL** | F4: vB selected-1 is recorded as Arista selected, but ANSI proves Airtel 14.143.x selected. Exact capture/selection commands are not preserved to resolve the discrepancy. |
| animation | **N/A** | Frozen manifest explicitly says optional; the source does not request animation. This contributes no pass. |

One of six applicable categories passes; four fail and one is blocked. There is one critical finding and three high findings. All eight source-edge topology audits pass; those edge results do not erase failed concept/label coverage. There are no extra apparent relationships to add to the audit.

## Evidence base and reproducibility

All evidence paths in `reviewer-result.json` are relative to the repository root. The frozen binary lives outside the repository, so its evidence path uses a repository-relative `../../…` traversal to the verified `/tmp/visualize-eval/round-01/bin/rataflow-view`; that external artifact remains necessary for reproduction. Capture abbreviations below resolve under `docs/visualize-eval/rounds/01/server-nic-layout/captures/`.

Coordinates are **1-based [column,row,width,height]**, not graph/world coordinates. Regions for missing content identify the existing node or whole view where the omission can be checked, not an invented location for absent text.

The actual hashes of the frozen skill, renderer binary, rubric, dataset manifest, this case's source/expected files and both final specs match metadata. See `verification.json`. The two final specs are represented by sorted path/SHA256 pairs in `spec-manifest.json`; its hash is:

`cc17c019af4855569984c19e4515b1477f6cfa131596c0934b4a59481a4f4f56`

Both final `--check` records contain complete stdout, empty stderr and exit code 0:

- vA: six nodes, five edges, zero flows; extent 64×32.
- vB: four nodes, three edges, three flows; extent 22×29.

These check records do not override visual findings. Independent Stage A raw-text and SGR parsing, not generator `grid_check` or `ansi_grid` conclusions, supplies the visual assessment. No generator audit helper was executed. No current source tree was substituted for frozen executed evidence. Cancelled round00 was not inspected or scored. Round01's renderer is a new baseline; this review attributes no renderer gain to the unchanged skill.

## Source concepts and cross-view coverage

| Source concept | Actual rendering and decision |
|---|---|
| Server1 Dell R7725 .58 | vA `server1 R7725 .58` at [10,19,17,1]. Identity/model remain recognizable; Dell branding is shortened. |
| Seven inactive physical NICs | vA `7 NICs dark` at [13,10,11,1], with `7 dark ports`. Correctly avoids asserting absent cables. Seven dark plus one active makes the eight-port inventory recoverable. |
| Active eno16595np0 25 GbE | vA [10,28,18,1], with `only uplink` [12,24,11,1]. Correct active-port distinction. Full public `103.19.91.58/29` assignment is missing. |
| Server2 Dell R7725 .59 | vA [34,10,17,1], with `same /29` on its gateway relation. Neighbor identity preserved. |
| .60–.62 address pool | vA [57,10,13,1], with `free? in /29` [29,35,12,1]. The node word `spare` alone is stronger than warranted, but the associated question mark makes uncertainty recoverable. This is not scored as a separate false availability claim. |
| Arista .57 / AS132717 gateway | Same label in vA [9,37,19,1] and vB [30,12,19,1]. The role is gateway, not proven ToR: dropping the historical ToR claim obeys the explicit qualification. |
| Airtel 14.143.x | vB [32,20,15,1], with transit 1.8 ms. Preserved. |
| Airtel backbone 14.141.x | vB `Airtel BB 14.141.x` [31,28,18,1]. BB is a recoverable abbreviation in this chain. |
| Cloudflare 1.1.1.1 AS13335 | vB [31,36,18,1] contains only Cloudflare and its IP. AS13335 is omitted, not abbreviated. |
| Public L3/no NAT/no IPv6 context | None is visible. This is relevant to the NIC/egress interpretation, unlike incidental handoff uptime or installed-software inventory. The generator explicitly deleted this context. |
| Invisible fabric uncertainty | No spine, leaf, tunnel or hidden switch is invented. Absence is not explicitly labelled as proof of L2. This respects the prohibition. |

The shared Arista label provides a valid cross-view boundary: all five host-side edges end or originate in vA as appropriate; all three upstream edges are present in vB. There is no lost *edge* at the split. Full concept and label coverage nevertheless fails. A narrative report saying what omitted text means cannot make that text visible in the diagram.

The source has an internal historical latency conflict: prose says Cloudflare at **8.6 ms**, while the explicit historical relationship list and expected edge say **8.3 ms**. The render follows the latter. I do not invent a human correction or call the value fabricated. No frozen independent measurement resolves which measurement should be authoritative. This uncertainty does not affect the uniquely traceable endpoint or the known missing AS detail.

## Every directed relationship, route and label

These are capture-based traces, fixed in Stage A before seeing expected relations. Full machine-readable audits are in `reviewer-result.json`.

| Relation | Source stem → target head | Visible label and ownership |
|---|---|---|
| dark → server1 | vA [13,13,1,3] → elbow [10,16,4,1] → [10,17,1,1] | `7 dark ports` [15,14,12,1], beside this route; inventory association, not proof of no cable. |
| server1 → NIC | vA [10,22,1,4] → [10,26,1,1] | `only uplink` [12,24,11,1]. |
| NIC → gateway | vA [10,31,1,1] → elbow [9,32,2,1] → [9,33,1,2] → [9,35,1,1] | `gw 0.1 ms` [12,31,9,1]. |
| server2 → gateway | vA [34,13,1,20] → [11,33,24,1] → [11,34,1,1] → [11,35,1,1] | `same /29` [19,32,8,1], above its horizontal run. |
| address pool → gateway | vA [57,13,1,21] → [13,34,45,1] → [13,35,1,1] | `free? in /29` [29,35,12,1], below its horizontal run. |
| gateway → Airtel | vB [30,15,1,2] → [30,17,3,1] → [32,18,1,1] | `transit 1.8 ms` [32,15,14,1]. |
| Airtel → Airtel backbone | vB [32,23,1,2] → [31,25,2,1] → [31,26,1,1] | `7.1 ms` [34,24,6,1]. |
| Airtel backbone → Cloudflare | vB [31,31,1,3] → [31,34,1,1] | `8.3 ms` [33,32,6,1]. |

All heads point down, immediately above the destination top borders. The three vA gateway heads at columns 9, 11 and 13 are distinct. The nested corridors in [9,31,49,5] neither cross nor share a stem. No spurious server2-to-server1/NIC link is visible. There is no source-requested intentional bus or branch in this case and no apparent false branch. The one-cell-inset ports are unusual but remain valid; I do not add a centered-port requirement to the rubric.

The two lower vA edge labels are less immediate than the vertical labels, but their above/below alignment with separate horizontal runs is sufficient to recover ownership. This was already the blind interpretation. I do not turn a generator admission of less-than-ideal placement into a failed edge without an actual ambiguity.

## Concrete defects

### F1 — Critical: required meaning omitted

Evidence: vB `unselected.text.txt`, Cloudflare box [30,35,20,4]; vA `unselected.text.txt`, full graph [8,9,63,31].

The full prefix/address assignment and AS13335 are absent, as are the public-L3/no-NAT/no-IPv6 qualifiers. The generator acknowledges truncating Cloudflare's AS for width and removing the network qualifiers because they are not nodes or edges. That justification is incorrect: annotations can preserve source meaning without inventing links. The semantic gate asks for concepts and label meaning, not merely matching an edge count.

Incidental fresh-handoff uptime, GPU inventory and software installation status are not treated here as mandatory NIC-topology additions. The failure rests on networking content and the explicit expected endpoint label.

### F2 — High: geometric fit achieved by deleting coverage

The actual graph extents are vA [8,9,63,31] and vB [29,11,21,28]. Every *drawn* box is complete and every *drawn* label fits. Both `stty-size.raw.txt` files report 47 rows by 77 columns; layout records show unzoomed 79×49 chrome-inclusive half panes. Natural 100% is supported by launch provenance and the no-fit/no-scroll/no-zoom record, not by a visible numerical zoom readout.

The frozen layout gate additionally requires full labels and complete source coverage. Those conjuncts fail. This is not a claim that an existing glyph is clipped, nor a penalty for unused space. In particular, the narrow upstream view has substantial spare width while AS13335 was deliberately removed. F1 and F2 concern one omission evaluated under two explicitly different frozen gates; they are not two fabricated visual defects.

### F3 — High: depth-based color is not conceptual grouping

Evidence: vA `unselected.ansi.txt`, top row [12,9,59,4], server1/NIC [9,18,20,13], gateway [8,36,21,4]; vB `unselected.ansi.txt`, [29,11,21,20].

Unselected border colors are:

- vA dark NICs (216,166,87), server2 (228,184,111), address pool (200,147,68): related gold shades for dissimilar source concepts.
- vA server1 (125,174,163), active NIC (211,134,155), gateway (169,182,101).
- vB gateway (216,166,87), Airtel (125,174,163), Airtel backbone (211,134,155), Cloudflare (169,182,101).

The two same-model servers are not one hue family. The two NIC concepts are not one hue family. The two Airtel stages are adjacent but teal versus pink. Arista changes green to gold across the split. These are source-grouping failures, not random alphabet cycling; the actual problematic organizing principle is geometric layer. There is no visible legend establishing an alternative source-supported interpretation.

### F4 — High: incorrect selected-state provenance

`generation.json` describes vB selected-1 as “Tab (Arista .57 selected).” In `vB/selected-1.ansi.txt`, Arista [29,11,21,4] retains its normal non-bold perimeter. Airtel [31,19,17,4] is bold and changes from teal to (216,166,87). This is a direct contradiction, independently observed before reveal.

The commands log contains viewer launch and quit/split operations, but not the exact pane capture commands or selection-action sequence. The second selected state does show Airtel BB, as recorded. This incomplete/mistaken provenance fails the required workflow-state evidence gate; good hashes do not repair it. No claim is made that a model was unavailable or that a pane leaked.

## Border evidence and remaining blockers

All ten node occurrences have complete top/bottom/left/right sides and four corners in unselected ANSI. The exact sides and RGB triples are enumerated in `observed-first.md`. All four actually selected occurrences also keep one consistent perimeter color, with SGR bold across all sides/corners:

- vA dark NICs [12,9,13,4], selected-1.
- vA server2 [33,9,19,4], selected-2.
- vB Airtel [31,19,17,4], selected-1.
- vB Airtel backbone [30,27,20,4], selected-2.

No separate handle glyph appears, so there is no observed handle mismatch to assert. However, the rubric says **every node**, including selected states. Selected captures are absent for vA spare [56,9,15,4], server1 [9,18,19,4], NIC [9,27,20,4], gateway [8,36,21,4], and vB gateway [29,11,21,4], Cloudflare [30,35,20,4]. It would be extrapolation to claim their selected states pass. This is an evidence blocker, not a renderer defect or an invitation to create new captures in this stage.

No required model or renderer capability is demonstrated unavailable. The missing selected coverage and capture-action provenance are the unresolved evidence needs. The known failed categories keep the overall result **fail**, even though border evidence is incomplete.

## Optional animation

`cases.json` and this case's `expected.json` explicitly mark animation optional; the source task does not request it. Thus animation is source-backed N/A, not a pass or a blocker.

vA has zero flows and its two frames are identical. vB includes dots on all three routes. The now-revealed generation timestamps put frames 1/2 at 08:28:03/04Z and frames 3/4 both at 08:28:05Z. Changes prove neither a precise speed nor unambiguous forward travel under temporal aliasing. The report's stronger “dots advance” claim is not adopted.

In `vB/frame3.text.txt` and `frame4.text.txt`, dots replace both upper bend corners within [30,17,3,1]; lower elbow cells in [31,25,2,1] are also sometimes replaced. This is visible but does not create an alternate route, cover a label, put a dot on a border, or erase a destination head. The unique endpoint-to-endpoint links remain readable. I therefore retain the blind traceability judgment rather than failing a source-unrequested motion-speed criterion. A later renderer improvement could preserve corner glyphs and avoid clustered dots, but that is not an additional pass condition here.

## Workflow, cleanup and attribution

Frozen generation provenance identifies a fresh isolated DeepSeek worker, no generator-run judging, and a separate later Astra judge. This judge's actual environment agrees with the required identity. The blind record predates expected-source reveal. Required final text/ANSI/check records and live dimensions are present, with the F4 exceptions above. Capture art was not pasted into this review's chat reply; it remains in evidence/report files. Unrelated chat, credentials and remote hosts were not accessed.

Cleanup records identify four owned panes: `w7E:p36`, `w7E:p3G`, `w7E:p3Q`, `w7E:p41`. All are reported closed after q via self-closing viewer commands. The commands log records only agent pane `w7E:p2W` remaining after final vA and final vB, supporting no remaining owned viewer pane. Earlier individual closure times are report records, not separate raw post-close responses. Cleanup is recorded done, with that evidence distinction. This judge created no panes.

### Skill-level correction candidates — not applied

1. Establish required concept/label coverage before fitting, including network annotations and complete AS identity. Do not assume “not an edge” means “safe to omit.” Preserve optional versus required content explicitly.
2. Keep the two-view gateway boundary, but retain full endpoint/address meaning on screen. Choose fewer abbreviations or supplementary labels rather than silently delete facts.
3. Separate conceptual groups from topology layers; do not claim geometric color depth is source-backed grouping. If the renderer cannot express the desired grouping independently, record a capability need rather than a false pass.
4. Preserve exact capture and selection commands and identify selected nodes from the actual ANSI output. Include selected-state coverage for every required node occurrence.
5. Keep the good qualifications: dark is not no-cable, MAC vendor is not proven ToR role, unanswered addresses are not proven free, and invisible fabric must not be invented.

### Renderer-level candidates — not applied or claimed as proven capability gaps

- Support independently controllable conceptual hue families and stable shared-node identity across split views, rather than coupling both to local geometric layer.
- Provide label/annotation layout that can preserve longer endpoint context without forcing one-line deletion. No conclusion is drawn about current API support from unexecuted source.
- Consider preserving route-corner glyphs during dot animation and distributing dots coherently across short segments. Do not reclassify these optional polish candidates as this case's failed animation gate.

No fixes, rendering, installs, commits or subagents were performed. The captain must gather all eight complete critiques before proposing or applying another skill candidate.

## Deliverables

- `docs/visualize-eval/rounds/01/reviews/server-nic-layout/reviewer-result.json`
- `docs/visualize-eval/rounds/01/reviews/server-nic-layout/critique.md`
- `docs/visualize-eval/rounds/01/reviews/server-nic-layout/spec-manifest.json`
- `docs/visualize-eval/rounds/01/reviews/server-nic-layout/verification.json`
- Unchanged `observed-first.md` in the same directory.
