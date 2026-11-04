# Blind observation — modal-runtime, round 11, stage A

Reviewer: openai/gpt-6.1-terra:high. This is an observation, not a verdict against unseen expectations. I did not read source.md, expected data, rubric, or other cases, and did not run a viewer. Statements about the source below are explicitly generator claims, not independently verified source facts. Coordinates are [column,row,width,height], 1-based in frame 0 of the 77×47 pinned dumps; row 1 is the viewer header. They are not coordinates in the centered 82×51 live-pane captures.

## Spec identity

`shasum -a 256` on final specs:
- v1-seam-pair.json: c6f862668fd62dce263ee5e65a1c9967bc5c42f486dadebc139e2b9f00ff694a
- v2-fan-final.json: 690df5a26d49ba85ea374f16bbd6e6e2b22a3d2f91f7e9487f99333743e42d6f
- v3-compute-final.json: 10f9f9ab32b0d440ee52c13d246287478d4aa15545aab1577136e4dd194ba50c

## Visible content

The following lists all graph labels, not application chrome. Label dimensions exclude the enclosing box. All 10 node occurrences and all 8 relation labels are visible.

**v1** (`evidence/v1/v1-77x47-pinned.stdout`): `modal-runtime` [24,24,13,1]; `modal-worker` [43,24,12,1]; `task input + ctrl RPCs` [29,27,22,1]; `events + mgmt RPCs` [30,28,18,1]. Worker → runtime is the upper horizontal route, left arrowhead ◀ [38,23], traceable between the boxes. Runtime → worker is lower, right arrowhead ▶ [41,25], traceable. Upper and lower routes are separate. Both labels are below both arrows: their ownership is not discernible by proximity alone; the declared upper-to-lower pairing supplies a convention, not a visual connection. Thus 2 uncertain label owners as a visual reading, although check reports 0. The generator identifies these as the two RPC directions and says the source specifies gRPC; the visible text says only RPCs, not gRPC, and abbreviates control and management.

**v2** (`evidence/v2/v2-77x47-pinned.stdout`): `modal-daemon` [50,21,12,1]; `modal-runtime` [16,24,13,1]; `Task engine` [51,26,11,1]; `fs HTTP over UDS` [30,22,16,1]; `dispatches tasks` [31,26,16,1]. Runtime → daemon follows the upper rightward route, bends upward and has ▶ [48,21]; runtime → engine follows the lower rightward route and has ▶ [49,26]. Both continuous, distinct and traceable, with labels adjacent to the respective routes. The daemon is above the engine: generator reports source listing e3 engine before e8 daemon, so this reverses that claimed order; the source listing itself was not inspected. `HTTP over UDS` is visible, with filesystem shortened to `fs`; no visible `gRPC` qualifier supplies the claimed interface contrast.

**v3** (`evidence/v3/v3-77x47-pinned-b.stdout`, not the superseded non-b file): `Task engine` [34,16,11,1]; `Container backend` [18,24,17,1]; `Filesystem + volumes` [40,24,20,1]; `Task container` [26,32,14,1]; `Blobnet` [45,32,7,1]; `mounts / snapshots` [19,19,18,1]; `starts / manages` [22,20,16,1]; `runs user process` [28,28,17,1]; `image + volume data` [51,28,19,1]. Engine → backend follows the left route and ▼ [26,22]; engine → filesystem follows the right route and ▼ [49,22]; backend → container follows the left lower route and ▼ [32,30]; filesystem → Blobnet follows the right lower route and ▼ [48,30]. All four routes are distinct and physically traceable. The two upper labels stack above the separation: `mounts / snapshots` is on row 19, `starts / manages` on row 20, and the two adjacent ports at columns 38 and 40 diverge at row 21; the labels are both left of the ports, so ownership of both is uncertain without the spec/ledger. The lower two labels sit beside their own runs. Generator's ledger maps the upper labels to filesystem and backend respectively, not in left-to-right label order. Check reports 0 ambiguous owners; visually I count 2 uncertain.

Across views the declared mapping is 8 distinct named components and 8 directed relations, with runtime repeated v1/v2 and engine repeated v2/v3. All 8 claimed arrows are visible in the listed direction; all claimed relation words except the source's specifically claimed gRPC technology are at least present verbatim or abbreviated. Full source completeness cannot be independently checked blind.

## Geometry and borders

0 visible route crossings, bridges, touching bends, or junction glyphs in the final views, consistent with all three checks (`0 bridges, 0 touching bends`). v2 is a fan from two separate ports of the runtime box, not a shared junction: upper bends at [47,23] and [47,21], lower bends at [48,25] and [48,26]. v3 has two separate downward engine ports, visually adjacent rather than a shared branch junction: left bends [38,21], [26,21]; right [40,21], [49,21]. Lower left bends [26,29], [32,29]; lower right bends [49,29], [48,29]. v1 routes are straight. No bridge glyph or apparent extra branch observed.

All 10 node occurrences show complete four sides and all four rounded corners. ANSI captures show each whole border in a consistent node hue; routes are muted RGB 124,111,100 and are distinguishable at the ports. Pinned box bounds: v1 runtime [23,22,15,5], worker [42,22,14,5]; v2 runtime [15,22,15,5], daemon [49,20,14,4], engine [50,25,13,4]; v3 engine [33,15,13,4], backend [17,23,19,4], filesystem [39,23,22,4], container [25,31,16,4], Blobnet [44,31,9,4].

