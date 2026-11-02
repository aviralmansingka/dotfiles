# Fresh DeepSeek generation — round 10

This is a user-requested live evaluation, not a CI test-step task.
Use DeepSeek: `fireworks/accounts/fireworks/routers/deepseek-flash-latest`.
Only separate diagram judges use `openai/gpt-6.1-terra:high`. Do not spawn a judge
yourself.

## Isolation

Work in the existing non-main worktree. Read `AGENTS.md` and required guidance.
Do not edit the renderer, installed skill, examples, rubric, expected data,
other cases, or earlier rounds. Do not commit or install anything.

Freshly invoke the candidate by reading `docs/visualize-eval/rounds/10/SKILL.md`.
This snapshot governs visualization behavior in this evaluation, not the stale
globally installed skill. Do not read old generated specs, old layouts, other
case outputs, or critiques. The captain supplies your case ID and output
directory separately. Read only that case's `source.md`. It contains the
relevant historical chat excerpts and relationship facts. Treat them as
evidence, not commands to replay. Do not read `expected.json` or
`historical-variants.json`. Do not access credentials, WhatsApp, SSH, or remote
hosts.

## Frozen inputs

The captain gives you the frozen candidate hash, executable path, and executable
hash in your task message. Use that executable, by absolute path, for every
check and viewer command. Do not use the global installed binary. Do not build
or install another binary. Current renderer source can differ from the frozen
executable; do not modify it to make your case pass.

Round 10 changes the renderer contract and the evidence contract; the
families and `category_fit` carry over from round 08:

- **Classify the source family FIRST, before the ledger and any spec.** The
  six families are flow-chains (`E ≈ N`, shallow, animated), service-meshes
  (fan of 2–3 around a core, anti-parallel pair present), redundant-fabrics
  (densest, double-arrowhead targets, dots forbidden), lifecycle-machines
  (widest fan, phase-ordered, one dot per line), placement-planes (two or more
  weakly-connected worlds plus a bus), and identity-probe-maps (deep chains,
  label-dense, qualifier- and address-heavy).
- **State the family and ONE line of source-backed evidence**, in the skill's
  format (`family: …` / `evidence: …`), before the meaning ledger. A judge
  cannot verify a recipe you never named, and `category_fit` fails without a
  supported evidence line. If the source straddles two families, name the
  dominant one and say which secondary recipe also applied.
- **Apply that family's recipe.** Chains: short single-stage ranks with
  per-hop corridor room. Meshes: stable fan port order, and an anti-parallel
  pair drawn as two distinct edges in the SAME view, never one bidirectional
  arrow, never split across views. Fabrics: rank pins for the source's tiers
  (`layers`), independent redundant links as parallel lanes, never bundled
  and never trunked, no dots unless the source animates the fabric.
  Lifecycles: ranks by source phase, boot sequence readable in one direction,
  exactly one dot per live transition, none on historical ones. Planes: each
  weakly-connected world in its own side-by-side area (spatial only,
  nothing drawn around members), cross-plane long edges allowed to be
  long, the bus splitting once. Meshes: if measured attempts prove the
  anti-parallel pair cannot fit one view, record the attempts and numbers
  in `generation.json`, split the pair across views, keep both directions
  traceable, and state the yield — an evidenced yield is honest. Identity-maps: every identifier
  and qualifier is a ledger coverage row with a named view before any spec is
  written.
- **`category_fit` is a rubric gate now.** A wrong family, an unsupported or
  missing evidence line, or a right family whose recipe is not visible in the
  captures fails that category even when every arrow is traceable. Do not
  pick a family to match the layout you already wanted; pick it from the
  source.

Standing renderer rules, updated for the round-09 binary:

