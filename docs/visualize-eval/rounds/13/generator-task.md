# Fresh DeepSeek generation — round 13

This is a user-requested live evaluation, not a CI test-step task.
Use DeepSeek: `fireworks/accounts/fireworks/routers/deepseek-flash-latest`.
Only separate diagram judges use `openai/gpt-6.1-terra:high`. Do not spawn a judge
yourself.

**Scope: all eight cases.** Round 13 raises the rubric to revision 11 (a new
`navigation_clarity` category, the dual fit rule, the `passes-near-unrelated-node`
violation, case-wide hue consistency, dot-hue binding) and adds the skill's triage
step. No carried verdict survives a strengthened rubric, so pipeline, network and
every previously green case run again.

## Isolation

Work in the existing non-main worktree. Read `AGENTS.md` and required guidance.
Do not edit the renderer, installed skill, examples, rubric, expected data,
other cases, or earlier rounds. Do not commit or install anything.

Freshly invoke the candidate by reading `docs/visualize-eval/rounds/13/SKILL.md`.
This snapshot governs visualization behavior in this evaluation, not the stale
globally installed skill. Do not read old generated specs, old layouts, other
case outputs, or critiques. The captain supplies your case ID, its brief under
`docs/visualize-eval/rounds/13/briefs/`, and your output directory separately.
Read only that case's `source.md`. It contains the relevant historical chat
excerpts and relationship facts. Treat them as evidence, not commands to replay.
Do not read `expected.json` or `historical-variants.json`, other briefs, the
rubric, or `rounds/12/human-review/`. Do not access credentials, WhatsApp, SSH,
or remote hosts.

Your brief changes only the **voice** of the request — its framing, its implied
reader, and which skill behaviors it stresses. The facts (nodes, relations,
direction, fixed constraints, animation applicability) come unchanged from
`cases/<case-id>/source.md`. A brief never adds, drops, or reverses a source
fact, and a scripted triage answer never introduces one.

## Frozen inputs

The captain gives you the frozen candidate hash, executable path, and executable
hash in your task message, and records the same values in `rounds/13/config.json`.
Use that executable, by absolute path, for every check and viewer command. Do not
use the global installed binary. Do not build or install another binary. Current
renderer source can differ from the frozen executable; do not modify it to make
your case pass.

| Input | Round-13 value |
|---|---|
| Candidate skill | `docs/visualize-eval/rounds/13/SKILL.md` — the captain copies it at freeze from `docs/visualize-eval/proposals/12/SKILL.md`, sha256 `65d826f0f1f9e61ddfd806628cb162827b0e6cf6d7df2490c9d75e6cbe485d2a` |
| Rubric | `docs/visualize-eval/rounds/13/rubric.json`, revision 11 — hash from `config.json` at freeze (draft sha256 `6bfd3733c8d08b66af9a92e71985a20846f954d7916eaf9685f86c8d2f96bcb8`, recomputed if the captain edits it) |
| Renderer binary | path and sha256 TBD by the captain at freeze (`config.json`) |
| Renderer source | git commit + dirty diff, frozen in `metadata.json` |
| Dataset | `cases.json` digest from `config.json`; per-case source hashes from `metadata.json` |
| Viewport | 77 columns x 47 rows, natural zoom 100% |

If any of those is missing from your task message, stop and report blocked.
Never invent a hash or a path.

### What changed for round 13

**Skill (proposal 12):**

- **Step 0 is now the triage step, not just a shape notice.** The skill asks
  focused questions — one at a time — until it genuinely knows what to draw, and
  stops when the picture is clear. It is part of the contract, not a nicety.
  This round the user is not live; read the **TRIAGE PROTOCOL** annex below.
- **The view ladder is explicit.** One concept that fits 77x47 → one
  side-by-side view. Several concepts, or a graph too large → ONE canvas hosting
  named concept-diagrams, each with a drawn **title and one-line description**.
  Never shrink clarity to fit; never drop or thin a relation to fit a number.
- **Clarity over shaping.** A layout budget is a readability hint; the source's
  content is the authority.

