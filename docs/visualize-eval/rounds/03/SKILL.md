---
name: visualize
description: Live, ratatui-rendered visualizations in terminal panes — today the rataflow node graph, laid out to fit beside the chat text, with semantic group colors, declared trunks, routed arrows, single-dot motion, and an independent Sol readability review. Build a small JSON spec and open it with the rataflow-view binary in a herdr pane the human can drag, pan, and zoom. For HTML artifacts (decks, dashboards, infographics) use the artifact skill; for diagrams inside the chat reply use the mermaid tool; for static terminal art or PNG export use the mermaid skill.
---

# visualize

Live visualizations rendered by ratatui, in a real terminal pane — the
surface the chat transcript cannot host, because it cannot run a TUI.
Today this skill renders node graphs: the `rataflow-view` binary (crate at
`rataflow/` in the dotfiles repo, built on the rataflow library) turns a
JSON spec into a pane the human can drag, pan, and zoom.

The graph must read without pan or zoom. That is a property of the spec,
not of the viewer: the viewer never shrinks text to fit (see Sizing).

A graph that draws every relationship and still loses its meaning has
failed. Meaning comes first, layout second, pixels third.

## Routing: pick the surface first

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

## Step 1 — Meaning ledger before any spec

Write the ledger as a temporary table. One row per source fact. Every row
ends as **drawn**, **abbreviated**, or **dropped with a reason**. Nothing
leaves the ledger by accident.

| Fact | Kind | Fate |
|---|---|---|
| `100.113.153.4` | address | drawn |
| ULA-only IPv6, no global v6 egress | limitation | drawn |
| `repair` action | verb | drawn |
| `boot.ipxe` + S3 args | payload | abbreviated to `boot.ipxe + S3 args` |

Collect these kinds before drawing, because they are what a diagram
silently loses:

- **Addresses and identifiers.** IPs, AS numbers, device names, ports.
  Abbreviate only with a key on the same view (`tailscale0 = 100.113.153.4`).
- **Roles and residency.** Which host runs what, which layer owns a
  service. "NVOS hosts NMX-C/T" is a residency fact, not a link.
- **Action verbs and payloads.** `create`, `terminate`, `repair`,
  `reprovision`, `verify` are different actions. Keep their arguments.
- **Protocols and paths.** `gRPC over UDS`, `HTTP`, `iPXE`, `Redfish`.
  Say which protocol runs on which hop.
- **Qualifiers and uncertainty.** "historical", "unconfirmed",
  "inactive", "not cabled". A fact the source does not confirm stays
  marked; it is never promoted to certainty or deleted.

A dropped fact must name its reason (`duplicate of row 3`, `unknown in
source`). Dropping a required fact is a defect, not a simplification.

## Step 2 — Relationship audit

One row per edge, before layout:

| id | from → to | verb / tech | label owner | view |
|---|---|---|---|---|
| e1 | laptop → tailscale0 | UDP encap | e1 | v1 |
| e2 | runtime → worker | events + mgmt RPC | e2 | seams |

- `from` is the producer, sender, or caller. `to` is the consumer,
  receiver, or callee. A real bidirectional relation is two edges, or one
  edge plus a stated dominant direction.
- **Label owner**: the edge id whose meaning this text carries. Every
  label belongs to exactly one edge. Two edges sharing one ambiguous
  string is a defect, not compression.
- Keep the audit after the round; it is the checklist a reviewer uses.

## Step 3 — Group by concept, not by geometry

Decide the conceptual groups from the source, then declare them:

```json
{ "nodes": [
  { "id": "mmctl", "label": "mmctl", "group": "humans" },
  { "id": "webapi", "label": "webapi", "group": "control" },
  { "id": "river", "label": "River queue", "group": "control" },
  { "id": "pg", "label": "Postgres", "group": "state" }
] }
```

- Nodes in the same group share a color family. Different groups get
  different families.
- Group by what the source says belongs together — control plane, data
  plane, storage, physical plant, humans. Do not group by row or column;
  layout depth is not a concept.
- A node with no honest group gets no `group`. Do not invent one to make
  the colors look tidy.
- Related concepts may share a family; they never need identical colors.

## Step 4 — Capability preflight

Check the renderer before you promise a shape it cannot draw. The
capability list is in `--check --help`-adjacent docs and in
`rataflow/src/lib.rs`; the short version:

