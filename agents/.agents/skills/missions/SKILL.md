---
name: missions
description: Create, launch, attach, or work on vault-backed missions with the mission CLI and Pi extension. Groom steps with ask_user_question before creating. Use for persistent multi-step repository work, structured progress, checks, and human checkpoints. Ordinary untracked edits do not need a mission.
---

# Missions

Use the `mission` CLI as the authority for mission state. Use its `--json` output
for agent work. Never edit state.md, attempt notes, or event projections directly.
The vault stores one mission at `6_missions/<repo>/<mission-slug>/`; mission.md is
the brief, state.md is the committed ledger, and attempts and artifacts preserve
execution evidence. Credentials are private local transport state, outside the vault.

## Create and refine

Register a repository checkout once. Each mission belongs to one repository.
Groom the steps with the next section before you create the mission.

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

## Groom the mission first

Never invent the steps alone. Groom the brief with `ask_user_question` before
`mission new`. Each question, option, and description is the text the human
reads: write it at full ASD-STE100. Ask exactly one question per call, put the
recommended option first, and offer three or four concrete options.

Ask only about gaps the human has not answered. When the human already names the
steps, confirm them instead of asking again. Stop when an answer stops changing
the brief.

Cover these six, in this order:

1. **End state.** What is true when this mission ships? Give candidate results,
   not a restatement of the goal.
2. **Shape.** One large step, or three small ones? Name the trade: fewer
   checkpoints against a long blind stretch.
3. **Step acceptance.** For each step, the one fact that proves it done.
4. **Checks.** Show the real presets from `mission checks`. Ask which steps prove
   themselves with a command, and which need only a written artifact.
5. **Checkpoints.** The step, and the decision where the human takes over.
6. **Scope fence.** What this mission must not change.

Then write the answers into a brief and create the mission with
`mission new REPO/SLUG --from brief.md`, or pass `--step` and `--checkpoint`
directly. Print `mission --json steps` and stop. Do not call `start` until the
human accepts the steps: a brief the agent wrote alone is not groomed. Reread
`steps` after any `mission step edit`, before a launch.

## Seat a captain

Start a captain under the login shell (`zsh -l`, or `sh -l`), so `pi`, `rex`,
and `mission` resolve on its `PATH`. A non-login shell has none of them: the
subagent gate fails on `rex`, and lifecycle calls fail with `spawn mission
ENOENT`. Verify a seat with `command -v pi rex mission` in the captain's own
block. A captain moved between multiplexers keeps its transcript but not its
binding, so re-attach after the move; without it every call warns `Restore the
mission's Herdr attachment before continuing`. Full contract:
`docs/pi-missions.md` § Seating a captain.

## Launch or attach in Pi

Discover the deferred `mission` tool through `tool_search`. Humans can use
`/missions` to open the mission desk in a Herdr pane, or
`/mission start REPO/SLUG`.

- `mission {action:"start", handle:"REPO/SLUG"}` prepares the mission worktree
  (`mission workspace`) and hands the launch to the CLI: `mission deploy
  REPO/SLUG --mux rex|herdr`, whichever mux this session runs in. The CLI seats
  the army session, the captain's window and the mission's subagent session, and
  the worker it seats is a full Pi agent, not a subagent: no subagent identity,
  loadout, timer, or watchdog. The tool then reads the runtime back from
  `mission show`; a repeat press reports the live seat instead of a second one.
- `mission {action:"attach", handle:"REPO/SLUG"}` adopts the current existing Pi
  session. It must already run at the root of an unowned non-main linked worktree,
  in a Herdr pane whose cwd is that worktree (the shared `army` workspace holds
  every captain, so the pane's cwd is the binding, not the workspace). It cannot
  move a live session's cwd.
- `mission {action:"status", handle:"REPO/SLUG"}` and `action:"steps"` inspect work.
- `mission {action:"next"}` claims the next eligible step in the same session and
  worktree. Resume the owning Pi session rather than opening a second owner.

Revive a deleted worktree. If the checkout is gone but the `mission/<slug>` branch
remains, `start` recreates the checkout at the recorded path. An existing checkout at
that path is adopted in place when it is already on `mission/<slug>` or holds a
clean detached HEAD at the branch tip; it is never recreated. Never create a
second branch or checkout; a branch checked out elsewhere is reported, not
duplicated.
If an owner session is recorded, resume it. If the step failed, run
`mission retry`, then `next`.

A started worker receives a continuation prompt after each verified step
when no review is pending. A session that attaches and holds the claim runs
autonomously the same way: after each verified step it picks up the next
eligible step without a human message, and stops only at checkpoints, reviews,
`waiting`, and `done`. An attached session that does not own the binding stays
explicit. At a review, wait for the user to decide and direct continuation.

One mission owns one persistent linked worktree and one durable Pi owner in one
seat. In Herdr every mission's captain shares the `army` workspace (one tab per
captain); in Rex the army session holds one captain window per mission. Attempts
belong to steps, not to new worktrees.
Do not remove a worktree after a step. Never bypass a pending launch by launching
again: a crash may have started the first session. Inspect its recorded session
file and Herdr pane, then attach that session using the pending launch_id.
A launch has one owner, the CLI, so a Rex mission and a Herdr mission cannot
diverge: `mission deploy` reserves the intent, seats the captain, verifies that pi
took the seat, retries the submit once, and acks. The seat's label is derived from
the handle, so a second press focuses the live captain instead of seating
another.

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

