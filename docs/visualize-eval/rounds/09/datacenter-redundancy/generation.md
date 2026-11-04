# datacenter-redundancy — round 09 generation

Generator `viz-ds09-5`, model `fireworks/accounts/fireworks/routers/deepseek-flash-latest`.
Candidate skill `docs/visualize-eval/rounds/09/SKILL.md`
(sha256 `ba2878c5194cd6fc4bc1af5299a156064130de9be1b0ccf4c6eeb0236d431381`).
Renderer `/tmp/visualize-eval/round-09/bin/rataflow-view`
(sha256 `405a61a674a7cc6271ae1276794eb270c9425dfc38585f4cbb1c48e9b6db495b`), absolute path in
every command and every recorded spec.

No judges, no subagents, no renderer/skill/rubric edits, no commits, no installs, no cargo.

## Step 0 — family

```
family: redundant-fabrics
evidence: every one of the 28 links over 18 devices is a tier-to-tier cross-connect
          where each lower target takes a double arrowhead (2 ISPs per MUX, 2 MUXes x
          2 cores, 2 cores x 2 firewalls, 2 firewalls x 2 border leaves, 2 border
          leaves x 2 spines, 2 spines x 2 rack leaves, 2 rack leaves x 2 racks) and
          the source says "remove the dots flowing for now" — densest family,
          double-arrowhead targets, dots forbidden.
```

Tie-breakers considered, in the skill's order:

1. **Density over depth** — `N = 18`, `E = 28`, so not a chain despite the 7 tiers.
2. **A bus with disconnected worlds?** No: the graph is one connected fabric and the
   source forbids merging links into a bus, so not placement-planes; no trunk is drawn.
3. **Identifier content** — 18 device names, no addresses/ports/AS numbers and only the
   `active`/`standby` qualifier, so not an identity-probe-map.
4. **Motion** — the source removed dots (line 134), dot-free plus dense = fabric, not a
   lifecycle machine.
5. **service-meshes** rejected as the *family*: there is no anti-parallel pair, only
   independent parallel links in the same direction. The mesh principle "never one
   bidirectional arrow" is applied as the **secondary rule** (source line 270).

## Views and coverage

| view | carries | nodes | edges | extent | crossings | ambiguous owners | validator |
|---|---|---|---|---|---|---|---|
| v1 uplink | ISPs → MUXes → cores; e1–e8 | 8 | 8 | 65×19 | 1 bridge | 0 | exit 0, all checks pass |
| v2 edge + firewall | cores → FW1 active / FW2 standby → border leaves; e9–e16 | 6 | 8 | 32×34 | 2 bridges | 0 | exit 0, all checks pass |
| v3 fabric tiers | spines above the co-level border-leaf/rack-leaf row, racks below; e17–e28 | 8 | 12 | 52×32 | 15 bridges | 3 | exit 1 — 2 ambiguous-owner checks fail |
| v4 fabric detail | spines above rack leaves above racks; e21–e28 again as the readable slice | 6 | 8 | 74×11 | 2 bridges | 1 | exit 1 — 2 ambiguous-owner checks fail |

All 28 source links are covered exactly once (e21–e28 appear twice: once in the complete
fabric view v3, once as the readable detail view v4 — duplication, never a substitution).

## Meaning ledger (fate of every source fact)

