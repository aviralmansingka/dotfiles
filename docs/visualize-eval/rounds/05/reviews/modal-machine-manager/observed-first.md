# Round 05 — modal-machine-manager — stage A blind observations

This record was saved before receiving source material, expectations, or a rubric. Only the task instructions, final specs, captured evidence, and pinned captures were read. No generator code, attempts, other cases, earlier rounds, or new viewer sessions were used. No fixes were made.

Coordinates below are 1-based `[column,row,width,height]` in the pinned 77×47 application grid, excluding the `viewport:` and `frame N at Tms` preambles. A route coordinate is `[column,row]`. Coordinates in the 83×51 live ANSI captures are the corresponding pinned coordinates plus `[3,2]`. The pinned dumps are plain text: they prove geometry and motion, not color. Color and selection statements below come specifically from the live ANSI captures.

## Evidence integrity and limits

All four final specs were hashed with `shasum -a 256`; each matches its evidence manifest:

| Spec | SHA-256 |
|---|---|
| v1.json | 51940826d898a708dd305bee0318861eef11c5bfd9e6a01e90f58f3d0df864fe |
| v2.json | b8c0d4df662084787af45751c955502c9579c552460fee63fbdf6e9f9722315a |
| v3.json | f17f920df3eb652afb9a525be1a77ace11469b721240dfca58a34f42e5357f0d |
| v4.json | 63afda58ce4738d175ffe73230d5886b1fa15b91f4fffad0e54f9c8d9c473074 |

All eight artifact hashes in each of the four evidence manifests were independently recomputed and match. The manifests all name binary hash `b1ab9f2e78af11c2f2b005eea083a999079d184bf550e8d0b6d9c51867f22404`; this verifies the captured hash declarations, not a fresh execution or hashing of the binary.

Pinned capture SHA-256 values, also measured with `shasum -a 256`:

| Capture under pinned-77x47/ | SHA-256 |
|---|---|
| v1-frames.txt | e53a148e6298961fd7fad9477533608b8c54977a48e6652283fe0377f469fb45 |
| v2-frames.txt | 2c5f007af6a89469210f02281d92273024449b4e209b02d5422272e283f151a7 |
| v3-frames.txt | f2a91955358b1cffd41e186e7781a52e319eb529b91c8b38b738db68884a68da |
| v4-frames.txt | e2a3e8ed31591b3a629b54d090c189ac84f37d82af45b5555d1ac39d4cc94393 |

Every pinned capture opens with `viewport: 77x47 zoom: 1.00 natural`. Each frame has a 47-row grid and a header naming `77x47 @100%` and the correct final spec. Trailing spaces are trimmed, so the maximum nonblank line width of 67 does not constitute a 67-column viewport. The live ANSI and selected ANSI captures have exactly 51 rows of 83 cells and headers naming `83x51 @100%`. Their manifests have null pane width/rectangle and null `viewport_line`, but contain `viewport_token: "83x51 @100%"`. Each live check says `viewport: unknown zoom: 1.00 natural`.

The live `*-frames.txt` and `*-frames.ansi` files are 1000-line scrollback tails, not complete frame sequences: v1 starts with a partial frame followed by frame 9, and the other views likewise omit their opening frames. They are supplementary, not frame-0 proof. The pinned sequences are complete for the delivered ranges: v1 frames 0–27 / 0–2700 ms; v2 0–65 / 0–6500 ms; v3 0–55 / 0–5500 ms; v4 0–29 / 0–2900 ms. Step spacing is 100 ms. No supplied file was unreadable or unsupported. Missing evidence: pinned-size ANSI/selected frames and a pixel/frame dump beyond these ranges. No missing evidence is inferred from a spec.

## Visible text and borders

All node labels below are verbatim. Every listed box is four cells high, with a complete `╭──…──╮` top, `╰──…──╯` bottom, and two uninterrupted `│` cells on each vertical side. All four corners are present. This is true for all 25 node occurrences in the pinned captures and the corresponding live regular/selected captures. No node label or border is clipped.

`RGB` is the regular border's single foreground color over its entire perimeter, measured from ANSI. Each node's selected border has RGB `(216,166,87)` over its entire perimeter. Thus regular and selected borders are each color-continuous; this does not claim that plain pinned text proves color. The full selected border of every node is present in the select-all capture, not merely a selected label or one selected exemplar.

