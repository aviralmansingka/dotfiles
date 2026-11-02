# datacenter-redundancy — round 02 generation report

Case `datacenter-redundancy`, round `02`, worker `viz-ds02-datacenter-redundancy`
(agent profile `worker`, model `fireworks/accounts/fireworks/routers/deepseek-flash-latest`).
The spawn was dispatched with the literal case id `undefined`; the captain corrected it to
`datacenter-redundancy`, and the Herdr tab label `viz-ds02-undefined-5` is not the worker identity.

Frozen inputs, all re-verified by sha256 before use:

| Input | Value |
|---|---|
| Candidate skill | `docs/visualize-eval/rounds/02/SKILL.md` — `7d1ff098d3ff460046e794c29925482ffd0ccb8c6fa493bc390758d976b75d70` |
| Renderer | `/tmp/visualize-eval/round-02/bin/rataflow-view` — `ee085c0f3a82e9b7d516cde7532f394864b3490c99691cd7ac5b2d36d640e8ea` |
| Source | `docs/visualize-eval/cases/datacenter-redundancy/source.md` (only this case's source was read) |
| Target viewport | 77 columns x 47 rows at natural 100% zoom |

The global `rataflow-view` was never invoked; every check, frame run and capture used the absolute
frozen path.

## Views

Four final views, 28 audited relations, each drawn exactly once.

| view | carries | nodes / edges | extent (cells) | labels placed | labels on route | labels skipped | dot violations | check warnings |
|---|---|---|---|---|---|---|---|---|
| v1 | ISP A–D → MUX 1/2 → Core 1/2 (e1–e8) | 8 / 8 | 43x41 | 4/4 | 0 | 0 | 0 | none |
| v2 | Core 1/2 → FW1 active / FW2 standby → BL 1/2 (e9–e16) | 6 / 8 | 30x41 | 8/8 | 0 | 0 | 0 | none |
| v3 | Spine 1/2 above BL 1/2 + Leaf 1/2 on one level (e17–e24) | 6 / 8 | 46x20 | 8/8 | 0 | 0 | 0 | none |
| v4 | Leaf 1/2 → Rack 1/2 dual-homed (e25–e28) | 4 / 4 | 21x14 | 4/4 | 0 | 0 | 0 | none |

Every view proves its measured size with the app's own header token `77x47 @100%`; the live
alternate screen erases the `viewport:` startup line, which the validator accepts as equivalent
proof. No panning, no zoom-out. One `--select-all` ANSI frame and five timestamped
`--frames 5 --step-ms 100` frames per view; the captured frames hold exactly one dot per route
(8 / 8 / 8 / 4), so `dots: 1` is proven per frame.

## Grouping, trunks, dots, dashed

- **group** — six semantic families: `wan` (ISP A–D), `mux` (MUX 1/2), `routing` (Core 1/2 and
  Spine 1/2), `security` (FW1/FW2), `leaf` (BL 1/2 and Leaf 1/2, both real leaves), `compute`
  (Rack 1/2). Groups follow concepts, never rows.
- **trunks** — supported by the renderer and deliberately **not used**. Source line 270 and the
  fixed constraints forbid merging independent redundancy links into one bus, and this topology
  has no shared medium. `/tmp/.../rataflow-view --check` prints an empty `trunks:` line for all
  four views.
- **dots: 1** — on all 28 routes: one live dot per route instead of a stream, matching the human's
  "remove the dots flowing" correction without losing motion evidence.
- **style: "dashed"** — on the four standby paths (e11, e12, e15, e16). The state also stays in the
  text: node labels `FW1 active` / `FW2 standby`, edge labels `active` / `standby`.

## Layout constraints from the human corrections

- Cross-connect at every adjacent tier: each tier pair is complete bipartite (2x2), four
  independent routes, each on its own corridor, no merged arrows.
- Border leaf and rack leaf at the same height, spines above them: v3 puts Spine 1/2 in the upper
  row and BL 1/BL 2 alongside Leaf 1/Leaf 2 in one shared row.
- Compact and readable at default zoom: short node labels, 6–9 character edge labels, explicit
  layer placement, three focused views instead of one dense overview.

Arrow convention: arrowheads mark the audited `to` endpoint (source → target as recorded). These
are physical cables and every link is bidirectional in fact; no traffic direction is implied. In v3
the audit order is border leaf → spine, so those four heads point up into the spine row while the
spine → leaf heads point down.

## Attempts

`attempts.json` records 4 views and 3 / 3 / 3 / 1 spec attempts. Every attempt was rendered through
the harness at 77x47 and read back from the captured frame; the best honest one was kept.

- v1: row-spacer layout accepted; compact (43x23) and one-spacer (43x32) layouts were rejected
  because the `x-connect` labels fused against the arrowheads at the MUX→Core crossing — a defect
  `--check` does not report.
- v2: row-spacer layout accepted; compact (30x23) and one-spacer (30x32) layouts fused two `active`
  labels into `activeactive`, making label ownership ambiguous.
- v3: the all-in-one fabric view measured 49x49 (over the 47-row pane) and left a dot violation; the
  default leaf order left 2 dot violations; the accepted order (BL 2, Leaf 1, Leaf 2, BL 1) is
  clean.
- v4: accepted on the first attempt.

## Validation

`scripts/viz-validate.py <bundle> --require-select --require-frames --attempts attempts.json`
on all four bundles: **24/24 checks PASS each, 96 PASS, 0 FAIL** (`validation/v1.txt` … `v4.txt`).
Covered: absolute binary path, recorded binary hash, artifact hashes, check present and exit 0, no
check warnings, labels parsed/complete/off routes/not skipped, dots parsed with no violations,
viewport proven and equal to 77x47, cleanup confirmed, select-all frame and artifact, frames
artifact with >= 3 timestamped frames, attempts readable, view budget, spec-attempt budget.

No validator check failed. Nothing was edited in the validator, the manifest, or a capture.

## Known defects (recorded, not hidden)

1. v3: one border-leaf cross-connect takes a long lane around the perimeter of the spine row; it
   stays traceable with no shared cells and no dot violation, but it is the least direct route in
   the set.
2. v3: the `ECMP` labels sit in the densest crossing band. All labels are off route cells and each
   sits beside its own route; the remaining cost is visual density, and the attempt budget for this
   view was already spent.
3. v1 and v2 use 41 of 47 rows and only 43 / 30 of 77 columns — tall and narrow rather than
   pane-filling. That is the price of label separation that `--check` cannot measure.
4. v4 is small (21x14) by purpose: it isolates rack dual-homing instead of crowding v3.
5. No link speeds or media labels: the source gives none, and inventing them would be a defect.

## Blockers

- `b1` (harness measurement gap, not a fit blocker): `scripts/viz-evidence.sh` reads the split
  pane's rect through `herdr pane layout`, which returned only the focused tab, so `pane_rect` and
  `pane_cols` are null in the manifests and `pane_rows` came from the app's viewport rows. The
  measured size is proven by the app's own `77x47 @100%` header token, and
  `viewport_matches_target` passed on that token.
- No capability blocker: `group`, `trunks`, `dots`, `dashed`, `--select-all`, `--frames`, `layers`
  and the `viewport:` line all exist in the frozen renderer.

## Cleanup

Seven panes were opened, all no-focus right half-splits inside my own tab `w7E:t1R`, and all seven
closed with `cleanup=confirmed_closed` in the manifest that owns them (`w7E:p76`, `p7W`, `p7X`,
`p7B`, `p7C` for the four final bundles plus the discarded probes, and `p78`/`p79` from the
superseded first captures). `herdr pane list` now shows exactly one pane in my tab, `w7E:p6N`. The
captain's tab was never split and no raw tmux was used.

## Output paths

```
docs/visualize-eval/rounds/02/datacenter-redundancy/
  v1.json v2.json v3.json v4.json      final specs
  attempts.json                        views, attempts, decisions
  attempts/                            rejected specs (v1-a2-compact, v1-a3, v2-a2-compact, v2-a3, v3-a1, v3-a2) + the kept first attempts
  evidence/v1…v4/                      manifest.json, bin.sha256, check.txt, *-text.txt, *-ansi.ansi, *-selected.ansi, *-frames.txt, *-frames.ansi
  validation/v1.txt…v4.txt             full validator output
  generation.json                      full machine-readable record
  generation.md                        this report
```

Nothing was written under `docs/visualize-eval/rounds/02/undefined/` (the directory does not exist),
nothing was committed, installed, or edited outside this case directory. No reviewer subagent was
spawned; the captain runs the separate Sol judges.
