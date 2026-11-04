---
name: visualize
description: Live, ratatui-rendered visualizations in terminal panes — today the rataflow node graph, drawn either as one view beside the chat text or as one large canvas of described sections with C4-style zoom-in containers, with semantic group colors, declared trunks, routed arrows, single-dot motion, and an independent Astra readability review. Build a JSON spec and open it with the rataflow-view binary in a herdr pane the human can drag, pan, and zoom. For HTML artifacts (decks, dashboards, infographics) use the artifact skill; for diagrams inside the chat reply use the mermaid tool; for static terminal art or PNG export use the mermaid skill.
---

# visualize

Live visualizations rendered by ratatui, in a real terminal pane — the
surface the chat transcript cannot host, because it cannot run a TUI.
Today this skill renders node graphs: the `rataflow-view` binary (crate at
`rataflow/` in the dotfiles repo, built on the rataflow library) turns a
JSON spec into a pane the human can drag, pan, and zoom.

Clarity over size. A diagram that draws every relationship and still
loses its meaning has failed: meaning comes first, layout second, pixels
third. So one view when one view tells the story, one large canvas when
it does not, and never a thinned-out diagram to reach a number.

The viewer never shrinks text to fit (see Sizing). It fits at 100% and no
less, so a drawing larger than the pane pans instead of losing its labels.

## Routing: pick the surface first

This skill owns the ratatui surfaces — live, terminal-native rendering.
The vendored `artifact` skill routes graph-shaped requests here by
default. The full surface map:

| Destination | Use |
|---|---|
| pi chat reply | `mermaid` tool (grok-mermaid) |
| Static ANSI in shell output or a file | mermaid skill → mmdflux |
| PNG image | mermaid skill → mermaid.ink |
| Live interactive node graph in a pane | this skill → rataflow-view |
| HTML page (deck, dashboard, infographic) | artifact skill → terminal-browser pane |

Never paste rataflow pane art or ANSI escapes into pi chat or nvim buffers.

Use rataflow-view when the human should *explore* the graph: tracing
edges, zooming into one region, dragging boxes. Use mermaid when the
diagram is part of an answer.

An architecture request with levels — a system, then the system's insides
— belongs here too: that is the canvas form with zoom-in views below.

## Step 0 — Triage: ask until you know what to draw

Before the spec, find out what the picture is for. Ask focused questions,
**one at a time**, until the source is understood, the reader's job is
known, and the shape is chosen.

- **Do not draw a vague picture.** If the request leaves the reader's
  job, the scope, or the level open, ask.
- **Ask when the answer changes the result.** "Several panes, or one pane
  with everything on one canvas?" is worth asking when the source is
  big enough that the choice decides the layout. It is not worth asking
  when the honest answer is obviously one small view.
- **Use a larger canvas freely.** The reader navigates by pan and zoom,
  so size is not something to negotiate. Never feel constrained by what
  the source requires; take the room it needs.
- **Stop asking once the picture is clear.** You own the judgment of when
  understanding has converged; do not pad the conversation with questions.

## Read the relationships first

This skill is not a network-diagram tool; it draws *relationships*. Before
writing the spec, say what each relationship is — one sentence per edge
group is enough:

- **Direction.** Every edge points somewhere. `from` is the producer,
  sender, or caller; `to` is the consumer, receiver, or callee. If the
  relationship is bidirectional in reality, draw two edges or pick the
  dominant direction and say so in the label.
- **Names.** Label edges with the relationship, not the endpoints: verbs
  or link tech ("enqueue", "grpc", "10 GbE", "replicates"). Label nodes
  with what they *are*, a few words at most.
- **Coverage.** Every relationship and every named component the source
  states is content. An edge that carries a protocol, a qualifier, or a
  direction of control is a relationship, not decoration.

## Spec format

Write a JSON file. Nodes are optional — every edge endpoint becomes a
node, and `label` defaults to `id`:

```json
{
  "direction": "lr",
  "theme": "gruvbox",
  "nodes": [
    { "id": "wan", "label": "WAN" },
    { "id": "fw", "label": "Firewall" },
    { "id": "core", "label": "Core switch" },
    { "id": "web", "label": "Web tier" }
  ],
  "edges": [
    { "from": "wan", "to": "fw", "label": "1 GbE" },
    { "from": "fw", "to": "core", "label": "10 GbE" },
    { "from": "core", "to": "web", "label": "10 GbE" }
  ]
}
```