Add `"actor": "<name>"` to record a trooper report: the attempt then also lists
who reported, so the sitrep can name the agent that finished the work. One
report per trooper stands: a later report from the same name replaces the row,
so a resumed run leaves its final state. The extension already does this for
every subagent it sees finish, so an agent only names itself when it reports for
another.

The step's work subagent writes the required artifact to the exact path returned by
attach; the session that holds the claim sends that write out and never makes it
itself. Call `mission {action:"verify"}` to inspect check verdicts and evidence.
Call `mission {action:"finish",summary:"Implemented and verified attachment"}` when
ready. This reports completion. The extension settles the attempt only after a
normal Pi 1.5+ run settles without pending messages, child agents, or external waits, and
the CLI's required checks pass. A failed check keeps the attempt owned; fix it
and report again. `action:"fail"` reports an unsuccessful attempt.

### Judge the step before finishing

A step's verification belongs to one judge subagent, never to the session that
holds the claim. After the work reports, call `mission {action:"judge"}`. It
returns the judge task plus the artifact path, the acceptance criteria, the check
list, and a one-shot capability path. Spawn one judge subagent with that task
verbatim, in its own session and never the work subagent's session. The judge
reads the artifact, runs the CLI check run itself through `mission verify` with the
capability, and records its verdict with reasons as progress citing the artifact.
`verify` and `finish` follow a recorded pass only; a failed verdict leaves the step
with its owner and names what must change.

### Answer the human

You are the human's one touchpoint while the mission runs. A status prompt is
answered with `mission {action:"status"}`, whose `summary` lines come from the
ledger: what runs, what passed, what is next, and any review or blocker. An admin
prompt is run through an existing command and confirmed from
`mission {action:"steps"}`: `edit` for a step's words, `retry` after a failed step,
`fail` to end an attempt. `edit` always names the revision your answer was built
from, so a concurrent write refuses with `revision_conflict` instead of being
overwritten; re-read and re-apply the human's words. An active attempt or a pending
review blocks `step edit`, so end or retry the attempt first and say that you did.
A checkpoint decision happens only when the human gives it.

`mission run` remains available for foreground process-managed agents. It owns
completion through observed process exit. Do not use it to wrap an already
running Pi session. For those agents, `mission progress` accepts status, summary,
next, blocker, evidence, and event-id with the wrapper's MISSION_* context.

## Test pi changes from a worktree

A live Pi session loads the main checkout, not the worktree. Unmerged edits to
`pi/.pi/agent/**` do nothing there. A worker that changes those paths must run
Pi on the worktree's own config directory instead:

- Interactive: `scripts/pi-dev <worktree>` starts Pi with that worktree's
  extensions, settings, and theme. Type `/reload` in it after a further edit.
- Scripted evidence: `scripts/pi-dev <worktree> -p "<prompt>"` is a one-shot
  probe with those extensions loaded. `scripts/pi-dev <worktree> --print` gives
  the exact command, for your own probe wrappers.

The script sets `PI_CODING_AGENT_DIR` and links `~/.pi/agent/auth.json` into
the worktree config. It keeps that link out of `git status`. No other session
changes its config, and the main checkout stays untouched.

## Reviews, interruption, and recovery

Stop at human reviews. Show the user the result and check evidence. Only an
explicit user decision authorizes `mission checkpoint accept|revise REPO/SLUG
[C01] --note TEXT`. `--actor` defaults to git user.name, and no revision is
needed. The command records an attestation, not authentication. Never let an
agent silently approve its own work.

A waiting review never blocks your tools. It blocks the next step, `step edit`,
and `finish`. Use the tools to investigate or fix your own result. `finish` fails
with the review id and the exact command the user runs.

On Pi reload, the extension replays unacknowledged hooks with their original IDs
and restores the attempt. A session shutdown preserves its owner and transcript;
resume the same session file. If attach committed before its acknowledgement was
saved, repeat attach from that same session. After a failed terminal attempt,
inspect evidence, use `mission retry`, then explicitly pick up next. Do not edit
the ledger to clear a stuck verifier, launch, or owner. Surface these for recovery.

The local credential/outbox directory must survive a restart. Its loss requires
operator recovery; this version deliberately has no automatic owner takeover.
Follow the repository's normal CI validation and shipping workflow.
Mission checks do not replace it, and agents must not start nested pipelines.

## Retire the mission

A finished mission stays in the vault as a record. Close it when its work ships,
so the record stops offering work.

```sh
mission --json close dotfiles/session-progress --note "Shipped in #430"
```

`close` sets `status: closed`, `closed_at`, and the note. It refuses open work:
an active attempt, or a step that is not `passed`. Add `--force` to close anyway.
A second close is safe and returns `already: true`. A closed mission refuses
`claim`, `pickup`, `launch`, `plan`, `workspace`, `attach`, `next`, `finish`,
`retry`, and `repair`. Start a new mission instead.
