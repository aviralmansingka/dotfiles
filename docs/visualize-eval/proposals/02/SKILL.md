---
name: visualize
description: Build live ratatui node diagrams in Herdr panes. Preserve source relationships, make arrows and labels traceable, check actual text and ANSI output, and use a separate Astra worker for readability review. Report unsupported renderer features instead of hiding them. Use artifact for HTML documents and mermaid for diagrams inside chat.
---

# visualize

Build a JSON graph for `rataflow-view` and show it in a Herdr pane.
Use the mermaid tool for a diagram inside a chat reply. Use artifact for HTML.
Never paste terminal pane art or ANSI escapes into chat or an editor buffer.

## Establish the meaning before drawing

Read the relevant conversation or source. Later human corrections override
older generated diagrams. Old assistant claims are evidence, not verified facts.
Do not replay commands, inspect credentials, or contact hosts merely because
historical messages mention those actions.

Make a short coverage record before writing the spec:

- Required concepts, labels, addresses, roles, and location facts.
- Each relationship's endpoints, direction, actions, payloads, and qualifiers.
- Requested ordering, conceptual groups, and independent versus shared links.
- Animation requirements: which edges, direction, speed, and dot count.
- Uncertain facts and optional context. Keep uncertainty visible.

Do not reduce coverage to an edge count. A visible arrow can still lose meaning
when its label drops repair, verification, payload arguments, or an address prefix.
Shorten wording only when the displayed text retains the original meaning.
Use multiline node labels or a clearly identified note where useful. A glossary
in the generation report does not repair information missing from the diagram.

For software placement, distinguish runs-on/hosts from calls/reads/deploys.
For networks, distinguish physical connectivity from directional traffic.
State the arrow convention. Do not reverse a relationship to improve placement.

## Check capabilities before repeated layout work

Use the actual selected executable's schema and check output. Do not infer
support from an old skill, another installed binary, or a proposed feature.

The currently evaluated schema supports:

- `direction`: `tb` or `lr`.
- `theme`: `gruvbox`, `dark`, or `light`.
- `nodes`: objects with `id` and optional `label`.
- `edges`: objects with `from`, `to`, optional `label`, and optional `flow`.
- `layers`: arrays of node IDs; each node appears once. `""` reserves a slot.
- `flow`: a boolean or positive speed, not an independent dot count.

Unknown fields are rejected. An endpoint can create an implicit node.

These are current limits, not authoring mistakes:

- No declared bus/junction primitive provides one shared trunk and one split.
- No independent one-live-dot setting exists. Lower speed does not reduce count.
- Hue families follow geometric layers. There is no independent semantic-group
  or color-family field for concepts spread across different layers.
- Automatic labels can be missing or visually detached even after a clean check.

If a requirement needs an unsupported capability, name the missing capability
and stop that part. Do not substitute independent paths for an explicit bus,
disable required motion, invent fields, or claim that geometric colors encode
conceptual groups. A renderer change needs its own tested baseline.

## Preserve independent links and intentional branches

Independent redundant links must stay separate. Each needs an identifiable
source stem and target arrowhead. A crossing must not look like a connection.
Separate ports and zero shared cells do not prove that neighboring bends read well.

A source-requested shared medium or bus is different. Honor its explicit branch
semantics; never apply a universal separate-edge rule against that requirement.
The current renderer limitation must remain visible when it cannot draw that bus.

Keep the source-to-target route readable through every crossing.
Keep labels off route cells. Reject text that hides a required stroke or masks
the cue needed to choose between paths. Place each label beside one clear route.
Identical labels do not excuse uncertain ownership.

## Choose layout and focused views

Choose conceptual groups before geometric layers. Keep related concepts near one
another. Check whether the actual layer hues support those concepts; do not claim
semantic grouping merely because nodes share a row or a color.

Measure the real pane. Natural zoom is 100%; do not shrink text to hide overflow.
Use `tb` when width is scarce and `lr` when height is scarce. Test extent rather
than treating an orientation rule as a guarantee. Rough budgets of 12 nodes and
16 edges are prompts to inspect density, not permission to delete information.

If one view is too dense, use focused views with repeated boundary nodes.
Map every required concept and relation to a visible view. Keep full source facts
and record intentional abstractions. Distinguish three coverage states:

1. Present in the spec.
2. Visually traceable from source to target.
3. Label meaning visibly and uniquely attached to that route.

Only the third is complete relationship coverage. Preserve meaningful location
and addressing annotations too. Do not replace distinct device branches with one
collapsed device box when the user requires the individual branches.

