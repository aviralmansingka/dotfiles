---
name: visualize
description: Live, ratatui-rendered visualizations in terminal panes — today the rataflow node graph, laid out to fit on a single screen beside the chat text in fullscreen, with slow dots flowing along its edges. Build a small JSON spec and open it with the rataflow-view binary in a herdr pane the human can drag, pan, and zoom. For HTML artifacts (decks, dashboards, infographics) use the artifact skill; for diagrams inside the chat reply use the mermaid tool; for static terminal art or PNG export use the mermaid skill.
---

# visualize

Live visualizations rendered by ratatui, in a real terminal pane — the
surface the chat transcript cannot host, because it cannot run a TUI.
Today this skill renders node graphs: the `rataflow-view` binary (crate at
`rataflow/` in the dotfiles repo, built on the rataflow library) turns a
JSON spec into a pane the human can drag, pan, and zoom. Lay the graph out
so it fits on a single screen: in fullscreen the pane sits beside the chat
text, and the whole graph must read without pan or zoom. Edges render as
arrows; an optional `flow` field adds slow dots that travel source →
target.

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

Use rataflow-view when the human should *explore* the graph: many nodes,
rearranging, tracing edges, zooming into one region. Use mermaid when the diagram is
part of an answer (chat, doc, PR).

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

Layout direction: `tb` for pipelines and hierarchies (stages read top to
bottom), `lr` for request flow that reads left to right. Pick the one that
matches how the human describes the flow ("client → … → db" is `lr`).

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
  keep values at or below 0.5 so motion stays slow. Dot spacing is fixed,
  so slow edges are as sparse as fast ones.
- `layers`: optional explicit placement — an array of arrays, one inner
  array per layer (a row in `tb`, a column in `lr`); the declared order
  runs across the perpendicular axis, and `""` reserves a slot so a
  node can align under another layer's column. Every node must be placed
  exactly once. With `layers` present, automatic ranking is skipped and
  each column is only as wide as its widest node — the tightest way to
  fit a pane.

Styling is automatic and gruvbox-native (it matches the terminal): a plain
background with no dot grid, node boxes filled with the canvas color so
their rounded borders sit flush, and node borders cycling the gruvbox
bright accents (yellow, orange, aqua, blue, purple, green). Selection uses the
gruvbox yellow accent. Edges attach at node borders with no marker dot —
the only dots on the canvas are the flowing ones.

## Open the viewer

Validate the spec before opening anything — the check needs no terminal
and works from any shell:

```sh
rataflow-view --check "$SPEC"
```

It prints `ok: nodes=N edges=M direction=… theme=…` on success, or
exits non-zero with the exact problem. Fix the spec until it passes, then
open the pane. Inside Herdr (the normal case), split a sibling and launch:

```sh
test "${HERDR_ENV:-}" = 1
herdr pane split --current --direction right --ratio 0.5 --cwd "$PWD" --no-focus
# the JSON response carries the new pane id at .result.pane.pane_id
herdr pane run <pane-id> "rataflow-view <spec>; herdr pane close <pane-id>"
```

- The launch command is self-cleaning: when the app exits — `q`, Esc, or
  Ctrl+C — the pane's shell runs the trailing `herdr pane close` and the
  pane removes itself. Substitute the real pane id in both places.

- `--ratio 0.5` is an even split: the graph pane gets half of the current
  pane, never a narrowed sliver. Split direction follows the herdr
  geometry rule: `right` when the calling pane is wide, `down` when it is
  narrow or tall.
- The viewer fits the graph on open and on resize, but never zooms past
  100%: a spec that overflows the pane at natural size stays cut, and the
  `f` key cannot shrink it. Fit is a property of the spec — shallow
  chains, short labels, explicit `layers` — not of the viewer.
- Verify the render with `herdr pane read <pane-id> --source visible`: the
  header line `rataflow-view · N nodes · M edges · …` proves the
  app started, and every node label appearing in that read proves the
  graph fits. A missing or half-cut label means the spec overflows the
  pane — cut nodes or shorten labels and re-open.
- Tell the human what appeared and where. Keys for the human: drag a node
  to move it, drag empty space to pan, scroll to zoom, `f` to fit, arrows
  or Tab to navigate, `q` (or Esc) to quit. Dragging from a node border to
  another node creates an edge; dragging an edge end reconnects it.
  Quitting closes the pane with the app.
- Cleanup: automatic — the pane closes itself the moment the app exits.
  Close it early with `herdr pane close <pane-id>` only when replacing
  the graph with a new spec or when a pane wedges.
- Outside Herdr (`HERDR_ENV` unset): say so and offer the mermaid tool
  instead. Never run rataflow-view in the agent's own pane — the bash tool
  has no TTY there, and the call blocks until it times out.

## When something goes wrong

- `command not found` — install.sh builds the binary; from the dotfiles
  checkout run `cargo install --path rataflow --locked`.
- `herdr pane read <pane-id> --source visible` shows no
  `rataflow-view · …` header — the pane is too small or the app died.
  Close it with `herdr pane close <pane-id>`, then re-split wider
  (`--direction down` gives a tall graph more room), or shrink the spec.
- The human closed the pane while the app ran — nothing to clean up; the
  app exits with its pane.
- The pane vanished while the human was still reading — the app exited
  (`q`, Esc, Ctrl+C) and the pane closed itself with it. Relaunch the same
  spec if they want it back.
- The graph renders but is unreadable — close the pane and cut the spec
  down (see Sizing and hygiene), or re-split with more room.

## Sizing and hygiene

- `id` is a key: short, stable, unique. `label` is display text: a few
  words at most — node width follows its label.
- Fit the whole graph on one screen in fullscreen, where the pane sits
  beside the chat text: prefer under ~20 nodes, short labels, and at most
  ~7 layers deep, so the graph reads without pan or zoom. For larger
  subjects, show a summary graph first and offer detail graphs per region.
- Keep the bottom-left corner of the layout clear: the viewer's control
  palette (zoom, fit, info) floats there and occludes whatever the spec
  places underneath — reserve that slot with `""`.
- Edge labels: a few words at most. Long labels widen the edge routes.
- One graph per pane. When an updated spec replaces an old pane, close the
  old one first with `herdr pane close <pane-id>`, then open the new one.
- The spec is a file the human can keep and re-open. For a throwaway, use
  a temp path; for a keeper, write it next to the work (for example
  `docs/graphs/<name>.json`) and say the path.

## Install and repair

`install.sh` builds the binary with `cargo install --path rataflow`. If
the command is missing, run that from the dotfiles checkout. Example specs
live at `rataflow/examples/pipeline.json` (a job pipeline) and
`rataflow/examples/network.json` (a network diagram); the
schema and its rejection rules live in `rataflow/src/lib.rs`.
