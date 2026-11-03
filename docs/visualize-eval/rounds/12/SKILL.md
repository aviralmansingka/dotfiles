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

Every graph in the frozen cases resembles one of six structural shapes.
Notice which one yours matches (Step 0) — it is a hint for where to
start, never a cage: take inspiration from the family's habits, then
follow the source wherever its own structure leads (Step 7).

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

## Step 0 — Notice the source's shape (a hint, not a cage)

Before the ledger, before any spec: name the closest family — a starting
hint, not a binding verdict. The family is a
property of the source's structure, not of your taste, and it decides the
layout before a single node id exists.

| Family | Signature in the source | Frozen cases |
|---|---|---|
| **flow-chains** | `E ≈ N` (one relation per node), shallow depth, animated | pipeline |
| **service-meshes** | fan of 2–3 edges around a core, an anti-parallel pair present | network, modal-runtime |
| **redundant-fabrics** | highest density, double-arrowhead targets, dots forbidden | datacenter-redundancy |
| **lifecycle-machines** | widest fan (5+ out of one state), phase-ordered, one dot per line | modal-machine-manager |
| **placement-planes** | two or more weakly-connected worlds plus a bus between them | gb300-rack-software |
| **identity-probe-maps** | deep chains, label-dense, qualifier- and address-heavy | homelab-nic-trace, server-nic-layout |

State the choice and **one line of evidence** from the source, before the
ledger:

```
family: lifecycle-machines
evidence: one machine node fans to 5 phase states; the source marks each
          transition live, so one dot per line.
```

Tie-breakers, in order:

1. **Density wins over depth.** If `E ≈ N` it is a chain even when the
   chain is long; if `E` clearly exceeds `N`, it is a mesh or a fabric.
2. **A bus with disconnected worlds means placement-planes**, even if the
   bus coincidentally looks like a chain.
3. **Identifier/qualifier content outranks shape.** A deep chain whose
   nodes are addresses, ports and uncertainty markers is an
   identity-probe-map: coverage of those facts is the hard part, layout is
   easy.
4. **Motion is a signature, not a tie-breaker.** Animated plus one dot per
   line on a wide fan is a lifecycle machine. Dot-free plus dense is a
   fabric.

If the source resembles two families, name the closer one and note the
other's habits you also borrowed. A family guess is a
rubric failure (`category_fit`), not a stylistic difference.

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
- **Never drop a source-stated fact for layout reasons.** Identifiers,
  qualifiers, roles (gateway, border router), and named relationships
  are mandatory ledger rows. If a view cannot hold them, re-split the
  views first; dropping is the last resort and needs a recorded,
  source-backed justification, not a layout one. A watered-down diagram
  that omits real components and relations has failed, however clean it
  looks.

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
- The engine never draws boxes, borders, or titles for groups. `group`
  is a logical tag: it drives hue families and a stable sibling order,
  and nothing is painted around members.
- When the source itself names tiers (web tier, spine/leaf, control
  plane), tier membership must stay readable: hue families or one
  non-boxed label line. Never drop source-semantic tiers to simplify.
- Group by what the source says belongs together — control plane, data
  plane, storage, physical plant, humans. Do not group by row or column;
  layout depth is not a concept.
- A node with no honest group gets no `group`. Do not invent one to make
  the colors look tidy.
- Related concepts may share a family; they never need identical colors.
- A group keeps ONE stable sibling order in every view of the case. If
  two views show the same group's members in opposite orders, the
  grouping signal contradicts itself; pick one order and keep it.

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
| Mid-side attachment; symmetric fans (engine-guaranteed) | automatic |
| Long labels beside their route | `label_slot` |
| Edge label in a reserved side gutter | `label_slot` |

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
- `edges[].style`: `"solid"` (default) or `"dashed"` for an uncertain
  link. Keep the uncertainty in the label text too.
- `edges[].label_slot`: optional `true` (validated only when the edge has
  a `label`) — reserves a horizontal gutter band beside the route for
  this edge's label, so a long label no longer costs rank-row height.
  Omit it and the engine places labels as before. Needs the round-09
  binary.
- `flow`: `true` animates the route at the **constant default speed** of
  0.5 cells per 100 ms step. A positive number animates at that constant
  rate instead. Do not set a rate unless the source itself gives one.
- `edges[].timing`: `"constant"` (the default) or `"same-arrival"`.
  Same-arrival makes the route leave at t=0 and reach its arrowhead
  after `duration_ms`, with its speed adjusted to its length. It needs
  `flow: true` and rejects a numeric `flow`.
- `duration_ms`: the shared arrival time for same-arrival routes,
  default `2000`. Valid **only** with `timing: "same-arrival"` and
  `flow: true`; any other combination is rejected.
- `layers`: optional explicit placement — one inner array per layer, `""`
  reserves a slot, every node placed exactly once. Prefer omitting it:
  the layout engine ranks and orders automatically, Mermaid-style.
- Unknown fields and bad values are rejected, and the error names the
  problem. Fix what it names and re-run.

## Step 6 — Motion rules

Dots appear **only where the source animated them**. If the source never
shows motion, the diagram is static — do not add dots as flair. If the
source explicitly forbids dots, that request wins absolutely.

