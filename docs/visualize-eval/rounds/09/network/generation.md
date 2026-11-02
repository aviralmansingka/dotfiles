# network — round 09 generation (viz-ds09-2)

- case: `network`, round `09`
- generator: `viz-ds09-2`, model `fireworks/accounts/fireworks/routers/deepseek-flash-latest`
- renderer: `/tmp/visualize-eval/round-09/bin/rataflow-view` sha256 `405a61a674a7cc6271ae1276794eb270c9425dfc38585f4cbb1c48e9b6db495b`
- candidate skill: `docs/visualize-eval/rounds/09/SKILL.md` sha256 `ba2878c5194cd6fc4bc1af5299a156064130de9be1b0ccf4c6eeb0236d431381`
- source read: `docs/visualize-eval/cases/network/source.md` only
- views: **1** (v1); spec candidates: **3** (budget 3); no judges, no subagents, no cargo, no commits

## Step 0 — family

```
family: service-meshes
evidence: core switch fans 2 edges to neighbours (core->web 10 GbE, core->cache 25 GbE) and two
          separate relations converge on the cache tier (core->cache 25 GbE, web->cache session)
          and on the DB tier (web->db queries, cache->db fill), which the source's fixed
          constraint requires kept separate.
```

Tie-breakers considered: E=7 > N=6 so not a flow-chain; no disconnected worlds and no
source-named bus so not placement-planes; no addresses/ports/qualifiers so not an identity map;
no double-arrowhead targets and the source asks for live dots so not a fabric; no wide fan out of
one state and no phase order so not a lifecycle. The skill's family table also names `network` as
a service-mesh case.

Paired-relation note: this source has no true anti-parallel pair. Its paired relations are
inbound pairs — cache receives `core->cache` + `web->cache`, db receives `web->db` +
`cache->db`. Both pairs are two distinct edges with distinct labels and distinct ports in the
single view; nothing is merged into one bidirectional arrow. No recipe yield was needed.

Secondary recipe: none.

## Meaning ledger

| fact | kind | fate |
|---|---|---|
| `wan` = WAN | role | drawn, box r1-4 c36-40 |
| `fw` = Firewall | role | drawn, r9-12 c33-42 |
| `core` = Core switch | role | drawn, r17-20 c32-44 |
| `web` = Web tier | role/tier | drawn, r25-28 c31-40 |
| `cache` = Redis | role/residency | drawn (label kept as `Redis`), r34-37 c37-43 |
| `db` = DB tier | role/tier | drawn, r42-45 c34-42 |
| wan→fw 1 GbE | speed/tech | drawn, label r5 c40-44 |
| fw→core 10 GbE | speed/tech | drawn, label r13 c40-45 |
| core→web 10 GbE | speed/tech | drawn, label r21 c40-45 |
| core→cache 25 GbE | speed/tech | drawn, label r22 c40-45 |
| web→cache `session` | application relation | drawn, label r29 c38-44 |
| web→db `queries` | application relation | drawn, label r30 c38-44 |
| cache→db `fill` | application relation | drawn, label r38 c42-45 |
| live dots, direction = traffic flow (line 5) | motion | drawn, 7 routes `flow: true` + `dots: 1` |
| dot speed represents the indicated speed (line 5 wish) | qualifier | drawn as a qualified subset: all routes share the single constant 0.5 c/step rate — the fixed constraint "do not imply motion speed is a measurement" wins |
| same box background, no background dots | style | drawn by theme (all boxes `48;2;40;40;40`, no dot field) |
| gruvbox scheme | style | drawn (`theme: gruvbox`, palette corner r40-45 c1-9) |
| even-split pane request (line 48) | pane setting | **dropped** — not a graph fact; harness splits at `--ratio 0.5` |
| keep core→cache and web→cache separate | constraint | drawn, two arrowheads on Redis top: (33,40) and (33,38) |
| keep 1/10/25 GbE visible, no motion-speed implication | constraint | drawn, three speed labels + one shared dot rate |

Row coordinates are `pinned/v1-77x47.txt` frame 0 (0-based; row 0 is the app header).

