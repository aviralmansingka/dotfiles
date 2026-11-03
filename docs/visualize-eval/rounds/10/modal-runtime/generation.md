# modal-runtime — round-10 generation report

Generator: `viz-ds10-7`, model `fireworks/accounts/fireworks/routers/deepseek-flash-latest`.
Candidate skill: `docs/visualize-eval/rounds/10/SKILL.md`, sha256 `9c125679…f77e56d`.
Renderer: `/tmp/visualize-eval/round-10/bin/rataflow-view`, sha256 `db70722b…fb92df8`.
Target: 77×47 @100% natural zoom. Static case: no dots anywhere.

## Step 0 — family

```
family: service-meshes
evidence: modal-runtime is the core with a fan of three callees (modal-worker, Task
          engine, modal-daemon) and the source states an anti-parallel pair on the
          same two boxes: `worker -> runtime` task input + control RPCs and
          `runtime -> worker` events + management RPCs.
```

Tie-breakers: E=8, N=8 (density alone would allow flow-chains) but a chain has one
relation per node while the runtime carries four endpoints, so the fan shape wins;
no bus with disconnected worlds (rules out placement-planes); no addresses or
uncertainty markers (rules out identity-probe-maps); no phase order and no motion
in the source, so lifecycle-machines is out. No secondary recipe is a design driver;
v2's execution/storage tail borrows flow-chain rhythm (single-stage `lr` hops) inside
a mesh view.

## Meaning ledger

| fact | kind | fate |
|---|---|---|
| modal-worker / modal-runtime / Task engine / Container backend / Task container / Filesystem + volumes / Blobnet / modal-daemon | components | drawn (all 8) |
| e1 worker→runtime: task input + control RPCs | relation + verbs | drawn v1 `task in + ctrl gRPC` |
| e2 runtime→worker: events + management RPCs | relation + verbs | drawn v1 `events + mgmt gRPC` |
| e3 runtime→engine: dispatches tasks | relation | drawn v1 `dispatch tasks` |
| e4 engine→backend: starts / manages | relation | drawn v2 `starts/manages` |
| e5 backend→container: runs user process | relation | drawn v2 `user process` |
| e6 engine→filesystem: mounts / snapshots | relation | drawn v2 `mount+snapshot` |
| e7 filesystem→blobnet: image + volume data | relation | drawn v2 `image+volume` |
| e8 runtime→daemon: filesystem HTTP over UDS | relation + protocol | drawn v1 `fs HTTP over UDS` |
| HTTP-over-UDS ≠ worker gRPC (round-09 failure) | seam qualifier | drawn: `gRPC` on e1+e2, `HTTP over UDS` on e8, never shared |
| task orchestration / container backends / storage / worker RPC seams | roles/tiers | drawn as 4 group tags (control, execution, storage, seams) |
| "three worker RPC seams" | unconfirmed count | dropped — excerpts enumerate two worker RPC directions + the daemon HTTP seam; a third is not named, drawing one would invent a link |
| chat-line provenance (line 55, call `call_KfPSNB…`) | provenance | dropped — metadata, recorded in `source_pointers` |

## Relationship audit

| id | from → to | verb / tech | label owner | view |
|---|---|---|---|---|
| e1 | modal-worker → modal-runtime | task input + control RPCs, gRPC | e1 | v1 |
| e2 | modal-runtime → modal-worker | events + mgmt RPCs, gRPC | e2 | v1 |
| e3 | modal-runtime → Task engine | dispatches tasks | e3 | v1 |
| e8 | modal-runtime → modal-daemon | filesystem HTTP over UDS | e8 | v1 |
| e4 | Task engine → Container backend | starts / manages | e4 | v2 |
| e5 | Container backend → Task container | runs user process | e5 | v2 |
| e6 | Task engine → Filesystem + volumes | mounts / snapshots | e6 | v2 |
| e7 | Filesystem + volumes → Blobnet | image + volume data | e7 | v2 |

## Split coverage

| view | direction | nodes | edges |
|---|---|---|---|
| v1 | tb | modal-worker, modal-runtime, Task engine, modal-daemon | e1, e2, e3, e8 |
| v2 | lr | Task engine, Container backend, Task container, Filesystem + volumes, Blobnet | e4, e5, e6, e7 |

