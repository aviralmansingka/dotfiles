# network — round 10 generation (viz-ds10-2)

Model: `fireworks/accounts/fireworks/routers/deepseek-flash-latest`. No judge was spawned (the
round-10 contract forbids it; the captain runs the terra judge separately).

- Candidate skill: `docs/visualize-eval/rounds/10/SKILL.md` — sha256 `9c1256791069e272…` (the snapshot governs)
- Renderer: `/tmp/visualize-eval/round-10/bin/rataflow-view` — sha256 `db70722b92777467…`
- Target: 77 × 47 at natural 100 % zoom

## Step 0 — classification

```
family: service-meshes
evidence: the core switch fans two links into the application tier (core->web 10 GbE,
          core->cache 25 GbE) and the three application nodes close a triangle
          (web->cache session, web->db queries, cache->db fill) — a fan around a core
          with mesh relations, 7 relations over 6 nodes.
```

Tie-breakers considered: density (7 > 6) rules out flow-chains even though wan→fw→core is a
straight run; no disconnected worlds and no source-named bus, so not placement-planes; no
addresses/ports/qualifiers, so not identity-probe-maps; motion is a signature, not a tie-breaker.
Secondary recipe: flow-chains applies only to the transit hop inside v1 (one node per rank).

The mesh recipe's anti-parallel clause did **not** trigger: all seven source relations are
one-directional. No reverse edge was invented to satisfy the recipe.

## Views (2)

| view | direction | carries | extent | spec |
|---|---|---|---|---|
| v1 | lr | wan, fw, core, web, cache; e1–e4; all three speeds | 75×9 | `specs/v1.json` |
| v2 | tb | core, web, cache, db; e4 (repeated), e5–e7 | 37×29 | `specs/v2.json` |

v1 keeps the whole core fan in one frame (mesh recipe). v2 repeats core→cache next to
web→cache so the fixed constraint — “separate core-to-cache and web-to-cache relations” — is
countable in a single capture.

Levers: `group` = network / app / state (three distinct hue families, verified in ANSI: aqua
≈168°, magenta 300°, orange 30°); `direction` only; no `layers` (the engine's ranking already
produces the source's tiers); no `minlen`; **no trunks** (the source names no bus, and core's two
links carry different speeds); `label_slot` used in v1-1 and dropped in the shipped v1; dots: 1
per route, `flow: true` (constant 0.5 cells/100 ms, the slowest available) because the source asks
for live dots whose speed does *not* encode a measurement.

## Why two views

One view was measured three times and yielded:

| probe | shape | result |
|---|---|---|
| v1-a | lr, no rank pins | extent **100×8** — 23 columns too wide, 1 ambiguous label |
| v1-b | tb, no rank pins | extent **30×57** — 10 rows too tall |
| v1-c | lr + `layers` pinning web+cache to one rank | rejected: *no obstacle-safe route for web -> cache* |

Then the split: v1 (2 of 3 candidates used), v2 (1 of 3 used). Every probe is recorded in
`attempts-log.jsonl`; the three one-view shapes are listed under `abandoned_shapes` in
`attempts.json`.

## Checks

`--check` per shipped view (raw output in `evidence/vN/check.txt`):

```
v1: extent=75x9   crossings: 0 bridges, 0 touching bends
    labels: 4/4 placed, 0 on route cells, 0 skipped, 0 ambiguous owners
    dots: 4 single-dot routes, 0 violations, 4 constant at 0.5c/step
    origins: 4/4    groups: network(3) app(1) state(1)
v2: extent=37x29  crossings: 0 bridges, 0 touching bends
    labels: 4/4 placed, 0 on route cells, 0 skipped, 0 ambiguous owners
    dots: 4 single-dot routes, 0 violations, 4 constant at 0.5c/step
    origins: 4/4    groups: network(1) app(1) state(2)
```

`viz-validate.py … --require-select --require-frames --require-records --attempts attempts.json`
→ **all checks passed** for both bundles (full text in `validator/v1.txt`, `validator/v2.txt`).

Pixel/ANSI evidence (coordinates in `generation.json` → `claims_with_captures`):

- group hues distinct: Redis border `rgb(206,161,115)`, Web tier `rgb(206,115,206)`, network
  borders three aqua shades — no collision (round-09's fabric/app teal clash does not recur).
- no bridges: `0 bridges` plus zero `╬ ═ ╫` glyphs in any capture (round-09's (32,34) bridge is gone).
- mid-side + symmetric fan: core's fan dots on rows 22 and 24 about its middle row 23.
- origins: frame 0 dots sit on the first cell after each source port.
- constant motion: 600 ms advances every dot exactly 3 cells in both views.
- full lap at 77×47: v1 core→cache laps in 22 frames (41 captured); v2 web→db wraps and is 5
  cells into a second lap by frame 60 (61 captured).

## Defects and caveats

1. In-pane frames are truncated by pane scrollback — 19 of 41 (v1) and 19 of 61 (v2) frames in
   `vN-frames.txt`. Full-lap proof uses the pinned 77×47 dumps of the same final specs
   (`v1-frames-77x47.txt` 41 frames, `v2-frames-77x47.txt` 61 frames).
2. The live pane measured **82×51**, not 77×47 (worker tab is 168 columns; the harness splits 50/50).
   Fit at target is proven by the pinned 77×47 dump of each FINAL spec
   (`v1-77x47.txt`, `v2-77x47.txt`, no overflow banner) — the pinned ruling's accepted route.
3. `manifest.pane_cols` is null in both bundles: `herdr pane layout` returned no rect for the
   split pane, so the column count comes from the app's header token, not the pane rect.
   `pane_rows` = 51 came from the pane viewport.
4. v1 is 75 of 77 columns — fits with 2 columns to spare; a pane narrower than 75 columns would
   show the overflow banner.
5. Measured mid-side behaviour: a 4-row box attaches its lone arrowhead at the upper of the two
   middle cells (identical for Redis and Web tier); a 5-row box (Core switch) is exactly centred.
6. v1-1 (rejected draft) had a checker-clean label that a reader could pair with either fan route;
   the shipped v1 places each fan label on its own route's side. This is the round-09
   “visually-uncertain gutter label” failure mode, fixed by default placement rather than by
   editing the checker.

## Cleanup

Panes `w7E:pQQ` (v1) and `w7E:pQR` (v2) closed; both manifests report `confirmed_closed`. The
captain's tab was never used; the pinned dumps run headless and create no pane.

## Files

`specs/` (final v1.json, v2.json + attempts v1-1, v1-2, v2-1, v1-a, v1-b, v1-c), `evidence/v1/`,
`evidence/v2/`, `attempts.json`, `attempts-log.jsonl` (+ `recorded/`), `validator/`,
`generation.json`.
