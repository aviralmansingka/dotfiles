# Task
Implement the captain's requested `R` shortcut in the Pi `run-command` extension.

Captain's request:
- Update the run-command tool to have a new shortcut `R`.
- `R` should use the Neovim path: open a new pane next to the captain's current pane, open a terminal inside Neovim using `:term dm`, launch the command inside that terminal, and extract the output automatically.
- The captain should not have to stop the run manually or paste output back by hand.
- Launch/work in this isolated worktree, not the primary checkout.

Important scope:
- Target repo: `<repo>`.
- Likely file: `pi/.pi/agent/extensions/run-command.ts`.
- Likely related code for reusable patterns: `pi/.pi/agent/extensions/nvim-open.ts`, `pi/.pi/agent/extensions/ask-user-question.ts`, `pi/.pi/agent/extensions/quiz.ts`, and any tests around Pi extensions.
- Read `AGENTS.md` before coding.
- Use Ponytail: choose the smallest root-cause change that works, reuse existing Neovim/RPC/pane helpers, and do not build a new control plane if a short extension-local integration is enough.

Before coding:
- Read the relevant Pi docs from the installed package:
  - `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
  - `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/tui.md`
- Inspect the existing `run-command` extension end to end before editing.
- Inspect the existing `nvim-open` extension or Neovim helper path before inventing new pane-opening behavior.
- If `:term dm` is ambiguous in context, preserve the captain's exact requested behavior and make the smallest implementation that can be manually smoked; open a `needs-decision` only if there are two materially different meanings that both require different code.

Acceptance criteria:
1. The run-command panel renders a clear `R` shortcut hint in addition to the existing copy/run/paste workflow.
2. Pressing `R` starts the displayed command through a Neovim terminal path instead of requiring manual copy/paste.
3. The Neovim terminal opens in a new pane next to the current/captain pane and starts via `:term dm` before running the command, matching the captain's wording as closely as the existing codebase supports.
4. Output is captured automatically and returned to the `run-command` tool's grading flow without the captain manually stopping the run or pasting output.
5. Existing manual workflow remains intact: copy key, paste-field submit, cancellation, and error handling keep working.
6. Long-running commands have a bounded, visible cancellation or timeout path; do not create an unkillable terminal job.
7. Add/update the smallest useful automated test for the shortcut behavior or its extracted testable unit.
8. Run local validation, commit on branch `fm/run-command-nvim-terminal`, then run the no-mistakes path and open a PR.

Implementation guidance:
- Prefer an extension-local helper that shells out to existing `nvim`/pane machinery over a broad abstraction.
- Reuse existing command quoting utilities if present; otherwise quote carefully and test commands containing spaces, quotes, and shell metacharacters.
- Treat command output as data: capture stdout/stderr/exit status when available, and clearly surface failures to the panel/tool result.
- Do not modify live files under `~/.pi/agent/extensions` directly.
- Do not push or merge manually; no-mistakes owns validation and PR creation.

# Herdr lifecycle declaration - NOT ENABLED
**HARD SAFETY GATE:** this scaffold cannot inspect the task text filled in above.
If the task will start, stop, delete, restart, profile, or otherwise drive Herdr lifecycle behavior, stop and regenerate the brief with `--herdr-lab` before dispatch.
Do not add Herdr lifecycle commands to this unguarded brief by hand.

# Setup
You are in a disposable git worktree of dotfiles, at a detached HEAD on a clean default branch.

**Verify isolation before anything else.** Run `pwd -P` and `git rev-parse --show-toplevel`; both must resolve to the disposable task worktree you were launched in, such as a treehouse pool path or an Orca-managed worktree, not the primary checkout firstmate operates from.
The path check is authoritative: `git rev-parse --git-dir` and `git rev-parse --git-common-dir` can help inspect the repo, but they do not prove you are outside the primary checkout.
If the top-level path is the primary checkout or not the worktree you were launched in, STOP - do not branch or commit here - append `blocked: launched in primary checkout, not an isolated worktree` to the status file and stop.

1. First action: create your branch: `git checkout -b fm/run-command-nvim-terminal`
2. Run `no-mistakes doctor`; if it reports the repo is not initialized here, run `no-mistakes init`.
