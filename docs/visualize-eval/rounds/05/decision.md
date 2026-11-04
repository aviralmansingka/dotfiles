# Round 05 decision

## Outcome

**0/8 green. 20 pass / 24 fail / 8 blocked of 52 applicable categories.
5 critical, 27 high, 20 medium, 1 low.** Aggregation validated all eight
reviewer results with zero problems. Frozen inputs: skill `ff4a9d3f…`,
binary `b1ab9f2e…` (`/tmp/visualize-eval/round-05/bin/rataflow-view` — the
round-03 source plus the mermaid-style engine), rubric revision 6
`039b9625…`, dataset unchanged since round 02. DeepSeek (fireworks)
generated; Sol judged.

## Verdict matrix (P/F/B, — = source-backed N/A)

| Case | Sem | Arr | Fit | Grp | Brd | Wfl | Anim | Overall |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| pipeline | P | F | B | P | P | B | F | FAIL |
| network | P | F | P | P | P | B | F | FAIL |
| homelab-nic-trace | F | P | F | P | F | B | — | FAIL |
| server-nic-layout | P | P | P | F | P | F | — | FAIL |
| datacenter-redundancy | F | F | F | F | P | B | **P** | FAIL |
| modal-machine-manager | F | F | F | P | B | F | F | FAIL |
| modal-runtime | F | P | F | P | P | B | — | FAIL |
| gb300-rack-software | F | F | F | P | F | — | — | FAIL |

## What the mermaid engine delivered (movement vs round 04's 24/25/6)

- **Crossings and label ownership collapsed.** Most views report `0
  bridges`; repeated labels that braided in every earlier round now read
  `0 ambiguous owners` on nearly every view (datacenter's 17 → 5, mm's
  4 → 5-6 localized). Barycenter ordering is doing mermaid's job.
- **Hue stability across views** — a group keeps its color in every view
  of a case (name-hash, proven by test). Round 03/04 instability gone.
- **Palette overwrites gone** — zero overwritten border cells in four
  cases that suffered them in round 04.
- **No-dots and static scope held** — datacenter animation PASSES
  (zero dots) for the third round running; pipeline's one scope slip
  (`Auth→Postgres` animated against the source) was caught.
- **The off-by-one is now the single dominant defect:** frame-0 dots
  render one cell past the first drawn route cell while `--check`
  claims full origins — verdict-confirmed in ALL FIVE animated cases
  (pipeline 6/6, network 7/7, mm 23/23, plus homelab's and gb300's
  animated-capture findings). One fix clears animation+arrows for most
  of the board.

## Remaining root causes, ranked

1. **Origin off-by-one** (user-directed round-06 focus, already
   recorded in state): render the frame-0 dot on the first drawn cell
   (stem, corner included); make the check measure the same cell.
2. **Group boxes/titles not drawn** — hue-only grouping (runtime,
   gb300, mm judges all confirmed). The mermaid subgraph look is
   half-delivered.
3. **Evidence bookkeeping** — 77×47 ANSI/selected captures missing
   (pipeline, gb300 blocked on it), raw command/status records, one
   63-char hash, captain-assembled pipeline records after the worker's
   disk crashes.
4. **Single-junction trunk regression** (gb300: two adjacent taps;
   1-junction layouts carried 3–14 bridges under the new ordering).
5. **tb routing refuses dense redundant fans** (datacenter forced to
   `lr`, losing the source's tier geometry); hue-family collisions
   still possible across cases (server); dashed corners regressed with
   the round-04 revert.

## Incidents this round

- **Disk exhaustion:** the pipeline worker's runaway pane-geometry
  probe (`geometry.txt`) grew to 359 GB, crashing two worker lives and
  one judge spawn. Root-caused, deleted, 364 GiB recovered; the
  incident is recorded in the pipeline bundle records.
- Two worker timeouts (r05's original session, r05b once) and one
  provider stream failure (datacenter judge) — all recovered by
  resume without losing immutable records.

## Stop-rule assessment

Continue to round 06 with the user-directed narrow scope: the
off-by-one fix ONLY, nothing else. Manual human review of round 04
(reverted) vs round 05 opens now and blocks revision work as always.