| fact | kind | fate | where |
|---|---|---|---|
| ISP A/B/C/D | identifier | drawn — four separate nodes, never folded into MUX labels | v1 |
| MUX 1/2, Core 1/2 | identifier | drawn | v1, v2 |
| FW1 active / FW2 standby | role qualifier | drawn as node names (source's own) plus edge qualifiers | v2 |
| BL 1/2, Spine 1/2, Leaf 1/2, Rack 1/2 | identifier | drawn | v2/v3/v4 |
| 4 ISP→MUX links | link, unlabeled | drawn unlabeled — source states no protocol, inventing one is forbidden | v1 |
| 4 MUX→core cross-connects | link | drawn as `x-connect` | v1 |
| 4 core→fw, 4 fw→bl | link + active/standby | drawn | v2 |
| 4 bl→spine, 4 spine→leaf | link + `ECMP` | drawn | v3, v4 |
| 4 leaf→rack | link + `dual` | drawn | v3, v4 |
| "remove the dots flowing" (line 134) | user constraint | drawn as absence — `dots: 0` on all 28 edges, 5 static frames per view | all views |
| "don't merge core1/core2 or mux1/mux2 arrows" (line 270) | user constraint | drawn — no trunk, no bidirectional arrow, every link its own route and arrowhead | all views |
| "border leaf and leaf same height, spine above the leaf" (line 248) | user constraint | drawn via `layers` pins | v3 |
| "compact, readable at default zoom" (150/158/166) | user constraint | drawn — every view fits 77×47 at 100% | all views |
| historical chat commands, credentials, host access | out of scope | dropped with reason — the brief restricts this case to the excerpts | — |

Abbreviations: `MUX 1/2` (MUX appliance), `BL 1/2` (border leaf — the source's own node
names), `x-connect` (cross-connect), `FW1 active / FW2 standby` (firewall appliance,
source's own names). `ECMP`, `dual`, `active`, `standby` are unchanged relation names.

## Relationship audit

| id | from → to | verb/tech | label owner | view |
|---|---|---|---|---|
| e1 | ispA → mux1 | unlabeled (no protocol stated) | none | v1 |
| e2 | ispB → mux1 | unlabeled | none | v1 |
| e3 | ispC → mux2 | unlabeled | none | v1 |
| e4 | ispD → mux2 | unlabeled | none | v1 |
| e5–e8 | mux1/mux2 → core1/core2 | x-connect | own id, each | v1 |
| e9, e10 | core1/core2 → fw1 | active | own id | v2 |
| e11, e12 | core1/core2 → fw2 | standby | own id | v2 |
| e13, e14 | fw1 → bl1/bl2 | active | own id | v2 |
| e15, e16 | fw2 → bl1/bl2 | standby | own id | v2 |
| e17–e20 | bl1/bl2 → sp1/sp2 | ECMP | own id | v3 |
| e21–e24 | sp1/sp2 → leaf1/leaf2 | ECMP | own id | v3, v4 |
| e25–e28 | leaf1/leaf2 → rack1/rack2 | dual | own id | v3, v4 |

Arrow convention: arrows keep the source's stated orientation (from = the tier nearer the
ISP side). These are physical links, not one-way traffic, so a link is never reversed to
make routing easier; a duplicate pair is never merged into one bidirectional arrow.

## Levers, with the source fact that justifies each

| view | lever | value | source fact |
|---|---|---|---|
| v1 | `groups` | isp(4), mux(2), core(2) | source names the tiers; hue + stable sibling order, nothing drawn around members |
| v1 | `minlen` | 3 on the four labeled mux→core lanes | line 270 — independent, non-overlapping arrows |
| v1 | `direction` | `lr` | three tiers deep reads left-to-right |
| v2 | `groups` | core(2), firewall(2), border-leaf(2) | source names these tiers |
| v2 | `minlen` | 2 on all eight labeled edges | repeated `active`/`standby` strings need their own corridor cells |
| v3 | `layers` | `[[sp1,sp2],[bl1,bl2,leaf1,leaf2],[rack1,rack2]]`, 8 pinned / 0 conflicts | line 248 + fixed constraint: border leaves and rack leaves on one level, both spines above |
| v3 | `trunks` | none (deliberate) | line 270 forbids a shared bus |
| v3, v4 | `dots` | `0` on all edges | line 134 — dots removed; the request wins everywhere |
| v4 | `minlen` | 3 (ECMP) / 2 (dual) | parallel lanes stay independent, each label owns its cell |
| v4 | `groups` | spine(2), rack-leaf(2), rack(2) | same hue families as v3 so both views read as one case |

`label_slot` was preflighted and rejected: on a 2-node fan it produced
`no obstacle-safe route` (`probe-capability`), and under `minlen` it skipped a label
(`probe-minlen-slot`). Labels here are ≤9 characters, so the gutter band bought nothing.

## Recipe yields (evidenced, not assumed)

1. **Zero-bridge 2×2 cross-connect.** `probe-k22` (isolated mux1/mux2 → core1/core2,
  `minlen: 5`) still prints `crossings: 1 bridges, 1 touching bends`. v1-a1 (tb) and
  v1-a2 (lr) both report 1 bridge; v2 reports 2 (one per fan); v4 reports 2. A bridge-free
  fan is unavailable from this router, so the bridge stays and is reported. Splitting a
  fan across views cannot remove it — the isolated probe proves it. No relation or label
  was dropped to hide it.
2. **Spines above the co-level leaf row with clean arrows.** v3-a1 (pins + `minlen`):
   `pins: 8 pinned, 8 conflict(s)`, 15 bridges, 3 ambiguous owners. v3-a2 (pins, no
   `minlen`): 0 pin conflicts, 15 bridges, 3 ambiguous owners. v3-a3 (drops the racks):
   14 bridges, 2 ambiguous owners — not worth the loss, so v3-a2 ships. The residual cost
   is the renderer walking the backward bl→spine links around the outer rails. v4 is the
   readable detail view of the same leaf/spine/rack links (2 bridges).
3. **Zero ambiguous owners in the fabric views.** Not reached within the three-attempt
   budget per view: v3 → 3, v4 → 1 (v4-a1 2 + 8 pins-conflict, v4-a2 2, v4-a3 1). A 2×2
   fan puts one-cell corridors side by side, so a short label can be equidistant from two
   of them, and `minlen` cannot grow under a pinned rank. Reported as defects.

## Defects and blockers

* v1: 1 bridge — the two diagonal mux→core lanes cross once at frame row 23, col 55 of
  `evidence/v1/v1-pinned-77x47.txt`.
* v2: 2 bridges — row 19 col 32 (core→fw) and row 34 col 34 (fw→bl).
* v3: **15 bridges and 3 ambiguous label owners**; `check.txt` carries the ambiguous-owner
  warning. Backward bl→spine links are routed around the outer rails (left col 22–24,
  right col 56–58), crossing the forward spine→leaf lanes.
* v3: the engine re-orders nodes inside a pinned rank, so Leaf 1/Leaf 2 render left of
  BL 1/BL 2. Rank membership — the actual constraint — holds: all four sit on rows 24–27.
* v4: 1 ambiguous label owner; 2 bridges; extent 74×11 leaves little right margin.
* Blockers (renderer): no backward-edge lane inside a pinned rank; `minlen` cannot exceed
  a pinned rank gap; `label_slot` unusable on these fans; zero-bridge 2×2 unavailable.

## Evidence and commands

Each view, one attempt each (all probes and rejected drafts are wrapped):

```sh
BIN=/tmp/visualize-eval/round-09/bin/rataflow-view
scripts/viz-evidence.sh record --to docs/visualize-eval/rounds/09/datacenter-redundancy/attempts-log.jsonl \
    --label v1-a3 -- "$BIN" --check .../views/attempts/v1-a3.json
scripts/viz-evidence.sh --spec .../views/v1.json --bin "$BIN" \
    --out .../evidence/v1 --label v1 --frames 5
COLUMNS=77 LINES=47 "$BIN" --frames 3 .../views/v1.json \
    > .../evidence/v1/v1-pinned-77x47.txt
scripts/viz-validate.py .../evidence/v1 --require-select --require-frames \
    --require-records --attempts .../attempts.json
```

* The pane in this worktree's tab measures **82×51** (tab 168×53 halved, minus the pane
  border); that token is in every bundle's `manifest.json`. Each bundle also carries a
  pinned `COLUMNS=77 LINES=47` dump of **that view's final spec** with
  `viewport: 77x47 zoom: 1.00 natural` and no overflow banner, which is the accepted fit
  proof at the target size.
* Records: `attempts-log.jsonl` — 4 capability probes + 11 view attempts, each with the
  executed command, binary sha256 and raw stdout/stderr hashes. `attempts.json` lists the
  same attempts per view (v1 3, v2 2, v3 3, v4 3) — within the 4-view / 3-attempt budget.
* Final specs are byte-identical copies of the shipped attempts (`v1` = a3, `v2` = a2,
  `v3` = a2, `v4` = a3); sha256s match those recorded in the log.
* Cleanup: 4 panes opened, all `confirmed_closed` in their manifests; `herdr pane layout`
  afterwards shows only this session's own pane. No cleanup failures.

## Validator result

v1 and v2: exit 0, all checks pass. v3 and v4: exit 1, failing only
`check_warnings_absent` and `labels_ownership_clear` (3 and 1 ambiguous label owners);
every other check passes. Full output per view is in `evidence/<view>/validator.txt` and
embedded in `generation.json`. This sample is **not** claimed green and was not
independently reviewed — the captain starts the terra judge separately.