Two timing modes exist, and constant speed is the default:

1. **Constant (default).** `flow: true` — every dot moves at the same
   speed, 0.5 cells per 100 ms step. Long routes take longer and that
   is correct; never speed them up to finish together unasked.
2. **Same-arrival (opt-in).** `flow: true` + `timing: "same-arrival"`
   + `duration_ms`: every route's dot leaves at t=0 and reaches its
   arrowhead at the same instant, visibly touching the head.

Three invariants hold in both modes:

1. **Every dot starts at the start of its own arrow** — the first drawn
   cell after the source port, including when that cell is a corner
   glyph. `origins: N/N` must read full and the capture must agree.
2. **Dots never hide the drawing.** No dot resting on a corner, bridge,
   junction or label; in same-arrival mode the dot may touch the
   arrowhead but never erase it.
3. **A route too short to show motion is not animated** — draw it static
   and say why. `dots:` violations must be zero.

Prove motion from captures: constant mode needs `ceil(route_cells /
0.5)` timestamped frames — enough for the LONGEST route's dot to
complete a full lap — with two well-spaced frames showing every dot
advanced by the same number of cells; same-arrival mode needs frame 0
(dots at origins) and the final frame (dots touching their arrowheads
together).

## Step 7 — Sizing and composition

**~12 nodes and ~16 edges is a readability HINT, never a budget.**
When the source has more concepts to show, coverage wins: pack each
view with as much of the graph as fits 77×47 at natural zoom, and split
only when one view genuinely cannot hold the content. Never drop or thin
a source concept to fit a number.

- **The layout engine owns placement.** Write nodes, edges, groups and
  trunks — never coordinates. The engine ranks by longest path, orders
  each rank by neighbour barycenter (Mermaid's crossing reducer), and
  reserves a slot sized to each label between its ranks, so crossings
  and ambiguous owners are prevented structurally. Do not iterate on
  placement by hand; iterate on the *split* only.
- **The family patterns are inspiration, not law.** The generic engine
  rules are the same for every graph; the family shapes suggest which
  lever to pull first and which failure to guard against. Start from
  the habits of the family you named in Step 0, then follow the source:
  deviate wherever its structure demands it, and record the deviation
  and its reason in `generation.json`. A deviation without a recorded
  reason fails `category_fit`; a deviation with one does not. A recipe demand
  yields only when measured attempts prove the renderer structurally
  cannot satisfy it; record the attempts in `generation.json` and
  satisfy the demand as closely as the renderer allows.

### Family patterns (reference shapes, not requirements)

**flow-chains** — protect the corridor widths. A chain's readability is
its horizontal rhythm, so keep every hop short and every rank one node
deep: `lr` for five or more stages, `tb` for four or fewer, never a
mixed shape that puts one hop's label in another hop's corridor. One dot
per animated hop, constant speed; no dot on a hop the source draws
static. Do not invent side branches to fill space. Where the source has them,
  draw them — the pattern is a default, the source is the authority.

**service-meshes** — order the fan ports, and keep an anti-parallel pair
in ONE view. Declare the core, then give its fan a stable order that
matches the source's own listing, so the fan's ports do not interleave
with the return edges. An anti-parallel pair (`request` and `response`,
`events` and `mgmt RPC`, `read` and `ack`) is two edges between the same
two boxes: draw both in the same view with distinct labels and distinct
ports, never split them across views and never merge them into one
bidirectional arrow. Both dots on the pair are ordinary dots. If
  measured attempts prove the renderer cannot hold the pair in one view
  (record the attempts and the numbers in `generation.json`), the recipe
  yields: split the pair across two views, keep both directions
  traceable, and state the yield — an evidenced yield is honest; an
  unrecorded one is a failed recipe.

**redundant-fabrics** — rank pins for the source's tiers, parallel-link
lanes, and never a trunk. This is the densest family, and its density is
the meaning: independent redundant links stay independently traceable,
never bundled, never trunked. Pin the source's tiers with `layers`
(uplinks above, leaves below, or the spine/leaf order the source states)
so the rank axis means role instead of accidental graph depth, and let
the barycenter ordering place the parallel links within each rank. A
target that receives a double arrowhead receives it from two separate
routes at two separate ports. Dots are forbidden here unless the source
animates the fabric; a fabric the source draws static stays static.

**lifecycle-machines** — the phase axis organizes; COVERAGE is the
goal. Rank the source's own stage order (empty → provisioning →
running → draining → terminated) so the sequence reads in one direction
of the page, but that spine is a skeleton, not the whole diagram: side
relations (web consoles, API calls, database writes) are first-class
content — draw them beside the spine when they fit, and give them their
own named view when they do not. Every source component and every
source relation must appear somewhere; re-split the views before you
ever drop one. Never ship a watered-down version. Every live
transition carries exactly one dot; historical transitions carry none
and are labelled as historical.

**placement-planes** — the worlds sit side by side, and the bus splits
once. Each weakly-connected world occupies its own area of the page,
drawn beside the other, not folded into one depth sequence — spatial
separation only, never a drawn box or title. Cross-plane relations are the few long edges
and are allowed to be long — that is the plane boundary, not a defect.
A source-named bus between planes is one trunk that splits once, with a
junction where each branch leaves; never one line per branch node.

