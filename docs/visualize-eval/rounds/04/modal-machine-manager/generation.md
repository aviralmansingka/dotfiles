# modal-machine-manager — round 04 generation report

Generator: fresh DeepSeek worker (`fireworks/accounts/fireworks/routers/deepseek-flash-latest`), worker label `viz-ds04-6`.
No judge was spawned (captain's step). Nothing was committed or installed.

Frozen inputs, both verified with `shasum -a 256` before any work:

| input | sha256 |
|---|---|
| `docs/visualize-eval/rounds/04/SKILL.md` | `ac431c6d3035e466e29136f36d9579c551c2e070a354dc5df72999b1bb1beb3c` |
| `/tmp/visualize-eval/round-04/bin/rataflow-view` | `0da16d8d8ed46e2a25eb773fc71ecad4de9e310cd33e303a4c7fe77231ad95bc` |

Four views, 23 of 23 relations, 17 of 17 components, one relation per view, no relation drawn twice.
Every view was checked, captured and validated through the repository harness; every pane was closed and the close is proven in its `manifest.json`.

## Views

| view | nodes / edges | extent | measured | crossings | labels | routes | dots | origins |
|---|---|---|---|---|---|---|---|---|
| `v1-intake` | 5 / 4 | 52x24 | 77x47 @100% | 0 bridges | 4/4 placed, 0 skipped, **1 ambiguous** | 4/4 near-minimal, 0 detours | 4 constant at 0.5c/step, 0 violations | 4/4 |
| `v2-provision` | 6 / 6 | 65x38 | 77x47 @100% | 0 bridges | 6/6 placed, 0 skipped, **1 ambiguous** | 6/6 near-minimal, 0 detours, 1 shortened | 6 constant at 0.5c/step, 0 violations | 6/6 |
| `v3-state` | 8 / 7 | 66x41 | 77x47 @100% | 1 bridge | 7/7 placed, 0 skipped, **1 ambiguous** | 7/7 near-minimal, 0 detours, 1 forced | 7 constant at 0.5c/step, 0 violations | 7/7 |
| `v4-ops` | 7 / 6 | 77x39 | 77x47 @100% | 0 bridges | 6/6 placed, 0 skipped, **1 ambiguous** | 6/6 near-minimal, 0 detours | 6 constant at 0.5c/step, 0 violations | 6/6 |

Measured size is the app's own header token (`77x47 @100%`) in the captured pane text and the `viewport: 77x47 zoom: 1.00 natural` line of the pinned-size dump. `scripts/viz-evidence.sh` could not resolve the pane rectangle on this Herdr build (`pane_rect`/`pane_cols` came back null), so no geometry was hardcoded — the app's token is the measurement, as the candidate skill allows.

## Full `--check` output (verbatim)

### v1-intake
```
viewport: unknown zoom: 1.00 natural
ok: nodes=5 edges=4 flows=4 direction=tb theme=gruvbox
extent=52x24 cells
crossings: 0 bridges, 0 touching bends
labels: 4/4 placed, 0 on route cells, 0 skipped, 1 ambiguous owners
warning: 1 label(s) have an ambiguous owner: another route is as close to the label as its own edge, so a reader cannot tell which edge the label names
groups: people(1) control(3) rpc(1)
trunks:
routes: 4/4 near-minimal, 0 detours, 0 shortened
dots: 4 single-dot routes, 0 periodic routes, 0 violations, 4 constant at 0.5c/step, 0 same-arrival at 2000ms
origins: 4/4 routes start at their arrow origin
arrivals: 0/0 same-arrival routes show their dot at the arrowhead on the final step
```

### v2-provision
```
viewport: unknown zoom: 1.00 natural
ok: nodes=6 edges=6 flows=6 direction=tb theme=gruvbox
layers=5 (explicit placement, sugiyama skipped)
extent=65x38 cells
crossings: 0 bridges, 0 touching bends
labels: 6/6 placed, 0 on route cells, 0 skipped, 1 ambiguous owners
warning: 1 label(s) have an ambiguous owner: another route is as close to the label as its own edge, so a reader cannot tell which edge the label names
groups: control(1) providers(2) host(1) boot(1) state(1)
trunks:
routes: 6/6 near-minimal, 0 detours, 1 shortened
dots: 6 single-dot routes, 0 periodic routes, 0 violations, 6 constant at 0.5c/step, 0 same-arrival at 2000ms
origins: 6/6 routes start at their arrow origin
arrivals: 0/0 same-arrival routes show their dot at the arrowhead on the final step
```

### v3-state
```
viewport: unknown zoom: 1.00 natural
ok: nodes=8 edges=7 flows=7 direction=tb theme=gruvbox
layers=5 (explicit placement, sugiyama skipped)
extent=66x41 cells
crossings: 1 bridges, 0 touching bends
labels: 7/7 placed, 0 on route cells, 0 skipped, 1 ambiguous owners
warning: 1 label(s) have an ambiguous owner: another route is as close to the label as its own edge, so a reader cannot tell which edge the label names
groups: host(2) rpc(2) control(2) state(1) providers(1)
trunks:
routes: 7/7 near-minimal, 0 detours, 1 forced, 0 shortened
note: route e4 (q -> db) runs 41 cells against a 29 cell straight stair; no obstacle-safe route is shorter, so the length is forced, not a detour
dots: 7 single-dot routes, 0 periodic routes, 0 violations, 7 constant at 0.5c/step, 0 same-arrival at 2000ms
origins: 7/7 routes start at their arrow origin
arrivals: 0/0 same-arrival routes show their dot at the arrowhead on the final step
```

### v4-ops
```
viewport: unknown zoom: 1.00 natural
ok: nodes=7 edges=6 flows=6 direction=tb theme=gruvbox
layers=5 (explicit placement, sugiyama skipped)
extent=77x39 cells
crossings: 0 bridges, 0 touching bends
labels: 6/6 placed, 0 on route cells, 0 skipped, 1 ambiguous owners
warning: 1 label(s) have an ambiguous owner: another route is as close to the label as its own edge, so a reader cannot tell which edge the label names
groups: control(3) ops(1) state(1) host(1) people(1)
trunks:
routes: 6/6 near-minimal, 0 detours, 0 shortened
dots: 6 single-dot routes, 0 periodic routes, 0 violations, 6 constant at 0.5c/step, 0 same-arrival at 2000ms
origins: 6/6 routes start at their arrow origin
arrivals: 0/0 same-arrival routes show their dot at the arrowhead on the final step
```

`routes: … 0 detours` holds everywhere. `origins` is full everywhere. `arrivals: 0/0` is the constant-mode report — no edge uses same-arrival timing, as this source never asks for it.

## Validator verdict

Command per view:

```sh
scripts/viz-validate.py docs/visualize-eval/rounds/04/modal-machine-manager/evidence/<view> \
    --require-select --require-frames \
    --attempts docs/visualize-eval/rounds/04/modal-machine-manager/attempts.json
```

All four bundles: **28 PASS, 2 FAIL** — the same two, for the same reason:

```
FAIL check_warnings_absent — warning: 1 label(s) have an ambiguous owner: …
FAIL labels_ownership_clear — 1 label(s) sit as close to another route as to their own edge; a reader cannot pair them
```

Passing in every bundle: binary absolute + hashed, artifact hashes, check exit 0, labels parsed/complete/off routes/not skipped, dots parsed and 0 violations, origins reported/complete, synchronized-dot count reported, arrivals reported/complete, ownership count reported, route economy reported and 0 detours, crossings reported, viewport proven / measurable / **77x47 = target**, cleanup confirmed, `--select-all` frame, frames artifact and timestamps, attempts readable, view budget 4, spec budget ≤3 per view.
Full per-view output: `evidence/<view>/validator.txt`.

## Known defects (honest)

The round-04 gate **“0 ambiguous owners total” is not met: 4 ambiguous owners, one in each view.** The check reports a count, not a name; each view below names the band and the label the geometry implicates.

- **D1 `v1-intake`** — both intake routes into the River queue bend toward the middle and their heads land on row 30 at columns 31 and 33. `reinstall/reprov` sits on row 28, columns 31-46: its left edge is one row above the sibling's corner `(31,29)` and 16 cells from its own corridor at column 47. See `evidence/v1-intake/direct-frames-77x47.txt`, frame 0, rows 27-30.
- **D2 `v2-provision`** — the request run (row 37, columns 8-33) and the response run (row 40, columns 5-32) are parallel and three rows apart; `boot.ipxe + S3 args` sits between them on row 39, columns 9-27. See `evidence/v2-provision/direct-frames-77x47.txt`, frame 0, rows 37-40.
- **D3 `v3-state`** — four Postgres writers leave corridors at columns 11, 29, 32, 53 (plus 55 for the gcore sync); `job rows` (row 28), `machine rows` (row 29) and `cluster state` (row 31) each sit between two of those corridors. See `evidence/v3-state/direct-frames-77x47.txt`, frame 0.
- **D4 `v4-ops`** — `diagnose uploads` is placed on row 23, columns 5-20, one row under the sibling queue route's run, while its own route turns at column 22. The case constraint “diagnose uploads must have an unambiguous owner” is therefore **not** met in this view. See `evidence/v4-ops/direct-frames-77x47.txt`, frame 0, rows 21-24.

Why they stand: the attempt budget (3 spec candidates per view) is fully spent on all four views — see `attempts.json` and `attempts/*.check.txt`. The one attempt that did reach 0 ambiguous owners (`attempts/v3-a1.json`, extent 85x41) would have to be panned inside 77 columns, which the skill forbids passing off as a fit. Recurring mechanism: consecutive edges leaving one node get adjacent ports (2 cells apart), so a fan band cannot host 16-20 character labels, and the label search keeps a clear-but-far slot when the label's own run has none inside the canvas extent.

No other gate failed. No blockers: `dots: 1`, `flow`, `group` and explicit `layers` exist and were used; `trunks` and `style: dashed` were not needed (the source states no shared bus and marks no relation unconfirmed).

## Motion

`dots: 1` + `flow: true` on every edge, constant default speed (0.5 cells per 100 ms). No `timing`, no `duration_ms`.
Proof from the pinned-size dumps (`COLUMNS=77 LINES=47 … --frames 21`, frame 0 included):
v1 frame 0 dots `(15,20),(47,20),(15,28),(47,28)` → frame 2 `(15,21),(47,21),(16,29),(46,29)` → frame 4 `(15,20),(47,20),(17,29),(45,29)`; v2 `(12,11),(9,19),(7,27),(8,35),(10,35),(30,40)` → `(11,12),(8,20),(8,28),(11,35),(8,36),(29,40)` → `(10,12),(7,20),(7,27),(12,35),(9,37),(28,40)`; v3 seven dots advancing one route cell per two steps; v4 `(24,11),(26,11),(28,11),(1,29),(45,29),(62,37)` → `(24,12),(26,12),(28,12),(2,30),(46,30),(63,38)` → `(24,13),(26,13),(28,13),(3,30),(47,30),(64,38)`. Every dot advances the same one cell per two 100 ms steps, and each view’s check line reads `… constant at 0.5c/step`.
The harness pane capture of frames kept frames 1-20 only (its `--source recent` buffer), so the full 0-20 cycle is preserved next to it as `direct-frames-77x47.txt` — that is the file the origin and speed claims cite.

## Coverage

| view | relations drawn |
|---|---|
| `v1-intake` | `web->wapi http` · `cp->pgrpc create/term/repair` · `pgrpc->q enqueue job` · `wapi->q reinstall/reprov` |
| `v2-provision` | `q->reg provision job` · `reg->prov provider API` · `prov->mch allocate instance` · `mch->boot iPXE request` · `boot->mch boot.ipxe + S3 args` · `mch->s3 pull boot image` |
| `v3-state` | `mch->agent runs on host` · `agent->pub register + heartbeat` · `pub->db machine state` · `pgrpc->db machine rows` · `q->db job rows` · `rec->db cluster state` · `rec->prov gcore sync, 1 min` |
| `v4-ops` | `q->ssh audit/verify reimage` · `ssh->mch run machine-audit` · `q->s3 diagnose uploads` · `q->jan diagnostic events` · `jan->wapi proposed actions` · `wapi->slack confirm + alerts` |

Components: `cp, web, wapi` (v1), `pgrpc` (v1, v3), `q` (v1, v2, v3, v4), `reg, boot` (v2), `prov` (v2, v3), `mch` (v2, v3, v4), `s3` (v2, v4), `agent, pub, db, rec` (v3), `ssh, jan, slack` (v4).

The three edge groups the source states map to the split: request/provisioning → v1+v2, heartbeat → v3, ops → v4. The two reconcile relations ride in v3 with the Postgres state they write, which is where the Postgres box lives; that is a split decision, not a dropped relation.

## Abbreviations and drops

- `create/term/repair` for *create / terminate / repair*; `reinstall/reprov` for *reinstall / reprovision* — both shortened in the intake band, where the 22- and 21-character forms left no unambiguous slot.
- `reconcile loop` for *cluster reconcile loop*; the dropped word survives on its `cluster state` edge.
- `register + heartbeat` carries the two verbs of the heartbeat path; the “fastest” cadence has no renderer field, so it is not drawn.
- Deliberate drops: **none**. No relation, qualifier, identifier or label was removed.

## Files

```
specs/v1-intake.json  specs/v2-provision.json  specs/v3-state.json  specs/v4-ops.json
attempts/v{1..4}-a{1..3}.json   + matching .check.txt   (12 candidates, raw output each)
attempts.json                   (per-view attempt log, hashes, notes)
evidence/<view>/manifest.json   (binary path+hash, spec hash, pane id, cleanup)
evidence/<view>/check.txt       (the check the bundle is validated against)
evidence/<view>/<view>-text.txt / -ansi.ansi / -selected.ansi / -frames.txt / -frames.ansi
evidence/<view>/direct-frames-77x47.txt  (full 21-frame cycle at the pinned target size)
evidence/<view>/validator.txt   (validator output, verbatim)
generation.json                 (ledger, audit, mapping, defects, cleanup, check lines)
```