## Relationship audit

| id | from → to | verb / tech | label owner | visible in v1 |
|---|---|---|---|---|
| e1 | wan → fw | 1 GbE | e1 | origin (5,37) → head (8,34) |
| e2 | fw → core | 10 GbE | e2 | origin (13,34) → head (16,33) |
| e3 | core → web | 10 GbE | e3 | origin (21,33) → head (24,32) |
| e4 | core → cache | 25 GbE | e4 | origin (21,35), lane c46 r24-31 → head (33,40) |
| e5 | web → cache | session | e5 | origin (29,32) → head (33,38) |
| e6 | web → db | queries | e6 | origin (29,34), column c34 r30-39 → head (41,35) |
| e7 | cache → db | fill | e7 | origin (38,38) → head (41,37) |

Coverage map: v1 carries all 6 nodes, all 7 edges, all 7 labels, all three speed classes, both
paired inbound relations and motion on every route. 7 of 7 source relationships mapped; none
unmapped. Label ownership is 1:1 and reads `0 ambiguous owners`. e2 and e3 share the text
`10 GbE` because the source states both links at 10 GbE; each label sits in its own gutter
(r13 and r21), so no reader can pair them wrongly.

## Structural levers (each with its source fact)

| lever | used | source fact |
|---|---|---|
| `groups` | `edge` {wan,fw}, `fabric` {core}, `app` {web}, `data` {cache,db} | the source names WAN, Firewall, Core switch, web tier, Redis, DB tier itself; groups are logical tags only — no box, border or title is drawn around members |
| `layers` (rank pins) | **not used** | the source's own order is already the longest-path rank order (wan, fw, core, web, cache, db); pinning adds no information and costs extent |
| `minlen` | **not used** | no source-stated corridor; extra gap only inflates extent past 47 rows |
| `trunks` | **not used** | the source states independent physical links with their own speeds plus application relations, not one shared bus; a trunk would fake a shared corridor. `check.txt` prints an empty `trunks:` line |
| `label_slot` | on all 7 labeled edges | labels are the link speeds / application relations and must stay beside their own route; with rank-gap slots only, the same spec measured 29x67 (attempt 2), over the 47-row target; with gutters it measures 27x45 with 7/7 placed and 0 ambiguous owners |

## Motion

`flow: true` + `dots: 1` on all 7 edges — the constant default 0.5 cells/100 ms step (slowest
available) and exactly one dot per route (sparse), which is what the Task asks for. No numeric
rate and no same-arrival timing: the source gives no rate, and the fixed constraint forbids
implying that motion speed measures the link speed. Speeds stay in the labels only.

Proof: `origins: 7/7` in `check.txt`; frame 0 of `pinned/v1-77x47.txt` shows every dot on the
first drawn cell after its own source port (listed in the audit table); frames 0 → 2 → 4 show
every dot advancing exactly one cell per two 100 ms steps (0.5 c/step), long routes simply taking
longer.

## Attempts (≤3 spec candidates, one view)

| # | spec | extent | crossings | ambiguous owners | verdict |
|---|---|---|---|---|---|
| 1 | `specs/v1-attempt1-lr.json` | 110x8 | 1 bridge | 1 | rejected: 6 rank columns overflow 77 cols |
| 2 | `specs/v1-attempt2-tb.json` | 29x67 | 1 bridge | 0 | rejected: rank-gap label slots overflow 47 rows |
| 3 | `specs/v1.json` (tb + `label_slot` on all edges) | **27x45** | 1 bridge | **0** | **shipped** |

Every candidate ran through `scripts/viz-evidence.sh record --to attempts-log.jsonl`; the final
spec's bytes were checked twice more (harness check + pinned dump) and count as one candidate.

## Evidence