### v1 nodes

| Label | Label bounds | Box bounds | Regular border RGB |
|---|---|---|---|
| control plane | [13,12,13,1] | [12,11,15,4] | 211,134,155 |
| humans + mmctl | [45,12,14,1] | [44,11,16,4] | 231,138,78 |
| private gRPC | [13,20,12,1] | [12,19,14,4] | 187,108,131 |
| webapi | [45,20,6,1] | [44,19,8,4] | 226,156,175 |
| River queue | [29,28,11,1] | [28,27,13,4] | 125,160,184 |
| Slack | [61,28,5,1] | [60,27,7,4] | 241,164,108 |
| Postgres | [13,36,8,1] | [12,35,10,4] | 169,182,101 |

### v2 nodes

| Label | Label bounds | Box bounds | Regular border RGB |
|---|---|---|---|
| River queue | [15,8,11,1] | [14,7,13,4] | 125,160,184 |
| prov registry | [15,16,13,1] | [14,15,15,4] | 231,138,78 |
| reconcile loop | [49,16,14,1] | [48,15,16,4] | 211,134,155 |
| metal providers | [15,24,15,1] | [14,23,17,4] | 241,164,108 |
| Postgres | [49,24,8,1] | [48,23,10,4] | 169,182,101 |
| machines | [15,32,8,1] | [14,31,10,4] | 125,160,184 |
| boot server | [15,40,11,1] | [14,39,13,4] | 151,184,206 |

### v3 nodes

| Label | Label bounds | Box bounds | Regular border RGB |
|---|---|---|---|
| machines | [19,12,8,1] | [18,11,10,4] | 125,160,184 |
| River queue | [49,12,11,1] | [48,11,13,4] | 125,160,184 |
| machine-agent | [19,20,13,1] | [18,19,15,4] | 151,184,206 |
| S3 store | [49,20,8,1] | [48,19,10,4] | 169,182,101 |
| public gRPC | [19,28,11,1] | [18,27,13,4] | 211,134,155 |
| Postgres | [19,36,8,1] | [18,35,10,4] | 189,201,124 |

### v4 nodes

| Label | Label bounds | Box bounds | Regular border RGB |
|---|---|---|---|
| River queue | [33,16,11,1] | [32,15,13,4] | 125,160,184 |
| janitor | [18,24,7,1] | [17,23,9,4] | 189,201,124 |
| SSH + BMC ops | [48,24,13,1] | [47,23,15,4] | 169,182,101 |
| webapi | [18,32,6,1] | [17,31,8,4] | 211,134,155 |
| machines | [48,32,8,1] | [47,31,10,4] | 125,160,184 |

### Visible edge labels

| View | Verbatim visible label | Bounds | Ownership observation |
|---|---|---|---|
| v1 | create/terminate/repair | [15,16,23,1] | control plane → private gRPC |
| v1 | http | [47,16,4,1] | humans + mmctl → webapi |
| v1 | enqueue job | [17,24,11,1] | private gRPC → River queue |
| v1 | reinstall/reprov | [29,24,16,1] | webapi → River queue intended; also sits above the far end of private gRPC's adjacent route |
| v1 | achine rows | [1,28,11,1] | private gRPC → Postgres; clipped text, NOT the full string `machine rows` |
| v1 | job rows | [18,32,8,1] | River queue → Postgres |
| v1 | confirm/alerts | [47,26,14,1] | webapi → Slack |
| v2 | provision job | [17,11,13,1] | River queue → prov registry |
| v2 | gcore sync 1m | [27,19,13,1] | reconcile loop → metal providers |
| v2 | cluster state | [36,21,13,1] | reconcile loop → Postgres intended; close to the long reconcile loop → metal providers run above |
| v2 | provider API | [18,21,12,1] | prov registry → metal providers intended; visibly closer to reconcile loop's route at column 17 than its own vertical at column 15 |
| v2 | alloc instance | [17,30,14,1] | metal providers → machines |
| v2 | iPXE request | [17,36,12,1] | machines → boot server |
| v3 | diag uploads | [36,15,12,1] | River queue → S3 store intended; also close to machines → S3 store below |
| v3 | pull boot img | [29,16,13,1] | machines → S3 store |
| v3 | runs on host | [21,18,12,1] | machines → machine-agent intended; immediately below machines → S3 store's horizontal route |
| v3 | register+hb | [21,25,11,1] | machine-agent → public gRPC |
| v3 | machine state | [21,32,13,1] | public gRPC → Postgres |
| v4 | diag events | [21,20,11,1] | appears beside River queue → janitor |
| v4 | audit reimage | [35,22,13,1] | appears below River queue → SSH + BMC ops |
| v4 | propose actions | [20,28,15,1] | appears beside janitor → webapi |
| v4 | machine-audit | [35,29,13,1] | appears beside SSH + BMC ops → machines |

