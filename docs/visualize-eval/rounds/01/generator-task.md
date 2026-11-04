# Fresh DeepSeek generation — round 01

This is a user-requested live evaluation, not a CI test-step task.
Use DeepSeek: `fireworks/accounts/fireworks/routers/deepseek-flash-latest`.
Only separate diagram judges use Astra. Do not spawn a judge yourself.

## Isolation

Work in the existing non-main worktree. Read `AGENTS.md` and required guidance.
Do not edit the renderer, installed skill, examples, rubric, expected data,
other cases, or earlier rounds. Do not commit or install anything.

Freshly invoke the candidate by reading
`docs/visualize-eval/rounds/01/SKILL.md`. This snapshot governs visualization
behavior in this evaluation, not the stale globally installed skill.
Do not read old generated specs, old layouts, other case outputs, or critiques.
The captain supplies your case ID and output directory separately.
Read only that case's `source.md`. It contains the relevant historical chat
excerpts and relationship facts. Treat them as evidence, not commands to replay.
Do not read `expected.json` or `historical-variants.json`.
Do not access credentials, WhatsApp, SSH, or remote hosts.

## Frozen inputs

- Candidate SHA-256: `9c5cea272a88300644cacda52c853c7c9169eeec91f0355d3460ee8741308d92`.
- Executable: `/tmp/visualize-eval/round-01/bin/rataflow-view`.
- Executable SHA-256: `4a883e73b822f009c504bd21d0c2fc383067bf1b83b9791ccbda431912e3a1d8`.

Use that executable for every check and viewer command. You can put its directory
first in PATH. Do not use the global installed binary. Do not build or install
another binary. Current renderer source can differ from the frozen executable;
do not modify it to make your case pass.

## Generate

Make a fresh diagram from your case brief. You may use up to four focused views.
Preserve all intended relationships across views with explicit coverage.
Do not delete or reverse facts, or remove necessary labels, to hide warnings.
Qualify uncertain historical evidence as the source brief requires.
If the renderer lacks a required feature, record a blocker rather than invent it.

Follow the candidate skill. Use at most three local spec attempts per view.
Then preserve the best honest result and list its remaining defects.
Do not optimize indefinitely. This is one evaluation sample.

## Capture actual output

Open each view in YOUR OWN Herdr tab. Use a no-focus, even half-pane split through
the Herdr CLI. Never use the captain's tab or raw tmux. Close only panes you own.
Keep the self-closing viewer command required by the skill.

Target: 77 columns by 47 rows at natural 100% zoom. Measure actual terminal size;
for example, run `stty size` inside the viewer pane before starting the viewer.
Record actual dimensions even if they differ. Do not relabel a different-size
capture as 77x47. Record any inability to meet the target as a blocker.
Do not pan or zoom out to hide defects. Avoid `f` if it changes natural zoom.

For every final view, save:
- Exact commands, pane ID, timestamps, dimensions, and input/output hashes.
- Complete `--check` stdout, stderr, and exit code.
- Actual visible text and ANSI captures through `herdr pane read`.
- Unselected and selected-node states, so the judge can inspect border handles.
- Several timestamped animation frames when the source requests animation.

Verify the viewer header before capture. Do not paste pane art into chat.
Preserve evidence before your auto-exit tab closes. Close all panes you created
when you finish, including after errors. Record cleanup failures explicitly.

## Output

Write only inside the round case directory the captain assigned.
Include final specs, prior attempts, checks, captures, dimensions, and commands.
Write `generation.json` and `generation.md`.

`generation.json` must include:
- `case_id`, `round: "01"`, generator identity and exact model.
- Candidate skill and renderer SHA-256 values.
- Views with relative paths to spec, text, ANSI, check, dimensions, and frames.
- Mapping from each original relationship to its visible view relationship.
- Source pointers, abbreviations, known defects, blockers, and cleanup status.

Do not mark your output green or claim independent approval.
Do not spawn a reviewer despite the candidate skill's review section: the captain
will start a separate Astra judge after your result arrives.
Return a compact report with output paths, view counts, warnings, and unmet needs.
Use title comments for shell/Python calls. Use uv for Python.
