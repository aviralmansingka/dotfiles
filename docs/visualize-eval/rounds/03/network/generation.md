# network — round 03 generation report

Generator: DeepSeek (`fireworks/accounts/fireworks/routers/deepseek-flash-latest`), fresh sample, no prior round output read.
Candidate skill `docs/visualize-eval/rounds/03/SKILL.md` sha256 `cf796bcd…b6cc659c`.
Frozen renderer `/tmp/visualize-eval/round-03/bin/rataflow-view` sha256 `b242b6a2…d9ee80f7`.
Target viewport 77x47, natural 100% zoom.

Not green-marked, not independently reviewed. One generator sample; the captain runs the Sol judge.

## Views

| view | carries | spec | extent | crossings | labels | dots | origins | measured pane |
|---|---|---|---|---|---:|---|---|---|---|
| v1 | WAN → Firewall → Core switch → Web tier, plus Core switch → Redis | `specs/v1.json` | 40x32 | 0 | 4/4 | 4 sync @2000ms | 4/4 | 77x47 @100% |
| v2 | Web tier → Redis (session), Web tier → DB tier (queries), Redis → DB tier (fill) | `specs/v2.json` | 24x24 | 1 | 3/3 | 3 sync @2000ms | 3/3 | 77x47 @100% |

Coverage map: e1–e4 in v1, e5–e7 in v2. No edge is in neither view, and no edge is merged, reversed or unlabelled.

## Why two views

The whole network needs six layers (wan → fw → core → web → cache → db, forced by `web → cache` and `cache → db`).
At natural zoom that chain measured **40x48 in tb** (one row over the 47-row target) and **144x20 in lr**
(67 columns over 77). Shrinking text, panning, or moving Redis up beside the Web tier would each break the tier
order or the fit rule, so the graph was split along the source's own seam: link speeds (v1) and application
relations (v2), with Redis and the Web tier appearing in both.

## `--check` output (frozen binary)

v1

```
viewport: unknown zoom: 1.00 natural
ok: nodes=5 edges=4 flows=4 direction=tb theme=gruvbox
extent=40x32 cells
crossings: 0
labels: 4/4 placed, 0 on route cells, 0 skipped
groups: edge(2) switching(1) app(1) data(1)
trunks:
dots: 4 single-dot routes, 0 periodic routes, 0 violations, 4 synchronized at 2000ms
origins: 4/4 routes start at their arrow origin
```

v2

```
viewport: unknown zoom: 1.00 natural
ok: nodes=3 edges=3 flows=3 direction=tb theme=gruvbox
extent=24x24 cells
crossings: 1
labels: 3/3 placed, 0 on route cells, 0 skipped
groups: app(1) data(2)
trunks:
dots: 3 single-dot routes, 0 periodic routes, 0 violations, 3 synchronized at 2000ms
origins: 3/3 routes start at their arrow origin
```

No warnings in either view.

## Ledger (21 rows)

Drawn: 6 node roles (WAN, Firewall, Core switch, Web tier, Redis, DB tier); 7 relations with their own labels
(`1 GbE`, `10 GbE`, `10 GbE`, `25 GbE`, `session`, `queries`, `fill`); gruvbox theme; flow direction; slow/sparse
motion; the two fixed constraints.

Dropped with reasons: motion speed as a measurement (forbidden by the case constraints — every route shares one
2000 ms clock, so no dot speed encodes a link speed); box fill / background-dot styling (renderer chrome, no spec
field — inventing one would be a false capability claim); pane split size (a capture concern; the evidence capture
did split at ratio 0.5).

Abbreviated: nothing needed beyond short node ids — every visible label is the source role in full.

## Relationship audit

| id | from → to | verb / tech | label | owner | view |
|---|---|---|---|---|---|
| e1 | wan → fw | 1 GbE uplink | `1 GbE` | e1 | v1 |
| e2 | fw → core | 10 GbE link | `10 GbE` | e2 | v1 |
| e3 | core → web | 10 GbE link | `10 GbE` | e3 | v1 |
| e4 | core → cache | 25 GbE link | `25 GbE` | e4 | v1 |
| e5 | web → cache | session traffic | `session` | e5 | v2 |
| e6 | web → db | queries | `queries` | e6 | v2 |
| e7 | cache → db | fill | `fill` | e7 | v2 |

Two edges carry the string `10 GbE` because the source gives that same speed to both hops; each is its own labelled
edge, not a shared ambiguity.

## Attempts (≤3 per view)

- v1: `v1-a1` tb whole graph 40x48 (fit fail) → `v1-a2` lr whole graph 144x20 (fit fail) → `v1-a3` = final, 40x32, crossings 0.
- v2: `v2-a1` = final, tb 24x24, crossings 1 → `v2-a2` lr 54x15, same single crossing, rejected on width.

Crossings chosen: **v1 = 0, v2 = 1**. The v2 crossing is structural (two routes leave the Web tier toward the same
side, with the Redis → DB link between them); removing it would need a tier reorder or a dropped relation.

## Evidence

- Harness bundles: `evidence/v1/`, `evidence/v2/` — `bin.sha256`, `check.txt`, plain text, ANSI, `--select-all` ANSI,
  `--frames 21` pane capture (frames 1–20), `manifest.json` with per-artifact hashes and `cleanup: confirmed_closed`.
- `frames/v1-direct-frames.txt`, `frames/v2-direct-frames.txt` — frozen binary, `COLUMNS=77 LINES=47 --step-ms 100
  --frames 21`, frames **0–20**: frame 0 puts every dot at its own arrow origin, 2000 ms is the shared arrival.
  (The pane capture loses frame 0 to the pane scrollback window; reproduced twice, not a race.)
- Validator: `validate-v1.txt`, `validate-v2.txt` — both `all checks passed` (26 PASS / 0 FAIL each, including
  `viewport_matches_target`, `origins_complete`, `dots_sync_reported`, `crossings_reported`, `attempts_*` budgets).
  `validate-case-root.txt` records that the case root is not itself a bundle (manifests are per view).

## Remaining defects

1. **v2 `crossings: 1`** — structural, documented above.
2. **No single self-contained graph** — the six-layer chain does not fit 77x47; two views plus the coverage map instead.
3. **Pane capture starts at frame 1** — frame-0 motion origin proven by the direct frozen-binary run instead.
4. **Arrival frame shows no dot** — at 2000 ms each dot is absorbed by its arrowhead glyph (round-03 renderer behaviour).
5. **`manifest.pane_cols` null** — `herdr pane layout` reports only the workspace-focused tab; size is proven by the
   app's own header token `77x47 @100%`.

## Cleanup

Three panes opened by this generator (one geometry probe pair plus the two evidence panes); all closed, both evidence
panes proved `confirmed_closed` by the harness. Pre-existing panes from other sessions were left untouched.
