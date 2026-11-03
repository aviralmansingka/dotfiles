# modal-machine-manager — round 10 generation (viz-ds10-6)

Generator: `fireworks/accounts/fireworks/routers/deepseek-flash-latest`
Candidate skill: `docs/visualize-eval/rounds/10/SKILL.md` (sha256 `9c125679…f77e56d`)
Frozen binary: `/tmp/visualize-eval/round-10/bin/rataflow-view` (sha256 `db70722b…fb92df8`)
Target viewport: 77×47 @ 100% natural.

The generator-task template's Output section still asks for `round: "09"`; this run is round 10 and
`generation.json` records `"round": "10"` with a note.

## Step 0 — family

```
family: lifecycle-machines
evidence: one queue fans to five phase destinations (provider registry, SSH ops, S3, janitor,
          Postgres) and the source gives an ordered machine life — provisioning → boot →
          heartbeat → reconcile — with every transition live, which the human's last correction
          renders as exactly one dot per line.
```

Tie-breakers: density (E=23 > N=17) points at a mesh/fabric, but the source names no tiers and no
redundant link pair; the only double-direction pair (machines ↔ boot server) is a request/response.
Not placement-planes (no bus between weakly-connected worlds — everything connects through the
queue). Not an identity probe map (no addresses, ports or uncertainty markers).

Secondary recipe: **service-meshes** — machines ↔ boot server is drawn as two edges in one view
(`e8` iPXE request down, `e9` boot.ipxe + S3 args back up), never merged.

## Views (4/4, all tb, all animated)

| view | carries | spec | extent | crossings | labels | dots/frames |
|---|---|---|---|---|---|---|
| v1 request intake | e1 e2 e3 e4 e21 | `specs/v1.json` | 63×21 | 0 bridges, 0 bends | 5/5, 0 skipped, 0 ambiguous | 5 dots, 52 frames |
| v2 provisioning + boot | e5 e6 e7 e8 e9 e22 | `specs/v2.json` | 64×29 | 0 / 0 | 6/6, 0 skipped, 0 ambiguous | 6 dots, 52 frames |
| v3 heartbeat + state | e10 e11 e12 e13 e14 e23 | `specs/v3.json` | 73×30 | 0 / 0 | 6/6, 0 skipped, 0 ambiguous | 6 dots, 78 frames |
| v4 ops + diagnostics | e15 e16 e17 e18 e19 e20 | `specs/v4.json` | 70×24 | 0 / 0 | 6/6, 0 skipped, 0 ambiguous | 6 dots, 90 frames |

Coverage: **17/17 components, 23/23 relations**, each relation mapped to exactly one view in
`generation.json.relation_to_view`. Nothing was dropped. Round 09 lost the humans/mmctl component
and three relations to budget exhaustion; here the humans/mmctl node is `console` in v1 and the
Slack confirm lives in the same view, and the three relations round 09 lost are drawn
(`console→webapi`, `private gRPC→Postgres`, `public gRPC→Postgres`).

## Grouping (logical tags only, nothing drawn around members)

`humans` (console, slack) · `control` (cp, wapi, pgrpc, q, pub, sync) · `metal` (catalog, prov, mch,
boot, agent) · `state` (state/Postgres, s3) · `ops` (bmc/SSH+BMC, jan). Five distinct hue families,
one sibling order, identical membership in every view.

## Levers and the source fact behind each

- `label_slot` on every edge — the round-10 binary's gap model charges `label_width − 1` rows per
  rank gap (measured: `probes/p2l13.json` 18×24 vs `p2l13slot.json` 30×12), so a five-rank
  provisioning view is impossible without gutters.
- Invisible node-id order — the engine orders a rank by id, and a `label_slot` band only extends to
  the **right** of its run, so the control plane column must sit right of the human column for the
  23-char `create/terminate/repair` band to place (`probes/q4fan-idsort.json` vs
  `probes/q4fan-grouporder.json`, which proved a group rename does not reorder siblings).
