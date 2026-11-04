# network — round 02 generation report

Worker `viz-ds02-network` · model `fireworks/accounts/fireworks/routers/deepseek-flash-latest`
(harness tab name was `viz-ds02-undefined-2`; the case was confirmed as **network** after a spawn bug.)

Frozen inputs: skill `docs/visualize-eval/rounds/02/SKILL.md`
`7d1ff098d3ff460046e794c29925482ffd0ccb8c6fa493bc390758d976b75d70`;
binary `/tmp/visualize-eval/round-02/bin/rataflow-view`
`ee085c0f3a82e9b7d516cde7532f394864b3490c99691cd7ac5b2d36d640e8ea` (re-hashed here, matches).
Target 77×47 at 100 % zoom.

## Result

Two final views, disjoint in edges, both captured at `77x47 @100%` natural zoom.

| view | carries | nodes/edges | extent | labels | single-dot routes | validator |
|---|---|---|---|---|---|---|
| v1 physical path | wan→fw→core→{web,Redis} with speeds e1–e4 | 5 / 4 | 40×32 | 4/4 placed, 0 on route, 0 skipped | 4, 0 violations | 24/24 PASS |
| v2 application relations | web→{Redis,DB} and Redis→DB, e5–e7 | 3 / 3 | 24×13 | 3/3 placed, 0 on route, 0 skipped | 3, 0 violations | 24/24 PASS |

`--check` prints no warnings in either view.

## What the source asked for, and where it landed

- Six nodes, seven relations — all drawn, none reversed, none merged. `core→cache` (e4, 25 GbE,
  v1) and `web→cache` (e5, session, v2) stay two separate relations, per the fixed constraint.
- Speeds stay in **label text only**: every edge uses the same `flow: 0.4` and `dots: 1`, so
  motion never reads as a measurement.
- Slow, sparse motion: exactly one dot per route, 5 timestamped frames at 100 ms per view show
  one-cell displacement per frame (v1: 4 dots in every frame, v2: 3 dots).

## Attempts

`attempts.json` holds 2 views × ≤3 attempts (v1: 3, v2: 2; v1 attempt 1 also records a
`direction: lr` probe, spec kept at `attempts/v1-probe-lr.json`).

1. **All-in-one, automatic tb** — `extent=40x48`, one row over the 47-row pane. Rejected on fit.
2. **All-in-one, explicit 4 layers** `[wan][fw][core][web,cache,db]` — all machine checks clean
   (`40x35`, 7/7 labels). Captured as `evidence/v1-pre-split`. Rejected on the readback: two
   corridors enclose the DB tier box on all four sides and read as a false outer border, and
   `session` sits beside the `core→cache` route, blurring label ownership between e4 and e5.
3. **Split, physical path** (kept as v1) — same facts minus the app tier, `40x32`.
4. **Split, app tier** (kept as v2) — auto placement first (rejected: two adjacent arrowheads into
   DB, `queries` crowded under `session`), then explicit `[web][cache,db]`: each relation gets its
   own short route and its own label.

## Capabilities

`group`, `dots: 1`, `--select-all`, `--frames` and the viewport proof are all used. Selected
frames differ from normal ones on every node border (accent `216;166;87` + bold appears 34× vs 10×
in v1, 21× vs 9× in v2).

Two round-02 features are deliberately **not** used, and both are honest omissions rather than
renderer gaps:

- **`trunks`** — the source declares no shared bus. The core's two downlinks carry different speeds
  (10 GbE to web, 25 GbE to Redis) and the app relations have different verbs; one corridor would
  merge links the source keeps distinct.
- **`style: "dashed"`** — the brief qualifies no relation as unconfirmed. Its only qualifications
  are the two fixed constraints, both about preservation. A dashed edge would invent uncertainty.

## Known defects

- The full chain WAN → firewall → core → web → DB needs both views; v1 alone stops at the tier fan-out.
- v1's left/right order (Redis left, Web tier right) is automatic placement, not a source claim.
- v2's `fill` label sits two cells above the DB tier's top-left corner — the tightest label in the set.
- v2's content is small for the pane (24×13 inside 77×47).
- Harness: `evidence/*/manifest.json` records `pane_cols: null`. `viz-evidence.sh` resolves
  `herdr pane layout` against the *focused* tab instead of the caller's tab, so the rect lookup
  misses the captured pane. Columns are proven by the app's own `77x47 @100%` header token and
  `pane_rows: 47` came from `viewport_rows`. Not patched — editing the harness is out of scope here.

## Cleanup

Three panes opened in this subagent's own tab `w7E:t1N`, each split `--no-focus` at ratio 0.5 by the
capture script, each `confirmed_closed` in its manifest: `w7E:p6X` (v1-pre-split), `w7E:p73` (v1),
`w7E:p77` (v2). Final `herdr pane layout --pane w7E:p6J` shows the tab back to one pane, 159×49.
The captain's tab was never touched, and no commit, install, renderer edit or reviewer run happened.

## Files

```
docs/visualize-eval/rounds/02/network/
  v1.json  v2.json
  attempts.json
  attempts/v1-attempt1.json  attempts/v1-attempt2-allinone.json  attempts/v1-probe-lr.json
  attempts/v2-attempt1-auto.json
  evidence/v1/{check.txt,v1-text.txt,v1-ansi.ansi,v1-selected.ansi,v1-frames.txt,
               v1-frames.ansi,manifest.json,bin.sha256}
  evidence/v2/{…same set…}
  evidence/v1-pre-split/{…same set…}   superseded, kept as attempt-2 evidence
  validation/v1-validator.txt  validation/v2-validator.txt  validation/v1-pre-split-validator.txt
  generation.json  generation.md
```

No self-certified pass: the judge runs separately.