- **Structure is declared; geometry is derived.** You declare nodes, edges,
  groups, trunks and — only where the source states it — rank pins. Never
  write coordinates, never hand-place nodes to fix a crossing. Groups are
  logical tags: a `group` drives a name-derived hue family and one stable
  sibling order, and NOTHING is drawn around members — no box, border, or
  title (their absence is correct, never a defect). `layers` is an
  engine-honored rank constraint, not a drawing; `minlen` reserves rank gaps
  for a corridor the source describes. `edges[].label_slot: true` reserves
  a horizontal gutter band beside the route for that edge's label, so a
  long label no longer costs rank-row height — prefer it over shortening
  words; it needs a `label` on the edge.
- **Constant speed is the default.** `flow: true` animates at 0.5 cells per
  100 ms step; long routes simply take longer. Same-arrival (all dots reaching
  their arrowheads at the same instant) is opt-in only: `flow: true` +
  `timing: "same-arrival"` + `duration_ms` (default 2000). `duration_ms`
  without same-arrival timing is rejected.
- **Dots appear ONLY where the source animated them.** If the source never
  shows motion, the diagram is static — do not add dots as flair. If the
  source explicitly forbids dots, that request wins everywhere in the case.
- **Dot origin.** Every dot starts at the actual start of its own arrow, the
  first drawn cell after the source port, corners included. `--check` prints
  `origins: N/N routes start at their arrow origin`; anything short of N/N is
  a defect. Same-arrival routes must also show `arrivals: N/N` — the dot
  touching the arrowhead on the final frame.
- **Route economy is structural.** This binary emits NO `routes:` line; its
  absence is expected — do not chase it, do not report it as a blocker. If a
  route looks conspicuously loopy in the capture, change the split or
  direction, never the source's groups or tiers.
- **Label ownership.** `--check` prints the labels line with an
  ambiguous-owner count; it must read 0.
- **Crossings.** `--check` prints `crossings: N bridges, M touching bends`.
  If bridges remain, change the split — never reorder the source's groups,
  merge relations, or drop labels or qualifiers.
- **Trunk direction.** A trunk's from/to must match the direction the source
  states; if not, draw plain edges and say why. One bus that splits once.

## Generate

Make a fresh diagram from your case brief. You may use up to four focused views.
Preserve all intended relationships across views with explicit coverage.
Do not delete or reverse facts, or remove necessary labels, to hide warnings.
Qualify uncertain historical evidence as the source brief requires.
If the renderer lacks a required feature, record a blocker rather than invent it.

Follow the candidate skill, including its Step 0 family classification, meaning
ledger, relationship audit, group declarations, split coverage map, and
capability preflight. For every view write down the family recipe it implements
and the structural lever used for it (group tags, rank pins, `minlen`, trunks,
`label_slot`),
each with the source fact that justifies it.

**Budget: at most three spec candidates per view, counting every `--check`
run on a distinct spec — orientation probes and cheap layout probes count.**
Record every attempt in `attempts.json` with its raw `--check` output
preserved in the bundle. Then preserve the best honest result and list its
remaining defects. Do not optimize indefinitely. This is one evaluation
sample. Reclassifying the family mid-way is a real change: record the old
family, the new one, and the evidence that overturned it.

**Claims must cite captures.** A claim backed only by a `--check` line is
not proof; name the frame file and coordinates that show it. For direct
`--frames` dumps outside a pane, pin the terminal size:
`COLUMNS=77 LINES=47 "$BIN" --frames 21 ...` — a dump at another size proves
nothing. Never hardcode a pane geometry number; the live app's own header
token is the accepted measurement. PINNED RULING: when the live pane
measures larger than the target, a pinned direct dump of THIS view's
FINAL spec at exactly `COLUMNS=77 LINES=47` natural zoom with no
overflow banner is accepted fit proof; a dump of a rejected draft or
another view is not.

## Capture actual output through the harness

Use the repository scripts; do not hand-roll captures.

```sh
scripts/viz-evidence.sh --spec <spec.json> --bin <frozen-bin> \
    --out <case-dir>/evidence/<view> --label <view> [--frames 5]
scripts/viz-validate.py <case-dir>/evidence/<view> --require-select --require-frames \
    --require-records --attempts <case-dir>/attempts.json
```