The v2 spec's `boot.ipxe + S3 args` is not visible anywhere in the pinned grid or corresponding live text; it has no visible bounds. Both the pinned warning and check explicitly identify this skipped label. The return arrow itself remains visible and traceable. This is one dropped label, not a second clipping item.

The v1 spec/live capture has `machine rows`; the pinned grid instead has `achine rows`. The missing initial `m` would occupy column 0. Exactly one character is clipped at the left boundary, in every pinned frame. The live 83×51 capture contains the full label at [3,30,12,1]. No pan/zoom evidence restores it at the pinned size, and no other clipped item is visible.

The checks report ambiguous-owner counts **1/2/2/1**. The first five can be localized visually as v1 `reinstall/reprov`; v2 `provider API` and `cluster state`; v3 `diag uploads` and `runs on host`. The v4 check does NOT identify which of its four labels accounts for its one reported ambiguity. From the pixels all four can be associated with an apparent route as listed, and I cannot independently isolate a uniquely tied owner there. I preserve the reported count of one without inventing an exact label identity or asserting a measured tie unsupported by the capture. Thus six reported ambiguity instances, five localized here, one unlocalized. This distinction is material even though every arrow can be traced.

### UI labels (not counted as graph labels)

Each view has the exact header `rataflow-view · 77x47 @100% · vN.json · K nodes · E edges · q quit`, at [2,1,66,1], with `(N,K,E)` respectively `(1,7,7)`, `(2,7,7)`, `(3,6,5)`, `(4,5,4)`. The live headers have the same text and bounds except `83x51` replaces `77x47`.

All four pinned views show `+ [+]` [4,42,5,1], `− [-]` [4,43,5,1], `⊡ [f]` [4,44,5,1], and `□ [i]` [4,45,5,1]. The complete legend box is [2,41,9,6], using square corners; its live counterpart is [2,45,9,6]. Its live border is uniformly RGB `(168,153,104)`. These 20 UI text occurrences are separate from the 47 visible graph-label occurrences.

## Every visible arrow and bend

The following polylines enumerate the first external route cell, every corner, and the final arrowhead. Straight stretches between coordinates are continuous. All 23 routes are traceable from their source box to their target box without choosing an unexplained crossing. All arrowheads remain drawn and point into the stated target. All but the return route have a downward `▼`; the return has a rightward `▶`. All are solid routes, not dashed. Each source/target association below comes from tracing the visible route; absence/ambiguity of a text label does not erase its arrow.

