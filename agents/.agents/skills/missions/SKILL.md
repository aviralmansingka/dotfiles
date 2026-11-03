---
name: missions
description: Create, launch, attach, or work on vault-backed missions with the mission CLI and Pi extension. Use for persistent multi-step repository work, structured progress, checks, and human checkpoints. Ordinary untracked edits do not need a mission.
---

# Missions

Use the `mission` CLI as the authority for mission state. Use its `--json` output
for agent work. Never edit state.md, attempt notes, or event projections directly.
The vault stores one mission at `6_missions/<repo>/<mission-slug>/`; mission.md is
the brief, state.md is the committed ledger, and attempts and artifacts preserve
execution evidence. Credentials are private local transport state, outside the vault.

## Create and refine

Register a repository checkout once. Each mission belongs to one repository.

```sh
mission --json repo add dotfiles --checkout /Users/aviral/dotfiles
mission --json new dotfiles/session-progress --kind implementation \
  --title "Preserve session progress" --goal "Recover work after a session restart" \
  --step "Inspect lifecycle hooks" --step "Implement attachment" --step "Verify recovery"
mission --json steps dotfiles/session-progress
mission --json step edit dotfiles/session-progress S02 \
  --instructions "Reuse existing session ownership" \
  --acceptance "Reject a second owner and preserve progress after reload" \
  --checks nonempty-artifact,go-test
```

Step titles alone are sufficient at creation. Defaults include a nonempty output
artifact check. Inspect and customize steps before work starts. `mission checks`
lists actual verifier presets; do not claim a prose acceptance statement is an
automated check. Add human checkpoints at creation with
`--checkpoint "S02:Review the attachment behavior"`. Use `--from` for a full brief.
Do not reset started steps or weaken checks without a user decision.

## Launch or attach in Pi

Discover the deferred `mission` tool through `tool_search`. Humans can use
`/missions` to select a mission, or `/mission start REPO/SLUG`.

- `mission {action:"start", handle:"REPO/SLUG"}` reserves a launch, creates or
  reuses the mission's worktree, and launches the durable mission-worker through
  interactive-subagents in the repository's existing Herdr workspace.
- `mission {action:"attach", handle:"REPO/SLUG"}` adopts the current existing Pi
  session. It must already run at the root of an unowned non-main linked worktree,
  in the repository's primary Herdr workspace. It cannot move a live session's cwd.
- `mission {action:"status", handle:"REPO/SLUG"}` and `action:"steps"` inspect work.
- `mission {action:"next"}` claims the next eligible step in the same session and
  worktree. Resume the owning Pi session rather than opening a second owner.

A started mission-worker receives a continuation prompt after each verified step
when no checkpoint is pending. An attached existing session uses explicit `next`
and does not automatically start more work. At a checkpoint, wait for the user to
accept it and direct continuation.

One repository owns one Herdr workspace. One mission owns one persistent linked
worktree and one durable Pi owner. Attempts belong to steps, not to new worktrees.
Do not remove a worktree after a step. Never bypass a pending launch by spawning
again: a crash may have launched the first session. Inspect its recorded session
file and Herdr pane, then attach that session using the pending launch_id.

## Work and report

Read the assigned brief returned by attachment. Stay within its scope and cwd.
Use the mission tool to report meaningful changes; it sends structured records
through the CLI without exposing credentials to the model:

```json
{"action":"progress","status":"working","summary":"Attachment validates the session header","next":"Test restart recovery"}
```

Use `blocked` or `needs-input` with a `blocker` that identifies the missing
decision. Optional `evidence` paths must be relative to the mission directory,
inside the current attempt, for example `artifacts/001/step-01.md`. The CLI hashes
them. Reuse an event_id when retrying the same report; change it for a new report.
The extension records lifecycle metadata and snapshots the transcript separately.
It does not interpret tool counts, elapsed time, or assistant prose as completion.

Write the required artifact to the exact path returned by attach. Call
`mission {action:"verify"}` to inspect check verdicts and evidence. Call
`mission {action:"finish",summary:"Implemented and verified attachment"}` when
ready. This reports completion. The extension settles the attempt only after a
normal Pi 1.5+ run settles without pending messages, child agents, or external waits, and
the CLI's required checks pass. A failed check keeps the attempt owned; fix it
and report again. `action:"fail"` reports an unsuccessful attempt.

`mission run` remains available for foreground process-managed agents. It owns
completion through observed process exit. Do not use it to wrap an already
running Pi session. For those agents, `mission progress` accepts status, summary,
next, blocker, evidence, and event-id with the wrapper's MISSION_* context.

## Checkpoints, interruption, and recovery

Stop at human checkpoints. Show the user the result and check evidence. Only an
explicit user decision authorizes `mission checkpoint --human --actor ...
--decision accept|revise --revision ...`. The flag records an attestation, not
authentication. Never let an agent silently approve its own work.

On Pi reload, the extension replays unacknowledged hooks with their original IDs
and restores the attempt. A session shutdown preserves its owner and transcript;
resume the same session file. If attach committed before its acknowledgement was
saved, repeat attach from that same session. After a failed terminal attempt,
inspect evidence, use `mission retry`, then explicitly pick up next. Do not edit
the ledger to clear a stuck verifier, launch, or owner. Surface these for recovery.

The local credential/outbox directory must survive a restart. Its loss requires
operator recovery; this version deliberately has no automatic owner takeover.
Follow the repository's normal No Mistakes validation and shipping workflow.
Mission checks do not replace it, and agents must not start nested pipelines.
