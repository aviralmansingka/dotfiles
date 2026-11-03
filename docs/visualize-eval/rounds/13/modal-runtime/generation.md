# modal-runtime — round 13 generation (viz-ds13-6)

Model: `fireworks/accounts/fireworks/routers/deepseek-flash-latest`
Skill: `docs/visualize-eval/rounds/13/SKILL.md` (proposal 12, sha `65d826f0…`)
Binary: `/tmp/visualize-eval/round-13/bin/rataflow-view` (sha `1f28d87d…`)
Rubric: revision 11. Target viewport 77x47 @100% natural.

## Triage (annex TRIAGE-modal-runtime)

The framing — *"Can you diagram modal-runtime for me?"* — is vague by design. Questions
provoked: scope; reader's job; panes vs canvas; motion; machine-manager false lead; plus four
that the first four answers made unnecessary (which components count as "internals", one
bidirectional arrow or two, dots or none, dashed qualifiers).

| # | question | answer (source) |
|---|---|---|
| 1 | whole runtime or one seam? | all eight components and eight relations (`annex answer 1`) |
| 2 | reader's job? | which seam carries which protocol; worker gRPC and filesystem HTTP/UDS must not blur (`annex answer 2`) |
| 3 | panes or one canvas? | one pane if the pair fits, else a described diagram per seam; don't split to shrink boxes (`annex answer 3`) |
| 4 | motion? | the source shows none — keep it static (`annex answer 4`) |
| 5 | machine-manager diagram? | no, judge it by the runtime source (`annex answer 5`) |

Own judgment (recorded in `generation.json`): the two seam labels stay verbatim (source facts,
and paraphrasing is the blur answer 2 forbids); no dashed links (no uncertainty is attached to
any relation); groups are orchestration / compute / storage, with worker and daemon left
ungrouped as boundary peers. Converged after Q1–Q5.

## Shape decision: canvas of 3 described diagrams

Rung 1 (one 77x47 view) was measured, not skipped:

| attempt | spec | measured | labels | near-miss |
|---|---|---|---|---|
| v1-a1 | `attempts/v1-a1.json` | 47x93 | 5/8, 3 skipped, 1 ambiguous | 0 |
| v1-a2 | `attempts/v1-a2.json` | 68x30 | 8/8, 3 ambiguous | 2 cells (e3 near `filesystem`) |
| v1-a3 | `attempts/v1-a3.json` | 57x30 | 8/8, 1 ambiguous (e0) | 2 cells |

Best honest single view fits but keeps one ambiguous seam label and one hugging route. The
engine's in-view rescue (leader ticks) prints a warning that `viz-validate.py` counts as a
failure, so a valid one-view bundle for this case is not reachable — see
`known_defects[0]` in `generation.json`. Rung 2 then: one canvas, split at the source's own
clusters.

| diagram | carries | extent |
|---|---|---|
| `d1` worker and runtime: the two RPC seams | e0, e1 (anti-parallel pair, both directions drawn) | 75x6 |
| `d2` task dispatch down to the container | e2, e3, e4 | 133x5 |
| `d3` storage and daemon interfaces | e5, e6, e7 | 107x10 |

Canvas: **133x34 cells**, drawn whole at 100%, navigated by pan.

## Checks (shipped spec `specs/modal-runtime-canvas.json`)

```
canvas: 3 diagrams on one canvas, drawn whole at 100%
extent=133x34 cells (whole canvas)
crossings: 0 bridges, 0 touching bends
near-misses: 0 cell(s) inside the 2-cell margin of a node the route does not serve (0 on trunk buses)
passes-near-unrelated-node: 0
labels: 8/8 placed, 0 leader-ticked, 0 on route, 0 skipped, 0 ambiguous owners
groups: orchestration(5) compute(2) storage(2)
dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 constant at 0.5c/step, 0 same-arrival at 2000ms
```

No warnings. Validator: **all checks passed** (`evidence/canvas/validator.txt`, 40 PASS lines).

## Motion: none

The source never animates anything and annex answer 4 forbids dots. The frames capture carries
five timestamped frames; only the `frame N at Nms` line differs between them, so the drawing is
provably static (no `--frames` animation audit to run: 0 animated routes).

## Evidence

- `evidence/canvas/` — pane bundle: `check.txt`, `canvas-text.txt`, `canvas-ansi.ansi`,
  `canvas-selected.ansi`, `canvas-frames.txt` (5 frames), `canvas-77x47-frames.txt` (pinned
  target-size dump), `canvas-whole-135x48-frames.txt` (whole canvas, 135x48), `manifest.json`,
  `validator.txt`.
- `evidence/canvas/sections/` — per-diagram crops of the whole-canvas dump, each showing its
  drawn title, its description and its drawing.
- `attempts-log.jsonl` + `recorded/` — every `--check` probe and every diagnostic dump, wrapped
  by `scripts/viz-evidence.sh record`.

## Defects recorded (not hidden)

1. Leader-tick labels emit `warning: … needed a leader tick`; the round-13 validator fails on any
   warning, so the round-13 ownership rescue cannot ship in a valid bundle.
2. A canvas description wider than the widest drawing sets the canvas extent but is drawn at its
   section's x offset, so its tail is cut off (measured with a 163-char description: extent 163,
   line ending `…HTTP on U`). Mitigated: every description is 105 chars inside a 133-wide canvas.
3. The viewer's palette box overlaps the bottom-left node when the viewport is only a few rows
   taller than the canvas (135x40). Natural pane (68x44) and the pinned 77x47 dump are clean.
4. `d1`'s two seam labels sit in adjacent rows; ownership is structural and the check says 0
   ambiguous, but it is the tightest thing on the canvas and the one spot a human reviewer should
   look at.
