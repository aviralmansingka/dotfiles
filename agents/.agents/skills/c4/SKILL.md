---
name: c4
description: C4 architecture views — system context, container and component levels — gathered from a codebase with scout subagents. Builds a level ladder (L0 system context, L1/L1b containers, L2/L2b components) as container boxes on the visualize canvas, with external systems outside every box and one wrapped description per level.
---

# c4

C4 answers "what is this system, what is it made of, and who calls whom"
at three zooms. The surface is the `visualize` engine: one rataflow canvas,
one described section per level, `containers` boxes for ownership. Read
`agents/.agents/skills/visualize/SKILL.md` for the renderer itself — this
skill only covers what C4 adds.

C4 adds three things `visualize` does not do:

1. **A level ladder.** L0 context, then L1/L1b containers, then L2/L2b
   components. Each level exists to motivate the next, and the level a
   reader is on is visible from the box, not from a legend.
2. **Fact gathering.** C4 must be complete about *who calls what and why*.
   Scouts read the codebase and produce an evidence-backed element and
   relation inventory before any spec exists.
3. **Containment as a claim.** A container box holds the component's own
   parts and nothing else. That is an ownership claim, so it needs
   sources, and it must survive a reader checking the box against the code.

Do not invent an element, a relation, or a boundary. If the scouts cannot
cite it, it does not get drawn.

## Routing

| Ask | Use |
|---|---|
| C4 levels of a component in a real codebase | this skill |
| One relationship graph from facts you already have | `visualize` |
| Diagram inside the chat reply | `mermaid` tool |
| Static ANSI / PNG | `mermaid` skill |
| Architecture *prose* page or deck | `artifact` skill |

`/c4 <component>` or "give me a C4 view of X" is the invocation. The skill
works in a repository it has never seen: the scouts are the only way it
learns anything, so nothing here depends on prior knowledge of the code.

## Step 0 — Pin the component

State, before any scout runs:

```
component: machine manager
repo root: /Users/aviral/modal
anchor:    machine_manager/  (one package, one deployable)
```

- **Component** is one thing a reader can point at in the code: a service,
  a package, one deployable unit. If the ask names a subsystem that spans
  several deployables, pick the deployable and say which neighbours it
  pulls in as externals.
- **Repo root** is where scouts start. Confirm the checkout exists; do not
  assume a path.
- **Anchor** is the strongest single piece of evidence that the component
  is one thing (package manifest, Helm chart, Terraform module, proto
  service, `main.go`). If you cannot name one, the component is probably
  two components — ask the human instead of guessing.

Ask at most one clarifying question (the component boundary is the only
one worth asking). Otherwise decide and record.

## Step 1 — Launch the scouts

Four prompts live in `prompts/`; each is a complete subagent task. Launch
them as `subagent` calls with `agent: "scout"` (read-only recon — scouts
must not edit the repository), all four in one turn so they run in
parallel, `cwd:` the repo root resolved in Step 0, and the component name
substituted for `<component>`:

| Scout | Prompt | Returns |
|---|---|---|
| Scope | `prompts/scope.md` | element inventory: id, one-line role, entry points, deployables, stores, external services, actors, file paths |
| Relationships | `prompts/relationships.md` | `from → to : verb + transport` rows, each with `file:line` |
| Boundary | `prompts/boundary.md` | members vs externals + the module/deployment boundary that justifies each membership |
| Levels | `prompts/levels.md` | level assignment per element, and which levels must split into L1/L1b (L2/L2b) |

Every scout returns **evidence with `file:line` references**. A row without
one is a rumour; drop it or re-ask that scout for a source.

**Launch the scouts from the repo root** — run the session there (or make
`cwd:` the same directory the session already sits in). A scout whose `cwd`
differs from the spawning session's can die before its process starts, and
the failure reads as "no pi process appeared in its pane".

Do not poll the subagents. The results arrive on their own; continue when
all four are back. If one fails, say which, and either retry it or record
the gap in the generation record — never fill the hole from memory.

## Step 2 — Reconcile into one ledger

Merge the four returns into three tables in the generation record. This is
the whole fact base; the spec may not contain anything that is not here.

```
elements:   id | label | role | class (actor|external|member|store) | evidence
relations:  id | from → to | verb + transport | level | evidence
boundary:   id | inside/outside | justifying boundary | evidence
```

- **Conflicts** are resolved by citing the stronger source (a manifest or
  deployment chart beats a comment; a call site beats a docstring), and
  the losing claim is recorded, not deleted.
- **Unresolved conflicts** and relations with no surviving source are
  recorded as open questions. Silence is a defect; a visible doubt is not.
- Keep one id per element and reuse it across levels, so a reader tracing
  `q → reg` sees the same two boxes at L1 and L2.

## Step 3 — What to draw (prioritisation)