Cross-view relation: e3 is drawn in v1 and its target (`Task engine`) is v2's anchor
node. No edge is drawn twice, none is missing: 8/8 nodes and 8/8 edges covered.

## v1 — RPC seam plane (specs/v1-seams.json)

Recipe: mesh — declare the core, order the fan ports, keep the anti-parallel pair in
ONE view as two distinct edges with distinct ports and labels.

Levers and their source facts:
- `layers` rank pins `[[worker],[runtime],[engine,daemon]]` — the source states e1
  `worker -> runtime` (task input), so the worker is the producer rank. Without the
  pin the engine ranks the worker *after* the runtime (the return edge closes the
  cycle) and all four runtime endpoints crowd one rank gap (measured: `v1a1-check-1`
  2 ambiguous label owners; `v1a2-seams-lr` 2 bridges + 1 skipped label).
- `label_slot: true` on all four edges — every seam carries a transport qualifier, so
  every edge needs its own 15–19 character label in a gutter band instead of a rank
  row as tall as the text is wide.
- groups `control{runtime,engine}` and `seams{worker,daemon}` — source separates task
  orchestration from the worker/daemon seam processes. Nothing is drawn around a group.
- `dots: 0` on every edge — the source never shows motion.

Claims (pinned `v1-77x47-frames.txt`, frame 0):
- Pair co-viewed, two edges: e1 leaves the worker's bottom port (36,20), jogs at row
  23 and terminates with a **▼ at (37,24)** on the runtime's top border; e2 leaves the
  runtime's top port (39,24) and terminates with an **▲ at (38,21)** under the
  worker's bottom border. Four distinct ports, two arrowheads, no bidirectional glyph.
- Mid-side attachment: the worker's bottom side spans cols 31–44 and the runtime's top
  side 31–45; the pair takes 36/38 and 37/39, symmetric about the middle cells.
- Fan: runtime bottom ports (37,29)→daemon (arrow at (29,32)) and (39,29)→engine
  (arrow at (46,32)); the labels `fs HTTP over UDS` (row 30, cols 21–36, ending on the
  col-37 route) and `dispatch tasks` (row 29, cols 40–53, starting on the col-39
  route) sit one cell from their own route.
- Static: the three frames in `evidence/v1/v1-frames.txt` are identical; check line
  `0 single-dot routes, 0 periodic routes, 0 violations`.
- Check: `extent=48x20`, `crossings: 0 bridges, 0 touching bends`, `labels: 4/4 placed,
  0 skipped, 0 ambiguous owners`, `layers=3 (4 pinned)`, `pins: 4 pinned, 0 conflicts`.

## v2 — execution + storage plane (specs/v2-exec-storage.json)

Recipe: the mesh fan-order rule applied to the engine (one port to the execution
column, one to the storage column, each lane on its own row), with a flow-chain rhythm
in the tail.

Levers: `lr` (3 single-stage columns; tb stacked both fan labels in one left-hand band
— measured `v2a1-exec-storage`), `label_slot` on all four edges (without it the engine
reserved horizontal label room and the graph grew to 94 cells = overflow, measured
`v2a3-exec-storage-noslot`), groups `control{engine}`, `execution{backend,container}`,
`storage{filesystem,blobnet}`, `dots: 0`.

Claims (pinned `v2-77x47-frames.txt`, frame 0):
- Engine box rows 24–28 cols 9–21; its right side carries two ports at rows 25 and 27,
  symmetric about the middle row 26.
- Fan: (21,25) → elbow (26,23) → arrow into `Container backend`'s left side at
  (27,23); (21,27) → elbow (24,28) → arrow into `Filesystem + volumes`' left side at
  (25,28). Each fan label rides its own lane's row (`starts/manages` row 23,
  `mount+snapshot` row 31).
- Tail: backend right (46,23) → arrow (51,23) into `Task container`; filesystem right
  (47,28) → arrow (55,28) into `Blobnet`.
- Check: `extent=70x11`, `crossings: 0`, `labels: 4/4 placed, 0 skipped, 0 ambiguous`,
  3 identical frames.

## Groups and colour

Four group tags, no drawn boxes: seams = teal family (`38;2;115;206;183` worker,
`38;2;153;219;203` daemon), control = pink family (`38;2;206;115;138` runtime,
`38;2;219;153;170` engine in v1; `38;2;206;115;138` engine in v2), execution = green
(`38;2;115;206;115` / `38;2;153;219;153`), storage = olive (`38;2;183;206;115` /
`38;2;203;219;153`). No family collides; control keeps its identity across views.
Palette corner sits at rows 43–46 while both graphs end at row 36 / row 30, so no
border cell is overwritten in normal or selected state.

