---
name: visualize
description: Live, ratatui-rendered visualizations in terminal panes — today the rataflow node graph, with animated dots flowing along edges that carry movement (traffic, jobs, streams) at per-edge speeds. Build a small JSON spec and open it with the rataflow-view binary in a herdr pane the human can drag, pan, and zoom. For HTML artifacts (decks, dashboards, infographics) use the artifact skill; for diagrams inside the chat reply use the mermaid tool; for static terminal art or PNG export use the mermaid skill.
---

# visualize

Live visualizations rendered by ratatui, in a real terminal pane — the
surface the chat transcript cannot host, because it cannot run a TUI.
Today this skill renders node graphs: the `rataflow-view` binary (crate at
`rataflow/` in the dotfiles repo, built on the rataflow library) turns a
JSON spec into a pane the human can drag, pan, and zoom. Edges that carry
movement show live dots flowing along the line — direction is the edge's
direction, speed is a per-edge number.

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
rearranging, tracing edges, zooming into one region — or when the diagram
is about movement and deserves live dots. Use mermaid when the diagram is
part of an answer (chat, doc, PR).

## Read the relationships first

This skill is not a network-diagram tool; it draws *relationships*. Before
writing the spec, say what each relationship is — one sentence per edge
group is enough:

- **Direction.** Every edge points somewhere. `from` is the producer,
  sender, or caller; `to` is the consumer, receiver, or callee. If the
  relationship is bidirectional in reality, draw two edges or pick the
  dominant direction and say so in the label.
- **Movement.** Does anything travel this edge over time — traffic, jobs,
  requests, bytes, money, commits? Then give the edge a `flow` speed and
  its dots travel `from → to` at that speed. Is the edge static structure
  — a dependency, containment, "authored by", a shared config? Leave the
  flow off; the line stays solid. Contrast is the message: a diagram where
  everything animates says nothing.
- **Rate.** The speed number is relative — it means "this many times
  faster than speed 1". Pick ratios that read true: a 10 GbE uplink flows
  about twice a 1 GbE link; the hot path flows faster than the cold path;
  replication trickles behind ingest.
- **Names.** Label edges with the relationship, not the endpoints: verbs
  or link tech ("enqueue", "grpc", "10 GbE", "replicates"). Label nodes
  with what they *are*, a few words at most.

Domains that animate well: networks, pipelines and queues, event streams,
request lifecycles, CI/CD progression, replication and backups, build
graphs, money flows. Domains that stay solid: dependency trees, org
charts, containment, taxonomy.

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
    { "from": "wan", "to": "fw", "label": "1 GbE", "flow": 1 },
    { "from": "fw", "to": "core", "label": "10 GbE", "flow": 2 },
    { "from": "core", "to": "web", "label": "10 GbE", "flow": 2 }
  ]
}
```

- `direction`: `"tb"` (default) or `"lr"`.
- `theme`: `"gruvbox"` (default), `"dark"`, `"light"`.
- `edges` is required and needs at least one entry. `from` and `to` must
  be non-empty. Node ids must be unique. Unknown fields are rejected and
  the error names the problem — fix what it names and re-run.
- `flow`: omitted or `false` for a solid static line; `true` for dots at
  speed 1; a positive number for dots at that speed. One speed unit moves
  a dot about 10 cells per second, and dots space themselves wider as the
  speed rises — so 0.5–3 reads well on typical edges; reserve higher
  speeds for long lines.

Styling is automatic and gruvbox-native (it matches the terminal): a plain
background with no dot grid, node boxes filled with the canvas color so
their rounded borders sit flush, and node borders cycling the gruvbox
bright accents (yellow, orange, aqua, blue, purple, green). Flow dots and
selection use the gruvbox yellow accent.

## Open the viewer

Validate the spec before opening anything — the check needs no terminal
and works from any shell:

```sh
rataflow-view --check "$SPEC"
```

It prints `ok: nodes=N edges=M flows=K direction=… theme=…` on success, or
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
- Verify the render with `herdr pane read <pane-id> --source visible`: the
  header line `rataflow-view · N nodes · M edges · K flows · …` proves the
  app started and the pane is wide enough.
- Tell the human what appeared and where. Keys for the human: drag a node
  to move it, drag empty space to pan, scroll to zoom, `f` to fit, arrows
  or Tab to navigate, `q` (or Esc) to quit. Dragging from a node handle to
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
- Dots missing on a fast edge — the dot spacing grows with speed
  (3 × speed cells); on a short line a high speed shows no dots at all.
  Lower the speed or drop the numbers closer together.

## Sizing and hygiene

- `id` is a key: short, stable, unique. `label` is display text: a few
  words at most — node width follows its label.
- Keep graphs readable in a half-pane: prefer under ~40 nodes. For larger
  graphs, show a summary graph first and offer detail graphs per region.
- Edge labels: a few words at most. Long labels widen the edge routes.
- Flow speeds: keep the range narrow (0.5–3) so every edge shows dots and
  the ratios stay honest; the point is *relative* speed, not big numbers.
- One graph per pane. When an updated spec replaces an old pane, close the
  old one first with `herdr pane close <pane-id>`, then open the new one.
- The spec is a file the human can keep and re-open. For a throwaway, use
  a temp path; for a keeper, write it next to the work (for example
  `docs/graphs/<name>.json`) and say the path.

## Install and repair

`install.sh` builds the binary with `cargo install --path rataflow`. If
the command is missing, run that from the dotfiles checkout. Example specs
live at `rataflow/examples/pipeline.json` (a job pipeline) and
`rataflow/examples/network.json` (a network with mixed link speeds); the
schema and its rejection rules live in `rataflow/src/lib.rs`.
