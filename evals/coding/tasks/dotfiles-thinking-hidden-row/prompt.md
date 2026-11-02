Repo: <repo> (defaults repo). Work only inside this worktree; do not touch the main checkout.

## Symptom
The user reports: "If I disable thinking, I see an extra bullet point with thinking." So the chat transcript gains a bare bullet-like row whose only text is "thinking" when the thinking level is off (and/or when thinking rows are hidden). No thinking text follows it.

## Where to look (already narrowed by the captain, verify don't assume)
- `pi/.pi/agent/extensions/thinking-title.ts` is the prime suspect. It sets the hidden-row label on session_start and on every coalesced repaint:
  - `HIDDEN_ROW_LABEL = "✺ thinking"` (line ~44), applied via `ctx.ui.setHiddenThinkingLabel(HIDDEN_ROW_LABEL)` in `session_start`, `scheduleRepaint`, and the `/titles` command.
  - `SPINNER_LABEL = "thinking"` / `spinnerLine()` returns a spinner frame + "thinking" for a streaming thinking block.
  - The markdown transformer returns `markdown` unchanged when text is empty, when `showFullThinking`, or for non-`assistant-thinking` zones.
  Pi's own renderer (`dist/modes/interactive/components/assistant-message.js` in the installed pi package at `~/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent`) renders each thinking run either as hidden `Text(hiddenThinkingLabel)` or as Markdown for the `assistant-thinking` zone. It skips runs whose `thinking.trim()` is empty.
- `pi/.pi/agent/extensions/rounded-bar-footer.ts` line ~286 renders the footer right side as `model • thinking off` when `ctx.model.reasoning && ctx.thinkingLevel === "off"`. Check whether this is the "extra bullet" the user means, or a second source (footer vs transcript).
- `pi/.pi/agent/extensions/tool-call-renderer-public.ts` renders status glyphs and bullets; confirm it does not add a thinking row.

## Goal
1. Find the exact code path that emits the extra "thinking" bullet when thinking is disabled. Check both cases: (a) `/thinking off` level, (b) thinking rows hidden (Ctrl+T / `hideThinkingBlock`).
2. Reproduce it deterministically. Prefer extending `scripts/test-pi-hidden-thinking-render.py` (pyte render of a fixture session) or `pi/.pi/agent/extensions/thinking-title.test.mjs`. Keep the reproduction offline and cheap. Read `docs/pi-live-config.md` and `scripts/test-pi-hidden-thinking.mjs` first for the contract: `hideThinkingBlock` must stay OFF in base settings, and the thinking-title extension owns the visible row via the `assistant-thinking` markdown zone.
3. Fix the root cause without breaking the contract: streaming spinner, closed-run title/heuristic, `/titles` toggle, and the non-blank hidden label (a blank label re-creates the old extra-blank-line bug, see the `#thinking-space` comment).
4. Add a regression test that fails on the current code and passes after the fix. If you add a new suite, add it as `scripts/test-<name>.*` with the required `# Paths:` / `// Paths:` header so `git ls-files` discovery picks it up automatically — never hand-list it.
5. Run `.no-mistakes.yaml` runners: `scripts/nm-test.sh` and `scripts/nm-lint.sh`. Gate/step agents must not launch live pi sessions, nvim, or tmux/multiplexer servers. The existing pyte render test is the sanctioned local check; state clearly whether you ran it and whether it needs the live PTY.
6. Commit on this branch with a concise message. Report: root cause, files changed, tests added, exact test/lint results, and any follow-up risk.

## Constraints
- Use `uv` for Python. Do not introduce Hatch/Hatchling.
- Do not re-introduce a bundle patch for pi; the extension approach survives `pi update`.
- Do not change the `/titles` command name (`/thinking` is pi's built-in).
- Keep the change minimal and in ASD-STE100-style prose for comments/commits (short sentences, active voice, approved verbs).
