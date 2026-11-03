# Brief — modal-machine-manager (full-system ask, one canvas)

**Framing:** full-system. Every relation, one canvas, the reader navigates.
**Facts:** unchanged from
`docs/visualize-eval/cases/modal-machine-manager/source.md`
(`source_sha256 a41065d9ceca1ed035bfd6282f0e937abbd0034ad497a33637a76f2d8a9ebab3`).
This brief changes only the voice of the request.
**Triage annex:** `TRIAGE-modal-machine-manager` (generator-task.md, TRIAGE
PROTOCOL). Expected triage load: light — the reader's preferences are explicit;
the skill's job is to choose the split, not the shape.

## The request

> I want the whole machine manager, not an overview: all seventeen components
> and all twenty-three relations, each one somewhere I can point at. Put it on
> one canvas if that's what it takes — I'd rather pan around a big drawing with
> named, described sections than lose the heartbeat path or the ops path. Keep
> the request, heartbeat, provisioning, boot, diagnostics and reconcile paths
> recognisable, keep the live transitions readable in one direction, and give
> them slow dots — one per line, none on borders, none on the historical hops.

## The reader's job

Navigating one large drawing to answer "where does this path go?". They will use
the diagram descriptions to jump between the request path, the heartbeat path and
the slow ops path, and then trace one route inside a diagram. They care that
nothing was merged to save space and that the reconcile loop's minute cadence
survives.

## What this framing exercises

- **Triage:** light. Shape and motion are stated; the open questions are which
  concepts separate into diagrams and whether `provider registry` / `machine
  agent` are grouped (the source permits grouping, never dropping).
- **Canvas:** the flagship case for branch B of the dual fit rule. Twenty-three
  relations cannot fit 77x47 honestly, so the test is whether the generator
  declares a canvas with accurate per-diagram titles and descriptions, reports
  per-diagram extents, and still keeps every relation traceable inside its
  diagram — rather than shrinking the drawing or thinning it.
- **Density:** highest in the set after datacenter; the previous rounds' failure
  mode was sparse over-splitting, so this framing also tests the density hint
  reading as a hint.
- **Motion:** required by `cases.json`. One dot per live transition, constant
  speed, none on historical hops, and round 13's dot-hue binding: each dot takes
  its route's source-or-destination hue by least-conflict choice on a dense
  canvas.
- **Grouping:** case-wide hue families across every diagram of the canvas, since
  `control`, `state`, `hardware`, `humans` and `ops` all recur across the split.

## What must not change

All 17 nodes and 23 directed relations of `source.md`, including both
`mch -> boot` (iPXE request) and `boot -> mch` (boot.ipxe + S3 args), the
janitor-to-webapi proposal path, and the separate `q -> s3` diagnostics relation;
plus the fixed constraints — cover every component across views, never delete a
relation to fix routing, slow sparse dots on selected communication edges only.