| View / route | Source → target | External route polyline (including all corners) | Arrowhead |
|---|---|---|---|
| v1 A | control plane → private gRPC | [13,15] → [13,18] | ▼ [13,18] |
| v1 B | humans + mmctl → webapi | [45,15] → [45,18] | ▼ [45,18] |
| v1 C | webapi → River queue | [45,23] → [45,25] → [31,25] → [31,26] | ▼ [31,26] |
| v1 D | private gRPC → River queue | [15,23] → [15,25] → [29,25] → [29,26] | ▼ [29,26] |
| v1 E | private gRPC → Postgres | [13,23] → [13,34] | ▼ [13,34] |
| v1 F | River queue → Postgres | [29,31] → [29,33] → [15,33] → [15,34] | ▼ [15,34] |
| v1 G | webapi → Slack | [47,23] → [47,25] → [61,25] → [61,26] | ▼ [61,26] |
| v2 A | River queue → prov registry | [15,11] → [15,14] | ▼ [15,14] |
| v2 B | reconcile loop → metal providers | [49,19] → [49,20] → [17,20] → [17,22] | ▼ [17,22] |
| v2 C | reconcile loop → Postgres | [51,19] → [51,21] → [49,21] → [49,22] | ▼ [49,22] |
| v2 D | prov registry → metal providers | [15,19] → [15,22] | ▼ [15,22] |
| v2 E | metal providers → machines | [15,27] → [15,30] | ▼ [15,30] |
| v2 F | machines → boot server | [15,35] → [15,38] | ▼ [15,38] |
| v2 G | boot server → machines | [13,40] → [11,40] → [11,32] → [13,32] | ▶ [13,32] |
| v3 A | machines → S3 store | [21,15] → [21,17] → [49,17] → [49,18] | ▼ [49,18] |
| v3 B | River queue → S3 store | [49,15] → [49,16] → [51,16] → [51,18] | ▼ [51,18] |
| v3 C | machines → machine-agent | [19,15] → [19,18] | ▼ [19,18] |
| v3 D | machine-agent → public gRPC | [19,23] → [19,26] | ▼ [19,26] |
| v3 E | public gRPC → Postgres | [19,31] → [19,34] | ▼ [19,34] |
| v4 A | River queue → SSH + BMC ops | [35,19] → [35,21] → [48,21] → [48,22] | ▼ [48,22] |
| v4 B | River queue → janitor | [33,19] → [33,21] → [18,21] → [18,22] | ▼ [18,22] |
| v4 C | SSH + BMC ops → machines | [48,27] → [48,30] | ▼ [48,30] |
| v4 D | janitor → webapi | [18,27] → [18,30] | ▼ [18,30] |

Crossing inventory: zero crossing cells, zero bridge glyphs, zero shared-route junction cells, zero shared runs, and zero touching bends that join distinct routes in all four views. There are 8/6/4/4 ordinary route corners respectively (22 total), all located in the polylines above. The checks' `crossings: 0 bridges, 0 touching bends` agrees with that inventory.

Important near-contacts: v2 corners [49,20] and [49,21] belong to different routes and sit vertically adjacent, but their glyph arms do not connect to each other; v3 corners [49,16] and [49,17] likewise sit adjacent without a connecting pair of arms. These compact bends are easy to confuse on a glance but are not a bridge or a shared branch. Target arrows are separated: e.g. v1 River queue at columns 29 and 31, v2 metal providers at 15 and 17, v3 S3 store at 49 and 51.

Apparent branching/convergence is confined to boxes with distinct ports: v1 private gRPC has two exits, webapi two exits, River queue two arrivals, and Postgres two arrivals; v2 reconcile loop has two exits, metal providers two arrivals, and the machines/boot-server pair has separate opposite-direction arrows; v3 machines has two exits and S3 store two arrivals; v4 River queue has two exits. No freestanding Y/T junction or declared bus is visible. The specs declare no trunks and all checks have empty `trunks:` lines.

## Motion and the pinned origin rule

The clarified source port is the **exit cell on the node border**. The true origin is the **first external drawn route cell immediately after that border port, including a corner if one occurs there**. It is not the second external cell and not the first non-corner selected by an animator.

All 23 specs set `flow: true` and `dots: 1`, with no per-route speed or same-arrival override. In every delivered frame there is exactly one visible `●` per route: v1 7 dots, v2 7, v3 5, v4 4. No overlaps or multi-dot periodic trains are visible; intra-route dot spacing is therefore not applicable. Dots are RGB `(216,166,87)` in live ANSI, while static edges/arrowheads are muted RGB `(124,111,100)`.

### Frame-0 coordinate adjudication, every route