## Attempts (full record in `attempts.json`, raws in `attempts-log.jsonl`)

| view | candidate | result |
|---|---|---|
| v1 | `v1a1-seams` tb, no pin | 2 ambiguous label owners → rejected |
| v1 | `v1a2-seams` lr, no pin | 2 bridges, 1 skipped label → rejected |
| v1 | `v1a3-seams` tb + rank pins + label_slot | 0 crossings, 4/4 labels, 0 ambiguous → **shipped** |
| v2 | `v2a1-exec-storage` tb | clean check but both fan labels in one band → rejected |
| v2 | `v2a2-exec-storage-lr` lr | 0 crossings, labels on their own rows → **shipped** |
| v2 | `v2a3-exec-storage-noslot` lr, no slots | extent 94 wide → overflows 77 → rejected |

Abandoned shapes (all recorded, none hidden): merged 8-node single view (tb; 62×74,
2 ambiguous owners), same with slots everywhere (62×30, still 2 ambiguous), two-node
pair view lr bare (1 ambiguous — the first label lands exactly between two lanes two
rows apart), two-node pair view lr + slots (both bands reserved below both lanes),
two-node pair view tb with `minlen: 2` (1 label skipped: no free cell in a 28-cell
extent). Total distinct specs checked: 10; two pinned 77×47 dumps.

## Validator

```
scripts/viz-validate.py …/evidence/v1 --require-select --require-frames \
    --require-records --attempts …/attempts.json      → all checks passed (33 PASS)
scripts/viz-validate.py …/evidence/v2 …               → all checks passed (33 PASS)
```

Full output kept in `validator-v1.txt`, `validator-v2.txt`. No failing check.
`viewport_matches_target` passes through the pinned 77×47 dump of each view's FINAL
spec; the live panes measured `82x51 @100%` (84×53 pane minus the 1-cell Herdr border).

## Known defects

1. **v1 pair labels share one gutter band.** The capture (frame 0, rows 21–22, cols
   40–58) puts `task in + ctrl gRPC` on the row of e2's arrowhead and `events + mgmt
   gRPC` one row below; e1's own lane is the column at (36,21)–(36,22). By cell
   distance the first label is nearer e2's lane, so adjacency-based reading swaps the
   two directions. `--check` reports 0 ambiguous owners because `label_slot` reserves
   each label's band. Five measured layouts failed to separate the two lanes (see
   abandoned shapes and v1's three candidates); with the lanes two cells apart and box
   borders on the only free rows, the frozen engine has no side to separate on, and
   v1's attempt budget was spent on the shipped layout. Direction stays provable
   structurally from the two arrowheads at (37,24) and (38,21).
2. **v2 `user process` sits between two lanes** (frame 0 row 26, cols 43–54): 3 rows
   from its own lane (row 23), 2 from the storage lane (rows 27–28). Removing
   `label_slot` overflows (94 wide), so the reserved band is the only fitting option.
3. **v1 callee sibling order is [modal-daemon, Task engine]**, i.e. group-block order
   (seams before control) rather than the source node-listing order. Rank pins fix rank
   only; the fan is not interleaved with the return edge, which is the recipe's demand.

## Blockers

- `viz-evidence.sh` queries `herdr pane layout` without `--current`, so `pane_rect` /
  `pane_cols` are null in both manifests; the app's own header token `82x51 @100%` plus
  a separately measured live rect (84×53 pane → 82×51 content) cover the measurement.
  Not edited: `scripts/` is out of scope for this case.
- The first v1 capture run recorded only the echoed command (the harness matches
  `rataflow-view` against the command echo and then waits 1 s, shorter than the app's
  cold start). That bundle was deleted and re-captured warm; the shipped bundle's text
  capture starts with ` rataflow-view · 82x51 @100% …`.

## Cleanup

Both evidence panes closed and verified (`cleanup: confirmed_closed` in each manifest;
`w7E:pRC`, `w7E:pRF`). Two manual probe panes I opened for measurement (`w7E:pR9`) were
q-quit and closed, verified absent with `herdr pane get`. My tab now holds only my own
pane. No other panes touched.
