---
name: visualize
description: Live, ratatui-rendered visualizations in terminal panes — today the rataflow node graph. Build a small JSON spec and open it with the rataflow-view binary in a herdr pane the human can drag, pan, and zoom. For HTML artifacts (decks, dashboards, infographics) use the artifact skill; for diagrams inside the chat reply use the mermaid tool; for static terminal art or PNG export use the mermaid skill.
---

# visualize

Live visualizations rendered by ratatui, in a real terminal pane — the
surface the chat transcript cannot host, because it cannot run a TUI.
Today this skill renders node graphs: the `rataflow-view` binary (crate at
`rataflow/` in the dotfiles repo, built on the rataflow library) turns a
JSON spec into a pane the human can drag, pan, and zoom.

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
rearranging, tracing edges, zooming into one region. Use mermaid when the
diagram is part of an answer (chat, doc, PR).

## Spec format

Write a JSON file. Nodes are optional — every edge endpoint becomes a
node, and `label` defaults to `id`:

```json
{
  "direction": "lr",
  "theme": "gruvbox",
  "nodes": [
    { "id": "api", "label": "API gateway" },
    { "id": "worker", "label": "Worker pool" }
  ],
  "edges": [
    { "from": "api", "to": "worker", "label": "enqueue" }
  ]
}
```

- `direction`: `"tb"` (default) or `"lr"`.
- `theme`: `"gruvbox"` (default, matches the terminal), `"dark"`, `"light"`.
- `edges` is required and needs at least one entry. `from` and `to` must
  be non-empty. Node ids must be unique. Unknown fields are rejected and
  the error names the problem — fix what it names and re-run.

## Open the viewer

Validate the spec before opening anything — the check needs no terminal
and works from any shell:

```sh
rataflow-view --check "$SPEC"
```

It prints `ok: nodes=N edges=M direction=… theme=…` on success, or exits
non-zero with the exact problem. Fix the spec until it passes, then open
the pane. Inside Herdr (the normal case), split a sibling and launch:

```sh
test "${HERDR_ENV:-}" = 1
herdr pane split --current --direction right --ratio 0.55 --cwd "$PWD" --no-focus
# the JSON response carries the new pane id at .result.pane.pane_id
herdr pane run <pane-id> "rataflow-view <spec>"
```

- Split direction follows the herdr geometry rule: `right` when the
  calling pane is wide, `down` when it is narrow or tall.
- Verify the render with `herdr pane read <pane-id> --source visible`: the
  header line `rataflow-view · N nodes · M edges · …` proves the app
  started and the pane is wide enough.
- Tell the human what appeared and where. Keys for the human: drag a node
  to move it, drag empty space to pan, scroll to zoom, `f` to fit, arrows
  or Tab to navigate, `q` (or Esc) to quit. Dragging from a node handle to
  another node creates an edge; dragging an edge end reconnects it.
- Cleanup: once the graph is no longer needed, close the pane with
  `herdr pane close <pane-id>` (after the human quit the app with `q`), or
  let the human close it in the TUI.
- Outside Herdr (`HERDR_ENV` unset): say so and offer the mermaid tool
  instead. Never run rataflow-view in the agent's own pane — the bash tool
  has no TTY there, and the call blocks until it times out.

## When something goes wrong

- `command not found` — install.sh builds the binary; from the dotfiles
  checkout run `cargo install --path rataflow --locked`.
- `herdr pane read <pane-id> --source visible` shows no
  `rataflow-view · …` header — the pane is too small or the app died.
  Close it with `herdr pane close <pane-id>`, then re-split with a larger
  `--ratio`, or `--direction down` for a tall graph.
- The human closed the pane while the app ran — nothing to clean up; the
  app exits with its pane.
- The graph renders but is unreadable — close the pane and cut the spec
  down (see Sizing and hygiene), or re-split with a bigger ratio.

## Sizing and hygiene

- `id` is a key: short, stable, unique. `label` is display text: a few
  words at most — node width follows its label.
- Keep graphs readable in a half-pane: prefer under ~40 nodes. For larger
  graphs, show a summary graph first and offer detail graphs per region.
- Edge labels: a few words at most. Long labels widen the edge routes.
- One graph per pane. When an updated spec replaces an old pane, close
  the old one first with `herdr pane close <pane-id>`, then open the new
  one.
- The spec is a file the human can keep and re-open. For a throwaway, use
  a temp path; for a keeper, write it next to the work (for example
  `docs/graphs/<name>.json`) and say the path.

## Install and repair

`install.sh` builds the binary with `cargo install --path rataflow`. If
the command is missing, run that from the dotfiles checkout. The example
spec lives at `rataflow/examples/pipeline.json`; the schema and its
rejection rules live in `rataflow/src/lib.rs`.
