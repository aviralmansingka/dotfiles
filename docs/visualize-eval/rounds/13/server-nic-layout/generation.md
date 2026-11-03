# server-nic-layout — round 13 generation (viz-ds13-3)

Brief: `docs/visualize-eval/rounds/13/briefs/server-nic-layout.md` (detail-complete framing, "everything, and I'll
navigate"). Source: `docs/visualize-eval/cases/server-nic-layout/source.md`
(`235d296fef435710c8a49bcd247455c8c82b844e71726f146c4cedf227d0308b`).
Frozen binary `/tmp/visualize-eval/round-13/bin/rataflow-view` (`1f28d87d…`), skill proposal 12 (`65d826f0…`),
rubric revision 11.

## Triage (TRIAGE-server-nic-layout)

| id | question | answer | source |
|---|---|---|---|
| 1 | one view, or a canvas I navigate? | "Show me everything. If that needs a bigger canvas, build it — I'll navigate. Just label each part so I know where I am." | annex |
| 2 | do the historical qualifiers stay drawn? | "Keep them. 'Not cabled', 'free', 'historical' mean something to me; don't clean them up into certainty." | annex |
| 3 | the invisible spine/leaf question? | "Don't draw switches the trace never proved. I want the observed layout, not a guess about the fabric." | annex |
| 4 | does "everything" include the fresh-handoff host state and the geography? | no — the source's own task scopes the picture to the NIC and observed egress | own judgment |
| 5 | does anything move? | no — the source never animates; static drawing | own judgment |
| 6 | Cloudflare latency: 8.3 ms or 8.6 ms? | 8.3 ms (relationship-facts list + brief's must-not-change list); discrepancy recorded | own judgment |
| 7 | whose AS is 132717, and where does it sit? | drawn on the gateway node as the source's own node list does | own judgment |
| 8 | three concept-diagrams or two? | two: ports + the /29 are one local cluster; egress is the second | own judgment |

Converged after Q1–Q3: the source was fully understood, the reader's job (an audit pass over ports, addresses and
qualifiers) was fixed by the brief, and the measured single-view extents fixed the shape. Q4–Q8 were source-internal
gaps the annex does not cover; each was decided from `source.md` and recorded with its reason. The framing made three
questions unnecessary: reader's job, scope ("not a summary") and whether the dark ports matter ("don't drop the dark
ports") are all stated outright.

## Step 0 classification

```
family: identity-probe-maps
evidence: nine nodes that are addresses, ports and qualifier markers (eno16595np0, .57/.58/.59/.60-.62,
          AS132717/AS13335, "OUI is not a ToR proof") strung down a deep lr chain gw -> airtel -> airtelbb -> cf.
```

Tie-breakers: density (E=8 vs N=9) reads as a flow-chain, but tie-breaker 3 decides — identifier/qualifier content
outranks shape. Secondary recipe borrowed: flow-chains (lr orientation, one rank one node deep, no invented side
branches). No reclassification.

## View shape

**One canvas, two named + described diagrams.** Rung-1 was rejected with measurements, not taste:

| candidate | check | extent |
|---|---|---|
| one view, lr, all 9 nodes + 8 relations | `probe-single-view` | `183x14` cells (labels 8/8) |
| one view, tb, the same graph | `probe-single-view-tb` | `53x96` cells (labels 8/8) |

The labels, not the node count, set the size. Reaching 77×47 would mean dropping addresses or qualifiers, which the
skill forbids. The split follows the source's own clusters: the local port + address audit (`local`) and the observed
egress chain (`upstream`). No diagram is a fragment — 6 nodes / 5 edges and 4 nodes / 3 edges, one concept each.

## Shipped surface

`specs/canvas-a3.json` → `evidence/canvas` (pane capture) and `evidence/canvas-wide` (whole-canvas dump).

| diagram | title | origin / extent | nodes | edges |
|---|---|---|---|---|
| `local` | server1 ports and its /29 | `0,3` / `124x15` | 6 | 5 |
| `upstream` | the hops the trace answered | `0,23` / `131x5` | 4 | 3 |

Whole canvas `131x28`. Descriptions (drawn above each drawing):

- local — *Bare-metal server1, one live uplink of eight NICs; the /29 is public L3 - no NAT, no v6. Arista OUI: clue, not a ToR proof.*
- upstream — *Hops the trace answered, at its own latencies; Cloudflare is AS13335. Silent hops and hidden fabric are not drawn.*

Check summary (`evidence/canvas/check.txt`):

```
canvas: 2 diagrams on one canvas, drawn whole at 100%
extent=131x28 cells (whole canvas)
crossings: 0 bridges, 0 touching bends
near-misses: 0 cell(s) inside the 2-cell margin of a node the route does not serve (0 on trunk buses)
passes-near-unrelated-node: 0
labels: 8/8 placed, 0 leader-ticked, 0 on route, 0 skipped, 0 ambiguous owners
groups: ports(2) hosts(2) pool(1) access(2) wan(3)
dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 constant at 0.5c/step, 0 same-arrival at 2000ms
dot hues: 0 by source, 0 by destination, 0 shared-hue pair(s) (source-only 0, destination-only 0)
```

## Coverage

Nine entities, eight relations, every qualifier drawn:

| # | relation | label | diagram |
|---|---|---|---|
| e1 | dark → s1 | `no cable seen` (dashed) | local |
| e2 | s1 → nic | `only uplink` | local |
| e3 | nic → gw | `default gw 0.1 ms` | local |
| e4 | s2 → gw | `same /29` | local |
| e5 | spare → gw | `free, unprobed` (dashed) | local |
| e6 | gw → airtel | `transit 1.8 ms` | upstream |
| e7 | airtel → airtelbb | `7.1 ms` | upstream |
| e8 | airtelbb → cf | `8.3 ms` | upstream |

Qualifiers kept visible: `no cable seen` (absence observed, not proven), `free, unprobed` (unresponsive ≠ free),
"Arista OUI: clue, not a ToR proof", "no NAT, no v6", "Silent hops and hidden fabric are not drawn" (no spine/leaf
node exists anywhere in the spec). Identifiers: `eno16595np0 25 GbE`, `.57`/`.58`/`.59`/`.60-.62`, `R7725`,
`AS132717`, `AS13335`, `14.143.x`, `14.141.x`, `1.1.1.1`.

## Routing and hue

Routing: `near-misses: 0` and `passes-near-unrelated-node: 0` on every attempt — no relief lever was needed. Three
separate labelled routes enter the gateway's three ports (`canvas-wide-140x40-frames.txt` rows 10–19).

Hue families (captured in `evidence/canvas-wide/canvas-wide-ansi.ansi`): ports `#73CE73`, hosts `#73CEB7`, access
`#DB99AA`, wan `#CEA173`; `pool` and the local gateway sit beyond the 68-column pane slice, so their colours are not
captured (evidence gap, recorded). No dots anywhere, so no dot-hue binding applies.

## Attempts (budget: 6 candidates for 2 rendered diagrams — all 6 used)

| # | spec | result |
|---|---|---|
| probe | `probes/probe-schema.json` | capability preflight: canvas block, description lines and the static dots line confirmed |
| probe | `probes/probe-single-view.json` | one view, lr → `183x14`; rung 1 rejected |
| probe | `probes/probe-single-view-tb.json` | one view, tb → `53x96`; rung 1 rejected in both orientations |
| 1 | `specs/canvas-a1.json` | 163x28 canvas; descriptions (150+ chars) drove the width → reworded |
| 2 | `specs/canvas-a2.json` | 131x28; identifiers thin (no R7725, no gateway role) → a3 |
| 3 | `specs/canvas-a3.json` | **shipped**: 131x28, coverage complete, 0 warnings |

Every probe and draft is wrapped in `attempts-log.jsonl` (`scripts/viz-evidence.sh record`); every recorded spec input
is bundled (`specs/`, `probes/`).

## Validation

```
scripts/viz-validate.py evidence/canvas       --require-select --require-frames --require-records --attempts attempts.json
scripts/viz-validate.py evidence/canvas-wide  --require-select --require-frames --require-records --attempts attempts.json
```

Both: **all checks passed** (`validator-canvas.txt`, `validator-canvas-wide.txt`), each with the note
`layout_fit_canvas_form — 2 diagram(s) on a 131x28 canvas, drawn whole at 100% and navigated by pan`.
Pane captures measured `68x44 @100%` by the app's own header token; fit for the canvas form is the check's
whole-canvas + per-diagram extents, not a 77×47 pane proof.

## Defects and gaps

1. "NxtGen Cloud" is not spelled out — only `AS132717` is drawn (abbreviation, recorded; budget spent).
2. Hue capture incomplete for `pool` and the local gateway (beyond the 68-column pane slice); the check's
   `access(2)` line and the engine's one-hue-per-tag rule carry the claim, no capture shows it.
3. Per-hop ICMP loss compressed to "Silent hops" in the upstream description (no hop numbers in the relationship
   facts, and drawing them would invent devices).

No blockers. Panes `w7E:pZV` and `w7E:pZW` opened and both manifests record `cleanup=confirmed_closed`.
No judges, no subagents, no commits. Not marked green — a separate terra judge follows.
