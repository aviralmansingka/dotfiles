# modal-runtime — round 11 generation (viz-ds11-7)

Generator: `viz-ds11-7`, model `fireworks/accounts/fireworks/routers/deepseek-flash-latest`.
Frozen renderer: `/tmp/visualize-eval/round-10/bin/rataflow-view`, sha256 `db70722b…`.
Candidate skill: `docs/visualize-eval/rounds/11/SKILL.md`, sha256 `fb975dbe…` (proposal 10).
Source read: `docs/visualize-eval/cases/modal-runtime/source.md` only.

## Step 0 — shape (a hint, then the source led)

```
family: service-meshes
evidence: modal-runtime is the core of a 3-branch RPC fan (worker e1/e2, task engine
          e3, modal-daemon e8) and the source states an anti-parallel pair between the
          same two boxes: worker -> runtime "task input + control RPCs" and
          runtime -> worker "events + management RPCs".
```

Tie-breakers: E = N = 8 looks like a chain, but density separates only when no fan is
present — runtime carries three branches plus a return edge, so the mesh wins. Not a
fabric (one lane per hop, no double arrowhead, no dot ban), not a lifecycle (no phase
order, no live transitions — this case is **static, no dots anywhere**), not
placement-planes (one world, no bus), not an identity map (no addresses; the qualifier
burden is protocol names). Secondary recipe: **flow-chains**, applied to the
compute/storage tail in v3.

## Views and coverage

| view | subject | direction | nodes | edges | extent | check |
|---|---|---|---|---|---|---|
| v1 | worker ↔ runtime anti-parallel RPC seam, co-viewed | lr | worker, runtime | e1, e2 | 44×7 | 2/2 labels, 0 ambiguous, 0 crossings |
| v2 | runtime's callee fan (engine dispatch, daemon fs HTTP on UDS) | lr | runtime, engine, daemon | e3, e8 | 59×9 | 2/2 labels, 0 ambiguous, 0 crossings |
| v3 | dispatch + container backend + storage chain | tb | engine, backend, container, filesystem, blobnet | e4, e5, e6, e7 | 66×20 | 4/4 labels, 0 ambiguous, 0 crossings |

Coverage: 8/8 components and 8/8 relations; runtime in v1+v2, engine in v2+v3; nothing
duplicated inside a view, nothing dropped. Groups (hues measured from the ANSI borders):
control `206,115,138` (runtime, engine), agents `183,206,115` (worker, daemon),
compute `115,161,206` + `153,186,219` (backend, container), volumes `138,115,206` +
`170,153,219` (filesystem, blobnet) — four distinct families across the case.

## Habits borrowed and deviations

Borrowed: mesh pair habit (both directions as separate edges, separate ports, separate
labels, **one view**), mesh fan habit (each branch keeps its own port and label row),
chain habit in v3 (short single-stage ranks, per-hop corridor room). Levers: `group` tags,
`label_slot` on every labelled edge (the only way this build reserves label room),
`lr` in v1/v2, `tb` in v3. No `layers`, no `minlen`, no `trunks` — the source names no
tiers to pin, no corridor length, and no shared bus.

Deviations, each with its measurement and capture:

1. **Pair and fan are in two views, not one frame.** Four labelled routes around one core
   failed in every measured shape: overview 47×84 with 1 skipped + 1 ambiguous label;
   `v1-a` 58×27 with 2 ambiguous owners; `v1-b` (layers) 33×35 with 0/4 labels + 1 bridge;
   `v1-c` (lr, all `label_slot`) 46×17 with 1 skipped label + 2 bridges. The pair itself —
   the recipe's hard demand — is still co-viewed (v1).
2. **v2 reads modal-daemon above Task engine**, reverse of the source's edge order
   (e3 before e8). Cause measured: flipping node declaration (`v2-fan-b`) rendered
   identically, and `layers` reports "within-rank order automatic". Edge-declaration order
   was not tested — the per-view candidate budget was spent. Colors still separate the two
   callees (engine shares runtime's control hue).
3. **v1's two labels share the reserved gutter below the corridor** (rows 7–8), order-matched
   top-to-bottom to the two arrows (row 3 is `◀───` worker→runtime, row 5 is `───▶`
   runtime→worker). The alternative orientation cannot place these labels at all
   (`v1-pair-c`: 0/2 placed in tb). This is the residual of round 10's shared-gutter
   objection and is recorded as a defect, not smoothed over.
4. **`lr` where the orientation rule says `tb`** for ≤4 ranks: measured, tb skips the long
   labels (v1) or makes one ambiguous (v2), lr + `label_slot` places all of them cleanly.
5. **Storage tag is `volumes`, not `storage`**: hues are name-derived; `storage` and `agents`
   both resolve to family 1 (183,206,115) in this build. `volumes` (the source's own word:
   "Filesystem + volumes", "image + volume data") resolves to family 5 (138,115,206).

## Round-10 regressions addressed

- *Shared-gutter pair labels defeating direction identification*: fixed structurally — two
  separate arrows at separate ports with separate labels in one frame, `0 ambiguous owners`,
  labels no longer merged into one string. Residual: both labels sit in the same gutter band
  (deviation 3).
- *Missing `runs` verb*: `runs user process` is drawn verbatim in v3 (pinned dump row 15).
- *Callee order reversed*: not fixed; recorded with its measurement and the untested variant
  (deviation 2). Every other multi-callee fan in the case is in the source's order — v3's
  engine → container backend then filesystem matches e4 before e6, and container before
  blobnet matches e5 before e7.

## Evidence

Per view: `specs/<final>.json`, `evidence/<v>/check.txt`, `<v>-text.txt`, `<v>-ansi.ansi`,
`<v>-selected.ansi`, `<v>-frames.txt|.ansi` (5 timestamped frames, static graph),
`<v>-77x47-pinned.stdout` (fit proof at `viewport: 77x47 zoom: 1.00 natural`, no overflow
banner), `manifest.json` (binary path + sha256, pane id, cleanup `confirmed_closed`).
Live pane header token was `82x51 @100%` (this tab's pane is larger than target), so the
pinned dumps carry the fit proof.

Probes: every `--check` and every frame dump went through
`scripts/viz-evidence.sh record` → `attempts-log.jsonl` with raw stdout/stderr in
`recorded/`. `attempts.json` lists 3 candidates per view (cap), plus three abandoned shapes
(calibration, single-view overview, 4-node seam-all). No hand-kept probe output.

## Validator

`scripts/viz-validate.py <bundle> --require-select --require-frames --require-records
--attempts attempts.json` → **all checks passed** for v1, v2 and v3 (29 checks each).
One first-pass failure was fixed without touching evidence: a superseded pinned dump's raw
file had been deleted by hand, so it was restored (sha256 matched the log byte for byte).

## Defects and blockers (not green)

- v1 pair labels share one gutter band (deviation 3); ownership needs row order + arrowhead.
- v2 callee order reversed vs the source listing (deviation 2).
- `gRPC` is drawn as `RPCs`; the interface contrast lives on e8's `fs HTTP over UDS`.
- v3's two engine labels stack above the corridor before it splits at row 8 (0 ambiguous
  owners; a reader follows the split two rows down).
- Pane-shell startup race in the harness (4–6 s shell vs ~1 s wait) forced re-runs:
  v1 1 run, v2 8, v3 5. No harness/validator/renderer file was modified.
- No `routes:` line in this build (expected, not a blocker).
- No judge, no reviewer subagent, no commits, no installs, no cargo — per the task.
