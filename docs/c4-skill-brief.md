# Brief — the `c4` skill

Build a skill that produces **C4 architecture views** with the `visualize`
engine's `containers` feature, gathering its facts with scout subagents.
The reference output is the approved machine-manager diagram
(`docs/visualize-eval/rounds/14/c4-l0/`): one canvas, a level ladder,
container boxes, and three-row descriptions.

## Why a separate skill

`visualize` draws relationships from facts the caller already has. C4 adds
three things it does not do:

1. **A level ladder** — L0 system context, then L1/L1b container views,
   then L2 component views. Each level exists to motivate the next.
2. **Fact gathering** — C4 must be complete about *who calls what and
   why*. Scouts read the codebase and produce an evidence-backed element
   and relationship inventory before any spec exists.
3. **Containment** — a container box holds the component's own parts and
   nothing else. That is a claim about ownership, so it needs sources.

## Level ladder (the shape that was approved)

| Level | Draws | Box behaviour |
|---|---|---|
| **L0 system context** | the component as ONE plain node, plus every actor and external system around it | no container, no double border — the point is the surrounding world |
| **L1 containers** | the component opened one level: its own deployable/runtime units inside a container, the externals from L0 outside | container on the internals |
| **L1b side view** | optional second slice when one level cannot hold the flow (e.g. the machine side of a control plane) | container, same rules |
| **L2 components** | the relationships *inside* one container | container |
| **L2b** | optional second slice of the same depth | container |

Every level carries a **description of one to three wrapped rows** (≤96
columns each) stating what is inside the box, what is outside, and how it
relates to its neighbour level. Titles stay short.

## Fact gathering — scout protocol

Before generating, gather facts. Do not invent an element or a relation.

- **Scope scout** — where the component lives: entry points, deployable
  units, data stores, external services it calls, and the actors that
  drive it. Output: element inventory with file paths.
- **Relationship scout** — for every element pair, the relation verb, the
  transport (gRPC, HTTP, SQL, queue, SSH, …) and its direction. Output:
  `from → to : verb + transport` list with sources.
- **Boundary scout** — what is INSIDE the component and what is a
  neighbour. This is the containment claim: cite the module/package or
  deployment boundary that justifies each member.
- **Level scout** (optional) — which elements belong to which C4 level,
  and why a level needs splitting into L1/L1b.

Each scout returns **evidence with file:line references**. The generator
reconciles them into one ledger; conflicts are resolved by citing the
stronger source, and unresolved conflicts are recorded, never silently
dropped.

**Completeness rule:** every element and relation a scout reports appears
in some level. If a level cannot hold it, add a level; never delete a
relation to make a diagram fit. Record a relations→level coverage map in
the generation record.

## Spec mechanics (the parts that are easy to get wrong)

- One canvas, `"direction": "lr"`, no per-diagram overrides.
- `"containers": [{"label": "...", "members": [...]}]` per diagram. The box
  is a real double-bordered rectangle grown around those members with the
  label set into the top edge.
- **Members must be contiguous.** A container is a rectangle: anything
  inside the members' bounding box is swallowed. Give a non-contiguous
  service its own `containers` entry rather than letting the box take the
  externals.
- At L0 the component is a **plain node** — no container, no `focus`.
- Descriptions: 1–3 wrapped rows, ≤96 columns, no ellipsis.
- Sizes: aim for a level inside 77×47; a larger canvas is allowed and pans,
  but zoom-out is capped at 100%, so a level that needs a wider pane than
  the tab simply pans.
- Verified at the natural fit. A container border is exact there and can
  drift on a panned pane; if a level needs panning, record it.

## Verification before claiming success

- `rataflow-view --check <spec>`: `0 near-misses`, `labels N/N, 0
  ambiguous`, `0 dot violations`, `0 crossings`.
- Inspect the render: every external outside every box, every member inside
  one, no label covered by a crossing edge, descriptions readable.
- Compare against the golden render at the same size; differences in level
  structure or coverage are defects, cosmetic differences are not.

## Deliverable

`<skill dir>/SKILL.md` plus any scout prompt files it needs. The skill is
invoked as `/c4 <component>` (or by description: "give me a C4 view of X"),
and it must work in a repository it has never seen by running its scouts
first — no prior knowledge of the component's internals.

## Acceptance test

Run the skill against **modal-machine-manager** in the `modal` repository.
The produced ladder must match the golden diagram on: level set (L0, L1,
L1b, L2, L2b), containment (which elements are members vs externals), and
relationship coverage (all 23 source relations, once each). Cosmetic
differences and level-splitting choices are acceptable when recorded.