The control palette occupies the lower-left area. Keep boxes, routes, labels,
and notes clear of it. Verify complete corners and sides, not only node names.

## Bind checks and rendering to the same executable

Resolve one absolute executable path and one absolute spec path. In an eval,
use its frozen executable, never the globally installed version. Record the
executable and spec SHA-256 values with the exact executed commands.

Run the absolute executable with `--check` and save stdout, stderr, and exit code.
A successful exit validates the input; it does not approve readability.
Inspect every warning. Missing labels remain defects even when exit status is zero.

Inside Herdr, split a no-focus sibling at ratio 0.5. Use the current agent's tab,
not another session's pane. Use the Herdr CLI, never raw tmux.

```sh
# Open an even viewer pane without changing the focused agent pane
herdr pane split --current --direction right --ratio 0.5 --cwd "$PWD" --no-focus
```

Take the actual pane ID from the response. Launch the absolute executable and
absolute spec, then close that exact pane when the viewer exits:

```text
herdr pane run <pane-id> '<absolute-executable> <absolute-spec>; herdr pane close <pane-id>'
```

Quote real paths correctly. Do not rely on the parent command's PATH being
inherited by an already running pane shell. Bare `rataflow-view` is insufficient
when a particular frozen executable is required.

Measure rows/columns inside the viewer pane before launch. Preserve the measured
PTY dimensions separately from Herdr's chrome-inclusive rectangle. A command echo
is not proof that the viewer started: inspect the actual visible header.

Outside Herdr, explain the missing live surface and offer the mermaid tool.
Do not launch the interactive viewer inside the coding tool's non-TTY shell.

## Check actual output

Capture `herdr pane read <pane-id> --source visible` and the ANSI form using
`--format ansi`. Record actual capture times, state, and filenames. Text and ANSI
reads can occur in different animation phases; do not label them simultaneous.
Do not substitute filesystem modification time for a recorded capture event.

Check these independently:

- Every required concept and complete relationship meaning appears.
- Every arrow has a clear source stem, continuous path, and unique target head.
- Every label has one identifiable owning route, without consulting the JSON.
- Crossings, adjacent bends, and animation do not imply false continuations.
- Boxes, labels, routes, and notes fit without pan, zoom, or control occlusion.
- Every border side and corner is complete and uniformly colored.
- Related colors describe source concepts rather than arbitrary geometric depth.

For strict evaluation, capture each node occurrence selected as well as unselected.
A frame containing one selected node does not test every other node's selected
state. Determine selection from actual ANSI, not from an assumed Tab order.
Missing state evidence is blocked, not proof of a broken border or a full pass.

For required animation, record sufficiently close timestamped frames or a recording
to resolve movement on every requested route. Inspect short routes and bends.
Sparse snapshots of repeated dots can alias; changed hashes alone prove neither
direction nor slow speed. Preserve corners, arrowheads, labels, and border cells.
Optional motion may be omitted when it harms traceability. Required motion cannot
be removed to obtain a pass. Explicit one-dot requirements need renderer support.

## Independent review

After generation, use a separate `worker` on `openai/gpt-6-astra` as the judge.
During skill evaluations, generators use DeepSeek; Astra is reserved for judging.
Do not let the generator or renderer fixer approve its own result.

First give the judge only final raw captures, dimensions, and timestamps.
Require saved blind observations of inferred links, labels, groups, and defects.
Then reveal the relevant source, spec, checks, and coverage record to the same judge.
Require concrete edge names, capture coordinates, per-category verdicts, and a
clear distinction between observed failures and missing evidence.

A clean check, all labels present, or passing tests cannot replace this review.
If Astra or required evidence is unavailable, report blocked. Do not silently
substitute another model. Results arrive automatically; do not poll.
After a correction, ask for another review through `subagent_message` with new
captures. Never claim approval before the result arrives.

## Cleanup and final report

Keep an ownership record for every pane created, including rejected attempts.
Close only owned panes. Save exact cleanup commands and closure or final-layout
results. Do not invent missing execution history after review.

Report the spec paths, view coverage, reviewer verdict, and remaining defects.
State whether the result is approved, failed, or blocked. Separate skill-authoring
problems from renderer limits. Do not claim a renderer change as a skill-only gain.

Controls: drag nodes to move them, drag empty space to pan, scroll to zoom,
`f` to fit, and `q` or Esc to exit. Reopening restores the planned layout.
Dragging uses the existing fallback router; initial-layout guarantees do not
prove that every dragged arrangement remains readable.
