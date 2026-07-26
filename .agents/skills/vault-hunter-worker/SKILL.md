---
name: vault-hunter-worker
description: Run and monitor one Vault Hunter Codex worker in an exact one-pane Herdr tab, including the persistent verifier steward, capture its opaque ownership tuple, accept its handoffs, and close only that worker. Use only when the main Vault Hunter skill delegates a worker lifecycle.
---

# Vault Hunter Worker

Own the mechanical lifecycle of one worker. Do not investigate the Task, choose the stage, alter the worker's assignment,
edit the vault, or accept its substantive result for the driver.

## Required input

Refuse to start until the delegating Vault Hunter driver supplies:

- route workspace ID and expected workspace label
- run worktree and expected branch
- run label, feature slug, run key, and role
- exact prompt or prompt-file path
- polling interval and no-progress window chosen for this stage
- whether the worker must remain open for another turn

Never derive or hardcode opaque Herdr IDs.

## Prompt contract

Reject a worker prompt unless it contains:

- one goal and an explicit done/stop condition
- the accepted context handoff as authoritative input
- exact readable paths and editable paths; no broad repository rediscovery
- settled decisions that must not be reopened
- exact required checks, when known
- a bounded handoff template: outcome, changed paths and commit, checks and evidence, risks, blockers
- an instruction to return unresolved questions instead of widening research

The prompt may explicitly permit narrow follow-up reads. Otherwise its path allowlists are closed.

## Start

1. Verify the workspace label, worktree, branch, and current ownership before changing Herdr state.
2. Put the exact prompt in a temporary file outside the repository so shell quoting cannot change it.
3. Use `herdr tab create` with the supplied workspace, cwd, label, `--no-focus`, and
   `SIDEKICK_NAMED_SESSION=<feature-slug>-<run-key>-<role>`. Capture its returned tab and root-pane IDs. Do not split
   beside another pane.
4. Use `herdr pane run` on that root pane to start
   `codex --dangerously-bypass-approvals-and-sandbox <prompt>` with the prompt-file contents.
5. Wait for that pane's agent detection, then use `herdr agent rename` to name it
   `codex-<feature-slug>-<run-key>-<role>`. Failure to detect the agent is a failed launch.
6. Return one JSON object containing the exact workspace, tab, pane, terminal, agent, session, cwd, branch, and
   `pane_count`. Accept the launch only when the tuple matches and `pane_count=1`.
7. Delete the prompt file after confirmed launch. If validation fails, close only the returned malformed tab, verify
   its captured IDs and prompt file are gone, and report failure. Never repair placement by moving or renaming
   unrelated state.

## Monitor

- Record the supplied polling interval, no-progress window, process-health state, and initial transcript marker before
  waiting.
- Inspect native status, `herdr agent get`, and `herdr agent read` for the captured agent only.
- A polling timeout is not a stall. Reset the no-progress window whenever status changes or the transcript grows.
- Report a stall only when the process is dead or unreachable, or when the full no-progress window expires and a
  confirmation check still shows no health or transcript progress.
- Do not send new instructions unless the Vault Hunter driver provides an exact follow-up prompt.

## Handoff and close

1. Return the final handoff and captured tuple to the driver without deciding whether the handoff satisfies the stage.
2. If the driver rejects it as incomplete, send the driver's exact follow-up to the same session and continue.
3. After the driver explicitly accepts it, close the captured tab and verify the captured agent, session, tab, pane,
   and terminal IDs are gone unless this is the registered `verifier-steward` or another worker explicitly marked
   resumable.
4. Keep the `verifier-steward` open and idle across every verifier, repair, rerun, final check, human merge wait, and
   post-merge check. Each follow-up remains one bounded goal supplied verbatim by the driver; never let the steward run
   ahead or reopen settled context. Close it only after the driver accepts post-merge evidence or explicitly abandons
   the Task. A timeout is never grounds to replace or close it.
5. Keep another worker open only when the driver explicitly marks it resumable. In particular, preserve a
   checkpoint-one specification worker across human evaluation.
6. Never close the Task driver tab, Task workspace, Neovim workspace tab, or any unrelated resource.