A C4 view is a judgement about importance, not a dump of the call graph. The
ledger holds every relation a scout found; the diagram holds the ones a reader
needs, and says out loud what it left out.

**A relation earns a place when it meets at least one of these:**

| id | test | example |
|---|---|---|
| **I1** | it crosses the component boundary (member ↔ external, external ↔ external) | `webapi → Latitude API`, `machines → sshx.io` |
| **I2** | it is a primary request, control or data path the source calls out (provision, heartbeat, audit, reconcile, boot) | `control plane → private gRPC`, `River queue → workers` |
| **I3** | it carries a protocol or qualifier the reader needs: RPC verb, transport, port, bucket, interval, timeout | `register + heartbeat every 1 min`, `gcore sync every 1 min` |
| **I4** | it explains a data store or an actor the reader cannot infer from the boxes | `store → Postgres`, `ops + mmctl → webapi` |
| **I5** | it is one leg of a redundant or parallel path that must stay countable | `machines → boot` **and** `boot → machines`; two independent pulls |

**Drop classes — a relation leaves the diagram only as one of these:**

| id | class | what it is |
|---|---|---|
| **C1** | internal detail | wholly inside one container, adds no boundary, protocol or actor information (`worker → store` per-query row when the store's writers are already drawn) |
| **C2** | duplicate call site | the same hop as a drawn relation, differing only in job type or argument, which the drawn label already carries |
| **C3** | helper | an element whose only job is to re-enter the same container (a client wrapper between two drawn boxes) |
| **C4** | redundant leg | a further parallel leg of a path whose countability the reader does not need (a second artefact from the same bucket, same transport) |

Rules that keep the judgement honest:

- **One arrow may carry several call sites** when the label carries their
  verbs (`create / terminate / repair`). That is a C2 fold, not a deletion.
- **Boundary crossing wins a tie** (I1 before I3 before I2). A diagram that
  drops an external hop to make room for an internal one has inverted its own
  priorities.
- **When in doubt, draw it**, and let the level's description say why it is
  there. Doubt is not a drop reason; `C1`–`C4` are.
- **Never drop silently.** Every ledger row ends as one of: *drawn*,
  `folded into <drawn relation>` (with the fold justified as C2), or
  `omitted — C1|C2|C3|C4` with one line of why. The coverage map (Step 7)
  states the four counts: drawn, folded, omitted by class, unaccounted.
- **Scope reduction is a different thing and needs the caller's words.**
  "Only the control plane view" or "20 relations max" is a scope ask: record
  it as the basis (`basis: caller scope, N relations`) alongside the counted
  ledger. Prioritisation is the default; a *subset* is a decision the caller
  makes, not one the generator infers.

## Step 4 — The level ladder

**The target shape is five sections, top to bottom:**

```
L0 · System context      one node for the component + its neighbours
L1 · The component       the component opened once, container on its parts
L1b · <second side>      the same depth, the other side of the system
L2 · Inside — <slice A>  relations between members, container on them
L2b · Inside — <slice B> the same depth, the other slice
```

That is the ladder: a five-section canvas is the deliverable. More sections
is a defect unless the splitting discipline below is satisfied, with numbers.

Draw each level only after the one above it exists, and give each one its
description before moving on.

| Level | Draws | Box behaviour |
|---|---|---|
| **L0 system context** | the component as ONE plain node, plus every actor and external system around it, plus the coarse arrows between them | **no container, no `focus`, no double border** — the point is the surrounding world, so the component looks like any other box |
| **L1 containers** | the component opened one level: its own deployable/runtime units **inside** one container; the L0 externals stay outside | container box on the members |
| **L1b side view** | the optional second slice when one L1 genuinely cannot hold the flow (the fleet end, the data plane, the batch path) — measured, never a new topic | container, same rules |
| **L2 components** | the relationships **inside** one container — the members of L1, now calling each other | container box around them |
| **L2b** | optional second slice of the same depth when one L2 cannot route its relations, or two stories need separate ranks | container, same rules |

Level rules that are not negotiable:

- **L0 is the component as ONE plain node.** One box for the whole
  component, its normal border, plus the actors and external systems around
  it. Not its parts, not its listeners, not its tables — those are the *next*
  level. If L0 has more than one node that belongs inside the component, it
  is not a context view. Containment at L0 would claim internals the reader
  has not been shown yet, and `focus` would point at a level that does not
  exist yet.
- **L1/L1b open L0's box.** Every member sits inside the container; every
  element that was an external at L0 sits outside it. A member that cannot
  be drawn outside the box's bounding box gets its own container entry
  (see Contiguity) — never a fudged one.
- **L2/L2b stay inside one box.** Both endpoints of every L2 relation are
  container members. If a relation leaves the box, it belongs at L1/L1b.
- **A level describes itself.** Title is short (`L0 · System context`);
  the description states what is inside the box, what is outside it, and
  how it relates to its neighbour level. Aim for 2–3 wrapped rows.
- **Motion is not a C4 property.** Levels 0–1b are static (`dots: 0`). An
  internal level whose relations are live flows may carry exactly one dot
  per route (`flow: true, dots: 1`); record the choice. Never animate an
  external arrow to decorate the ladder.

### Splitting discipline — a level is a DEPTH, not a topic

A C4 level answers one question at one zoom. Two levels of the same depth
exist only because one section could not hold the content; a new *topic* is
not a reason to add a section.

- **Never add L1c, L1d, L1e or a fifth *side*.** The ladder has three
depths (context, containers, components) and at most two slices at each
depth below the first. A canvas that grows a slice per subsystem or per
mention is a topic list wearing level titles.
- **A second slice must name its measurement:** the routes `--check`
  refuses, the shared corridor it reports, or the ranks that collide (two
  external ends with no external in common). "It felt crowded" is not one.
- **Same-depth slices share the box, the labels, and the ids.** L1 and L1b
  draw the same component with the same member ids; L2 and L2b draw the same
  members. Only the edge set and the ranks differ, and each description says
  which slice it is.
- **A slice is named `b`** (`l1b`, `l2b`); never invent a depth.
- **Depth beyond L2 is not drawn.** If component internals still decompose,
  say so in the record and stop: code classes and functions are not a C4
  level a reader asked for. The ladder ends where the ask ends.
- **Everything the ledger holds and the ladder does not draw is a scope
  decision, written down** (Step 6), not a silent deletion and not a new
  section.

## Step 5 — Spec mechanics

One canvas, one reading direction, one section per level:

```json
{
  "direction": "lr",
  "theme": "gruvbox",
  "diagrams": [
    {
      "id": "l0",
      "title": "L0 · System context",
      "description": "System context: the manager is one box. ...",
      "nodes": [ ... ],
      "edges": [ ... ]
    },
    {
      "id": "l1",
      "title": "L1 · The manager",
      "description": "L0's box opened one level: ...",
      "containers": [ { "label": "Machine manager", "members": ["api", "q", "db"] } ],
      "layers": [ ["actor"], ["api", "q"], ["db"], ["prov"] ],
      "nodes": [ ... ],
      "edges": [ ... ]
    }
  ]
}
```

- **`direction: "lr"` once**, on the canvas. Never a per-diagram override:
  a reader who re-orients on every section has lost the ladder.
- **Five sections.** `l0`, `l1`, `l1b`, `l2`, `l2b`, in that order. A sixth
  section needs Step 3's measurement recorded; a canvas of ten or twenty
  sections is a topic list, not a ladder — fold it back to three depths
two slices each.
- **`containers` is a per-diagram list** of `{label, members}`. The box is
  a real double-bordered rectangle grown around the members, with the
  label set into its top edge. Several boxes per diagram are allowed.
- **Member ids must exist in that diagram's `nodes`.** A member id that
  names no node is silently dropped by the parser — the box then draws
  around fewer nodes than you claimed and `--check` does not warn. Count
  the drawn box against the members you declared.
- **Contiguity rule.** A container is a rectangle: it swallows everything
  inside its members' bounding box, externals included. Put the members
  in one band (a rank, or a short chain) and give a non-contiguous group
  its own `containers` entry. Two honest boxes beat one box that claims
  four externals.
- **`layers` is optional.** Use it to pin the source's own ranks (actors
  in, stores out) when the engine's ordering would interleave an external
  between members. Prefer omitting it.