**Engine (frozen at freeze; verify in your own captures, do not assume):**

- The canvas spec form: `diagrams: [{ id, title, description?, direction?,
  nodes, edges, layers?, trunks? }]`. A spec declares either `edges` or
  `diagrams`, never both; `nodes`, `layers` and `trunks` move inside each
  diagram. `--check` reports `canvas: N diagrams on one canvas`, one
  `diagram <n> "<title>" at <x>,<y>: extent=<w>x<h> nodes=… edges=… routes=…`
  line plus a `description:` line per diagram, and one whole-canvas extent.
- Ambiguity-free routing: the corridor planner penalises cells near unrelated
  nodes; `--check` names each offender as
  `near-miss: route eN passes <c> cell(s) at ring <r> of node '<id>' (nearest
  cell <x>,<y>)`, and a `passes-near-unrelated-node` total that must read 0.
- Case-wide group hues: one `group` tag keeps one hue family across every
  diagram of a canvas.
- Dot hues: `--check` prints
  `dot hues: N by source, M by destination, K shared-hue pair(s) (source-only S,
  destination-only D)`; each dot takes its own route's source-or-destination
  hue, whichever end leaves fewer routes sharing one hue.

If the frozen binary does not print a line this task names, record that as a
blocker for that behaviour rather than editing the spec to imitate it.

## Step 0 — triage, then classify

Run the skill's Step 0 in this order:

1. **Triage.** Ask the questions the framing provokes, use your judgment between
   them, and stop when you know the source, the reader's job, and the shape.
   Under this harness the user is scripted: read **TRIAGE PROTOCOL** at the end of
   this file and use your brief's annex. Never ask a question the annex cannot
   answer; when a real gap remains, decide it yourself from the source and the
   skill, and record the decision with `answer_source: "own judgment"` plus the
   reason. Never import a fact from outside `source.md`.
2. **Classify the source family** — still required, still one of the six:
   flow-chains, service-meshes, redundant-fabrics, lifecycle-machines,
   placement-planes, identity-probe-maps. State `family: …` and one
   source-backed `evidence: …` line before the meaning ledger. The family is a
   hint, never a cage: borrow its habits, deviate with a recorded reason, and
   record an evidenced yield only when measured attempts prove the renderer
   cannot satisfy the habit.

Round 13 keeps the round-10/11/12 engine contract (mid-side attachment,
target-aligned port order, lane-aware rank gaps, inside-hop back edges,
collision-free group hues) and the standing declaration rules:

- **Structure is declared; geometry is derived.** Declare nodes, edges, groups,
  trunks and — only where the source states it — rank pins. Never write
  coordinates. Groups are logical tags: nothing is drawn around members, and
  their absence is never a defect.
- `layers` is an engine-honored rank constraint, `minlen` reserves a rank gap
  for a corridor the source describes, `edges[].label_slot: true` reserves a
  gutter for one long label. Each needs a source fact that justifies it.

## Choose the view shape honestly

Write the choice down before the first spec, with the facts that decided it:

- **One view** when the source's concepts fit 77x47 at natural zoom, read
  side-by-side with chat. `~12 nodes / ~16 edges` is a readability hint about
  when this rung usually applies — never a budget.
- **One canvas of described concept-diagrams** when the source has several
  concepts that separate cleanly, or a graph that cannot fit 77x47. Each
  diagram gets `title` + `description`; the split follows the source's own
  clusters, never a node count.
- **Never** a canvas to dodge a hard layout, and never a canvas for a single
  small concept that fits one view. Never drop, merge, or thin a source concept
  to fit either shape. There is no fixed diagram cap, but a diagram must carry a
  concept, not a fragment: round 11's failure mode was over-splitting one case
  into sparse views, and a canvas of thin fragments is the same defect with a
  nicer title.

Every diagram's description must be true: what it shows, in the reader's terms
(the rubric's new `navigation_clarity` category fails an inaccurate or
boilerplate description). For a single-view case no title line is required.

Write the split coverage map before drawing: one row per viewed diagram, every
audited edge and ledger fact naming its diagram. A split that loses a relation,
qualifier or identifier has failed.

