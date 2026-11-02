# modal-runtime — round 04 generation report

**Case:** `modal-runtime` · **Round:** 04 · **Generator:** `viz-ds04-7`,
`fireworks/accounts/fireworks/routers/deepseek-flash-latest` (fresh isolated worker;
no reviewer or judge was spawned).

**Frozen inputs (verified with `shasum -a 256` before any work):**

| input | path | sha256 |
|---|---|---|
| candidate skill | `docs/visualize-eval/rounds/04/SKILL.md` | `ac431c6d3035e466…` ✓ |
| renderer | `/tmp/visualize-eval/round-04/bin/rataflow-view` | `0da16d8d8ed46e2a…` ✓ |
| case source | `docs/visualize-eval/cases/modal-runtime/source.md` | `c6e4552d5842347b…` |

**Result: 1 view.** `specs/v1-b.json` → `evidence/v1/`.
Checks-and-captures clean. One real layout defect (D1, control palette over the
`Task container` corner) that the view's attempt budget could not address.

## Views and sizes

| view | spec | extent | pane (measured) | crossings | routes | labels | owners |
|---|---|---|---|---|---|---|---|
| v1 | `specs/v1-b.json` | 64x37 cells | **77x47 @100%** | 0 bridges, 0 touching bends | 8/8 near-minimal, **0 detours**, 4 shortened | 8/8 placed, 0 on route cells, 0 skipped | **0 ambiguous** |

Viewport proof is the running app's own header token `77x47 @100%` on
`evidence/v1/v1-text.txt` line 0 and on every captured frame header
(`evidence/v1/v1-frames.txt`). The harness's pane-rectangle lookup returned null
(`pane_rect`/`pane_cols` null, `pane_rows` 47), so the token is the only size
proof; nothing was hardcoded.

## Full `--check` output (kept view, byte-identical in `checks/v1-b.check.txt` and `evidence/v1/check.txt`)

```
viewport: unknown zoom: 1.00 natural
ok: nodes=8 edges=8 flows=8 direction=tb theme=gruvbox
layers=5 (explicit placement, sugiyama skipped)
extent=64x37 cells
crossings: 0 bridges, 0 touching bends
labels: 8/8 placed, 0 on route cells, 0 skipped, 0 ambiguous owners
groups: services(2) orchestration(2) compute(2) storage(2)
trunks:
routes: 8/8 near-minimal, 0 detours, 4 shortened
dots: 8 single-dot routes, 0 periodic routes, 0 violations, 8 constant at 0.5c/step, 0 same-arrival at 2000ms
origins: 8/8 routes start at their arrow origin
arrivals: 0/0 same-arrival routes show their dot at the arrowhead on the final step
```

Rejected candidates (raw logs preserved): `checks/v1-a.check.txt` (1 ambiguous
owner), `checks/v1-c.check.txt` (clean but no visible change),
`checks/v2-a.check.txt` (1 skipped label + 2 ambiguous), `checks/v3-a.check.txt`
(2 ambiguous).

## Validator verdict

```
uv run --no-project python scripts/viz-validate.py \
  docs/visualize-eval/rounds/04/modal-runtime/evidence/v1 \
  --require-select --require-frames \
  --attempts docs/visualize-eval/rounds/04/modal-runtime/attempts.json
→ 34 PASS, 0 FAIL, "all checks passed"     (validator-v1.txt)
```

## Motion: choice and evidence

The source never asks for motion, so dots are **flair, kept** on all eight
directed routes (`dots: 1`, `flow: true`, constant 0.5 cells/100 ms; no
`timing`/`duration_ms` — the source never asks for synchronized arrival).

- **Origins** (`evidence/v1/v1-frames.txt`, frame 1 = 100 ms = index 0): all
  eight dots sit on the first drawn cell after their own source port —
  `(35,11)` e1 · `(32,15)` e2 · `(35,19)` e3 · `(37,19)` e8 · `(36,27)` e4 ·
  `(38,27)` e6 · `(8,35)` e5 · `(31,35)` e7, each one cell outside its source
  border (worker 34..47/6..9, runtime 34..48/14..17, engine 35..47/22..25,
  backend 7..25/30..33, filesystem 30..51/30..33).
