# network — round 05 generation (viz-ds05-2)

Generator: fresh DeepSeek subagent `viz-ds05-2`, model
`accounts/fireworks/routers/deepseek-flash-latest` (fireworks, high reasoning).
Candidate skill `docs/visualize-eval/rounds/05/SKILL.md`
(sha256 `ff4a9d3f32ba0bf8…`), frozen renderer
`/tmp/visualize-eval/round-05/bin/rataflow-view` (sha256 `b1ab9f2e78af11c2…`),
both verified with `shasum -a 256` before any spec was written. No rebuild, no
substitute binary, no renderer or skill edits.

## Views

| view | spec | shape | extent | check tail |
|---|---|---|---|---|
| v1 | `specs/v1.json` (sha `52c9e990…`) | tb, 5 nodes / 4 edges | 17x40 | `crossings: 0 bridges, 0 touching bends` · `labels: 4/4 placed, 0 on route cells, 0 skipped, 0 ambiguous owners` · `origins: 4/4` · `dots: 4 single-dot routes, 0 violations, 4 constant at 0.5c/step` |
| v2 | `specs/v2.json` (sha `087943b8…`) | tb, 4 nodes / 3 edges | 39x24 | `crossings: 0 bridges, 0 touching bends` · `labels: 3/3 placed, 0 on route cells, 0 skipped, 0 ambiguous owners` · `origins: 3/3` · `dots: 3 single-dot routes, 0 violations, 3 constant at 0.5c/step` |

No `routes … 0 detours` line exists in this build (dropped with the round-04
revert), and `arrivals: 0/0` because no route uses same-arrival timing.

Coverage: every one of the 7 audited edges appears exactly once — v1 carries
e1 `1 GbE`, e2 `10 GbE`, e4 `25 GbE`, e7 `fill`; v2 carries e3 `10 GbE`,
e5 `session`, e6 `queries`. Core, Redis and DB tier appear in both views as
continuity anchors. The two cache relations stay separate (e4 in v1, e5 in v2)
and are never merged. All three link speeds (1/10/25 GbE) are visible on v1.

Groups: `network` = WAN, Firewall, Core switch; `tiers` = Web tier, Redis,
DB tier. Verified in colour: pink family `rgb(211,134,155)` / `226,156,175` /
`187,108,131` vs teal family `rgb(125,174,163)` / `147,194,183`
(`evidence/v1/v1-ansi.ansi`), stable across views.

## Why this split

The graph has six longest-path ranks; the single-view spec measured 40x48 and
overflows a 47-row viewport, and `lr` measured 117x8 for the same path. The two
skip edges (`core→cache`, `web→db`) each force a bridge when they share a view
(measured: v2-a1 tb and v2-a2 lr both `1 bridges`). Moving e4 into v1 leaves one
skip edge per view and both views report `0 bridges, 0 ambiguous owners`.

## Motion

Every route is animated (`flow: true`, `dots: 1`, constant default
0.5 cells/100 ms, no numeric rate, no `same-arrival`, no `duration_ms`) because
the source asked for live dots whose direction is traffic flow. Speed is *not*
encoded in motion: GbE lives only in the labels, per the case's fixed
constraint.

Longest corridor: v1 = 2 cells (4 frames = one lap), v2 = 13 cells (26 frames).
Proof, pinned `COLUMNS=77 LINES=47`:

- v1 `evidence/v1/v1-frames-77x47.txt` frames 0→2: dots `(11,33),(19,33),(27,33),(35,33)`
  → `(12,33),(20,33),(28,33),(36,33)`, every dot +1 cell; frame 4 back at origins.
- v2 `evidence/v2/v2-frames-77x47.txt`: frame 0 `(19,35),(27,35),(27,37)` →
  frame 2 `(20,35),(30,31),(30,47)`; the session dot returns to `(27,35)` at
  frame 26, closing the full lap.
- Live-pane motion in `evidence/v1/v1-frames.txt` and `evidence/v2/v2-frames.txt`
  (83x51) matches.