## Routing — no passing near unrelated nodes

A route must not run near, hug, or overlap a node that is neither its source nor
its destination; a route inside the ring that touches an unrelated box reads as
a connection to it. This is the round-13 defect the gb300 a3 view showed
(`nvos -> nmxc` and in-band routes hugging the OOB LAN until it looked joined).
Levers, in order: move the split, change the direction, use `layers` to open a
corridor the source describes. Never delete or merge a relation, never reorder
the source's groups or tiers, and never accept `near-miss:` lines or a non-zero
`passes-near-unrelated-node` count when a legal route exists.

## Motion

- **Dots appear ONLY where the source animated them.** If the source never shows
  motion the diagram is static; if the source forbids dots, that wins. Case
  applicability is frozen in `cases.json`.
- **Constant speed is the default** (0.5 cells per 100 ms). Same-arrival is
  opt-in only, needs `timing: "same-arrival"` + `duration_ms`, and must show the
  dot touching each arrowhead in one frame.
- **Dot origin**: first drawn cell after the source port, corners included;
  `origins: N/N` must read full.
- **Dot hue binds the route** where dots run: the source or destination node's
  hue, whichever end leaves fewer shared hues. State which end each animated
  route used and why; `dot hues: …` must agree with the capture.
- A route too short to show motion stays static with a recorded reason.

## Generate

Make a fresh diagram from your brief. Cover every source relation and qualifier.
Qualify uncertain historical evidence as the source brief requires. If the
renderer lacks a required feature, record a blocker rather than invent it.

**Budget: at most three spec candidates per rendered diagram, counting every
`--check` run on a distinct spec — orientation probes and cheap layout probes
count.** Long-label gutters and canvas re-layouts count too. Record every
attempt in `attempts.json` with its raw `--check` output preserved in the
bundle, and every rejected draft or probe through the record wrapper. Preserve
the best honest result and list its remaining defects. Do not optimize
indefinitely. Reclassifying the family mid-way is a real change: record the old
family, the new one, and the evidence that overturned it.

**Claims must cite captures.** A claim backed only by a `--check` line is not
proof; name the frame file and coordinates that show it. For direct `--frames`
dumps outside a pane, pin the terminal size:
`COLUMNS=77 LINES=47 "$BIN" --frames 21 ...`. Never hardcode a pane geometry
number; the live app's own header token is the accepted measurement.

Fit evidence depends on the shape you chose:

- **Single view**: PINNED RULING — a live pane header token at 77x47 @100%
  natural, or a pinned direct dump of THIS view's FINAL spec at exactly
  `COLUMNS=77 LINES=47` natural zoom with no overflow banner. A dump of a
  rejected draft or another view is not proof.
- **Canvas**: a pane capture of the whole canvas at natural 100% zoom (the
  reader pans it; an overflow banner is expected and is not itself the defect),
  plus the `--check` canvas block — per-diagram `at x,y: extent=w x h` lines and
  the whole-canvas extent — plus a capture per diagram showing its drawn title
  and description above its own drawing. Never zoom the app out to fake a fit;
  never shrink text.

## Capture actual output through the harness

Use the repository scripts; do not hand-roll captures.

```sh
scripts/viz-evidence.sh --spec <spec.json> --bin <frozen-bin> \
    --out <case-dir>/evidence/<surface> --label <surface> [--frames 5]
scripts/viz-validate.py <case-dir>/evidence/<surface> --require-select --require-frames \
    --require-records --attempts <case-dir>/attempts.json
```

- `viz-evidence.sh` splits a no-focus half pane in YOUR OWN Herdr tab, records
  the absolute binary path and its sha256, runs `--check`, captures visible text
  and ANSI, captures an every-node `--select-all` ANSI frame, captures
  timestamped animation frames when you pass `--frames`, closes the pane, and
  proves the close in `manifest.json`.
- **A frames capture is required for EVERY surface, static ones included** — at
  least 3 timestamped frames. For an animated surface pass `--frames N` where N
  is at least `ceil(longest_route_cells / 0.5)` so the LONGEST route's dot
  completes a full lap; constant mode also needs two well-spaced frames showing
  every dot advanced by the same number of cells.
