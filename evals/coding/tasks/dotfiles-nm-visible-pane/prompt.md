# Task
Make no-mistakes run in a visible Herdr pane next to the agent pane when it is invoked, instead of the agent running the `no-mistakes` CLI as an opaque in-process command. The captain wants to see the no-mistakes run happening live in the pane beside theirs.

Captain's request:
- When no-mistakes is invoked, open it in a Herdr pane next to where the agent is running, similar to how the `nvim-open` extension opens Neovim next to the agent.
- The no-mistakes command should run in the background inside that pane so it is visible and live, not hidden inside the agent's own bash output.
- The agent should automatically use this visible-pane path instead of invoking no-mistakes the way it does today (a raw command in its own bash tool).
- A Pi extension is the suggested mechanism, but the worker may choose another approach if it is simpler and still meets the requirement.

Scope:
- Target repo: `<repo>`.
- Likely files: `pi/.pi/agent/extensions/nvim-open.ts` (the pattern to mirror for opening a Herdr pane), `pi/.pi/agent/extensions/run-command.ts` and `run-command/nvim-terminal.ts` (recent work on opening a Neovim terminal pane and capturing output), and any existing no-mistakes-related extension or hook.
- Read the no-mistakes skill at `/Users/aviral/.agents/skills/no-mistakes/SKILL.md` to understand how the agent currently invokes no-mistakes (`no-mistakes axi run`, `no-mistakes axi respond`, `no-mistakes axi status`).
- The visible pane should run the no-mistakes command the agent would otherwise run inline, so the captain sees the same pipeline output live. The agent still needs the structured result back (findings, awaiting state) to continue driving the gate.

Before coding:
- Read `AGENTS.md` in the dotfiles worktree.
- Read `nvim-open.ts` end to end to learn the Herdr pane-open pattern this repo already uses.
- Read `run-command/nvim-terminal.ts` for the recent capture-from-a-visible-terminal pattern.
- Read the no-mistakes skill and `no-mistakes axi --help` to understand the command surface the agent drives.
- Read Pi extension/TUI docs if needed:
  - `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
  - `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/tui.md`
- Use Ponytail: reuse the existing pane-open and capture machinery; do not build a new control plane.

Acceptance criteria:
1. When the agent invokes no-mistakes (start run, respond to a gate, or check status), the no-mistakes command opens in a Herdr pane next to the agent pane and runs visibly in the background.
2. The agent still receives the structured result it needs to continue driving the gate (findings, awaiting/sync state, next action). If a command only produces a TUI the agent cannot parse, fall back to a mode that still returns structured data.
3. The pane is clearly a no-mistakes run pane (labeled or titled so the captain can tell what it is).
4. Long-running or stuck no-mistakes runs have a visible, cancellable path; do not create an unkillable pane.
5. Existing no-mistakes behavior (ask-user escalation, gate responses, CI monitoring) keeps working end to end.
6. Add or update the smallest useful automated test for the new path or its extracted testable unit.
7. Commit on branch `fm/nm-herdr-pane`, then run the no-mistakes path and open a PR.

Implementation guidance:
- Prefer reusing `nvim-open.ts` pane-split + Herdr command machinery over duplicating it.
- If the cleanest design is a new Pi extension that registers a tool the agent calls instead of raw `no-mistakes`, do that, but keep the agent's existing no-mistakes skill invocation semantics intact.
- Do not modify live global Pi extension files, the captain's `~/.pi` config, or the no-mistakes daemon. Do not push or merge manually.

# Herdr lifecycle declaration - NOT ENABLED
**HARD SAFETY GATE:** this scaffold cannot inspect the task text filled in above.
If the task will start, stop, delete, restart, profile, or otherwise drive Herdr lifecycle behavior, stop and regenerate the brief with `--herdr-lab` before dispatch.
Do not add Herdr lifecycle commands to this unguarded brief by hand.

# Setup
You are in a disposable git worktree of dotfiles, at a detached HEAD on a clean default branch.

**Verify isolation before anything else.** Run `pwd -P` and `git rev-parse --show-toplevel`; both must resolve to the disposable task worktree you were launched in, such as a treehouse pool path or an Orca-managed worktree, not the primary checkout firstmate operates from.
The path check is authoritative: `git rev-parse --git-dir` and `git rev-parse --git-common-dir` can help inspect the repo, but they do not prove you are outside the primary checkout.
If the top-level path is the primary checkout or not the worktree you were launched in, STOP - do not branch or commit here - append `blocked: launched in primary checkout, not an isolated worktree` to the status file and stop.

1. First action: create your branch: `git checkout -b fm/nm-herdr-pane`
2. Run `no-mistakes doctor`; if it reports the repo is not initialized here, run `no-mistakes init`.