- `direction`: `"tb"` (default) or `"lr"`.
- `theme`: `"gruvbox"` (default), `"dark"`, `"light"`.
- `edges` is required and needs at least one entry. `from` and `to` must
  be non-empty. Node ids must be unique. Unknown fields are rejected and
  the error names the problem — fix what it names and re-run.
- `nodes[].group`: a semantic group name, not a rank (see How it draws).
- `nodes[].focus`: `true` draws that node's border double — the box a
  later section expands (see Zoom-in views). It changes the border only.
- `flow` on an edge: `true` or a small positive number — dots travel
  `from → to` along the line. One speed unit is about 10 cells per second;
  keep values at or below `0.5`. Dots sit at least 7 cells apart.
- `dots` on an edge: `1` keeps exactly one live dot on that route,
  `0` draws none. Use it when the source animates one thing at a time.
- `style` on an edge: `"solid"` (default) or `"dashed"` for an uncertain
  link. Keep the uncertainty in the label text too, so color is not the
  only carrier.
- `layers`: optional explicit placement — an array of arrays, one inner
  array per layer (a row in `tb`, a column in `lr`); the declared order
  runs across the perpendicular axis, and `""` reserves a slot.
  Every node must be placed exactly once.
- `trunks`: one shared bus drawn as a single corridor that splits, one
  spur per branch: `{ "id": "oob", "label": "OOB LAN", "from": "sw",
  "to": "nvos", "branches": ["c1", "c2", "c3"] }`. Use it only for a bus
  the source really shares; three independent lines are not a trunk.

## One canvas, several described diagrams

When the source has more than one concept, or one concept that does not
fit, keep every concept and stack it on ONE canvas. A canvas spec declares
`diagrams` instead of top-level `nodes`/`edges`:

```json
{
  "theme": "gruvbox",
  "diagrams": [
    {
      "id": "l0",
      "title": "L0 — machine manager and its neighbours",
      "description": "Who calls the machine manager, and what it owns.",
      "direction": "lr",
      "nodes": [
        { "id": "cli", "label": "mmctl", "group": "humans" },
        { "id": "mm", "label": "Machine manager", "group": "control",
          "focus": true },
        { "id": "db", "label": "Postgres", "group": "state" }
      ],
      "edges": [
        { "from": "cli", "to": "mm", "label": "gRPC" },
        { "from": "mm", "to": "db", "label": "SQL" }
      ]
    },
    {
      "id": "l1",
      "title": "L1 — inside the machine manager",
      "description": "The components in the box above, and how they talk.",
      "direction": "lr",
      "nodes": [
        { "id": "cli", "label": "mmctl", "group": "humans" },
        { "id": "api", "label": "webapi", "group": "control" },
        { "id": "river", "label": "River queue", "group": "control" },
        { "id": "rec", "label": "reconciler", "group": "control" },
        { "id": "db", "label": "Postgres", "group": "state" }
      ],
      "containers": [
        { "label": "Machine manager", "members": ["api", "river", "rec"] }
      ],
      "edges": [
        { "from": "cli", "to": "api", "label": "gRPC" },
        { "from": "api", "to": "river", "label": "enqueue" },
        { "from": "river", "to": "rec", "label": "job" },
        { "from": "rec", "to": "db", "label": "SQL" }
      ]
    }
  ]
}
```

- A diagram is `{ id, title, description, direction, nodes, edges,
  containers, layers, trunks }`. A spec declares either `edges` or
  `diagrams`, never both. `nodes`, `layers`, and `trunks` live inside each
  diagram. The canvas `theme` and `direction` are handed down; a diagram
  may override its own `direction`.
- Sections stack in declared order: a rule, the title, the description,
  one blank row, then the drawing. The dividers are uniform — every rule
  spans the widest band — and the first section carries a top rule too,
  so the canvas reads as evenly divided bands.
- The description wraps to at most three rows of 96 columns, so a section
  can say what it shows. Give every diagram a title and a description;
  `--check` warns when a description is missing, because the headings are
  how a reader navigates a large canvas.