- **Every probe and rejected draft must run through the record wrapper**:
  `scripts/viz-evidence.sh record --to <case-dir>/attempts-log.jsonl
  --label <name> -- "$BIN" --check <spec>`. Hand-kept or missing records are an
  evidence gap the validator fails.
- **Animation evidence.** When the frozen bundle ships
  `scripts/viz-frame-audit.py`, run it on every animated frames capture and keep
  its table with the evidence: it prints the per-route motion, the shared-speed
  comparison, and the equal-distance window the animation category needs. Its
  exit status is part of the record; do not argue with it in prose.
- **Run the validator and keep its full output.** A failing check is a defect you
  fix or report; never edit the validator, the manifest, or a capture.
- The `viewport:` line is the authority on measured size and zoom. A measured
  size other than the target is recorded as a blocker, not relabelled as 77x47.

Never use the captain's tab or raw tmux. Close only panes you own. Do not paste
pane art into chat. Verify the viewer header before capture. Preserve evidence
before your auto-exit tab closes. Record cleanup failures explicitly.

## Output

Write only inside the round case directory the captain assigned. Include final
specs, prior attempts, checks, captures, dimensions, commands, `attempts.json`,
validator output, and the evidence bundles.

Write `generation.json` and `generation.md`.

`generation.json` must include:

- `case_id`, `round: "13"`, generator identity and exact model.
- Candidate skill and renderer SHA-256 values, plus the rubric revision (11).
- **`triage`**: the brief annex id; `questions_provoked` (verbatim, including the
  ones your framing made unnecessary); `questions_used` as
  `{id, question, answer, answer_source}` where `answer_source` is
  `brief framing`, `annex answer <id>`, or `own judgment` with a reason;
  `converged_when`; and `shape_decision` (one view, or canvas with N described
  diagrams). See the TRIAGE PROTOCOL.
- The Step 0 classification: family name, the one-line source evidence, the
  tie-breakers considered, any secondary recipe, and any reclassification.
- The **view-shape decision**: rung chosen, the source facts that decided it, and
  the preference-ladder rung(s) rejected with the reason.
- Surfaces (views or canvas diagrams) with relative paths to spec, text, ANSI,
  selected ANSI, check, frames, measured dimensions, the `viewport:` line, and —
  for a canvas — each diagram's `id`, `title`, `description`, its `--check`
  origin and extent, and its node/edge/route counts.
- Per-diagram/per-view nodes, edges, labels and hues, plus the canvas totals.
- The habits borrowed per surface, and every deviation with its reason and the
  capture that shows it.
- The meaning ledger and the relationship audit from the skill.
- Mapping from each original relationship to its visible surface relationship.
- The structural levers used per surface: declared groups, rank pins, `minlen`,
  trunks, `label_slot`, `diagrams` blocks — each with the source fact that
  justifies it.
- **Routing record**: the `near-miss:` count and `passes-near-unrelated-node`
  total per attempt, and for any non-zero relief the lever that removed it.
- **Hue record**: the group→hue family table across all diagrams of the canvas,
  and the `dot hues:` line per animated diagram with the end each route bound to.
- Any recipe yield: the demand, the measured attempts that proved it impossible,
  and how close the shipped surface comes.
- Source pointers, abbreviations, deliberate drops with reasons, known defects,
  blockers, and cleanup status.
- Validator output per surface, including any failing check.

Do not mark your output green or claim independent approval. Do not spawn a
reviewer despite the candidate skill's review section: the captain starts a
separate terra judge after your result arrives.

Return a compact report with output paths, family chosen, shape chosen, triage
questions used, view counts, warnings, and unmet needs.
Use title comments for shell/Python calls. Use uv for Python.

---

# TRIAGE PROTOCOL (autonomous harness annex)

The skill's Step 0 asks the user until it knows what to draw. This harness has no
live user, so each brief pre-scripts the reader. The protocol exists to test the
**skill's** triage behavior without a human in the loop — not to let the
generator skip it.

