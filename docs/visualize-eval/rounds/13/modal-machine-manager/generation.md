# modal-machine-manager — round 13 (viz-ds13-5)

Full-system ask: all 17 components and all 23 directed relations of `source.md`, on ONE
canvas of named, described concept-diagrams, with slow sparse dots.

**Model:** `fireworks/accounts/fireworks/routers/deepseek-flash-latest`
**Skill:** `docs/visualize-eval/rounds/13/SKILL.md` (proposal 12, sha256 `65d826f0…`)
**Renderer:** `/tmp/visualize-eval/round-13/bin/rataflow-view` (sha256 `1f28d87d…`), rubric rev 11.

## Step 0 — triage (annex `TRIAGE-modal-machine-manager`)

Questions provoked: scope (all 23 or the main paths), shape (one canvas or several panes),
motion, which concepts split into diagrams, whether `provider registry` / `machine-agent`
are grouped or dropped, whether both boot directions and the separate `q -> s3` diagnostics
edge survive, which hops are historical, and (provoked but unnecessary) whether one pane
beside the chat would do.

Used: the three annex answers verbatim (all 23 relations; one canvas with named described
diagrams; one slow dot per live transition, none on borders), plus four **own-judgment**
decisions: the split follows the source's own three edge groups; `provider registry` and
`machine-agent` are drawn as grouped boxes, never dropped; both `mch <-> boot` directions and
the separate `q -> s3` upload stay distinct; and — since `source.md` marks no relation
historical — the single dot-free route is the residency edge `mch -> agent: runs on host`.

Converged when scope, shape, seam, coverage qualifiers and motion were all fixed — no
remaining question could change the drawing.

**family: lifecycle-machines** — evidence: one River job queue state fans to 5 destinations
(registry, database, SSH+BMC ops, janitor, S3) and the source asks for one live dot per line.
Density (E=23 > N=17) rules out a chain; no source-named bus rules out placement-planes; low
identifier density rules out identity-probe-maps. Secondary recipe borrowed: service-meshes'
anti-parallel pair (`mch -> boot` / `boot -> mch` in one diagram, own ports and labels).

## Shape — rung 2, one canvas

Rung 1 (one view) was rejected by measurement, not taste: the 7-rank provisioning chain with
17–22 character source labels alone is 260 cells wide. Rung 3 (thin a concept) is refused.

| diagram | title | extent (check) | nodes | edges | routes |
|---|---|---|---|---|---|
| `request` | Request and provisioning path | `260x11` at `0,3` | 10 | 10 | 10 |
| `heartbeat` | Heartbeat and machine state | `118x15` at `0,19` | 6 | 5 | 5 |
| `ops` | Slow ops path and reconcile loop | `132x25` at `0,39` | 10 | 8 | 8 |

Whole canvas: **260x64**, drawn whole at 100%. 26 node instances for 17 unique components;
23 edges/23 routes, 22 animated.

Each description is drawn under its title (see the whole-canvas capture); each is a true
statement of what that section shows, in the reader's terms (request entry + provisioning,
the fastest liveness path plus its three Postgres writers, the slow ops + one-minute sync).

## Check summary (`evidence/canvas/check.txt`)

- `labels: 23/23 placed, 0 leader-ticked, 0 on route, 0 skipped, 0 ambiguous owners`
  — round 12's four uncertain owners are gone, no leader ticks needed.
- `near-misses: 0`, `passes-near-unrelated-node: 0`.
- `crossings: 0 bridges, 0 touching bends`.
- `dots: 22 single-dot routes, 0 periodic routes, 0 violations, 22 constant at 0.5c/step`;
  `origins: 22/22`; one static route (`runs on host`, residency).
- `dot hues: 13 by source, 9 by destination, 0 shared-hue pair(s)`.
- groups are case-wide: `control(10) humans(2) hardware(7) state(4) ops(3)`.

## Attempts (3 candidates, all recorded)

1. `c1-tb-all` — every diagram `tb`: canvas 162x257, request 39x150, 2 labels skipped,
   1 ambiguous owner. Rejected.
2. **`c2-lr-all` — shipped** (`specs/canvas.json`, byte-identical): `lr` spends width instead
   of height, so the same labels cost 11 rows. Only completely clean candidate.
3. `c3-request-tb-slots` — request `tb` with `label_slot` on four long labels: 162x157,
   6 near-miss cells on `prov` via `request:e7`, 2 ambiguous owners, 1 skipped label. Rejected.

Every probe ran through `scripts/viz-evidence.sh record`; all three input specs are bundled in
`attempts/` so each record can be re-run.

## Verification

`scripts/viz-validate.py evidence/canvas --require-select --require-frames --require-records
--attempts attempts.json --frame-audit` → **all 40 checks passed, 0 failures**
(`evidence/canvas/validator.txt`).

Frame audit on the whole-canvas capture (`evidence/canvas/canvas-300x70-frames.txt`, 88 frames,
22/22 routes tracked): every dot at 0.500 cells/frame, equal distance over 77 ten-frame windows,
verdict PASS. 88 frames = 44 cells ≥ the 42-cell longest route (`ceil(42/0.5) = 84`).

## Known defects

- Canvas 260x64: the reader pans; the request section is a 3.4-pane-wide ribbon. Top-to-bottom
  and `label_slot` variants were measured and were taller and dirty.
- The viewer's controls legend (and minimap) paints over the canvas's bottom corners, so on any
  pane smaller than the canvas it overwrites drawing cells (ops title's first 11 cells in the
  68x44 pane; part of the `humans + mmctl` label in the 300x18 request window). At 300x70 it
  falls on empty margin. Viewer chrome, not fixable from a spec.
- The pane capture measured 68x44, not 77x47 (Herdr's half-pane width follows the tab). The
  77x47 target is proven by the pinned dump of this same final spec, which reports
  `canvas 260x64` — the expected navigable-canvas overflow, not a fit failure.

## Files

`specs/canvas.json`, `attempts/`, `attempts.json`, `attempts-log.jsonl`, `recorded/`,
`evidence/canvas/` (check, text, ansi, selected, frames, pinned 77x47, whole-canvas 300x70,
`sections/` per-diagram captures, frame audit, manifest, validator), `generation.json`.