| Route | Border source port | Required first external cell | Actual frame-0 dot | Origin result |
|---|---|---|---|---|
| v1 A | [13,14] | [13,15] | [13,16] | fail: one drawn cell downstream |
| v1 B | [45,14] | [45,15] | [45,16] | fail |
| v1 C | [45,22] | [45,23] | [45,24] | fail |
| v1 D | [15,22] | [15,23] | [15,24] | fail |
| v1 E | [13,22] | [13,23] | [13,24] | fail |
| v1 F | [29,30] | [29,31] | [29,32] | fail |
| v1 G | [47,22] | [47,23] | [47,24] | fail |
| v2 A | [15,10] | [15,11] | [15,12] | fail |
| v2 B | [49,18] | [49,19] | [49,20] | fail; dot replaces a corner |
| v2 C | [51,18] | [51,19] | [51,20] | fail |
| v2 D | [15,18] | [15,19] | [15,20] | fail |
| v2 E | [15,26] | [15,27] | [15,28] | fail |
| v2 F | [15,34] | [15,35] | [15,36] | fail |
| v2 G | [14,40] | [13,40] | [12,40] | fail, proceeding leftward |
| v3 A | [21,14] | [21,15] | [21,16] | fail |
| v3 B | [49,14] | [49,15] | [49,16] | fail; dot replaces a corner |
| v3 C | [19,14] | [19,15] | [19,16] | fail |
| v3 D | [19,22] | [19,23] | [19,24] | fail |
| v3 E | [19,30] | [19,31] | [19,32] | fail |
| v4 A | [35,18] | [35,19] | [35,20] | fail |
| v4 B | [33,18] | [33,19] | [33,20] | fail |
| v4 C | [48,26] | [48,27] | [48,28] | fail |
| v4 D | [18,26] | [18,27] | [18,28] | fail |

Therefore **0/23 frame-0 dots satisfy the pinned origin rule**, despite check lines claiming 7/7, 7/7, 5/5, and 4/4 origins. This is a coordinate-proven contradiction, not a semantic failure inferred from a spec. The route's border port and first external cell are both explicitly recorded so that the disagreement cannot be hidden by redefining “origin.”

### Full delivered motion ranges

For a compact, reproducible description, index each external route's drawn cells from zero at its first external cell, counting corners and the final arrowhead. `0..3`, for example, is a four-cell vertical route, with index 3 its arrowhead. In the table, `3..15` includes every integer in that interval. Every listed occupancy is measured across the pinned frames; no future frames are assumed.

| Route(s) | Drawn route cells | Observed dot indices over delivered frames | Direction / behavior |
|---|---:|---|---|
| v1 A, B | 4 each | {1,2} | down, then reset; two-position loop |
| v1 C, D, F, G | 18 each | {1,3..15} | along each route toward its target; skips the near corner at 2; delivered end is index 15 |
| v1 E | 12 | {1..10} | down then reset at frame 20 |
| v2 A, D, E, F | 4 each | {1,2} | down then reset every four frames |
| v2 B | 36 | {1..32,34} | left across the long run then down; corner at index 1 occupied in frames 0 and 1; corner 33 skipped |
| v2 C | 6 | {1,3} | repeats between [51,20] and [50,21], then jumps back upstream |
| v2 G | 13 | {1,3..9,11} | left, up, right; corners at 2 and 10 skipped; reset at frame 18 |
| v3 A | 32 | {1,3..29} | right toward S3; near corner 2 skipped; delivered end is index 29 |
| v3 B | 6 | {1,2,4} | repeats [49,16] → [50,16] → [51,17] → reset |
| v3 C, D, E | 4 each | {1,2} | down then reset every four frames |
| v4 A | 17 | {1,3..14} | right toward SSH; reset at frame 26 |
| v4 B | 19 | {1,3..16} | left toward janitor; delivered end is index 16 |
| v4 C, D | 4 each | {1,2} | down then reset every four frames |

Dot positions generally repeat for each pair of successive 100 ms frames: frame 0 equals frame 1, frame 2 equals frame 3, etc. Between pairs, movement is one eligible cell forward, with two-cell drawn-route jumps where a corner is skipped and a backward jump on wrap. The checks call all routes constant `0.5c/step`; the captures support a shared cadence over eligible cells, not strictly constant distance traveled over all drawn cells. None is a same-arrival route in the specs/checks.

The two conspicuous short dogleg loops are v2 C and v3 B. v2 C truly has only two observed dot positions, [51,20] and [50,21], repeating every 400 ms; neither is its arrowhead [49,22]. v3 B has **two straight-cell positions PLUS a corner position**, not literally only two visible positions when corners are included: frames 0/1 [49,16] (corner), 2/3 [50,16], 4/5 [51,17], then frames 6/7 [49,16] again. Its cycle is 600 ms and it never reaches [51,18]. Calling v3 B merely “two cells” would omit the visible corner dot. The delivered check reports one dot violation in each of v2 and v3, but gives no route ID or reason, so that counter alone cannot establish which geometric defect it counts.