## Rules

1. Read your brief and its annex before anything else. The annex holds the only
   answers available to you this round.
2. **Provoke first, then answer.** Write down every question your framing
   genuinely prompts (source scope, reader's job, panes-vs-canvas, motion,
   qualifiers), even the ones the brief already answers. The record is part of
   the deliverable; an empty list is only honest when the framing is
   unambiguous.
3. **Use the annex answer verbatim.** Do not embellish it into a new fact. An
   annex answer may set preference (one view vs canvas, dots or none, which
   seam matters) — never a node, relation, protocol or qualifier that
   `source.md` does not state.
4. **Stop when the picture is clear.** Do not manufacture questions to look
   thorough; a framing that answers everything converges after the first pass.
   Say in `converged_when` what made understanding complete.
5. **A gap the annex does not cover is yours.** Decide it from the source and the
   skill, then record `answer_source: "own judgment"` and the reason. Never
   invent a user statement.
6. The triage record is judged in stage B: a generator that asked nothing where
   its framing was vague, or asked past the point of clarity, fails the
   workflow's honesty bar even when the drawing is clean.

## Scripted dialogues per brief

Each block lists the questions the framing provokes, labelled `Q` with the
annex answer `A`. Answers are the simulated reader's words; ids are stable
(`TRIAGE-<case>-<n>`).

### TRIAGE-pipeline (quick reference, side-by-side)

Reader's job is known from the framing, so this case converges fast.

- **Q1 — shape: one pane beside the chat, or a canvas?**
  **A (TRIAGE-pipeline-1):** "One, beside my chat. I'm reading it while I work —
  it should fit without me dragging anything."
- **Q2 — motion: does the source's traffic request still apply?**
  **A (TRIAGE-pipeline-2):** "Yes, slow and sparse like the source says. I want
  to see direction, not speed."
- **Q3 — the two database paths: one label or two?**
  **A (TRIAGE-pipeline-3):** "Two. The auth read and the worker write are
  different paths; don't collapse them."

### TRIAGE-network (terse one-liner)

Deliberately under-specified: the skill must ask, and the annex supplies what a
live user would.

- **Q1 — scope: the whole path, or just the edge?**
  **A (TRIAGE-network-1):** "WAN through firewall and core, down to web, Redis
  and the database. All of it."
- **Q2 — reader's job?**
  **A (TRIAGE-network-2):** "I need to read the link speeds and see which
  application talks to which — not a picture of the boxes."
- **Q3 — panes or one pane with everything?**
  **A (TRIAGE-network-3):** "One pane, side-by-side. It's small enough."
- **Q4 — is the motion a measurement?**
  **A (TRIAGE-network-4):** "No. Slow sparse dots show traffic direction; the
  GbE labels are the measurement. Never imply the dot speed is the link speed."

### TRIAGE-server-nic-layout (detail-complete)

The framing answers the shape question outright; triage is about coverage, not
size.

- **Q1 — shape: one view, or everything on a canvas I navigate?**
  **A (TRIAGE-server-nic-layout-1):** "Show me everything. If that needs a
  bigger canvas, build it — I'll navigate. Just label each part so I know where
  I am."
- **Q2 — do the historical qualifiers stay drawn?**
  **A (TRIAGE-server-nic-layout-2):** "Keep them. 'Not cabled', 'free',
  'historical' mean something to me; don't clean them up into certainty."
- **Q3 — the invisible spine/leaf question?**
  **A (TRIAGE-server-nic-layout-3):** "Don't draw switches the trace never
  proved. I want the observed layout, not a guess about the fabric."

### TRIAGE-homelab-nic-trace (troubleshooting, trace one path)

- **Q1 — which path matters most?**
  **A (TRIAGE-homelab-nic-trace-1):** "The wired one, end to end: host through
  bond0, the router, ONT, the Verizon hops, Cloudflare. I want to follow it hop
  by hop."
- **Q2 — and the Wi-Fi and overlay paths?**
  **A (TRIAGE-homelab-nic-trace-2):** "Keep them, but clearly secondary — they're
  the backup and the encapsulation, not the main path. Don't let them tangle
  into it."
