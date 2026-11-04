# datacenter-redundancy — round 01, fresh DeepSeek generation

Case: `datacenter-redundancy` · round `01` · fresh generation that replaces the user-cancelled Astra run.
No file from that cancelled run was read or reused; this directory did not exist when work started.

- Generator: agent `viz-ds01-datacenter-redundancy` (worker profile)
- Model: `fireworks/accounts/fireworks/routers/deepseek-flash-latest`
  (`PI_PROVIDER=fireworks`, `PI_MODEL=accounts/fireworks/routers/deepseek-flash-latest`, `PI_REASONING_LEVEL=high`)
- Candidate skill: `docs/visualize-eval/rounds/01/SKILL.md`
  sha256 `9c5cea272a88300644cacda52c853c7c9169eeec91f0355d3460ee8741308d92` (matches the frozen value)
- Renderer: `/tmp/visualize-eval/round-01/bin/rataflow-view`
  sha256 `4a883e73b822f009c504bd21d0c2fc383067bf1b83b9791ccbda431912e3a1d8` (matches the frozen value)
- Judging: separate Astra judges are captain-owned. This generator spawned no reviewer and claims no approval.

## Viewport

| Item | Value |
|---|---|
| Target | 77 columns x 47 rows at 100% zoom |
| Split | `herdr pane split --current --direction right --ratio 0.5 --cwd $PWD --no-focus` (own tab `w7E:tS`, own pane `w7E:p20`) |
| Herdr pane rect | 79x49 (includes chrome) |
| Measured pty | `stty size` inside every viewer pane → `47 77` |
| Status | target met; no `f`, no pan, no zoom-out in any capture |

## Views (4, allowed maximum)

| View | Spec | Dir | Extent | Nodes/edges | Pane | Captured (UTC) |
|---|---|---|---|---|---|---|
| view1 ISP → MUX | `specs/view1-isp-mux.json` | tb | 45x14 | 6 / 4 | `w7E:p5G` | 20261102T083328Z |
| view2 MUX → core | `specs/view2-mux-core.json` | lr | 45x12 | 4 / 4 | `w7E:p5H` | 20261102T083335Z |
| view3 core → FW → BL | `specs/view3-fw-ha.json` | lr | 67x12 | 6 / 8 | `w7E:p5J` | 20261102T083341Z |
| view4 fabric | `specs/view4-fabric.json` | tb | 63x28 | 8 / 12 | `w7E:p5N` | 20261102T083348Z |

Every spec passes `--check` with exit 0, no warnings. Full stdout/stderr/exit for each view is in
`checks/<view>.check.*` with the command, timestamp and spec hash in `<view>.check.meta.txt`.

Why four views: one canvas cannot hold the topology. Auto layout refuses it
(`rataflow-view: no obstacle-safe route for mux2 -> core1, core2 -> fw2, fw1 -> bl1, bl2 -> sp2, sp1 -> leaf2,
leaf1 -> rack2`), and explicit 7-layer placement gives extent 54x71 with
`18 nodes / 28 edges is above the readable budget (12/16)` and two dropped labels. That one-view render
(`ref-full-singleview`, pane `w7E:p5R`) shows the `graph overflows · drag to pan` badge inside the 47x77 pane.

## Relationship coverage — 28 of 28, none dropped, none reversed