**identity-probe-maps** — every identifier and qualifier is a coverage
row before any spec exists. This family loses meaning through omission,
not through layout: addresses, ports, AS numbers, device names, and
qualified facts (`historical`, `unconfirmed`, `ULA-only`) each get a
ledger row and a named view before you write the first node. The view
split follows the fact clusters the source gives you. Once coverage is
complete the layout is often a deep `lr` chain; but the shape follows
the source, not the pattern — spend no attempts on geometry while a
fact is still missing.

- **Orientation.** `lr` spends width, `tb` spends height. Use `lr` for
  chains of 5 or more layers, `tb` for 4 or fewer. This — plus the
  split and, for fabrics, `layers` — is the whole of your layout
  freedom.
- **Groups.** Declare groups by name; the engine gives each a hue
  family (derived from the name) and keeps one stable sibling order in
  every view of the case. No box, border, or title is drawn — grouping
  is legible as color and order, nothing painted.
- **Labels:** node labels a few words; edge labels 14 characters or
  fewer. The engine reserves their slots; `0 ambiguous owners` should
  read structurally clean.
- **Density:** 3 nodes per rank reads well; 4 starts to crowd.
- **Splits.** At 77×47 a wide graph needs two to four views. Write a
  coverage map before drawing them:

  | view | carries |
  |---|---|
  | v1 overview | nodes + group membership |
  | v2 overlay | e1–e5 with labels |
  | v3 WAN | e6–e8 with labels |

  Every audited edge and every ledger fact names its view. A split that
  drops a relation, a qualifier, or an identifier has failed, even if
  each view is clean.
- Keep the bottom-left corner clear: the layout engine reserves the
  palette corner automatically; verify in the capture that no border
  cell is overwritten.

## Step 8 — Check, then capture

```sh
BIN=/absolute/path/to/rataflow-view
sha256sum "$BIN"                      # record this hash in the reply
"$BIN" --check "$SPEC"                # must print no warnings
```

Read every line of the check output: extent; labels with
placed/on-route/skipped/ambiguous counts; groups; trunk junctions;
`crossings: N bridges, M touching bends`; the `dots:` line with both mode
counts; `origins: N/N`; `arrivals: N/N`; and warnings. A skipped label, a
label on a route cell, an ambiguous label owner, a dot violation, a dot that
does not start at its origin, or a same-arrival route without visible
arrival — each is a defect. The check and the capture must agree; when they
disagree, report both readings. Never delete an edge or a label to silence a
warning.

Record the Step 0 family line — family plus the one evidence line — with
its spec and captures, so a reviewer can check `category_fit` without
guessing which recipe you intended to follow.

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
- **Measured viewport**: per view, either the running app's own header
  token (e.g. `77x47 @100%`) or a pinned direct dump of THAT view's
  FINAL spec at exactly `COLUMNS=77 LINES=47` natural zoom with no
  overflow banner — never a hardcoded or invented number, never a dump
  of a rejected draft or another view.
- **One plain-text frame and one ANSI frame per final view.**
- **A `--select-all` ANSI frame per view**, which proves every node's
  selected border in one shot, palette corner included.
- **A frames capture for EVERY view, static ones included** — at least
  3 timestamped frames proving time passes and nothing moves. For
  animated views, cover a full lap of the longest route
  (`ceil(longest_route / 0.5)` frames at 100 ms steps). For direct
  `--frames` dumps outside a pane, pin the terminal size:
  `COLUMNS=77 LINES=47 "$BIN" --frames <n> ...` — a dump at another
  size proves nothing about the target viewport.
- **Motion proof per animated view**: constant mode — two well-spaced
  frames showing every dot advanced by the same number of cells;
  same-arrival mode — frame 0 at origins and the final frame at heads.
- **Crossing and origin lines** from `--check` recorded per attempt.
- **Raw records for every rejected attempt and probe**: run every probe
  and rejected draft through `scripts/viz-evidence.sh record --to
  <case-dir>/attempts-log.jsonl --label <name> -- "$BIN" ...`; the log
  keeps command, exit status, raw stdout/stderr and the spec argument's
  sha256, and `viz-validate.py --require-records` verifies it. Never
  report an attempt without its record in the log.
- **Exploratory probes beyond the view budget are allowed but must be
  listed**: shape experiments that never ship go under `abandoned_shapes`
  in `attempts.json`, each with its record label — never hidden,
  never trimmed to look tidy.
- **Cleanup probe** per pane: the pane id and the close result, verbatim.

Self-closing launch commands (`; herdr pane close <pane-id>`) keep the
store tidy. Never claim cleanup you did not run. **Every claim must cite
the capture file and coordinates that show it** — a `--check` line alone
is not proof.

## Step 9 — Independent review

After the capture, use the `subagent` tool: `agent: "worker"`,
`model: "openai/gpt-6.1-terra:high"`. The reviewer must not be the worker that
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

## Step 10 — Repairs preserve meaning

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