- Diagram ids are their own namespace: two diagrams may both declare
  `api`, and they stay two different boxes.
- Group names stay stable across the canvas: the same group keeps the
  same hue family in every section, so color follows the concept from
  section to section instead of restarting per diagram.

## Zoom-in views (C4-style)

When the source has levels — a system, then that system's insides — draw
the zoom chain instead of repeating one box everywhere.

- **Containers make containment literal.** Name the nested cells in a
  `containers` entry on the section that holds them:
  `"containers": [{ "label": "Machine manager", "members": ["api",
  "river", "rec"] }]`. The box is drawn as a labelled double-bordered
  rectangle around those members, its label set into the top edge, and
  the members render inside it. A reader sees the contents sitting in the
  box instead of inferring them from a tag. Several containers in one
  section are allowed.
- **Keep the members contiguous.** A container is a rectangle, so it
  swallows everything inside its members' bounding box: put the nested
  cells in one band or a short chain, or the box encloses the external
  actors that happen to sit between them. If a service must stay apart
  from the rest, give it its own container entry.
- **Relations cross the boundary, they never run along it.** An edge
  leaving or entering the box keeps its own cells, so the border shows a
  gap where the relation passes: that reads as a connection, not a break.
- **The zoom parent wears a double border** when `"focus": true` is set on
  the node the next section expands. That is a plain extra ring around
  that one node and nothing more; it is optional, so set it when the
  reader also needs to know which box opens next.
- **A double border is a claim of containment.** It encloses its node and
  nothing else, with at least one blank cell of padding on every side.
- **No route may pierce the ring.** An arrow attaches to the outer ring,
  or the ring breaks at that cell the way a container border does — never
  a line through an intact ring.
- **If the renderer cannot honour this, do not set `focus: true` on a node
  that has edges.** Name the zoom parent in the section title, or repeat
  it as the container in the next section, and report the defect instead
  of shipping a pierced ring.
- **The level ladder.** L0: the component as one plain node among its
  neighbours. L1: its internals, sitting inside a container, with the
  external actors outside. L2: the internals' own relationships, drawn
  inside that same container so the context survives the zoom. When a
  level needs two diagrams, suffix the id (`l1` and `l1b`) and keep the
  titles in ladder order, so the reader can say where they are.

## How it draws

The renderer owns the character grid, so the rules are predictable:

- **Separate relationships.** Every edge needs a distinct source, route,
  and target. A crossing must not look like a branch. Check the actual
  render; separate ports alone do not prove separate routes.
- **Ports fan out.** A node widens to fit its busiest side, so parallel
  edges leave from separate cells. Fan-in lands on separate cells too.
- **Forward edges follow the flow.** In `tb`, an edge to a later layer
  leaves the bottom and enters the top, however far apart the boxes sit.
  Same-layer and backward edges are routed by geometry and cost more
  space — avoid them in a layered spec.
- **Arrow attachment matters.** Each edge needs a clear source stem and
  an arrowhead that points into its target. A sideways start, missing
  arrowhead, or detached arrowhead fails the readability check.
- **Color encodes the concept group.** A `group` name gives its members
  one hue family derived from that name, siblings take related shades,
  and every other group gets a different family; the same group keeps its
  hue in every section of a canvas. Edges stay one muted stroke, and the
  accent marks selection and flow dots only. Group by what the source says
  belongs together — control plane, data plane, storage, physical plant,
  humans — never by row or column, because layout depth is not a concept.
  A node with no honest group stays ungrouped rather than being forced
  into one for tidiness. The engine paints nothing around a group:
  grouping is color and order, not a box.
- **Labels use free space** after routing. A label with no free slot is
  omitted; `--check` reports the count. An omitted relationship label is
  a defect to fix, not proof that the diagram is simpler. In a `tb` view a
  labelled rank gap costs the label's length in rows; set
  `"label_slot": true` on that edge to give the label a horizontal gutter
  band beside its own run instead, which keeps tall labelled views short.
  Never shorten the words to buy rows.
- **Boxes are at least 4x4 cells.** The library places connection handles
  at the box centre; a 3-cell box puts that handle on a corner.
