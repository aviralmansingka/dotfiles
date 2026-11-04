# Blind observation — server-nic-layout, round 09, stage A

Reviewer: openai/gpt-6.1-terra:high. Only final specs, captured text/ANSI/selected/frames, check output and pinned captures were inspected. No expectations, source, manifest, generation record, or attempt records were opened. Coordinates below are 1-based terminal cells in the 82×51 text captures, not file line numbers including any viewport preamble. Label rectangles describe text only; all are one row high. Counts are occurrences across views, not deduplicated entities.

## Spec hashes

- `specs/v1-a3.json`: `f96c220692514e89f75df57bdbceb0f4df62c5f19f0887d3eb6e231618762597`
- `specs/v2-a2.json`: `66bbf524432bfb9080c517b70a825dab2579823800abb7894ce18196843d080f`
- `specs/v3-a3.json`: `ec9c98518985f57a1aa92e189e7dee54ae6fa578e54b4458bcc5acb3283ba62f`

## Visible labels and arrows

### v1 — 4 nodes, 3 routes

Node labels: `7 dark ports` [36,14,12,1]; `server1 .58 R7725` [33,22,17,1]; `eno16595np0 25GbE` [33,30,17,1]; `.57 Arista (OUI) AS132717` [29,38,25,1].

Edge labels: `no link seen` [44,17,12,1]; `only uplink 25GbE` [43,25,17,1]; `.58/29 no NAT/v6 0.1ms` [43,33,22,1].

- `7 dark ports` → `server1 .58 R7725`: dashed vertical from (36,17), turns left at row 19 from x36 to x33, downward filled arrowhead (33,20). `no link seen` sits right of the initial segment. Traceable.
- `server1 .58 R7725` → `eno16595np0 25GbE`: solid vertical at x33, arrowhead (33,28), no horizontal jog. `only uplink 25GbE` sits to its right. Traceable.
- `eno16595np0 25GbE` → `.57 Arista (OUI) AS132717`: solid at x33, turns left along row 35 to x29, downward arrowhead (29,36). Label is right of initial segment. Traceable.

### v2 — 4 nodes, 3 routes

Node labels: `.57 Arista (OUI) AS132717` [30,14,25,1]; `Airtel 14.143.x` [35,22,15,1]; `Airtel backbone 14.141.x` [30,30,24,1]; `Cloudflare 1.1.1.1 AS13335` [29,38,26,1].

Edge labels: `transit 1.8ms` [44,17,13,1]; `7.1 ms` [44,25,6,1]; `8.6 ms` [44,33,6,1].

- `.57 Arista (OUI) AS132717` → `Airtel 14.143.x`: solid, x30 at start, turns right across row 19 to x35, downward arrowhead (35,20); `transit 1.8ms` is to the right of the start. Traceable.
- `Airtel 14.143.x` → `Airtel backbone 14.141.x`: solid, starts x35, turns left on row 27 to x30, arrowhead (30,28); `7.1 ms` at x44 on its start row. Traceable.
- `Airtel backbone 14.141.x` → `Cloudflare 1.1.1.1 AS13335`: solid, starts x30, moves one column left on row 35 to x29, arrowhead (29,36); `8.6 ms` is to its right. Traceable.

### v3 — 3 nodes, 2 routes

Node labels: `server2 103.19.91.59 R7725` [15,22,26,1]; `103.19.91.60-.62 free?` [46,22,22,1]; `.57 Arista (OUI) AS132717` [29,30,25,1].

Edge labels: `same /29` [30,25,8,1]; `no probe reply` [59,25,14,1].

- `server2 103.19.91.59 R7725` → `.57 Arista (OUI) AS132717`: solid at x15 through row 26, turns right on row 27 to x29, downward arrowhead (29,28). Traceable.
- `103.19.91.60-.62 free?` → `.57 Arista (OUI) AS132717`: dashed at x46 through row 26, turns left on row 27 to x31, downward arrowhead (31,28). Traceable, distinct from the solid route; no junction.
- **One visually uncertain owner:** `same /29` lies at x30–37, row 25, between x15 solid and x46 dashed vertical starts. Its nearest route on that row is the dashed route, not its declared solid route. The solid's bend ends at x29 below the label, but this does not unambiguously bind the text. The checker says 0 ambiguous owners; this is a reader-facing disagreement. `no probe reply` is immediately to the right of the dashed side, and is identifiable.

There are no visible route crossings, bridge glyphs, route-to-route touching bends, junctions or apparent branches. In v3 the bends at (29,27) and (31,27) are separated by the empty cell (30,27), and their arrowheads similarly have one empty cell between them. Source/target border contacts are intentional endpoint connections. Each hop is drawn with vertical runs and, where the boxes are offset, a horizontal jog immediately before the arrow; the aligned v1 middle hop is straight. They are individually traceable, but these repeated box-to-box jogs are geometry, not additional devices or links.

## Shape, grouping, and borders

