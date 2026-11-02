# Round 03 capability audit — renderer baseline

Frozen binary: `/tmp/visualize-eval/round-03/bin/rataflow-view`
Binary sha256: `b242b6a28e2e27934b06b7a297be638c143e5c99680495e104380cd8d9ee80f7`
Renderer source: `/tmp/visualize-eval/round-03/renderer-source`
Source digest: `8322f542af031ca03d687b523d86e14cb47960600e068be286183466920270fd` (formula recorded in metadata.json)
Candidate skill: `SKILL.md` sha256 `cf796bcdc527897687ec2ca19844f399c921252409b9ca7ad04fbfa1b6cc659c` (proposal 04)
Rubric: `rubric.json` sha256 `545707a79f2bb098a3d1504ccb3095943eb9e6c452c931a50ebcbc9dbf8fcdc3` (revision 3: motion + crossing rules, fireworks generator)

## What changed against the round-02 binary

- **Synchronized motion.** `flow: true` animates on a shared clock: dot index
  `round(i*(n-1)/steps)`, `steps = duration_ms/100`, default `duration_ms`
  2000, phase cycles `steps+1`. Step 0 = first drawn cell after the source
  port; final step = arrowhead cell. Numeric `flow` stays as the documented
  legacy escape hatch (cells per 100 ms step, not synchronized).
  `duration_ms` validates as a positive whole number and rejects combination
  with numeric `flow` or `flow: false`.
- **Dot origin.** The router prefers a straight stem on the first cell after
  the port (fallback pass keeps tight fan-outs routable); `dot_stats`
  independently recomputes the first drawn cell and compares, so `origins:`
  is a real check — a mismatch is also a violation.
- **Arrowhead painted last** — an arriving dot is absorbed by the head glyph
  instead of erasing it; the arrival frame is treated as correct.
- **Crossing-aware routing.** Crossing (bridge) cost 45 -> 150; a two-cell
  detour plus bends (72) now beats one crossing. Port order already followed
  the far endpoint; now pinned by a test.
- **New check lines.** `crossings: N`, extended `dots:` line with
  `synchronized at <ms>ms`, `origins: N/N routes start at their arrow origin`,
  and one warning per too-short route (< 3 dot cells, reported not animated).
- Tests 58 -> 73 (34 lib + 5 cli + 34 render); Clippy, fmt, and the python
  suite (9/9, `duration_ms` added to ALLOWED_EDGE with the same contradiction
  rules) all clean.

## Frozen-binary measurements

| spec | extent | crossings | synchronized | origins |
|---|---|---:|---|---|
| demo-sync.json (tb) | 21x40 | 1 (structural, hotfix spans all layers) | 5 at 2000ms | 5/5 |
| examples/trunk.json | 67x21 | 4 (forced; persist at cost 1000) | 0 (legacy speed) | 2/2 |
| examples/network.json | — | 1 | 0 (legacy speed) | 7/7 |
| examples/pipeline.json | — | 1 | 0 (legacy speed) | 5/5 |
| detour.json (crossing test) | — | 1 -> 0 after cost change | — | — |

`demo-sync.json` is preserved in this round directory; replay with
`$BIN --check` and `$BIN --frames 21 --step-ms 100`.

## Honest limits

- Origin guarantee is preferred-then-fallback: a cramped layout reports
  `m/n` plus a violation instead of refusing to route.
- `duration_ms` alone (no `flow`) also animates a route; the skill tells
  generators to write `flow: true` + `duration_ms` explicitly.
- A synchronized `dots: 1` route shows the head glyph instead of a visible
  dot on the single arrival frame (100 ms of 2000).
- Bundled examples still use legacy numeric `flow`, so they read
  `0 synchronized`; generators write `flow: true` for synchronized cases.