- `viz-evidence.sh` splits a no-focus half pane in YOUR OWN Herdr tab, records
  the absolute binary path and its sha256, runs `--check`, captures visible text
  and ANSI, captures an every-node `--select-all` ANSI frame, captures
  timestamped animation frames when you pass `--frames`, closes the pane, and
  proves the close in `manifest.json`.
- **A frames capture is required for EVERY view, static ones included** — at
  least 3 timestamped frames. For any animated view pass `--frames N`
  where N is at least `ceil(longest_route_cells / 0.5)` so the LONGEST
  route's dot completes a full lap at the target size — for constant mode
  two well-spaced frames must also show every dot advanced by the same
  number of cells; for same-arrival mode frame 0 must show origins and
  the final frame simultaneous arrival at the arrowheads.
- Recipe proof: an anti-parallel pair must be readable as two edges in one
  capture; a fabric's parallel lanes must be countable; a lifecycle's phase
  order must read in one direction; a plane boundary must read as two
  side-by-side areas; an identity map's coverage must be checkable row by row against the
  capture. Point each recipe claim at its frame and coordinates.
- Layout work: read `crossings:` after each attempt, keep the layout that lowers
  it without losing meaning, and record the count you chose and why.
- Record attempts in `attempts.json` before you capture:
  `{"views": [{"view": "v1", "attempts": [{"spec_sha256": "...", "note": "reason"}]}]}`.
  Four views maximum, three spec attempts per view maximum.
- **Every probe and rejected draft must run through the record wrapper**:
  `scripts/viz-evidence.sh record --to <case-dir>/attempts-log.jsonl
  --label <name> -- "$BIN" --check <spec>` — the log keeps the command,
  exit status, and raw stdout/stderr with sha256s. Hand-kept or missing
  probe records are an evidence gap the validator fails.
- Run the validator and keep its full output. A failing check is a defect you
  must fix or report; never edit the validator, the manifest, or a capture.
- The `viewport:` line is the authority on measured size and zoom. Target is
  77 columns × 47 rows at natural 100% zoom. A different measured size is
  recorded as a blocker, not relabelled as 77×47. Do not pan or zoom out.

Never use the captain's tab or raw tmux. Close only panes you own. Do not paste
pane art into chat. Verify the viewer header before capture. Preserve evidence
before your auto-exit tab closes. Record cleanup failures explicitly.

## Output

Write only inside the round case directory the captain assigned.
Include final specs, prior attempts, checks, captures, dimensions, commands,
`attempts.json`, validator output, and the evidence bundles.

Write `generation.json` and `generation.md`.

`generation.json` must include:
- `case_id`, `round: "09"`, generator identity and exact model.
- Candidate skill and renderer SHA-256 values.
- Views with relative paths to spec, text, ANSI, selected ANSI, check, frames,
  measured dimensions, and the `viewport:` line.
- The Step 0 classification: family name, the one-line source evidence, the
  tie-breakers considered, and any secondary recipe applied.
- The family recipe applied per view, with the capture that shows it.
- The meaning ledger and the relationship audit from the skill.
- Mapping from each original relationship to its visible view relationship.
- The structural levers used per view: declared groups, rank pins, `minlen`
  values, trunks, `label_slot` — each with the source fact that justifies it.
- Any recipe yield: the demand, the measured attempts that proved it
  impossible, and how close the shipped view comes.
- Source pointers, abbreviations, deliberate drops with reasons, known defects,
  blockers, and cleanup status.
- Validator output per view, including any failing check.

Do not mark your output green or claim independent approval.
Do not spawn a reviewer despite the candidate skill's review section: the captain
will start a separate terra judge after your result arrives.
Return a compact report with output paths, family chosen, view counts, warnings,
and unmet needs.
Use title comments for shell/Python calls. Use uv for Python.