| # | Relation | Label | View | Visible evidence (1-based row/col) |
|---|---|---|---|---|
| 1 | `ispA → mux1` | (unlabeled by design) | view1 | stem (22-24,18) -> corner (25,18) -> run (25,19-28) -> corner (25,29) -> down col 29 -> arrow (26,29) on MUX 1 top border |
| 2 | `ispB → mux1` | (unlabeled by design) | view1 | stem (22-23,29) -> dogleg (24,29)╰─(24,30)─(24,31)╮ -> down col 31 -> arrow (26,31) on MUX 1 top border |
| 3 | `ispC → mux2` | (unlabeled by design) | view1 | stem (22-24,44) -> corner (25,44) -> run (25,45-54) -> corner (25,55) -> down col 55 -> arrow (26,55) on MUX 2 top border |
| 4 | `ispD → mux2` | (unlabeled by design) | view1 | stem (22-23,55) -> dogleg (24,55)╰─(24,57)╮ -> down col 57 -> arrow (26,57) on MUX 2 top border |
| 5 | `mux1 → core1` | x-conn | view2 | run (20,24-51) -> arrow (20,52) on Core 1 left border; label (19,35-40) directly above |
| 6 | `mux1 → core2` | x-conn | view2 | run (22,24-49) -> corner (22,50) -> down col 50 (crossing hop at (23,50)) -> corner (26,50) -> arrow (26,52) on Core 2 left border; label (21,34-39) |
| 7 | `mux2 → core1` | x-conn | view2 | run (26,24-47) -> corner (26,48) up col 48 -> corner (23,48) -> run (23,49-50) (crossing hop (23,50)) -> corner (23,51) up col 51 -> corner (22,51) -> arrow (22,52) on Core 1 left border; label (25,33-38) |
| 8 | `mux2 → core2` | x-conn | view2 | run (28,24-51) -> arrow (28,52) on Core 2 left border; label (27,35-40) |
| 9 | `core1 → fw1` | act | view3 | run (20,14-44) -> arrow (20,45) on FW1 left border; label (19,28-30) |
| 10 | `core2 → fw1` | act | view3 | run (26,14-42) -> corner (26,43) up col 43 -> corner (22,43) -> run (22,44) -> arrow (22,45) on FW1 left border; label (25,27-29) |
| 11 | `core1 → fw2` | stby | view3 | run (22,14-40) -> corner (22,41) down col 41 -> corner (25,41) -> run (25,42) (crossing hop (25,43)) -> corner (25,44) -> down col 44 -> corner (26,44) -> arrow (26,45) on FW2 left border; label (21,25-28) |
| 12 | `core2 → fw2` | stby | view3 | run (28,14-44) -> arrow (28,45) on FW2 left border; label (27,27-30) |
| 13 | `fw1 → bl1` | act | view3 | run (20,58-64) -> arrow (20,65) on BL 1 left border; label (19,60-62) |
| 14 | `fw1 → bl2` | act | view3 | run (22,58-62) -> corner (22,63) down col 63 (crossing hop (23,63)) -> corner (26,63) -> run (26,64) -> arrow (26,65) on BL 2 left border; label placed in free space at (24,56-59) |
| 15 | `fw2 → bl1` | stby | view3 | run (26,57-60) -> corner (26,61) up col 61 -> corner (23,61) -> run (23,62) (crossing hop (23,63)) -> corner (23,64) up -> corner (22,64) -> arrow (22,65) on BL 1 left border; label placed in free space at (24,65-67) |
| 16 | `fw2 → bl2` | stby | view3 | run (28,57-64) -> arrow (28,65) on BL 2 left border; label (27,59-62) |
| 17 | `bl1 → sp1` | ECMP | view4 | right port (25,13) -> run (25,14-27) -> corner (25,28) up col 28 -> corner (13,28) -> arrow (13,27)◀ into Spine 1 right border |
| 18 | `bl1 → sp2` | ECMP | view4 | right port (27,13) -> run (27,14-15) -> corner (27,16) up col 16 -> jog (14,16)->(14,15) -> up col 15 -> corner (10,15) -> top wrap run (10,16-54) -> corner (10,55) down col 55 -> corner (13,55) -> arrow (13,54)◀ into Spine 2 right border |
| 19 | `bl2 → sp1` | ECMP | view4 | left port (25,31) -> run (25,30) -> corner (25,29) up col 29 -> corner (23,29) -> run (23,15-28) (crossing hops (23,16),(23,28); label ECMP inside the run at (23,20-23)) -> corner (23,15) -> jog (22,15)->(22,13) -> up col 13 -> corner (13,13) -> run (13,14-16) (crossing hop (13,15)) -> arrow (13,17)▶ into Spine 1 left border |
| 20 | `bl2 → sp2` | ECMP | view4 | right port (25,36) -> run (25,37-43) -> corner (25,44) up col 44 (crossing hop (22,44)) -> corner (21,44) -> run (21,45-54) (crossing hop (21,49)) -> corner (21,55) up col 55 -> corner (15,55) -> arrow (15,54)◀ into Spine 2 right border |
| 21 | `sp1 → leaf1` | ECMP | view4 | bottom port (15,19) down col 19 -> corner (22,19) -> run (22,20-46) (crossing hops (22,28),(22,44)) -> corner (22,47) down -> arrow (23,47)▼ on Leaf 1 top border |
| 22 | `sp1 → leaf2` | ECMP | view4 | bottom port (15,21) down col 21 -> corner (20,21) -> run (20,22-62) (crossing hops (20,28),(20,49),(20,55)) -> corner (20,63) down -> arrow (23,63)▼ on Leaf 2 top border |
| 23 | `sp2 → leaf1` | ECMP | view4 | bottom port (16,46) down col 46 -> corner (19,46) -> run (19,47-48) -> corner (19,49) down -> arrow (23,49)▼ on Leaf 1 top border |
| 24 | `sp2 → leaf2` | ECMP | view4 | bottom port (16,48) down col 48 -> corner (18,48) -> run (18,49-64) (crossing hop (18,55)) -> corner (18,65) down -> arrow (23,65)▼ on Leaf 2 top border |
| 25 | `leaf1 → rack1` | dual | view4 | bottom port (27,47) down col 47 -> corner (31,47) -> run (31,20-46) (crossing hop (31,22)) -> corner (31,20) down col 20 -> arrow (33,20)▼ on Rack 1 top border; label 'dual' free-space (28,32-35) |
| 26 | `leaf2 → rack1` | dual | view4 | bottom port (27,63) down col 63 -> corner (30,63) -> run (30,45-62) (crossing hops (30,47),(30,49)) -> corner (30,45) up col 45 -> corner (29,45) -> run (29,22-44) -> corner (29,22) down col 22 -> arrow (33,22)▼ on Rack 1 top border; label (30,32-35) |
| 27 | `leaf1 → rack2` | dual | view4 | bottom port (27,49) down col 49 -> corner (31,49) -> jog (31,48) -> down col 48 -> corner (32,48) -> jog (32,47) -> down col 47 -> arrow (33,47)▼ on Rack 2 top border; label (29,51-54) |
| 28 | `leaf2 → rack2` | dual | view4 | bottom port (27,65) down col 65 -> corner (32,65) -> run (32,49-64) -> corner (32,49) down -> arrow (33,49)▼ on Rack 2 top border; label (31,55-58) |