## Groups, rank and color

Specs declare groups, not painted enclosing boxes. No group border, title or tier marking is drawn; hues are node-border families, not separately titled source-named tiers. From actual final ANSI (`v1-ansi.ansi`, `v2-ansi.ansi`, `v3-ansi.ansi`):
- agents: worker and daemon RGB 183,206,115 (green).
- control: runtime RGB 206,115,138; engine in v2 RGB 219,153,170, in v3 RGB 206,115,138 (pink family).
- compute: backend RGB 115,161,206; container RGB 153,186,219 (blue family).
- volumes: filesystem RGB 138,115,206; Blobnet RGB 170,153,219 (purple family).

Four distinct final hue families. Each two-member chain group appears in sequential ranks in v3, not as same-rank siblings; ordering is backend before container, filesystem before Blobnet. Control runtime and engine occur left/right in v2. Agents members never co-occur in one frame; no within-rank sibling ordering can be assessed for that group. There are no group boxes.

The generator claims the discarded tag `storage` collides with `agents` in family 1, RGB 183,206,115, and calls this a regression; the final agents ANSI confirms its green, but the retained superseded `v3-77x47-pinned.stdout` is plain text, not ANSI, and no storage-tag ANSI capture was found among the evidence bundles. Therefore storage's alleged collision is not independently verified from ANSI here. Final `volumes` is visibly purple and does not collide with agents.

No final spec declares layers/rank pins; generation.json says none were used. Observed ranks: v1 runtime left, worker right (with arrows in both directions); v2 runtime left, daemon and engine right, daemon above; v3 engine top, backend/filesystem middle, container/Blobnet bottom. No explicit lifecycle phase sequence or tier labels. Rank pins 0; pin correctness not applicable.

## Structural observation

The views have 2/2, 3/2, 5/4 node/edge occurrences; combined by repeated names, 8 distinct nodes and 8 edges. Widest node has 3 distinct outgoing targets across views (runtime → worker, engine, daemon), though its v2 fan shows 2; engine in v3 has 2. One box pair has two opposite directed routes. No node visibly receives arrowheads from two different routes. The three frames are individually connected; their union connects via repeated runtime and engine, not an explicitly drawn bus. There are no identifiers beyond component names and no addresses; labels are fairly dense with action/payload and protocol qualifiers. Ranks in v3 read as a top-down two-hop progression, not explicit phases. The pair/fan is split between views, so the three-target fan is not in a single frame.

## Classification and deviations as stated by the generator

Verbatim, `generation.json` → `step0_classification`:

`family: service-meshes`

`evidence: modal-runtime is the core of a 3-branch RPC fan (worker e1/e2, task engine e3, modal-daemon e8) and the source states an explicit anti-parallel pair between the same two boxes: worker -> runtime "task input + control RPCs" and runtime -> worker "events + management RPCs".`

Generator also calls flow-chains a secondary recipe for the compute/storage tail. Classification is a hint, not a visual requirement. In `generation.json` → `deviations` and `known_defects`, it explains: split pair and fan after measured single-frame placement failures; v2 reversed callees because node declaration order did not change layout and edge-order alternative was untested; pair labels share a gutter because alternative vertical placement skipped both; horizontal layout for v1/v2 because vertical attempts lost or ambiguated labels; `volumes` substitutes for `storage` to avoid the claimed hue collision; engine labels stack above the split; and gRPC was reduced to RPCs. These are generator reasons, not independent proof that no better alternative exists.

## Selection, animation, fit and limitations

`v1-selected.ansi`, `v2-selected.ansi`, `v3-selected.ansi` show all 2+3+5 node occurrences with bold selected-border RGB 216,166,87 simultaneously: 10/10 selected border coverage. The capture is `--select-all`, not 10 separate interactive selection frames; individual-selection behavior is not proved.

Five captured frames per view at 0, 100, 200, 300, 400 ms are static: 0 animated routes, 0 dots per frame, 0 visible dot violations. Spacing, direction, origin, corner/bridge/arrowhead occupancy and same-frame arrival are not applicable, not proven for animated routes. Each check says 0 flows and 0 dot violations.

Checks report extents 44×7, 59×9, 66×20; pinned outputs each say `viewport: 77x47 zoom: 1.00 natural`. Live text/ANSI pane headers say 82×51 @100%. All graph nodes, routes and graph labels are visible with no clipping or pan/zoom requirement in pinned captures. At 77 columns the v3 viewer header itself truncates `q quit` to `q`; this is chrome, not a graph item. Missing `routes:` is expected for this renderer. The superseded storage capture is plain text, so it cannot independently establish the storage border color. No supplied capture format was unreadable.

## Blind scorecard

- Visible graph nodes: v1 2, v2 3, v3 5; 10 occurrences / 8 distinct.
- Visible directed edges: 2 + 2 + 4 = 8.
- Graph labels: 10 node labels + 8 edge labels = 18 occurrences; all 8 edge labels placed, none clipped.
- Groups: 4 final hue families; storage/agents collision asserted but storage ANSI evidence absent.
- Rank pins: 0. Crossings/bridges/touching bends: 0/0/0.
- Uncertain edge-label owners: 4 visually (v1 both, v3 both engine labels); checks report 0.
- Clipped graph items: 0; clipped chrome: v3 pinned header `q quit`.
- Selected-border coverage: 10/10 simultaneous select-all, not separate selection captures.
- Dot violations: 0 observed and reported; 0 animated routes.
