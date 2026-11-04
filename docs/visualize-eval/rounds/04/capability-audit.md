# Round 04 capability audit — renderer baseline

Frozen binary: `/tmp/visualize-eval/round-04/bin/rataflow-view`
Binary sha256: `0da16d8d8ed46e2a…` (full value in `config.json`)
Renderer source: `/tmp/visualize-eval/round-04/renderer-source`
Source digest: `3e7551947bb4ba00…` (formula in `metadata.json`)
Candidate skill: `SKILL.md` sha256 `ac431c6d3035e466…` (proposal 05)
Rubric: `rubric.json` sha256 `18412615f82841b3…` — revision 5 (constant-speed
default, dots-as-flair, route economy, pane-proof rules).
Dataset: unchanged; all 24 case-file hashes identical to rounds 02–03.

## What changed against the round-03 binary

- **Two motion modes, constant default.** `flow: true` animates at
  `DEFAULT_FLOW_RATE = 0.5` cells per 100 ms step (the rate the round-03
  examples were tuned at). `flow: <n>` keeps its legacy constant-rate meaning.
  `timing: "same-arrival"` + `flow: true` + `duration_ms` (default 2000)
  is the opt-in synchronized mode. `duration_ms` is now valid ONLY with
  same-arrival timing and `flow: true` — this intentionally breaks round-03
  specs that used `duration_ms` alone; the break is documented in `USAGE`.
- **Origin at the first drawn glyph.** `dot_cells` always starts on the
  cell after the source port, corner glyph included (round 03 skipped
  corners, so tb routes with side ports started one cell late — the defect
  behind 6/6, 7/7, 20/20 origin failures). Corpus scan of 266 specs:
  `origins_ok == origins_total` everywhere.
- **Visible arrival.** In same-arrival mode the dot is drawn on the cell
  touching the arrowhead on the final step (`●▶`), one frame showing every
  route's dot at its own head. New `arrivals: N/N` check line.
- **Route economy.** Detour = length > shortest bridge-free A* + 3; a
  shortening pass (up to 4 rounds of length-first re-search, accepted only on
  strict improvement) removes loops and hairpins. Root cause fixed on the
  way: `Grid::claim` double-counted bends, which inflated occupancy and
  blocked shortening. Measured: datacenter v2 e7 13→9 and hairpin gone,
  crossings 4→2; datacenter v3 e7 37→33, crossings 9→7; two-tier-fan e8
  84→66; gb300 v1 e3 60→58; detours 1→0 on all of these.
- **Single split-point trunk.** One junction cell serves the corridor and up
  to two branches (a 4-sided cell has only four arms); trunks with more
  branches keep per-branch taps and report the honest junction count. gb300's
  2-branch + `to` trunk now draws a single `┼` splitting three ways.
- **Dashed through bends.** Dashed routes no longer draw solid elbows;
  pinned by test.
- **Truthful crossings.** Old metric counted junction taps as crossings
  (gb300's "3" = 1 bridge + 2 taps). New line: `crossings: <n> bridges,
  <m> touching bends`, both asserted against the glyphs on the canvas.
- **Ambiguous owners.** Labels prefer an anchor whose nearest route is
  their own edge; `labels:` gains `u ambiguous owners` and a warning names
  them. On the current corpus `u` is reported, not silently repositioned.
- **Tests:** 73 → 84 (38 lib + 5 cli + 41 render); Clippy, fmt, release
  build all clean; `scripts/test-rataflow.py` 9/9 with `timing` mirrored.
  Harness: validator parses the new dots/labels/routes/arrivals/crossings
  lines; aggregator cross-checks every spec-manifest hash (gb300 lesson).

## Frozen-binary `--check` (verbatim, gb300 round-03 spec re-checked)

```
crossings: 2 bridges, 1 touching bends
labels: 6/6 placed, 0 on route cells, 0 skipped, 2 ambiguous owners
trunks: oobdrop from oob to pwr, 2 branches, 1 junction(s)
routes: 5/5 near-minimal, 0 detours, 1 shortened
dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 constant at 0.5c/step, 0 same-arrival at 2000ms
origins: 0/0 routes start at their arrow origin
arrivals: 0/0 same-arrival routes show their dot at the arrowhead on the final step
```

Note: the round-03 gb300 spec's dots line reads 0 everywhere because its
edges carry no `flow` — re-checked under the round-04 binary it stays a
valid static rendering with honest reporting.

## Honest limits

- A trunk with 3+ branches plus a separate `to` cannot share one junction
  (4 arms per cell); those keep per-branch taps and report the count.
- Ambiguous-owner placement is a no-op on the current corpus: the squeezed
  labels there have no unambiguous anchor within the candidate set, so the
  count is reported rather than hidden; generators must change layout or
  split to reach `0 ambiguous owners`.
- The live pane's fixed 100 % fit remains out of scope; only the
  measurement canvas gained a margin (a route wrapping outside the bounding
  box was clipped in headless measurement).
- Round-03 specs using `duration_ms` without `timing: "same-arrival"`
  are now rejected by design; round-04 generation writes the new shape.