| Need | Field |
|---|---|
| One bus that splits into branches | `trunks` |
| Exactly one moving dot per route | `dots: 1` |
| Visible uncertainty | `style: "dashed"` |
| Related colors by concept | `group` |

If the required semantics has no field: stop, say which capability is
missing, and draw the closest honest subset. Never draw three independent
lines and call them one trunk. Never draw an unconfirmed link as a
confirmed one. Report the gap in the reply.

## Step 5 — Spec format

```json
{
  "direction": "lr",
  "theme": "gruvbox",
  "nodes": [
    { "id": "wan", "label": "WAN", "group": "plant" },
    { "id": "fw", "label": "Firewall", "group": "edge" },
    { "id": "core", "label": "Core switch", "group": "plant" },
    { "id": "web", "label": "Web tier", "group": "compute" }
  ],
  "trunks": [
    { "id": "oob", "label": "OOB LAN", "from": "sw", "to": "nvos",
      "branches": ["c1", "c2", "c3"] }
  ],
  "edges": [
    { "from": "wan", "to": "fw", "label": "1 GbE", "dots": 1, "flow": true },
    { "from": "fw", "to": "core", "label": "10 GbE", "dots": 1 },
    { "from": "core", "to": "web", "label": "10 GbE", "style": "dashed" }
  ]
}
```

- `direction`: `"tb"` (default) or `"lr"`. `theme`: `"gruvbox"` (default),
  `"dark"`, `"light"`.
- `nodes[].group`: optional semantic group name.
- `trunks[]`: `id`, optional `label`, `from`, `to`, `branches` (one or
  more node ids). A trunk is one corridor with one branch spur per branch
  node and a junction glyph where each spur leaves. Use it only for a real
  shared bus; never to fake a fifty-fifty split.
- `edges[].dots`: `1` = exactly one live dot on that route, `0` = none.
  Omit for the default periodic motion.
- `edges[].style`: `"solid"` (default) or `"dashed"` for an uncertain
  link. Keep the uncertainty in the label text too.
- `flow`: `true` animates the route. `duration_ms` sets the timing.
  A positive number is a legacy per-edge speed override; do not use it
  unless the source itself gives one route a different rate.
- `duration_ms`: how long every animated dot takes to reach its
  arrowhead. Default `2000`.
- `layers`: optional explicit placement — one inner array per layer, `""`
  reserves a slot, every node placed exactly once.
- Unknown fields and bad values are rejected, and the error names the
  problem. Fix what it names and re-run.

## Step 6 — Motion rules

Motion shows direction, not decoration. Three rules decide whether a
judge can read it:

1. **Every dot starts at the start of its own arrow** — the first drawn
   cell after the source port. A dot that begins mid-route, one cell in,
   or on the source border proves nothing about direction.
2. **All dots arrive together.** Every animated route leaves its source at
   the same instant and reaches its arrowhead at the same instant, so the
   finished state shows one dot per line at the ends at once. Short routes
   and long routes therefore move at different speeds, and that is correct.
   Deviate with `duration_ms` only when the source itself specifies a
   different rate for one route, and say so in the reply.
3. **Dots never hide the drawing.** No dot on a corner, bridge, junction,
   arrowhead or label. A route too short to show motion is not animated:
   draw it static and say why.

To prove 1 and 2, capture the first step and the final step of a cycle.
The first step shows every dot at its origin; the final step shows every
route's dot at its arrowhead at the same time.

## Step 7 — Sizing and composition

Aim for at most **12 nodes and 16 edges**, at most ~3 edges per node.
Above that, draw an overview and one detail view per region.

- Keep the bottom-left corner clear: the control palette floats there.
- **Overlaps.** Crossings cost readability, so lay the graph out to keep them
  low: put related groups in adjacent bands, keep long edges in the outer
  bands instead of through the middle, and prefer a layer order that stops two
  fans braiding. Reordering layers is allowed only when the source leaves that
  order free. Never move a group out of its logical band, merge two links, or
  drop a label to reduce a crossing. Read the `crossings:` line after each
  attempt and keep the layout that lowers it without losing meaning.
- **Orientation.** `lr` spends width, `tb` spends height. Use `lr` for
  chains of 5 or more layers, `tb` for 4 or fewer.
- **Labels:** node labels a few words; edge labels 14 characters or fewer.
- **Depth:** at most ~7 layers. **Density:** 3 nodes per layer reads
  well; 4 starts to crowd.