- **The engine owns placement.** Write nodes, edges, groups, trunks, and
  containers — never coordinates. It ranks by longest path and orders each
  rank to reduce crossings, so crossing-free routing and unambiguous label
  owners are structural, not lucky. Iterate on the split, not on placement
  by hand.

## Sizing: the view ladder

A view beside the chat shows about **77×47 cells** at natural zoom, which
comfortably holds **~12 nodes and ~16 edges**. Those numbers are hints for
when this rung usually applies, never budgets. In preference order:

1. **One concept that fits at natural zoom → one view.** Readable beside
   the chat, no pan needed.
2. **Several concepts, or a graph too large to fit → ONE large canvas** of
   described sections (the `diagrams` form above). Splitting concepts into
   sections is good; they share one canvas, and the reader navigates it by
   pan and zoom.
3. **Never drop or thin a source concept to fit a number, a pane, or a
   canvas.** If something cannot fit, say so and add a section. A dropped
   component or relationship is a defect, however clean the render looks.

- **Orientation.** `lr` spends width, `tb` spends height. A chat-beside
  pane is taller than it is wide but the graph text is wide: use `lr` for
  chains of 5 or more layers, `tb` for 4 layers or fewer. Keep one reading
  direction across a canvas; mixed directions make a reader re-orient on
  every section.
- **Labels:** node labels a few words; edge labels 14 characters or fewer.
  Node width follows the label, so a long label widens the whole column.
- **Depth:** `layers` is the tightest placement. Keep them at most ~7.
- **Density per layer:** 3 nodes per layer reads well; 4 starts to crowd.
- **The fit never shrinks text.** The viewer fits at 100% and no less. A
  single view larger than the pane is cut and reports `canvas WxH at 100%
  · drag to pan` in the corner — shrink that spec. A canvas reports its
  extent in the header and pans by design; that is the point of rung 2.
- The engine reserves the corner slot the control palette floats in. Check
  in the capture that no node border cell sits under it.

`--check` prints the drawing's extent in cells. Compare it with the pane
size before opening anything.

## Open the viewer

Validate the spec before opening anything — the check needs no terminal:

```sh
rataflow-view --check "$SPEC"
```

It prints a summary, the extent, and a warning line for each problem it
can predict without drawing: density above the readable hint, two edges
sharing a corridor, edge labels with no free slot, routes hugging a node
their relation does not serve, and a section without a description. Read
every line; before opening the pane these must hold:

- `crossings: 0 bridges, 0 touching bends`.
- `near-misses: 0` and `passes-near-unrelated-node: 0`.
- `labels: N/N placed`, `0 on route`, `0 skipped`, `0 ambiguous owners`.
- `dots: … 0 violations`, and `origins: N/N` when anything is animated.
- Per section on a canvas: its extent, its `double border` zoom parents,
  and its `enclosed` boxes or entrances when a level uses an enclosure.

Then open the pane. Inside Herdr, split and launch:

```sh
test "${HERDR_ENV:-}" = 1
herdr pane split --current --direction right --ratio 0.5 --cwd "$PWD" --no-focus
# the JSON response carries the new pane id at .result.pane.pane_id
herdr pane run <pane-id> "rataflow-view <spec>; herdr pane close <pane-id>"
```

- The launch command is self-cleaning: when the app exits — `q`, Esc, or
  Ctrl+C — the trailing `herdr pane close` removes the pane.
- `--ratio 0.5` is an even split. Split direction follows the herdr
  geometry rule: `right` when the calling pane is wide, `down` when it is
  narrow or tall.
- Read the render with `herdr pane read <pane-id> --source visible`.
  Check all of these:
  1. The `rataflow-view · …` header proves the app started, not readability.
  2. Every complete node box and relationship label on screen is whole —
     no half box, no clipped label. On a canvas, pan to each section and
     check it there; zoom can change fit after the initial render.
  3. Every edge has a clear source stem and a visible target arrowhead.
     Trace the full route. Reject false branches and unrelated box contacts.
  4. No arrow glyph sits inside a word (`al▼ocat`). No `●` sits on a
     node border. Controls must not cover nodes, routes, or labels.
  5. Each node has four complete sides and corners. All border cells use
     that node's border color, including connection handles. Plain-text
     capture cannot prove color: use `--format ansi` or buffer-cell tests.
  6. Every container box sits one cell outside its members: four corners,
     label set into the top edge, and no member border or edge clipped by
     it.
