---
name: visualize
description: Live, ratatui-rendered visualizations in terminal panes — today the rataflow node graph, laid out to fit beside the chat text, with related layer colors, routed arrows, and an independent Astra readability review. Build a small JSON spec and open it with the rataflow-view binary in a herdr pane the human can drag, pan, and zoom. For HTML artifacts (decks, dashboards, infographics) use the artifact skill; for diagrams inside the chat reply use the mermaid tool; for static terminal art or PNG export use the mermaid skill.
---

# visualize

Live visualizations rendered by ratatui, in a real terminal pane — the
surface the chat transcript cannot host, because it cannot run a TUI.
Today this skill renders node graphs: the `rataflow-view` binary (crate at
`rataflow/` in the dotfiles repo, built on the rataflow library) turns a
JSON spec into a pane the human can drag, pan, and zoom.

The graph must read without pan or zoom. That is a property of the spec,
not of the viewer: the viewer never shrinks text to fit (see Sizing).

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
- `flow` on an edge: `true` or a small positive number — dots travel
  `from → to` along the line. One speed unit is about 10 cells per second;
  keep values at or below `0.5`. Dots sit at least 7 cells apart.
- `layers`: optional explicit placement — an array of arrays, one inner
  array per layer (a row in `tb`, a column in `lr`); the declared order
  runs across the perpendicular axis, and `""` reserves a slot.
  Every node must be placed exactly once.

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
- **Color encodes the layer.** Each layer gets its own hue family, and
  nodes inside a layer take related shades of that family: siblings read
  as one group, nearby layers never share a hue. Edges stay one muted
  stroke, and the accent marks selection and flow dots only. Group your
  `layers` by what belongs together — the color then shows the structure
  without a legend.
- **Labels use free space** after routing. A label with no free slot is
  omitted; `--check` reports the count. An omitted relationship label is
  a defect to fix, not proof that the diagram is simpler. In a `tb` view a
  labelled rank gap costs the label's length in rows; set
  `"label_slot": true` on that edge to give the label a horizontal gutter
  band beside its own run instead, which keeps tall labelled views short.
  Never shorten the words to buy rows.
- **Boxes are at least 4x4 cells.** The library places connection handles
  at the box centre; a 3-cell box puts that handle on a corner.

## Sizing: what fits

Aim for at most **12 nodes and 16 edges**, with at most ~3 edges per node.
Above that, show an overview graph and offer one detail graph per region.
The research is blunt about this: crossings dominate readability, and a
second diagram beats a denser first one.

- **Orientation.** `lr` spends width, `tb` spends height. A chat-beside
  pane is taller than it is wide but the graph text is wide: use `lr` for
  chains of 5 or more layers, `tb` for 4 layers or fewer.
- **Labels:** node labels a few words; edge labels 14 characters or fewer.
  Node width follows the label, so a long label widens the whole column.
- **Depth:** `layers` is the tightest placement. Keep them at most ~7.
- **Density per layer:** 3 nodes per layer reads well; 4 starts to crowd.
- **The fit never shrinks text.** The viewer fits at 100% and no less. A
  graph larger than the pane is cut and shows `graph overflows · drag to
  pan` in the corner. Do not fight that with pan; shrink the spec.
- Keep the bottom-left corner of the layout clear: the control palette
  floats there. Reserve that slot with `""`.

`--check` prints the graph's extent in cells. Compare it with the pane
size before opening anything.

## Open the viewer

Validate the spec before opening anything — the check needs no terminal:

```sh
rataflow-view --check "$SPEC"
```

It prints a summary, the extent, and a warning line for each problem it
can predict without drawing: density above budget, two edges sharing a
corridor, and edge labels that had no free slot. Fix the spec until those
warnings are gone, then open the pane. Inside Herdr, split and launch:

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
  2. Every complete node box and relationship label fits. Check the actual
     pane size and viewport; zoom can change fit after the initial render.
  3. Every edge has a clear source stem and a visible target arrowhead.
     Trace the full route. Reject false branches and unrelated box contacts.
  4. No arrow glyph sits inside a word (`al▼ocat`). No `●` sits on a
     node border. Controls must not cover nodes, routes, or labels.
  5. Each node has four complete sides and corners. All border cells use
     that node's border color, including connection handles. Plain-text
     capture cannot prove color: use `--format ansi` or buffer-cell tests.
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
- The pane shows the `graph overflows` badge — the graph is bigger than the pane.
  Cut layers, shorten labels, or switch `tb` to `lr`.
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
Example specs live at `rataflow/examples/pipeline.json` and
`rataflow/examples/network.json`; the schema and its rejection rules live
in `rataflow/src/lib.rs`, and the router in `rataflow/src/router.rs`.