- **Constant speed:** frames 2..20 change in exact pairs — frame 3 ≡ 2, 5 ≡ 4,
  … 19 ≡ 18 — and every dot moves on exactly the same steps, i.e. 0.5 cells per
  step for all eight routes. Example: e8's dot walks `(38,20) → (39,20) → … →
  (48,20)` over frames 2 → 20, one cell every two frames.
- **No arrival claim:** `arrivals: 0/0` is honest — constant-mode dots wrap
  before the arrowhead by design, so no dot arrives and none is claimed.

## Meaning ledger and relationship audit

Ledger (full version in `generation.json`): all 8 component identifiers drawn
verbatim; 8 relations drawn with their protocol/payload wording; four groups
taken from the source's own sentence "task orchestration, container backends,
storage, and three worker RPC seams".

| id | from → to | verb / tech | label | owner | view |
|---|---|---|---|---|---|
| e1 | worker → runtime | task input + control RPC | `task+ctrl RPC` | e1 | v1 |
| e2 | runtime → worker | events + management RPC | `events+mgmt RPC` | e2 | v1 |
| e3 | runtime → engine | dispatches tasks | `task dispatch` | e3 | v1 |
| e4 | engine → backend | starts / manages | `starts/manages` | e4 | v1 |
| e5 | backend → container | runs **user** process | `runs process` (abbrev.) | e5 | v1 |
| e6 | engine → filesystem | mounts / snapshots | `mounts/snapshots` | e6 | v1 |
| e7 | filesystem → blobnet | image + volume data | `image+volume data` | e7 | v1 |
| e8 | runtime → daemon | filesystem HTTP over UDS | `HTTP over UDS` | e8 | v1 |

Seam specificity is kept: `task+ctrl RPC`, `events+mgmt RPC` and
`HTTP over UDS` stay distinct routes with distinct protocols; `HTTP over UDS` is
never merged with the worker gRPC seams. Single view ⇒ complete coverage; the
edge-by-edge capture coordinates are in `generation.json`
(`coverage_map.mapping_original_to_visible`).

## Deliberate abbreviation

`runs user process` → `runs process` (e5). At 17 characters the label anchor sat
9 cells from its own route while e4's run sat 8 cells away in every candidate
slot (`checks/v1-a.check.txt`: 1 ambiguous owner); at 12 characters the anchor
clears its own route by 7 cells and ownership reads 0. Only the qualifier "user"
was dropped.

## Known defects

**D1 — control palette overwrites `Task container`'s bottom-left corner**
(medium; would fail `layout_fit`/`border_integrity` if judged strictly).
The box spans pane columns 9–24, rows 38–41; the app's floating palette occupies
columns 1–9, rows 40–45. In `evidence/v1/v1-text.txt` row 40 column 9 shows the
palette's `┐` instead of the box's left border, and row 41 column 9 shows the
palette's `│` instead of the box's `╰` (same two cells in `v1-ansi.ansi`).
Cause: the layout puts the compute chain in the left column, so the bottom-left
node lands inside the corner the skill reserves for the palette.
Fix identified, not applied: swap the two chains' columns (storage left, compute
in the spine) — the bottom-left node then becomes `Blobnet` at pane column ~15,
clear of the palette, e4 becomes vertical and e6 takes the single leftward run.
The view's three-attempt budget was already spent (attempt 3 tried an empty
leading column, which the node-bbox centring absorbed with no visible change).

**D2 — e3's dot occupies an elbow cell for one 100 ms step** (observation).
`v1-frames.txt`: frame 1 row 20 shows `╮` at column 36, frame 2 shows `●` there,
frames 3–4 show `╮` again, repeating to frame 20. `--check` still reports
0 dot violations and 8/8 origins, so the renderer's corner accounting treats
that cell as a straight dot cell while a reader sees the elbow hidden on odd
steps. Check and capture disagree; both are reported.

**D3 — no same-arrival evidence on this case** (observation). `arrivals: 0/0`,
by choice: the source never requests synchronized arrival.

## Splits tried and rejected

Two split candidates (runtime seams / engine fan-out) were checked and rejected:
3-layer graphs compress both fan-out routes into one 4-row channel, which cost a
skipped label (`v2`) and two ambiguous owners (`v3`). The single view scores
strictly better on the hard gates, so it was kept.

## Cleanup

`evidence/v1/manifest.json` → `"cleanup": "confirmed_closed"` (pane `w7E:pDK`,
closed by the harness and probed gone). A later `herdr pane layout` shows one
pane and zero splits in this session's tab. No pane outside the harness was
created; nothing pan/zoomed.

## Blockers

None. No renderer capability was missing for this case.