| artifact | path |
|---|---|
| spec (final) | `specs/v1.json` |
| check | `evidence/v1/check.txt` |
| visible text | `evidence/v1/v1-text.txt` (pane header `82x51 @100%`) |
| ANSI | `evidence/v1/v1-ansi.ansi` |
| selected ANSI | `evidence/v1/v1-selected.ansi` |
| frames (pane) | `evidence/v1/v1-frames.txt` (frames 2-20, 19 timestamped) |
| frames (pinned 77x47) | `pinned/v1-77x47.txt` (frames 0-20, `viewport: 77x47 zoom: 1.00 natural`, no overflow banner) |
| manifest | `evidence/v1/manifest.json` (`cleanup: confirmed_closed`, pane `w7E:pNM`) |
| attempts | `attempts.json`, `attempts-log.jsonl` |
| validator | `validator-v1.txt` — **all checks passed** |

## Known defects

1. **One crossing bridge** (`crossings: 1 bridges, 0 touching bends`). The bridge glyph sits at
   (32,34) in `pinned/v1-77x47.txt` frame 0 (pane copy: `evidence/v1/v1-text.txt` row 34). Both
   routes leave Web tier's bottom edge, so `session` jogging right to Redis's top port crosses
   `queries` continuing down beside Redis. Traceability is intact (distinct arrowheads at
   (33,38) and (33,40)); every candidate at this depth measured exactly 1 bridge, and removing it
   would need a port-order change beyond the 3-candidate budget or a forbidden relation reorder.
2. **Group hue collision**: `fabric` (Core switch) and `app` (Web tier) both render teal
   `38;2;125;174;163` (`evidence/v1/v1-ansi.ansi` rows 19-20 vs 27-28), while `edge` renders blue
   and `data` renders pink — four declared groups, three hue families. The hue is derived by the
   engine from the group name; no spec lever re-assigns it and the view's budget is spent. Tier
   identity stays readable because the tier names are in the node labels.
3. **Pane frames lost frames 0-1** to scrollback trimming (`v1-frames.txt` starts at frame 2);
   the complete 21-frame dump of the same final spec at the exact target size is
   `pinned/v1-77x47.txt`.
4. **Measured pane 82x51, not 77x47** — my tab's width is not generator-controlled. Fit at the
   target is proven by the pinned direct dump of this view's final spec: `viewport: 77x47 zoom:
   1.00 natural`, no overflow banner.

Blockers: none. No missing renderer capability was hit. The binary emits no `routes:` line
(expected for round 09; not chased).

## Commands (verbatim)

```sh
BIN=/tmp/visualize-eval/round-09/bin/rataflow-view
CASE=docs/visualize-eval/rounds/09/network
COLUMNS=77 LINES=47 "$BIN" --frames 21 "$PWD/$CASE/specs/v1.json"   # wrapped in record, see generation.json
scripts/viz-evidence.sh record --to $CASE/attempts-log.jsonl --label v1-attempt1-lr          -- "$BIN" --check "$PWD/$CASE/specs/v1-attempt1-lr.json"
scripts/viz-evidence.sh record --to $CASE/attempts-log.jsonl --label v1-attempt2-tb          -- "$BIN" --check "$PWD/$CASE/specs/v1-attempt2-tb.json"
scripts/viz-evidence.sh record --to $CASE/attempts-log.jsonl --label v1-attempt3-tb-labelslot -- "$BIN" --check "$PWD/$CASE/specs/v1-attempt3-tb-labelslot.json"
COLUMNS=77 LINES=47 scripts/viz-evidence.sh record --to $CASE/attempts-log.jsonl --label v1-pinned-77x47 -- "$BIN" --frames 21 "$PWD/$CASE/specs/v1.json"
scripts/viz-evidence.sh --spec "$PWD/$CASE/specs/v1.json" --bin "$BIN" --out "$PWD/$CASE/evidence/v1" --label v1 --frames 21
scripts/viz-validate.py $CASE/evidence/v1 --require-select --require-frames --require-records --attempts $CASE/attempts.json
```

## Cleanup

One pane opened (`w7E:pNM`), closed; `herdr pane get w7E:pNM` fails afterwards and
`evidence/v1/manifest.json` records `cleanup: confirmed_closed`. No cleanup failures. The
captain's tab was never touched and no raw tmux was used.