Per view: view1 4, view2 4, view3 8, view4 12.

### Arrow convention (stated, not changed)
Arrows point from the recorded link endpoint to the other endpoint (the historical `from → to` order).
Every link is physical connectivity, not one-way traffic, and no endpoint pair was reversed to make layout
easier. The border-leaf → spine links therefore point **upward** as recorded, which is exactly what forces
the wrap routes in view4.

### User corrections honoured
- Redundancy is never merged: every redundant pair leaves separate ports and keeps its own route and arrowhead
  in all four views (8 independent `x-conn`/`ECMP`/`dual` pairs, no shared-bus glyph in any capture).
- Border leaves and rack leaves sit on one level: view4 row 24 top edges for `BL 1`, `BL 2`, `Leaf 1`, `Leaf 2`.
- Both spines are above them (rows 12-16), racks below (rows 34-37).
- Flow dots stay off (`flows=0` in every spec, header reads `0 flows`), per the source's "remove the dots" instruction.
- Compactness: 45x14, 45x12, 67x12 and 63x28 inside a 77x47 viewport.

## Checks performed on the actual renders

- Header present in every capture (`rataflow-view · <spec> · N nodes · M edges · 0 flows · …`).
- Node boxes: 6/6, 4/4, 6/6, 8/8 complete (four corners, all sides; scripted check over the visible captures).
- Arrowheads: 4, 4, 8 and 12 traced to their targets; no arrow glyph sits inside a word (scripted scan: 0 hits).
- Colour: border cells carry per-layer hue families, all edge strokes share one muted colour
  `rgb(124,111,100)`, and every arrow/hop glyph uses that edge colour. Selection changes the selected node's
  border shade (recorded in `*-selected.ansi`).
- Two frames per view (`*-visible.txt` and `*-frame2.txt`) — identical, because no flow dots exist.
- Labels: 0 in view1 (by design), 4/4 in view2, 8/8 in view3, 12/12 in view4. No label was dropped by `--check`.

## Defects that remain

