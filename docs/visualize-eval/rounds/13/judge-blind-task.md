# Terra review — stage A (blind), round 13

You are an independent diagram judge. You are not the generator. You are the
only kind of worker allowed to judge: `openai/gpt-6.1-terra:high`.

## What you receive now

- The candidate's final specs, commands, `--check` output, evidence bundles,
  measured dimensions, `attempts.json`, validator output and `generation.json`
  for ONE case under `docs/visualize-eval/rounds/13/<case>/`.
- Nothing else. You do not receive `source.md`, `expected.json`, the case brief,
  the triage annex, the rubric, the dataset manifest, other cases, or any
  earlier round.

You may read `generation.json` for what the spec declares — groups, rank pins,
trunks, `label_slot`, diagram titles and descriptions, the family line, the
recorded near-miss and dot-hue counts. **Do not open its `triage` block until
stage B**; that block is reviewed with the brief in hand.

## Stage A: observe and save before you see the expectations

Read only the captures and the spec files. Record what a reader actually sees.
The unit of observation is the **surface**: one view, or one diagram of a canvas.
Record every surface separately, then the canvas total.

Per surface:

- **Shape and counts.** Visible nodes, edges, routes. Whether the surface is a
  single graph or one diagram of a multi-diagram canvas, and the diagram's own
  title and description **verbatim**, with the `[column,row,width,height]` region
  each occupies and whether either is clipped or occluded.
- **Labels.** Every visible label, verbatim, with its 1-based
  `[column,row,width,height]`, and every label whose owner is uncertain.
- **Arrows.** Every visible arrow: source box, target box, direction, arrowhead
  state, and whether the whole route is traceable without guessing. Note every
  crossing, touching bend, bridge glyph, junction and apparent branch.
- **Near misses (round 13).** For every route, did it run in the ring that
  touches a node that is neither its source nor its destination? Record the
  route, the untouched node it passed, the closest visible cell, and how many
  cells it held inside the margin. Quote any `near-miss: route eN passes …` or
  `passes-near-unrelated-node` line the check printed, and say when the check and
  the capture disagree.
- **Hues.** Every declared group: the hue family its members share (ANSI
  evidence), whether members keep one stable sibling order, and whether anything
  is drawn around them (a box, border or title would be a renderer defect this
  round — the engine paints nothing for groups). For a canvas, record the hue
  family each group tag shows **in each diagram**, and whether a tag's hue
  changes between diagrams of the same canvas. Record tier markings: any label
  line or hue band that marks source-named tiers.
- **Rank pins.** Which nodes `generation.json` says are pinned, and which rank
  the capture actually shows them in.
- **Borders.** Complete sides and corners per node, and whether each border is
  color-continuous. Color needs ANSI or buffer evidence; plain text cannot prove
  it.
- **Selected states.** How many node occurrences have their own selected border
  captured, out of how many appear across the final surfaces.
- **Motion.** For every animated route, per timestamped frame: dots visible,
  spacing, direction, whether a dot ever rests on a corner, bridge, junction,
  label or arrowhead, whether frame 0's dot sits at the arrow's true origin, and
  whether every dot reaches its arrowhead in the same frame. Also: the hue each
  dot carries, the border hue of its route's source and destination nodes, and
  which end its hue matches — then the shared-hue pairs you can see. Quote the
  check's `dot hues: N by source, M by destination, K shared-hue pair(s) …` line
  and say whether it agrees.
- **Fit and navigability.** Measured columns × rows, the `viewport:` line, the
  `canvas:` block and each `diagram <n> "…" at x,y: extent=w x h …` line, the
  whole-canvas extent, whether any content is clipped, hidden, overlapping
  another diagram, or reachable only by pan or zoom, whether an overflow banner
  is present, and the crossings you can see against the reported
  `crossings: N bridges, M touching bends`. This renderer emits no `routes:`
  line; its absence is expected, not a finding. For a canvas, also say whether a
  reader could identify and navigate to each diagram from the drawing alone.
- **Structural shape in neutral terms:** node and edge counts, fan width out of
  the widest node, whether any box pair has edges in both directions and how
  many, whether a node receives arrowheads from two separate routes, whether the
  graph has disjoint worlds and how they are joined, identifier and qualifier
  density, and whether any ordering looks phase-like. These are observations, not
  verdicts — do not name a family and do not grade it yet.
- The generator's stated classification line verbatim (`family: …` /
  `evidence: …`), if it wrote one, and where it is stated.

Write `observed-first.md` and save it. Hash it with `shasum -a 256` and record
the hash. Do not modify it later. If evidence for something is missing, write
that it is missing; do not infer it from the spec.

## Deliverable for stage A

- `observed-first.md` — the blind record, organized per surface then per canvas.
- Its SHA-256, printed in your reply.
- A tool-usable blind scorecard, both per surface and as a canvas total: visible
  nodes, edges, routes, labels, group hue families, pinned ranks, crossings,
  uncertain label owners, clipped items, selected-state coverage, dot
  violations, near-miss routes, dot-hue matches and shared-hue pairs, and — for a
  canvas — diagram count, each diagram's title, description, origin and extent,
  whether any description misdescribes its own diagram, and whether any group tag
  changed hue between diagrams.
- The structural observation summary listed above, in neutral terms.
- Any evidence you could not read at all (unsupported format, missing file).

Do not read the source, the brief, the rubric, or the expected data. Do not run
new viewer sessions, do not fix anything, and do not spawn subagents. Use uv for
Python and intent comments on shell/Python calls.

Stop after stage A. The captain reveals expectations in a second message.
