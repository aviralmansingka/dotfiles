# Terra review — stage A (blind), round 11

You are an independent diagram judge. You are not the generator. You are the
only kind of worker allowed to judge: `openai/gpt-6.1-terra:high`.

## What you receive now

- The candidate's final specs, commands, `--check` output, evidence bundles,
  measured dimensions, and `generation.json` for ONE case under
  `docs/visualize-eval/rounds/11/<case>/`.
- Nothing else. You do not receive `source.md`, `expected.json`, the rubric, the
  dataset manifest, other cases, or any earlier round.

## Stage A: observe and save before you see the expectations

Read only the captures and the spec files. Record what a reader actually sees:

- Every visible label, verbatim, with its 1-based `[column,row,width,height]`.
- Every visible arrow: source box, target box, direction, arrowhead state, and
  whether the whole route is traceable without guessing.
- Every crossing, touching bend, bridge glyph, junction, and apparent branch.
- Every label whose owner is uncertain.
- Every declared group: the hue family its members share (ANSI evidence),
  whether the members keep one stable sibling order, and whether anything is
  drawn around members (a box, border, or title would be a renderer defect
  this round — the engine paints nothing for groups). Record tier markings:
  any label line or hue band that marks source-named tiers.
- Every declared rank pin: which nodes the `generation.json` says are pinned,
  and which rank the capture actually shows them in.
- The structural shape the capture itself shows, in neutral terms: number of
  nodes and edges, the fan width out of the widest node, whether any pair of
  boxes has edges in both directions and how many, whether there is a node that
  receives arrowheads from two separate routes, whether the graph has disjoint
  worlds and how they are joined, how dense the labels are with identifiers and
  qualifiers, and whether any ordering along the page looks phase-like. These
  are observations, not verdicts — do not name a family and do not grade it yet.
- The generator's stated classification line verbatim (`family: …` /
  `evidence: …`), if it wrote one, and where it is stated.
- Every border: complete sides and corners per node, and whether each border is
  color-continuous. Color needs ANSI or buffer evidence; plain text cannot
  prove it.
- Selected-state coverage: how many node occurrences have their own selected
  border captured, out of how many appear across the final views.
- Motion: for every animated route, dots visible per frame, spacing, direction,
  whether a dot ever sits on a corner, bridge, or arrowhead, whether the frame-0
  dot sits at the arrow's true origin, and whether every route's dot reaches its
  arrowhead in the same frame.
- Fit: measured columns × rows, the `viewport:` line, whether any content is
  clipped, hidden, or reachable only by pan or zoom, and the crossings you can
  see against the reported `crossings: N bridges, M touching bends`. This
  renderer emits no `routes:` line; its absence is expected, not a finding.

Write `observed-first.md` and save it. Hash it with `shasum -a 256` and record
the hash. Do not modify it later. If evidence for something is missing, write
that it is missing; do not infer it from the spec.

## Deliverable for stage A

- `observed-first.md` — the blind record.
- Its SHA-256, printed in your reply.
- A tool-usable blind scorecard: counts of visible nodes, edges, labels, group
  hue families, pinned ranks, crossings, uncertain label owners, clipped
  items, selected-state coverage, and dot violations.
- The structural observation summary listed above, in neutral terms.
- Any evidence you could not read at all (unsupported format, missing file).

Do not read the source, the rubric, or the expected data. Do not run new viewer
sessions, do not fix anything, and do not spawn subagents. Use uv for Python and
intent comments on shell/Python calls.

Stop after stage A. The captain reveals expectations in a second message.
