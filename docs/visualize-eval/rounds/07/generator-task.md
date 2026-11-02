# React Flow convergence pilot — round 07

This is a user-requested pilot, not a CI test-step task.
You run on the DeepSeek generator model by design; do not switch models
and do not spawn judges.

## Scope: three cases, dual rendering

For each pilot case — **modal-machine-manager**, **datacenter-redundancy**,
**gb300-rack-software** — the rataflow side is ALREADY DONE: the round-05
bundles under `docs/visualize-eval/rounds/05/<case>/` hold the final
specs, captures, and validator output. Do NOT redo rataflow generation and
do NOT touch the round-05 bundles or the renderer. Your job is the React
Flow twin of each final spec.

Read the final spec for each case from its round-05 bundle
(`generation.json` names it; verify its sha256 with shasum). Translate it
faithfully: same node ids and labels, same edges with their labels, same
groups — as React Flow **subflows** — and animated edges exactly where the
source animates that case (machine-manager: the machine flows with one
live dot per animated edge; datacenter: NO animated edges, the source
forbids them; gb300: no animation, the source never animated).

## The React Flow artifact, per case

Write `docs/visualize-eval/rounds/07/<case>/reactflow.html`:

- **Self-contained HTML** loading React, ReactDOM, `@xyflow/react`, and
  dagre from a CDN, with the graph data inline; no build step, no local
  server dependencies beyond the CDN fetch.
- **dagre layout, deterministic**: fixed rankSep/nodeSep/edgeSep, same
  direction as the rataflow view (`tb` unless the round-05 spec used
  `lr`), nodes get positions from dagre only — never hand-placed.
- **Groups as subflows** with visible borders and the group name as the
  subflow label; nodes keep the same hue per group as the rataflow
  view where the spec declares groups.
- **Edge labels** rendered with the same strings as the rataflow spec.
- **Animated edges** (`animated: true`) only where listed above.
- A fixed viewport (e.g. 1100x700) with `fitView` so the whole graph is
  visible without pan; no minimap, no controls chrome in the capture.

## Evidence capture, per case

Read the terminal-browser skill (`agents/.agents/skills/terminal-browser/SKILL.md`)
FIRST and follow it. Open the HTML file, wait for layout to settle, and
take a snapshot/screenshot per the skill's mechanism; save the capture
and the exact commands you ran into `docs/visualize-eval/rounds/07/<case>/`
alongside the HTML. Record the measured layout facts you can read from
the page (node count, subflow titles visible, any edge crossings you can
see) in `notes.md` — informal observations for the judge to verify, not
claims.

## Budget and isolation

- At most three React Flow attempts per case (layout-parameter changes
  count); preserve each rejected HTML variant under `attempts/` with the
  parameter diff noted.
- Do not edit: `rataflow/**`, `scripts/**`, `docs/visualize-eval/rubric.json`,
  `docs/visualize-eval/proposals/**`, the round-05 bundles, or any other
  case. Write only under `docs/visualize-eval/rounds/07/`.
- Do not read `expected.json` or `historical-variants.json` for any
  case; work from the round-05 final specs only.

Report tersely per case: spec used (+hash), dagre parameters, subflow
titles, capture path, honest divergences you noticed versus the rataflow
rendering.