- **Container geometry is exact at the natural fit and can drift.** The
  box is computed from the members' cells, so it is exact when the drawing
  fills or overflows its pane at 100% — an overflowing canvas is fine. A
  pane much larger than the drawing, or a panned view, can shift the box
  off its members. Size the pane to the drawing, press `f` to re-fit, and
  prove the box in the capture before reporting. A route that crosses the
  top edge can also overwrite a label character; check the container label
  in the capture and move the members' band if it is damaged.
- Complete the independent review below before claiming the diagram is ready.
- Tell the human what appeared and where. Keys: drag a node to move it,
  drag empty space to pan, scroll to zoom, `f` to fit, arrows or Tab to
  navigate, `q` (or Esc) to quit. Dragging from a node border to another
  node creates an edge; dragging an edge end reconnects it. Quitting
  closes the pane with the app. A dragged node's edge falls back to the
  library router until you reopen the spec.
- Cleanup is automatic. Close a pane early with
  `herdr pane close <pane-id>` only when replacing the graph with a new
  spec or when a pane wedges.
- Outside Herdr (`HERDR_ENV` unset): say so and offer the mermaid tool
  instead. Never run rataflow-view in the agent's own pane — the bash tool
  has no TTY there, and the call blocks until it times out.

## Independent readability review

After each generated or revised diagram, use the `subagent` tool:
`agent: "worker"`, `model: "openai/gpt-6-astra"`. The reviewer must be
separate from the worker that made the diagram or renderer change.

Give the reviewer the spec path, pane id, pane dimensions, and captures.
Ask for a read-only review of the actual render before inspecting the
router code. The reviewer must trace every arrow, then compare its source,
target, direction, and label with the spec. Require concrete edge names
for missing labels, false branches, ambiguous crossings, detached stems,
missing arrowheads, border defects, and clipped content.

Require a pass/fail verdict and a list of remaining defects. A valid spec,
clean `--check`, passing tests, or visible node labels is not a visual pass.
If Astra is unavailable, report that the review did not run. Do not silently
use a different model. Plain-text review does not establish color correctness.

The result arrives automatically. Do not poll. After corrections, capture
the new render and use `subagent_message` to request another review. Do not
claim approval before the review result arrives. Report unresolved defects.

Preserve relationship meaning during corrections. Do not delete an edge,
reverse it, or remove its label to hide a routing defect. If the graph needs
separate views, keep the full spec and account for each relationship across
the views. State any deliberate abstraction.

## When something goes wrong

- `command not found` — install.sh builds the binary; from the dotfiles
  checkout run `cargo install --path rataflow --locked`.
- No `rataflow-view · …` header in the pane read — the pane is too small
  or the app died. Close it and re-split, or shrink the spec.
- The pane reports `canvas WxH at 100% · drag to pan` — the drawing is
  bigger than the pane. On a canvas that is expected: pan, or open a
  taller pane. In a single view, cut layers, shorten labels, or switch
  `tb` to `lr`; do not pan and call it fit.
- A container box is off its members — size the pane to the drawing and
  press `f`, then re-capture. If it still drifts, report the drift instead
  of claiming containment.
- A ring with a route through it — the `focus` node's double border is
  pierced. That is a defect, not a style choice; drop `focus` and report it.
- `--check` warns a section has no description — write the one line that
  says what that section shows.
- `--check` warns about a shared corridor — the router could not separate
  two edges. Change placement or use separate views. Do not delete a real
  relationship to make the warning disappear.
- `--check` reports skipped labels — provide more space or shorten labels
  without changing their meaning. Do not hide the warning by removing labels.
- The human closed the pane while the app ran — nothing to clean up.
- The pane vanished while the human was still reading — the app exited
  (`q`, Esc, Ctrl+C) and closed its own pane. Relaunch the same spec.

## Install and repair

`install.sh` builds the binary with `cargo install --path rataflow --locked`.
Example specs live in `rataflow/examples/` (pipeline, network, trunk,
modal-machine-lifecycle); the schema and its rejection rules live in
`rataflow/src/lib.rs`, and the router in `rataflow/src/router.rs`.