- **Splits.** At 77×47 a wide graph needs two to four views. Write a
  coverage map before drawing them:

  | view | carries |
  |---|---|
  | v1 overview | nodes + group membership |
  | v2 overlay | e1–e5 with labels |
  | v3 WAN | e6–e8 with labels |

  Every audited edge and every ledger fact names its view. A split that
  drops a relation has failed, even if each view is clean.
- Keep the bottom-left corner clear: the control palette floats there.

## Step 7 — Check, then capture

```sh
BIN=/absolute/path/to/rataflow-view
sha256sum "$BIN"                      # record this hash in the reply
"$BIN" --check "$SPEC"                # must print no warnings
```

Read every line of the check output: extent, labels placed/on-route/skipped,
groups, trunks, crossings, dots violations and synchronization, arrow origins,
and warnings. A skipped label, a label on a route cell, a dot violation, a
route whose dot does not start at its origin, or one route finishing much later
than the rest is a defect. Fix it in the spec. Never delete an edge or a label
to silence a warning.

Then capture real evidence at the target viewport:

```sh
# 77 columns x 47 rows, natural zoom, every node selected once
herdr pane split --current --direction right --ratio 0.5 --cwd "$PWD" --no-focus
herdr pane run <pane-id> "$BIN '$SPEC' --select-all; herdr pane close <pane-id>"
herdr pane read <pane-id> --source visible            # plain text
herdr pane read <pane-id> --source visible --format ansi   # colors
```

Requirements for the evidence bundle:

- **Absolute binary path** and its sha256 in every command you record. A
  bare `rataflow-view` proves nothing about which build rendered.
- **Measured viewport** (columns × rows) from the pane, plus the
  `zoom: 1.00 natural` startup line.
- **One plain-text frame and one ANSI frame per final view.**
- **A `--select-all` ANSI frame per view**, which proves every node's
  selected border in one shot.
- **Animation evidence**: `"$BIN" --frames <n> --step-ms 100 ...` covering a
  whole cycle for every animated view, saved verbatim. With the default
  `duration_ms: 2000` that is 21 frames: frame 0 shows every dot at its arrow
  origin, the last frame shows every dot at its arrowhead at the same instant.
  A five-frame sample cannot prove synchronized arrival or direction.
- **Crossing count** from `--check`, so the layout can be compared across
  attempts without re-reading captures.
- **Cleanup probe** per pane: the pane id, and the close result.

Self-closing launch commands (`; herdr pane close <pane-id>`) keep the
store tidy. Never claim cleanup you did not run.

## Step 8 — Independent review

After the capture, use the `subagent` tool: `agent: "worker"`,
`model: "openai/gpt-6.1-sol"`. The reviewer must not be the worker that
made the diagram or the renderer change.

Give it the spec paths, evidence paths, and pane dimensions — not your
conclusions. The reviewer must trace every arrow and compare source,
target, direction, and label with the audit table. Require concrete edge
ids for missing labels, false branches, ambiguous crossings, detached
stems, missing arrowheads, border defects, and clipped content.

The result arrives automatically. Do not poll. A valid spec, clean
`--check`, or passing tests is not a visual pass; plain-text-only review
does not establish color correctness. If the reviewer model is
unavailable, say the review did not run. Never substitute a model
silently.

## Step 9 — Repairs preserve meaning

Fix the spec, not the story. Do not delete a real edge, reverse a
direction, weaken a label, or drop a required fact to make a warning or a
review go away. If space runs out, split the view and carry the coverage
map. State any deliberate abstraction and its reason.

## When something goes wrong

- `command not found` — `install.sh` builds the binary; from the dotfiles
  checkout run `cargo install --path rataflow --locked`.
- No `rataflow-view · …` header in the pane read — the app did not start
  or the pane is too small. Close it, re-split, retry.
- `graph overflows · drag to pan` — the graph is bigger than the pane.
  Cut layers, shorten labels, or switch `tb` to `lr`. Do not pan and call
  it fit.
- A rejected spec names the offending field — fix that field only.
- `--check` reports a shared corridor — change placement or split views.
  Never delete a relationship to clear the warning.
- `--check` reports a skipped label — make room or shorten the label
  without changing its meaning.
- Outside Herdr (`HERDR_ENV` unset) — say so and offer the mermaid tool.
  Never run rataflow-view in the agent's own pane.

## Install and repair

`install.sh` builds the binary with `cargo install --path rataflow --locked`.
Example specs live at `rataflow/examples/`; the schema and its rejection
rules live in `rataflow/src/lib.rs`, the router in `rataflow/src/router.rs`.