- **Q3 — panes or one pane?**
  **A (TRIAGE-homelab-nic-trace-3):** "One pane if the hop chain reads cleanly;
  a canvas if the local virtual nets need their own space. Your call."
- **Q4 — dots?**
  **A (TRIAGE-homelab-nic-trace-4):** "Only if they help me follow a hop. This is
  a trace, not a traffic map."

### TRIAGE-modal-machine-manager (full system, prefers one canvas)

- **Q1 — all 23 relations, or the main paths?**
  **A (TRIAGE-modal-machine-manager-1):** "All of them. Every relation once. I'd
  rather navigate a big canvas than lose a path."
- **Q2 — one canvas or several separate panes?**
  **A (TRIAGE-modal-machine-manager-2):** "One canvas with everything, split into
  named diagrams I can read. Describe each one so I know what I'm looking at."
- **Q3 — motion?**
  **A (TRIAGE-modal-machine-manager-3):** "Slow, sparse dots — one per live
  transition. Nothing on the historical ones, and no dot sitting on a border."

### TRIAGE-modal-runtime (ambiguous ask)

The framing is vague on purpose: the skill must ask about scope, reader's job and
shape before drawing.

- **Q1 — scope: the whole runtime, or one seam?**
  **A (TRIAGE-modal-runtime-1):** "All eight components and their eight
  relations — the seams, modules and RPCs. That's the point of the diagram."
- **Q2 — reader's job?**
  **A (TRIAGE-modal-runtime-2):** "I want to know which seam carries which
  protocol. The worker gRPC and the filesystem HTTP over UDS must not blur."
- **Q3 — panes or one canvas?**
  **A (TRIAGE-modal-runtime-3):** "One pane if the pair fits; a canvas with a
  described diagram per seam if the labels need room. Don't split just to make
  boxes smaller."
- **Q4 — motion?**
  **A (TRIAGE-modal-runtime-4):** "The source never shows motion — keep it
  static."
- **Q5 — is this a machine-manager diagram?**
  **A (TRIAGE-modal-runtime-5):** "No. It's the runtime's own internals; judge it
  by the runtime source, not by the machine-manager cases."

### TRIAGE-gb300-rack-software (plane separation)

- **Q1 — how separate are the OOB and in-band worlds?**
  **A (TRIAGE-gb300-rack-software-1):** "Completely. OOB is its own Ethernet
  network for hardware control; the in-band fabric carries training and storage.
  Keep the two worlds apart so nothing reads across them."
- **Q2 — the OOB fan: one line per BMC, or one trunk?**
  **A (TRIAGE-gb300-rack-software-2):** "One trunk that splits exactly once into
  the compute BMC, NVSwitch BMC and power shelf branches. Not a pile of lines
  that happen to touch."
- **Q3 — free software only?**
  **A (TRIAGE-gb300-rack-software-3):** "Yes. Anything that needs money stays
  out, and don't imply the gated images are free."
- **Q4 — panes or canvas?**
  **A (TRIAGE-gb300-rack-software-4):** "One canvas with a diagram per world is
  fine if that keeps the planes from bleeding into each other."

### TRIAGE-datacenter-redundancy (audit)

- **Q1 — what is the reader auditing?**
  **A (TRIAGE-datacenter-redundancy-1):** "Redundancy. I want to count the paths
  at each layer — two per MUX to the cores, both firewalls to both border
  leaves, both spines to each leaf, both leaves to each rack."
- **Q2 — may independent links share a bus?**
  **A (TRIAGE-datacenter-redundancy-2):** "Never. Each redundancy link stays its
  own line; if I can't count it, the diagram is wrong."
- **Q3 — panes or one canvas?**
  **A (TRIAGE-datacenter-redundancy-3):** "One pane if the fabric reads at
  natural zoom; a canvas if it truly needs it. No shrinking the text."
- **Q4 — dots?**
  **A (TRIAGE-datacenter-redundancy-4):** "None. The source turned them off and
  these are physical links."