## Known defects (honest)

1. **Short motion span on adjacent hops.** In tb the gap between adjacent ranks
   is 4 cells and the renderer animates only the 2-cell corridor, so e1/e2/e4/e7
   (v1) and e3 (v2) advance one cell and wrap every 400 ms instead of travelling.
   `lr` would lengthen it but measured 117x8 and overflows
   (`attempts/v1-a3.check.txt`). Not hidden: no route switched to `dots: 0`, no
   label cut, `0 dot violations`.
2. **Dots wrap before the arrowhead in constant mode** — e.g. the v2 session dot
   is last drawn at `(28,23)` and restarts at `(27,35)` while the head ▼ sits at
   `(29,22)`; constant mode makes no arrival claim (`arrivals: 0/0`).
3. **No group blocks or group names are drawn** by this build — only member
   border hues (`grep` for `network`/`tiers` in the ANSI captures finds nothing,
   while `--check` reports `groups: network(3) tiers(2)`).
4. **v1 fills only 17 of 83 columns** — the fit price of a 6-rank graph in tb.

## Blockers (recorded, not relabelled)

- Measured pane viewport is **83x51**, not 77x47: the worker tab is 170x53 and
  herdr clamps splits (max ratio 0.9, sibling ≥17 cells), so a 79x49 child is
  unreachable. Mitigation accepted by the current validator: a pinned
  `COLUMNS=77 LINES=47` dump per view with no overflow banner
  (`evidence/v1/v1-frames-77x47.txt`, `evidence/v2/v2-frames-77x47.txt`).
- No route-economy line in the frozen build (expected per the corrected task);
  no detour claim is made.

## Attempts (3 candidates max per view)

| view | attempt | verdict |
|---|---|---|
| v1 | `v1-a1` wan/fw/core/web tb (17x32, clean) | rejected — split left `25 GbE` apart from `session` |
| v1 | `v1-a2` 5-node path tb (17x40, clean) | **chosen** |
| v1 | `v1-a3` same path lr (117x8) | rejected — overflows 77 columns |
| v2 | `v2-a1` 4-node tier fan tb (40x24) | rejected — 1 bridge, 1 ambiguous label owner |
| v2 | `v2-a2` same in lr (66x20) | rejected — 1 bridge persists |
| v2 | `v2-a3` 3-edge tier view tb (39x24) | **chosen** |
| — | `single-6node-tb` all-in-one tb (40x48) | rejected — overflows 47 rows, 1 bridge |

Raw `--check` output for every attempt is in `attempts/`; ledgers and hashes in
`attempts.json`. Provenance note: the first run's raw file was overwritten in
place by a later candidate; that spec was reconstructed from the exact JSON and
re-run, and the regenerated record reproduces the original numbers.

## Validator

`scripts/viz-validate.py` (sha `902370989d632a49…`, concurrently edited upstream
during this case, not by me) with `--require-select --require-frames --attempts`:
**all checks passed** for both views (`validator-v1.txt`, `validator-v2.txt`).

This is a self-assessment only. No independent judge or reviewer ran; the
skill's Step 9 review was skipped on purpose.

## Commands

```sh
shasum -a 256 docs/visualize-eval/rounds/05/SKILL.md /tmp/visualize-eval/round-05/bin/rataflow-view
/tmp/visualize-eval/round-05/bin/rataflow-view --check specs/<candidate>.json
COLUMNS=77 LINES=47 /tmp/visualize-eval/round-05/bin/rataflow-view --frames 31 specs/v2.json
scripts/viz-evidence.sh --spec docs/visualize-eval/rounds/05/network/specs/v1.json \
    --bin /tmp/visualize-eval/round-05/bin/rataflow-view \
    --out docs/visualize-eval/rounds/05/network/evidence/v1 --label v1 --frames 9
uv run --no-project scripts/viz-validate.py docs/visualize-eval/rounds/05/network/evidence/v1 \
    --require-select --require-frames --attempts docs/visualize-eval/rounds/05/network/attempts.json
```