Corner occupancy: exactly two routes have observed dots on corners. v2 B occupies [49,20] at frames 0 and 1; v3 B occupies [49,16] at frames whose number modulo 6 is 0 or 1 (20 frames in this delivered sequence). No other route's dot sits on a corner in the delivered frames. There are no bridge glyphs, hence no bridge-dot occupancies.

Arrowheads: **no route's dot occupies its arrowhead in any delivered frame**. The short loops show repeated reset without reaching their arrowheads; the long sequences terminate before any head occupancy, so no future head occupancy is assumed. All 23 arrowheads remain visible as arrows throughout the delivered frames. There is no frame in which every route reaches its arrowhead, and no observed individual arrowhead arrival to synchronize. The check's `arrivals: 0/0 same-arrival routes...` is vacuous, not proof of head arrival for these constant-speed routes.

Checker dot violations are 0/1/1/0, total 2. The blind observation independently counts 23 origin failures, 23 routes with no observed arrowhead occupancy, and 2 corner-occupying routes. These are overlapping categories, not additive independent failed routes. The union of routes with at least one of those observed defects is 23/23. No wrong dot-count route is observed.

## Fit, selected-state coverage, and routing economy

| View | Pinned viewport | Live check extent | Node / edge occurrences | Visible edge labels | Clipped items | Selected borders captured |
|---|---|---|---|---|---|---|
| v1 | 77×47 @100% | 75×32 | 7 / 7 | 7, one truncated | 1 character in 1 label | 7/7 live |
| v2 | 77×47 @100% | 54×40 | 7 / 7 | 6 | 0 | 7/7 live |
| v3 | 77×47 @100% | 47×32 | 6 / 5 | 5 | 0 | 6/6 live |
| v4 | 77×47 @100% | 49×24 | 5 / 4 | 4 | 0 | 5/5 live |

The graph is displayed at 100%, not fitted below 100%. All boxes and all arrow routes are on screen. The v1 first letter is nonetheless offscreen despite a reported 75-cell extent fitting within 77 columns: a fit claim does not repair that clipping. In v2 the boot-server bottom border at row 42 is beside, not behind, the legend at columns 2–10. The v2 missing return-edge label is skipped, not merely offscreen. No captured interaction demonstrates any additional pan/zoom-only content, so none is claimed.

All 25 node occurrences have their own selected border captured in the 83×51 select-all images, for **25/25** coverage. Target-size selected/color capture coverage is **0/25**, because pinned dumps are plain text without selected variants. Geometric correspondence between sizes is clear, but it is not substitute pinned color evidence.

There are no conspicuous long winding loops other than v2's clear boot-server return route, which travels around the left side of the stacked boxes. That route has 13 drawn cells versus a nine-cell unconstrained endpoint Manhattan route, a four-cell detour; the direct line would run beside/through the stacked-box boundary rather than provide its lateral exit/entry. All other listed paths are coordinate-monotone between their external endpoints and have Manhattan-minimal length for those endpoints. This does not prove globally optimal placement or routing. None of the four checks supplies a `routes: N/M near-minimal` line, so that comparison is missing rather than assumed successful. Visible crossing counts match the reported zero counts.

## Tool-usable blind scorecard

Graph counts are view occurrences, not deduplicated conceptual entities. Visible labels include the one truncated label as one visible text occurrence; UI labels are excluded. “Dot violations” is split into checker counters and measured categories to prevent silently trusting the check or double-counting overlapping failures. No rubric-dependent numerical grade is assigned during stage A.