- `layers` rank pins in v4 only — `[[q], [ssh, jan], [mch, wapi, s3]]`, from the source's own ops
  path (jobs → SSH/janitor → machines/webapi); S3 is a store, not a stage, so it sits beside the
  machines that pull images from it and `mch→s3` becomes one inside-rank hop.
- No trunks anywhere: the source names no shared bus.

## Motion

Constant mode, 0.5 cells / 100 ms, exactly one dot per route, no dot on any border
(`dots: … 0 violations`, `origins: N/N` for all four views). Frame budget = `2 ×
longest drawn route`, measured on the pinned 77×47 dump with `probes/lap-proof.py`:
52 / 52 / 78 / 90 frames for v1…v4. v4 frame 0 → frame 10 shows every dot advanced by the same
5 cells (coordinates in `generation.json.animation_evidence.constant_speed_proof`).

## Known defects

1. **v1, medium — two dots never leave their first two cells.** In `pinned/v1-77x47.txt` the
   `console→wapi` and `cp→pgrpc` dots alternate between rows 17/18 at columns 28/47 across every
   frame (0, 10, 20, 30, 51) although their drawn routes run to row 20. The other three v1 dots
   traverse normally, and isolated probes (`probes/motion1.json`, `motion2.json`, `motion4.json`)
   traverse whole routes with and without `label_slot`, so the behaviour is specific to this fan
   geometry and could not be fixed inside the attempt budget without losing a label or a relation.
2. **all views, low — pane frames artifact keeps only the last 19 frames.** `herdr pane read
   --source recent` is capped at 1000 lines; at 51 rows per frame the earlier frames are dropped.
   The recorded command still passes the full frame count, and the full-lap proof is the pinned
   77×47 dump (accepted by the round-10 pinned ruling).
3. **v4, low — `mch→s3` is drawn as an inside-rank horizontal hop** because S3 is rank-pinned
   beside the machines. Direction and label are intact.
4. **v3, low — tight width**: extent 73×30 leaves four columns of slack inside 77; nothing clipped.

## Blockers (renderer / tooling, not worked around by inventing capabilities)

- No per-edge gutter-side choice for `label_slot` (band only extends right); cost v1 two attempts.
- No `minlen` field in the round-10 schema, so corridor spacing cannot be reserved.
- Herdr's 1000-line `recent` cap limits live-pane lap proof (see defect 2).

## Evidence

- Bundles: `evidence/v1 … v4` (check.txt, text, ansi, selected ansi, frames, manifest with pane
  ids, measured 82×51, `cleanup: confirmed_closed`).
- Fit proof: `pinned/vN-77x47.txt` — `viewport: 77x47 zoom: 1.00 natural`, final spec, no
  `overflows` line, 52/52/78/90 frames.
- Attempts: `attempts.json` (≤3 candidates per view: v1 3, v2 2, v3 2, v4 3) plus
  `abandoned_shapes` for every calibration and labelling probe; all 103 entries in
  `attempts-log.jsonl` are `viz-evidence.sh record` records with spec-bound sha256s
  (verified by `viz-validate.py --require-records`).
- Validator: `validator/v1…v4.txt`, exit 0, `all checks passed` for every view.

## Commands (abridged; every one is in `attempts-log.jsonl` with its raw output)

```sh
BIN=/tmp/visualize-eval/round-10/bin/rataflow-view
scripts/viz-evidence.sh record --to attempts-log.jsonl --label v1-a -- "$BIN" --check specs/v1-a.json
scripts/viz-evidence.sh --spec specs/v1.json --bin "$BIN" --out evidence/v1 --label v1 --frames 52
COLUMNS=77 LINES=47 "$BIN" --frames 52 specs/v1.json > pinned/v1-77x47.txt
uv run --no-project scripts/viz-validate.py evidence/v1 --require-select --require-frames \
    --require-records --attempts attempts.json
```
