# modal-machine-manager — round 08 generation record

Generator: pi worker subagent, model `accounts/fireworks/routers/deepseek-flash-latest`.
Frozen inputs (verified with `shasum -a 256`):

| input | sha256 |
|---|---|
| `docs/visualize-eval/rounds/08/SKILL.md` | `b1bdb4d3d38336cb7783db34da7f9f19edf80704a890de32285d9e582b4221eb` |
| `/tmp/visualize-eval/round-08/bin/rataflow-view` | `ea24593b0f80c1617573eef4766f2bacaaf4315a8133a65d5331e9daec1c1f30` |

## Step 0 — family

```
family: lifecycle-machines
evidence: the River queue is one state that fans to five phase transitions
          (registry, SSH+BMC audit, janitor, S3 diagnostics, Postgres rows) and
          the brief's last correction — "keep on dot alive per line" on "slow
          dots flowing through it" — fixes the motion signature; the provisioning
          path is a phase order (request → gRPC → enqueue → provision → allocate
          → boot → register), so ranks are phases, not depths.
```

Per-view family lines are in `generation.json` (`views[].family_line`). Recipe applied:
phase-ordered ranks via `layers` in every view, one dot per live line (`flow: true`,
`dots: 1`, constant 0.5 cells/100 ms, no timing override, no same-arrival).

## Views, sizes, check lines

| view | subject | dir | extent | crossings | labels | origins | pinned 77x47 |
|---|---|---|---|---|---|---|---|
| v1 | request phase + human channel | tb | 41x40 | 0 bridges | 4/4 placed, 1 ambiguous | 4/4 | fits (region titles lost, see defects) |
| v2 | queue fan into job classes, provider chain head, janitor loop | lr | 71x28 | 1 bridge | 7/7 placed, 1 ambiguous | 7/7 | fits |
| v3 | boot plant, image pull, host agent | tb | 52x24 | 0 bridges | 5/5 placed, 1 ambiguous | 5/5 | fits |
| v4 | state writers, heartbeat sink, reconcile loop | tb | 76x40 | 2 bridges | 7/7 placed, 0 ambiguous | 7/7 | fits |

Every view: `pins: N pinned, 0 conflict(s)`; `dots: N single-dot routes, 0 violations, N
constant at 0.5c/step, 0 same-arrival`; `arrivals: 0/0` (constant mode, not requested).
Measured pane size in every harness capture: **83x51 @100%** (the caller tab is 170x53 and
`viz-evidence.sh` splits half of it) — the 77x47 fit is proved by pinned
`COLUMNS=77 LINES=47 --frames 71` dumps that carry `viewport: 77x47 zoom: 1.00 natural`
and no overflow banner.

## Coverage

All 17 components and all 23 relations are drawn, each relation exactly once
(`coverage_map` in `generation.json`): v1 = e1,e3,e4,e21 · v2 = e2,e5,e6,e15,e16,e19,e20 ·
v3 = e8,e9,e10,e17,e18 · v4 = e7,e11,e12,e13,e14,e22,e23. Carried labels:
`boot.ipxe + S3 args` (v3, frame 0 row 35 col 37), `reimage` (v2, frame 0 row 27 col 22),
`pull image` (v3, frame 0 row 28 col 37) all survive.

## Structural levers and why the source justifies them

- **Regions** (`group`): seven source concepts — control, humans, jobs, providers, plant
  (machines + boot server + host agent), state (Postgres, S3), ops (SSH+BMC, janitor).
  Same names in every view, so each region keeps one hue. Every view renders them as
  bordered, titled boxes with members inside.
- **Rank pins** (`layers`): phase order per view, taken from the brief's own sentence
  order (request → gRPC → enqueue; queue → job classes → downstream; machine → boot/S3/
  agent; writers → API surface → Postgres). 0 pin conflicts everywhere.
- **`minlen`**: not used — no source-described hop visibly spans stages beyond what the
  pins already encode, and using it to open label space would be layout polish.
- **`trunks`**: not used — the source names no shared bus. The queue's five relations are
  distinct job classes with distinct destinations and labels; one corridor for three
  independent lines is what the skill forbids.
- **Direction**: tb for the phase sequence (v1, v3, v4); lr for v2 because in tb three fan
  ports sit 2 cells apart and their labels collide (measured in v2's tb candidate).

## Honest defects

1. **v1, v2, v3: one ambiguous label owner each** (the only failing validator checks).
   Mechanism is engine-side and geometric, not a missing fact: a node with two or more
   out-edges inside one rank band gets ports 2–3 cells apart, and a label's centre is
   placed `len/2 + 1 + gap` from its corridor, so it cannot be strictly closer to its own
   line than to its sibling. v4 has no such node in a band and reads `0 ambiguous owners`.
2. **v1: region titles lost** — the three boxes draw but their titles are overwritten by
   arrowheads landing on the title row (`──▼j▼bs ───────`); membership is still provable
   from `groups: control(3) jobs(1) humans(1)` and the borders themselves. Same painting
   defect in v2/v3, where titles survive but v2's janitor box reads `│janitor─app│`
   (a route glyph sits in the label's space cell). Engine behaviour; no schema field moves
   a port off a border or a glyph out of a label space.
3. **v4: 2 bridges** (crossings) between the three Postgres corridors — accepted because
   changing the split trades clean label ownership for a warning.
4. **`create/term`**: the third verb `repair` is not visible. The 17-cell candidate was
   skipped at 6 nodes (`attempts-raw/v1-a2-check.txt`) and left zero fit margin at 5 nodes
   (`extent=41x47`), so the final candidate uses the 11-cell form.

## Blockers (recorded, not invented)

- **Pane size**: harness captures ran at 83x51, not 77x47, because the tab is 170x53 and the
  script splits it in half; `herdr pane layout` without `--pane` resolves the focused
  workspace, so `pane_cols` is null in the manifests. The app's own header token is the
  measured authority, and pinned 77x47 dumps prove the fit.
- **Pane frames truncated**: the pane-based frames artifact holds 19 of 71 frames (bounded
  recent buffer), so the full-lap proof lives in the pinned dumps (71 frames; the longest
  measured route is 31 cells → 62 frames needed).

## Motion evidence (constant mode)

Frames 0 → 10 (10 x 100 ms) advance every dot exactly 5 cells (0.5 cells/step): v1 4/4
dots, v2 7/7, v4 7/7, v3 5/5 (one v3 path bends, so nearest-neighbour pairing reports 6).
Frame 0 dot counts equal the `dots:` single-dot counts, and frame 0 dots sit on the port
stem cell of their source box (`origins: N/N` in every check, coordinates in
`generation.json.capture_claims`).

## Cleanup

All four evidence panes are `confirmed_closed` in their manifests. Nothing outside this case
directory was written; no renderer, skill, or installed binary was touched.

## Status

Not green, not self-approved. v4 passes all 32 validator checks; v1/v2/v3 pass 30 of 32 and
fail `check_warnings_absent` + `labels_ownership_clear` with one ambiguous owner each.
No reviewer was spawned — the captain runs the judge.