- **Descriptions: 1–3 wrapped rows, ≤96 columns, no ellipsis.** The engine
  wraps at 96 and hard-caps at 3 rows, ellipsising the tail. `--check`
  echoes the raw text and does **not** warn about the cut, so count
  characters yourself: 288 is the ceiling, 240 leaves margin. No hand-made
  line breaks — a multi-line description is rejected.
- **Sizes.** Aim for each level inside 77×47. A larger canvas is allowed
  and pans; zoom-out is capped at 100%, so a level that needs more than
  the tab simply pans. Record any level that needs panning.
- **Verify at the natural fit.** `--check` prints `drawn whole at 100%`.
  Container borders are exact at natural fit and can drift on a panned or
  centred viewport — that is a known residual of the renderer, not a spec
  error. Do not "fix" it by moving nodes.

## Step 6 — Check

```sh
BIN=$(command -v rataflow-view)      # absolute path; record its sha256
"$BIN" --check <spec>
```

The line must read:

- `0 near-misses`
- `labels: N/N placed, ... 0 on route, 0 skipped, 0 ambiguous owners`
- `0 violations` on the `dots:` line
- `crossings: 0 bridges, 0 touching bends`
- `canvas: N diagrams on one canvas, drawn whole at 100%`

Then inspect the render itself, because `--check` never looks at a box:

