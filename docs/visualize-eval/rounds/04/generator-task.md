# Fresh DeepSeek generation — round 04

This is a user-requested live evaluation, not a CI test-step task.
Use DeepSeek: `fireworks/accounts/fireworks/routers/deepseek-flash-latest`.
Only separate diagram judges use `openai/gpt-6.1-sol`. Do not spawn a judge
yourself.

## Isolation

Work in the existing non-main worktree. Read `AGENTS.md` and required guidance.
Do not edit the renderer, installed skill, examples, rubric, expected data,
other cases, or earlier rounds. Do not commit or install anything.

Freshly invoke the candidate by reading `docs/visualize-eval/rounds/04/SKILL.md`.
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

Round 04 changes the motion model and adds three quality gates the human
review asked for:

- **Constant speed is the default.** `flow: true` animates at 0.5 cells per
  100 ms step; long routes simply take longer. Same-arrival (all dots
  reaching their arrowheads at the same instant) is opt-in only:
  `flow: true` + `timing: "same-arrival"` + `duration_ms` (default 2000).
  `duration_ms` without same-arrival timing is rejected.
- **Dots are flair.** Arrowheads alone can carry the flow. Keep dots on
  directed-flow views unless the source forbids them or they clutter; if the
  source asks for no dots, that request wins everywhere in the case.
- **Dot origin.** Every dot starts at the actual start of its own arrow, the
  first drawn cell after the source port, corners included. `--check` prints
  `origins: N/N routes start at their arrow origin`; anything short of N/N
  is a defect. Same-arrival routes must also show `arrivals: N/N` — the dot
  touching the arrowhead on the final frame.
- **Route economy.** `--check` prints `routes: N/M near-minimal, K detours`.
  Iterate until detours is 0 or every long route is reported `forced`.
  Never accept a loop or hairpin a shorter obstacle-safe path avoids.
- **Label ownership.** `--check` prints the labels line with an
  ambiguous-owner count; it must read 0. If no unambiguous slot exists,
  change the layout or split — only then record it as a defect.
- **Crossings.** `--check` prints `crossings: N bridges, M touching bends`.
  Reduce bridges by port reassignment first, then spacing, then a re-split —
  never by reordering the source's groups, merging relations, or dropping
  labels or qualifiers.
- **Trunk direction.** A trunk's from/to must match the direction the
  source states; if not, draw plain edges and say why.

## Generate

Make a fresh diagram from your case brief. You may use up to four focused views.
Preserve all intended relationships across views with explicit coverage.
Do not delete or reverse facts, or remove necessary labels, to hide warnings.
Qualify uncertain historical evidence as the source brief requires.
If the renderer lacks a required feature, record a blocker rather than invent it.

Follow the candidate skill, including its meaning ledger, relationship
audit, group declarations, split coverage map, and capability preflight.

**Budget: at most three spec candidates per view, counting every `--check`
run on a distinct spec — orientation probes and cheap layout probes count.**
Record every attempt in `attempts.json` with its raw `--check` output
preserved in the bundle. Then preserve the best honest result and list its
remaining defects. Do not optimize indefinitely. This is one evaluation
sample.

**Claims must cite captures.** A claim backed only by a `--check` line is
not proof; name the frame file and coordinates that show it. For direct
`--frames` dumps outside a pane, pin the terminal size:
`COLUMNS=77 LINES=47 "$BIN" --frames 21 ...` — a dump at another size
proves nothing. Never hardcode a pane geometry number; the live app's own
header token is the accepted measurement.

## Capture actual output through the harness

Use the repository scripts; do not hand-roll captures.

```sh
scripts/viz-evidence.sh --spec <spec.json> --bin <frozen-bin> \
    --out <case-dir>/evidence/<view> --label <view> [--frames 5]
scripts/viz-validate.py <case-dir>/evidence/<view> --require-select [--require-frames] \
    --attempts <case-dir>/attempts.json
```

- `viz-evidence.sh` splits a no-focus half pane in YOUR OWN Herdr tab, records
  the absolute binary path and its sha256, runs `--check`, captures visible text
  and ANSI, captures an every-node `--select-all` ANSI frame, captures
  timestamped animation frames when you pass `--frames`, closes the pane, and
  proves the close in `manifest.json`.
- For any animated view pass `--frames 21` so the capture covers a whole 2000 ms
  cycle: frame 0 proves every dot starts at its arrow origin, the final frame
  proves every dot reaches its arrowhead at the same instant.
- Layout work: read `crossings:` after each attempt, keep the layout that lowers
  it without losing meaning, and record the count you chose and why.
- Record attempts in `attempts.json` before you capture:
  `{"views": [{"view": "v1", "attempts": [{"spec_sha256": "...", "note": "reason"}]}]}`.
  Four views maximum, three spec attempts per view maximum.
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
- `case_id`, `round: "03"`, generator identity and exact model.
- Candidate skill and renderer SHA-256 values.
- Views with relative paths to spec, text, ANSI, selected ANSI, check, frames,
  measured dimensions, and the `viewport:` line.
- The meaning ledger and the relationship audit from the skill.
- Mapping from each original relationship to its visible view relationship.
- Source pointers, abbreviations, deliberate drops with reasons, known defects,
  blockers, and cleanup status.
- Validator output per view, including any failing check.

Do not mark your output green or claim independent approval.
Do not spawn a reviewer despite the candidate skill's review section: the captain
will start a separate Sol judge after your result arrives.
Return a compact report with output paths, view counts, warnings, and unmet needs.
Use title comments for shell/Python calls. Use uv for Python.