Each of v1 and v2 is a four-node, three-edge downward chain; v3 has two source nodes converging on one target, three nodes and two edges. The maximum outgoing fan width per node is 1; v3 has one node receiving two separate arrowheads. No pair has edges in both directions. Within each view all nodes are connected; across views the repeated Arista label is the visible joining identity, not a drawn cross-pane edge. The layout moves top-to-bottom by hop, not by an explicitly marked time phase. Labels are dense with interface names, IP fragments/full addresses, AS numbers, latency, link state, and uncertainty. The view labels show `7 dark ports`, not seven individual port names.

ANSI node borders are complete: all four sides and four corners on all 11 node occurrences; inspected corners of each box use the same foreground and side segments are continuous, with no group outlines. Group names are logical tags only: no group boxes, borders, or titles. The following RGB values are node border hues; text inside is a separate neutral color:

- `server1` v1: dark (125,160,184), s1 (151,184,206), nic (98,132,156): blue-family shades, in top-down spec order.
- `nxtgen`: gateway (169,182,101), yellow-green in all three views; one member per view.
- `transit` v2: Airtel (169,182,101), backbone (189,201,124), Cloudflare (143,157,79): green-family shades, in top-down spec order. Airtel and the adjacent nxtgen gateway have exactly the same hue, so hue alone does not distinguish those two group memberships.
- `prefix` v3: server2 (231,138,78), spare (241,164,108): orange-family shades, in left-to-right spec order.

No separate source-named tier labels or tier bands are visible; hue is on individual node borders. Group membership cannot be recovered solely from the painting. No rank pins are declared in these final specs. The task also asks what `generation.json` says is pinned, but stage A forbids reading that record; its claims are unavailable. Actual visible ranks are v1/v2 four sequential levels and v3 two top siblings over one bottom node.

Selected ANSI is a single `--select-all` capture per view, not 11 separate individual-selection frames. All 11 node occurrences show complete selected gold RGB (216,166,87) borders simultaneously: coverage 11/11 for selected-border appearance, 0/11 individually isolated selections evidenced. Color continuity is evidenced for selected borders as well.

## Motion, fit, and checker

The 82×51 evidence frames each have five frames at 0, 100, 200, 300, 400 ms. The 51 terminal rows per frame are byte-identical within each view in both text and ANSI; frame header timestamps and trailing shell context are not frame pixels and differ. The five pinned 77×47 frames per view likewise show no changing graph. No flow dots are visible; all specs declare `dots: 0`, and checks report zero routes with dots and zero violations. Dot spacing, origin, corner/head occupancy, direction, and simultaneous arrival are not applicable, not proved for an animated route.

Live evidence headers measure 82×51 at 100%. Each `check.txt` says `viewport: unknown zoom: 1.00 natural`, not 82×51. Pinned captures explicitly state `viewport: 77x47 zoom: 1.00 natural`; all boxes, labels, arrows and controls fit without clipping in the captured 77×47 frame. There is no observed pan or zoom requirement in either size. The checks report extents 49×28, 41×28, 60×12 respectively, `crossings: 0 bridges, 0 touching bends` in all three, and 3/3, 3/3, 2/2 labels placed with 0 on route cells and 0 skipped. Own route-coordinate inspection agrees on crossings, not on one v3 label owner. Absence of a `routes:` line is expected.

## Disclosures and evidence limits

The task briefing supplies a generator disclosure of 8.6 ms drawn versus 8.3 ms in a fact list, and mentions a cross-view /29 key. In these captures `8.6 ms` is visible and `.58/29` and `same /29` appear in different views; neither the 8.3 ms fact list nor an explicit full cross-view key is in the inspected final specs or captures. This is recorded neutrally, without choosing which number is correct.

The briefing paraphrases a classification line as `family: identity-probe-maps`, E=N with omission the risk and tie-breakers listed. The complete verbatim classification/evidence line and its exact location cannot be established from the permitted files inspected; `generation.json` and recorded material were not opened under the stage-A-only instruction. No claim is made that this paraphrase is a verbatim quotation. Likewise generator-declared rank pins are unavailable. No evidence format was unreadable; captures and ANSI were readable. Draft captures and other candidate specs were not needed to characterize final views and were not inspected.

## Blind scorecard

| Measure | v1 | v2 | v3 | Total |
|---|---:|---:|---:|---:|
| Node occurrences | 4 | 4 | 3 | 11 |
| Edges | 3 | 3 | 2 | 8 |
| Node + edge labels | 7 | 7 | 5 | 19 |
| Declared hue families | 2 | 2 | 2 | 4 unique |
| Spec-declared rank pins | 0 | 0 | 0 | 0 (generation record unavailable) |
| Visible crossings / touching bends | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Uncertain edge-label owners, own read | 0 | 0 | 1 | 1 |
| Clipped graph items | 0 | 0 | 0 | 0 |
| Selected appearance / occurrences | 4/4 | 4/4 | 3/3 | 11/11 simultaneous |
| Individual selection frames | 0/4 | 0/4 | 0/3 | 0/11 |
| Dot violations / animated routes | 0/0 | 0/0 | 0/0 | 0/0 |