- every external is **outside** every container box, and every member is
  **inside** one — traced on the capture, not assumed;
- no label is covered by a crossing edge, and each level's description is
  fully readable (no ellipsis, no clipped row);
- each level's arrows cross the box border, never run along it.

Containment, read off the plain-text dump: find the container's top border
row (the row carrying `╔═<label>`), then the node cells on it and immediately
below; the topmost member's top-left corner is on that row too. Repeat for the
bottom border and the side columns. A member outside the borders, or a
neighbour node between them, is a contiguity bug (Step 4), not a renderer bug.

Capture the text and the styled frame at the target viewport (77×47 pane
or the exact canvas size), exactly as `visualize` Step 8 requires. A
`--check` line alone is not proof that the boxes are right.

## Step 7 — Coverage map, counted

Every ledger row is accounted for, and the map says how many of each:

```
ledger rows: 97
  drawn:            29
  folded:           47   (C2 duplicate call sites, into named relations)
  omitted:          21   (C1 .. C4, one line each)
  unaccounted:       0   ← this number must be 0
```

- **Drawn** rows name the level and the label carrying them.
- **Folded** rows name the drawn relation they fold into, and the fold must
  read as C2: same hop, same meaning, only the job type or argument differs.
  A fold that changes the meaning (a different writer, a different store) is
  an omission, not a fold.
- **Omitted** rows carry a class id (`C1`–`C4`, Step 3) and one line of why.
  `C1` is the common case inside a container; `C4` covers a second artefact of
  the same pull.
- **Unaccounted must be 0.** If the four numbers do not add up to the ledger,
  a row vanished; find it before reporting.
- **Basis line.** State which basis the relation set used: `basis: prioritised
  (I1–I5)` by default, or `basis: caller scope — <the ask>` when the caller
  limited the view. A diagram must not claim the default basis when it drew a
  subset for another reason.

Write the map next to the spec, one row per ledger row:

| row | disposition | level | drawn as / fold target / class |
|---|---|---|---|
| e1 | drawn | L1 | `cp → api` create / terminate / repair |
| e2 | folded | L1 | into e1 — C2, same hop |
| e10 | omitted | — | C1 — internal store write, no boundary info |

- **External → external relations** (machines pulling from object storage)
  have no container to live in. L0 is their level; draw them there and
  say so, rather than forcing them into L1.
- **L0's coarse arrows are not extra relations.** They summarise lower
  levels (`manager → providers` standing for two L1 edges). Record each
  summary with the relation ids it covers, so the reviewer can check
  nothing is counted twice or lost.
- **A split level keeps both halves honest.** When L2 splits into L2/L2b,
  the box, the labels and the ids stay identical; only the edge set and
  the ranks differ, and each description says which slice it is.

## Step 7 — Record

Write these next to the spec, so the ladder can be audited without rerunning
anything:

```
<prompt outputs>.md        the four scout returns, verbatim
ledger.md                  elements, relations, boundary tables (Step 2)
priorities.md              top relations in, with the I-criterion for each;
                           the drop classes out, with counts
coverage.md                every ledger row: drawn / folded / omitted, plus
                           L0's coarse arrows and the basis line
generation.json            triage, ladder, deviations, known residuals
check.txt                  full --check output, binary sha256
captures/                  text + ANSI frame per level, one --select-all frame
comparison.md              only when a reference render exists
```

Record deviations and their reason, not just the result. A split level, a
level that pans, a relation that needed a second box — each is a recorded
choice, and an unrecorded one is a defect.

## When something goes wrong

- `unknown field` — the installed binary predates the spec form. Rebuild:
  `cargo install --path rataflow --locked` from the dotfiles checkout, record
  the new `sha256`, and say which build drew the captures. Two round-14
  behaviours exist: the earlier one offsets container borders by a row, the
  later one draws them exactly and gaps the border only where a route crosses.
- A member sits outside its box, or the box eats an external — the members
  are not contiguous. Split into two `containers` entries; do not nudge.
- A level overflows its pane — that is allowed (it pans), but first try
  shortening labels and dropping `layers`; panning is the last resort and
  must be recorded.
- More than six sections, or L0 with several component-owned nodes — you
  are drawing topics, not levels. Collapse to L0/L1/L1b/L2/L2b and move the
  extra detail into the coverage map.
- Two relations need the same corridor and `--check` reports a shared
  corridor — add a level, never delete a relation.
- No evidence for a relation — it is not drawn. Say which claim is
  unsupported and where you looked.
- Outside Herdr (`HERDR_ENV` unset) — render to `--check` plus text dumps
  and say the pane capture did not run.
