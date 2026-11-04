# pipeline — round 08 generation record

Case: `pipeline` · round `08` · generator `viz-ds08-1` (worker), model
`accounts/fireworks/routers/deepseek-flash-latest` (provider `fireworks`, reasoning high).
Candidate skill `docs/visualize-eval/rounds/08/SKILL.md`
sha256 `b1bdb4d3d38336cb7783db34da7f9f19edf80704a890de32285d9e582b4221eb`.
Renderer `/tmp/visualize-eval/round-08/bin/rataflow-view`
sha256 `ea24593b0f80c1617573eef4766f2bacaaf4315a8133a65d5331e9daec1c1f30`.

## Step 0 — family

```
family: flow-chains
evidence: 6 nodes and 6 relations (E = N, one relation per node), shallow
          depth, and the source asks for slow sparse motion on the traffic,
          so one dot per animated hop at the constant default speed.
```

Recipe applied: one dot per animated hop at constant speed, no invented side
branches, one node per rank except the source's own fork at the gateway, single
view (no split).

Recipe deviation, measured: the recipe prefers `lr` at five or more stages. At
this content `lr` measures `extent=89x9` (12 columns past the 77-column pane,
`graph overflows` in the pinned dump) and reports two hops with only 2 dot cells,
i.e. hops that cannot show motion at all. `tb` measures `extent=31x46` and fits.
See `attempts/03-lr-case/` versus `attempts/02-tb-final/`.

## View v1 — the whole pipeline

- spec `specs/pipeline-tb.json` (sha256 `e0180ab5749af573…`), direction `tb`, theme `gruvbox`
- check `evidence/v1/check.txt`:

```
viewport: unknown zoom: 1.00 natural
ok: nodes=6 edges=6 flows=6 direction=tb theme=gruvbox
extent=31x46 cells
crossings: 0 bridges, 0 touching bends
labels: 4/4 placed, 0 on route cells, 0 skipped, 0 ambiguous owners
groups:
trunks:
dots: 6 single-dot routes, 0 periodic routes, 0 violations, 6 constant at 0.5c/step, 0 same-arrival at 2000ms
origins: 6/6 routes start at their arrow origin
arrivals: 0/0 same-arrival routes show their dot at the arrowhead on the final step
```

- measured app viewport `83x51 @100%` (`evidence/v1/v1-text.txt` line 1); target fit
  proven by the pinned dump of the FINAL spec
  `COLUMNS=77 LINES=47 …/rataflow-view --frames 36 --step-ms 100 specs/pipeline-tb.json`
  (`evidence/v1/v1-77x47-frames.txt`, `viewport: 77x47 zoom: 1.00 natural`, no overflow badge).
- frames: 36 pinned (`evidence/v1/v1-77x47-frames.txt`), 19 in-pane
  (`evidence/v1/v1-frames.txt`; the pane reader caps at 1000 lines). Longest route
  (`auth->db`, 18 drawable dot cells) returns to its origin on frame 34, so 36
  frames at 100 ms cover a full lap including frame 0.

### Levers used, with the source fact behind each

| lever | value | source fact / evidence |
|---|---|---|
| direction | `tb` | no source fact fixes orientation; the 77x47 viewport does (`lr` = 89x9 + 2 unanimated hops) |
| `group` regions | none | tier shades need a declared group; declared sibling regions on this centred chain land outside their members (`attempts/01-lr-synthetic-groups`) |
| `layers` rank pins | omitted | the source states no geometry (no rows, spine/leaf order, parallel planes) |
| `minlen` gaps | omitted | no corridor/phase-skip fact; the read path's extra rank is the join, not a declared gap |
| `trunks` | none | the gateway fork carries two different relations (verify, enqueue), not one bus that splits |
| dots | `flow: true` + `dots: 1` ×6, constant 0.5 c/100 ms | pipeline historically animated; "slow, sparse motion for traffic" |

### What the capture shows (77x47 pinned frame 0, coordinates are row,col)

- Six boxes with the exact source labels, no truncation: CLI `r1-4`, API gateway
  `r9-12`, Auth `r23-26 c28-33`, Job queue `r23-26 c37-47`, Worker pool `r31-34 c35-47`,
  Postgres `r43-46 c33-42`.
- Gateway fork = two separate bottom ports `(33,12)` and `(35,12)`, labels
  `verify (r17,c26-31)` and `enqueue (r17,c37-43)`, two separate arrowheads on `r22` at c29 and c38.
- Read/write stay distinct at the join: `auth->db` head `(34,42)`, `worker->db`
  head `(36,42)`; labels `read (r34,c24)` and `write (r38,c38)`.
- Crossings: none; labels own blank lanes (check: 0 on route cells, 0 ambiguous).
- Palette corner clear: controls box `r40-45 c1-9`, columns 10-23 on those rows blank.
- Motion: all six dots advance exactly one dot cell per two frames, e.g.
  `(37,6)->(36,7)`, `(33,14)->(33,15)`, `(35,14)->(35,15)`, `(29,28)->(29,29)`,
  `(38,28)->(37,29)`, `(36,36)->(36,37)` between frame 0 and frame 2.

## Honest defects

1. **D1 — dot origin is one cell late (renderer-side).** `--check` prints
   `origins: 6/6` under its own definition (`dot_cells[0] == origin_cell()`,
   and `origin_cell()` = polyline point 0 + one step while polyline point 0 is
   already the first cell outside the border). The capture disagrees with the
   stated rule: for all six routes the frame-0 dot sits at port row + 2 while
   the first drawn route cell is at port row + 1 — cli->api port `(37,4)`, first
   drawn `(37,5)`, dot `(37,6)`; api->auth `(33,12)/(33,13)/(33,14)`;
   api->queue `(35,12)/(35,13)/(35,14)`; queue->worker `(38,26)/(38,27)/(38,28)`;
   auth->db `(29,26)/(29,27)/(29,28)`; worker->db `(36,34)/(36,35)/(36,36)`.
   Both readings are recorded; a spec cannot fix it.
2. **D2 — no group regions.** Semantic-tier shades are unmet: sibling regions
   render as bands outside their members on this chain (`groups:` is empty in the
   check). Recorded instead of shipping false boxes.
3. **D3 — pane rectangle not recorded.** `scripts/viz-evidence.sh` resolves the
   rect with `herdr pane layout` (no `--pane/--current`), which returned the
   focused tab, not this session's tab, so `pane_rect`/`pane_cols` are null; the
   measured size comes from the app's header token, and fit from the pinned dump.
4. **D4 — pane frames truncated.** The pane reader returns at most 1000 lines, so
   the in-pane frames artifact holds frames 17-35; the full lap incl. frame 0 is
   the pinned 77x47 dump.

## Validator

`scripts/viz-validate.py docs/visualize-eval/rounds/08/pipeline/evidence/v1 --require-select --require-frames --attempts docs/visualize-eval/rounds/08/pipeline/attempts.json`
→ **all checks passed** (32 PASS lines, `evidence/v1/validator.txt`).

## Cleanup

Evidence pane `w7E:pK6` closed by the capture script; `manifest.json`
`cleanup: confirmed_closed`. No other pane, tab or workspace touched. Nothing
committed or installed; renderer, skill, examples and other cases unmodified.

This file does not mark the output green and no independent review was run.