| Id | View | Severity | Defect |
|---|---|---|---|
| D1 | view4 | high | `bl1 → sp2` wraps across the top (row 10, cols 15-55) and back down col 55, framing the spines and running one row above Spine 2's border. Caused by the required upward `bl → sp` direction with spines above. |
| D2 | view4 | medium | 14 crossing-hop glyphs `⌒`; routes stay separate but must be followed hop by hop. |
| D3 | view3 | medium | The crossing pair `fw1 → bl2` (act) and `fw2 → bl1` (stby) have their labels in free cells at (24,56-59) and (24,65-67), two rows from their routes, so act/stby cannot be attributed by position. The FW node labels still state which tier is active. |
| D4 | view4 | medium | Labels are drawn inside route runs (row 23 `ECMP` at 20-23 breaks the stroke) or far from their route; since all `ECMP` and all `dual` texts are identical the tier meaning survives, the per-edge association does not. |
| D5 | view4 | low | `BL 1` is five rows tall (two ports), the others four; tops align on row 24, centres differ by half a row. |
| D6 | view2 | low | Adjacent opposing corners `╮╭` at (22,50-51) plus a hop at (23,50); both routes and both arrowheads still trace separately. |
| D7 | view1 | low | ISP A's corner (25,29) stacks directly under ISP B's dogleg corner (24,29). |
| D8 | all | info | In view1 the first Tab selection lands on ISP A, whose normal border colour equals the selection accent, so that state is colour-identical; `final-view1c` (two Tabs, ISP B) proves selection works. |

## Blocker (recorded, not worked around)

**B1 — no clean backward-edge routing.** The frozen renderer has no clean route for child → parent edges in a
`tb` layout: it wraps them around the top and inserts crossing hops. The case forbids reversing endpoints to
suit the layout and requires the spines above the leaves, so view4 carries that geometry. Six fabric variants
were rendered (`v4-a2-spaced`, `v4-a3-blright`, `viewC-fabric-uplinks`, `viewFab-a1-W1`, `viewFab-a2-center`,
plus the adopted `view4-final`); splitting the fabric did **not** remove the wrap routes, so the complete
12-edge view was kept. No renderer, skill, example or rubric file was touched; nothing was built, installed,
committed or sent to a remote host.

## Attempts (kept as evidence, not reused as final output)

| View | Spec attempts | Adopted | Superseded renders |
|---|---|---|---|
| view1 | 2 | short doglegs after empty-slot alignment | `view1-wan-mux-core` (w7E:p3J), `view1-final` (w7E:p3Y) |
| view2 | 3 | `lr`, labels above their own runs | `view2-final` tb (w7E:p49), `view2-a2-wide` (w7E:p4E) |
| view3 | 3 | wide `lr` | `view3-final` tb (w7E:p4M), `view3-a2-lr` (w7E:p4R) |
| view4 | 3 (+3 rejected split variants) | 12-edge `tb` fabric | `view4-a2-spaced`, `view4-a3-blright`, `viewC-fabric-uplinks`, `viewFab-a1-W1`, `viewFab-a2-center` |
| merged WAN+core (explored) | 1 | not used — the two clean views were kept | `viewA-a1-merged-lr` (w7E:p51) |

Attempt specs live in `attempts/`; four earlier candidate final specs were moved to
`attempts/superseded-specs/` together with `attempts/superseded-checks/`.

## Captures and reproducibility

- `scripts/capture.sh <tag> <spec>`: splits your own tab (`--ratio 0.5 --no-focus`), measures `stty size`,
  launches `rataflow-view <spec>; herdr pane close <pane>`, reads visible text + ANSI, presses Tab for the
  selected state, reads a second frame, sends `q`, then writes a hash record to `captures/capture-log.jsonl`.
- Per view: `<tag>-<ts>-header.txt`, `-visible.txt`, `-visible.ansi`, `-selected.txt`, `-selected.ansi`,
  `-frame2.txt`; hashes for all of them plus the spec hash are in `captures/capture-log.jsonl`.
- Cleanup: 25 panes were created and every one closed through the self-closing launch command and a final `q`.
  `herdr pane layout --pane w7E:p20` afterwards lists only `w7E:p20` in tab `w7E:tS`. The captain's tab and raw
  tmux were never used.

## Unmet needs

None for the four delivered views. D1-D4 are renderer limitations, not deleted relationships: all 28 recorded
link pairs, labels and directions are present in the specs and visible in the captures. Animation was requested
off by the source, so the two stored frames per view are static by design.
