# Task
Add a Tab mode-cycling control to the quiz extension so the captain can switch between three input modes while a quiz prompt is open: steering, note (for "I don't know"), and follow-up.

Captain's request:
- Tab cycles between three modes while a quiz is open: steering, note (for "I don't know"), or follow-up.
- If steering, do not remove the quiz question. The captain might just be asking for files to be opened (e.g. pressing the existing `o` shortcut to open context files) or typing a steer that references the question.
- Use your judgement for the other modes about whether to keep the quiz open or not: keep the quiz open when the captain's input is consistent with continuing the quiz, and close it only when the mode genuinely ends the quiz.

Scope:
- Target repo: `<repo>`.
- Likely file: `pi/.pi/agent/extensions/quiz.ts` and any shared user-input panel helpers it already uses.
- Reuse the existing quiz panel machinery (number-key selection, `o` context-file shortcut, note field, Enter submit, Escape cancel). Tab is an additive mode selector on top of that, not a rewrite.
- Use the existing `nvim-open.ts` and `ask-user-question.ts` patterns as reference for shared behavior.

Before coding:
- Read `AGENTS.md` in the dotfiles worktree.
- Read the current `quiz.ts` end to end before editing.
- Read Pi extension/TUI docs if you need API details:
  - `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
  - `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/tui.md`
- Use Ponytail: keep the change minimal, reuse existing input/panel code, and do not invent a new mode framework.

Acceptance criteria:
1. While a quiz is open, Tab cycles a visible mode indicator between steering, note, and follow-up.
2. The current mode is clearly rendered (e.g. a label or hint line) so the captain always knows which mode is active before typing.
3. Steering mode: the quiz question stays visible and the quiz is not removed; the captain can type a steer and/or use `o` to open context files without losing the question.
4. Note mode: typing produces a note (the existing note-field semantics for "I don't know"), and the quiz stays open unless submitting the note ends it by design.
5. Follow-up mode: typing produces a follow-up message; use your judgement on whether the quiz stays open, but never close it silently — make the outcome visible.
6. Existing quiz behavior still works: number-key selection, `o` context-file shortcut, arrow navigation, Enter submit, Escape cancel, explanation display, shuffled options.
7. Add or update the smallest useful automated test for the mode-cycling behavior or its extracted testable unit.
8. Commit on branch `fm/quiz-tab-modes`, then run the no-mistakes path and open a PR.

Do not modify the H100 lesson files, live global Pi extension files, or the captain's `~/.pi` config. Do not push or merge manually.

# Herdr lifecycle declaration - NOT ENABLED
**HARD SAFETY GATE:** this scaffold cannot inspect the task text filled in above.
If the task will start, stop, delete, restart, profile, or otherwise drive Herdr lifecycle behavior, stop and regenerate the brief with `--herdr-lab` before dispatch.
Do not add Herdr lifecycle commands to this unguarded brief by hand.

# Setup
You are in a disposable git worktree of dotfiles, at a detached HEAD on a clean default branch.

**Verify isolation before anything else.** Run `pwd -P` and `git rev-parse --show-toplevel`; both must resolve to the disposable task worktree you were launched in, such as a treehouse pool path or an Orca-managed worktree, not the primary checkout firstmate operates from.
The path check is authoritative: `git rev-parse --git-dir` and `git rev-parse --git-common-dir` can help inspect the repo, but they do not prove you are outside the primary checkout.
If the top-level path is the primary checkout or not the worktree you were launched in, STOP - do not branch or commit here - append `blocked: launched in primary checkout, not an isolated worktree` to the status file and stop.

1. First action: create your branch: `git checkout -b fm/quiz-tab-modes`
2. Run `no-mistakes doctor`; if it reports the repo is not initialized here, run `no-mistakes init`.