```json
{
  "stage": "A",
  "case": "modal-machine-manager",
  "coordinate_surface": "pinned-77x47",
  "per_view": {
    "v1": {
      "nodes": 7, "edges": 7, "visible_node_labels": 7,
      "visible_edge_labels": 7, "fully_visible_graph_labels": 13,
      "visible_graph_labels_including_truncated": 14,
      "skipped_edge_labels": 0, "crossings": 0, "bridges": 0,
      "touching_bends": 0, "ordinary_route_corners": 8,
      "uncertain_label_owners_reported": 1, "uncertain_owners_localized": 1,
      "clipped_items": 1, "clipped_characters": 1,
      "selected_borders_live": {"captured": 7, "total": 7},
      "dot_count_violations_observed": 0, "dot_violations_check": 0,
      "origin_failures_observed": 7, "corner_dot_routes_observed": 0,
      "routes_without_observed_arrowhead_occupancy": 7,
      "dot_violating_routes_observed_union": 7
    },
    "v2": {
      "nodes": 7, "edges": 7, "visible_node_labels": 7,
      "visible_edge_labels": 6, "fully_visible_graph_labels": 13,
      "visible_graph_labels_including_truncated": 13,
      "skipped_edge_labels": 1, "crossings": 0, "bridges": 0,
      "touching_bends": 0, "ordinary_route_corners": 6,
      "uncertain_label_owners_reported": 2, "uncertain_owners_localized": 2,
      "clipped_items": 0, "clipped_characters": 0,
      "selected_borders_live": {"captured": 7, "total": 7},
      "dot_count_violations_observed": 0, "dot_violations_check": 1,
      "origin_failures_observed": 7, "corner_dot_routes_observed": 1,
      "routes_without_observed_arrowhead_occupancy": 7,
      "dot_violating_routes_observed_union": 7
    },
    "v3": {
      "nodes": 6, "edges": 5, "visible_node_labels": 6,
      "visible_edge_labels": 5, "fully_visible_graph_labels": 11,
      "visible_graph_labels_including_truncated": 11,
      "skipped_edge_labels": 0, "crossings": 0, "bridges": 0,
      "touching_bends": 0, "ordinary_route_corners": 4,
      "uncertain_label_owners_reported": 2, "uncertain_owners_localized": 2,
      "clipped_items": 0, "clipped_characters": 0,
      "selected_borders_live": {"captured": 6, "total": 6},
      "dot_count_violations_observed": 0, "dot_violations_check": 1,
      "origin_failures_observed": 5, "corner_dot_routes_observed": 1,
      "routes_without_observed_arrowhead_occupancy": 5,
      "dot_violating_routes_observed_union": 5
    },
    "v4": {
      "nodes": 5, "edges": 4, "visible_node_labels": 5,
      "visible_edge_labels": 4, "fully_visible_graph_labels": 9,
      "visible_graph_labels_including_truncated": 9,
      "skipped_edge_labels": 0, "crossings": 0, "bridges": 0,
      "touching_bends": 0, "ordinary_route_corners": 4,
      "uncertain_label_owners_reported": 1, "uncertain_owners_localized": 0,
      "uncertain_owner_identity_missing": 1,
      "clipped_items": 0, "clipped_characters": 0,
      "selected_borders_live": {"captured": 5, "total": 5},
      "dot_count_violations_observed": 0, "dot_violations_check": 0,
      "origin_failures_observed": 4, "corner_dot_routes_observed": 0,
      "routes_without_observed_arrowhead_occupancy": 4,
      "dot_violating_routes_observed_union": 4
    }
  },
  "totals": {
    "visible_nodes": 25, "visible_edges": 23,
    "visible_node_labels": 25, "visible_edge_labels": 22,
    "visible_graph_labels_including_truncated": 47,
    "fully_visible_graph_labels": 46,
    "ui_text_occurrences_excluded_from_graph_labels": 20,
    "skipped_edge_labels": 1,
    "crossings": 0, "bridges": 0, "touching_bends": 0,
    "ordinary_route_corners": 22,
    "uncertain_label_owners_reported": 6,
    "uncertain_owners_localized": 5, "uncertain_owner_identity_missing": 1,
    "clipped_items": 1, "clipped_characters": 1,
    "complete_node_borders": 25,
    "color_continuous_regular_borders_live": 25,
    "color_continuous_selected_borders_live": 25,
    "selected_borders_live": {"captured": 25, "total": 25},
    "selected_borders_pinned": {"captured": 0, "total": 25},
    "animated_routes": 23, "dot_count_violations_observed": 0,
    "dot_violations_check": 2,
    "origin_passes_observed": 0, "origin_failures_observed": 23,
    "corner_dot_routes_observed": 2, "bridge_dot_routes_observed": 0,
    "arrowhead_dot_routes_observed": 0,
    "routes_without_observed_arrowhead_occupancy": 23,
    "all_routes_same_frame_arrowhead_arrival_observed": false,
    "dot_violating_routes_observed_union": 23,
    "unreadable_evidence_files": 0
  }
}
```

This record is final for stage A. Its SHA-256 is reported outside the file; the file is not to be edited after saving.
