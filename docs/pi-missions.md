# Pi missions

The mission CLI owns vault state. The Pi extension connects a session to an
attempt, records lifecycle facts, and sends structured progress through the CLI.
Herdr owns sessions, panes, and attachment. The missions skill teaches the agent
how to use these interfaces. No dispatcher or replacement session registry is added.

Use Pi 1.5 or later. Completion uses its `agent_before_settle` and `agent_settled`
events. `agent_end` records activity only, because retries and continuations can
still follow it.

## Use this checkout

Build and preview without changing the main checkout or global Pi configuration:

```sh
(cd go/mission && go build -o bin/mission ./cmd/mission)
./scripts/pi-missions
```

Run the preview in a Herdr pane. It uses this checkout's Pi configuration, extension,
and skill. Keep this checkout while its sessions
are in use. Set `MISSION_VAULT` to a scratch vault for a pilot.

The launcher keeps mutable Pi files in a private directory under
`~/.local/state/pi-missions-preview/<checkout-key>` (or `MISSION_PREVIEW_DIR`).
Its extension/theme links point into this checkout. Session files and authentication
stay outside Git. Use an environment API key or `/login` once in that private
configuration; the launcher does not copy your normal Pi credentials.

After adopting the changes into the normal dotfiles checkout, run
`./scripts/install-missions`. Existing `pi` and `agents` stow packages expose the
extension and skill; reload Pi to discover them. The binary must be on PATH or
configured with `MISSION_BIN`. No real mission is created by installation.

```sh
mission --json repo add dotfiles --checkout /Users/aviral/dotfiles
mission --json new dotfiles/session-progress --kind implementation \
  --title "Preserve session progress" --goal "Recover work after reload" \
  --step "Inspect hooks" --step "Implement attachment" --step "Verify recovery" \
  --checkpoint "S02:Review attachment behavior"
```

In Pi, `/missions` opens the mission desk in a Herdr pane. `/mission start REPO/SLUG` launches
its owner. Agents use the deferred `mission` tool via `tool_search`. Its actions
are `list`, `create`, `steps`, `edit`, `status`, `start`, `attach`, `next`, `progress`,
`verify`, `judge`, `finish`, `fail`, and `retry`. Tool results never include claim
credentials.

## Workspace and ownership

A repository keeps its existing primary Herdr workspace. A mission checkout is
its own worktree, and `mission workspace` is the only thing that creates or
revives it. Seating is a separate step with one owner, the CLI: `start` hands the
launch to `mission deploy --mux <rex|herdr>` (see `Deploy a mission`), and the
Herdr adapter seats the captain's tab in the shared `army` workspace with the
mission worktree as its cwd. The extension registers no worktree and opens no
tab, so a Rex mission and a Herdr mission take the same path.

Each mission gets `~/.herdr/worktrees/<repo>/mission-<slug>` on
`mission/<slug>`, initially from local `main`. The CLI creates the checkout and
checks the branch name with `git check-ref-format --branch`; the base commit is
recorded.
An existing checkout at that path is adopted rather than recreated: one already
on `mission/<slug>`, or holding a clean detached HEAD at the branch tip (carried
onto the branch in place), becomes the mission's worktree, and a missing
ownership marker is then written. A checkout on another branch is reported as
`worktree_mismatch`, a detached HEAD with uncommitted work as `worktree_dirty`,
and neither is ever switched over local changes. A non-empty path that is not a
checkout is reported as `worktree_invalid` and never deleted. An existing branch
with no marker and no checkout at the path is reported as `unowned_branch`; a
branch checked out in another worktree as `worktree_in_use`.
The same path and branch remain bound across steps, retries, and revisions.
If the checkout is deleted but the `mission/<slug>` branch remains, `start`
recreates the checkout at the recorded path. It never creates a second branch or
checkout. A branch checked out elsewhere is reported, not duplicated.
A closed mission is refused instead: `/cleanup` closes the record when it removes
the checkout, so a retired mission never revives it. Start a new mission for new
work.
Ownership is single-host and exclusive across missions in that vault. Unrelated
vaults do not share a lock or ownership index.

For an already running Pi session, use `/mission attach REPO/SLUG` from the root
of its non-main linked worktree, in a Herdr pane whose cwd is that worktree (the
shared `army` workspace holds every captain, so the pane's cwd is the binding, not
the workspace shape) or in a Rex block there. The CLI
checks the Pi session header, repository identity, cwd, durable owner, and active
attempt. It adopts that worktree without copying code or moving the session.
Attachment to main, a second mission in the same worktree, or a different owning
session is refused. Herdr remains responsible for preventing duplicate live
attachments to the same Pi session file.

`start` first prepares the mission worktree (`mission workspace`), then asks the
CLI to seat the mission: `mission deploy REPO/SLUG --mux rex|herdr`, where the mux
is the one this session runs in (`herdr` when the session carries a Herdr pane,
`rex` when it carries a Rex block). The CLI reserves the launch intent, seats the
army session, the captain's window and the mission's subagent session, acks the
launch, and reports the deployment. `start` then reads the runtime back from
`mission show`: the record, not the launch, is the authority on where the captain
runs. A repeat press finds the captain already seated and focuses it; `start`
reports `launched: false` and the desk receipt says the seat is live.

The extension owns no mux command for a launch. It has no Herdr worktree, tab,
agent, or prompt call: `herdr worktree open`, `tab create`, `agent start`,
`agent wait`, `agent prompt`, and `agent get` are gone from the launch path, so
the seat's behaviour is the CLI's for both muxes and cannot drift between them.

A launch receipt stores its session
file. Repeating start returns the recorded runtime instead of launching again.
An uncertain launch remains reserved for inspection; it is never timed out into a
second writer automatically. Runtime session identity remains bound after an
attempt completes. Use `next` explicitly to claim the next eligible step.

A launched driver receives a continuation prompt after a successful
step when the mission is ready for more work. It keeps the same session and
worktree. Existing sessions attached for progress tracking use explicit `next`.
Both modes pause at checkpoints; accepting one does not silently start another run.
A waiting review blocks the next step and `finish` only. The driver keeps every tool.

## Driver role

The launched agent is the **driver**. It holds the claim on one work request and
performs no step work itself. Its launch prompt names three duties and one
touchpoint.

> **Rank vocabulary.** The rank this mission deploys for that seat is the
> **captain**, and the launch prompt has one owner: `mission plan` renders it as
> `captain_brief` (`captainBrief` in `go/mission/cmd/mission/plan.go`), together
> with `captain_argv` and the `subagent_session` its troopers work in. `mission
> deploy` writes that text into the seat as the exec line's last argument, so the
> plan is the only description of the rank: the extension holds no second copy
> and no fallback contract. The sections below that speak of the captain (`The
> launch description`, `Deploy a mission`) are the rank vocabulary for this seat.

1. **Hold the claim.** The driver session owns the attempt and keeps the `mission`
   tool. It reports structured progress and calls `verify` and `finish` only after
   a judge records a pass.
2. **Send the step work out.** The driver never edits repository code and never
   writes a step artifact. For each step it spawns one work subagent
   (`agent=worker`) with the step brief, the artifact path, and the acceptance
   criteria, then waits for the result.
3. **Send the verification out.** After the work subagent reports, the driver
   spawns one judge subagent, independent of that work subagent. The judge
   receives the artifact path, the acceptance criteria, and the check list; it
   reads the artifact, runs the checks itself through `mission verify`, and records
   its verdict with reasons as progress. The flow is below.

The touchpoint is the driver session itself. The human asks it for status and for
admin changes there, in plain prompts; both kinds are described next. No new CLI
command exists for either. The driver keeps the mission worktree as its cwd, stops
at human checkpoints, and never approves one itself.

## Status and admin prompts

The human steers a mission by talking to its driver. Two prompt kinds cover the
work, and both use commands that already exist.

**Status.** The driver calls `mission action="status"`. The extension reads the
record with the CLI's `show` and derives a plain-language answer from the same
ledger (`driverStatus` in `missions/core.mjs`):

```
Mission dotfiles/driver-holds-the-claim is running.
Running step S02 (Route every verification through a judge subagent) under attempt attempt-98…; last report: Judge flow landed.
Passed: S01 (Write the driver contract and launch instructions).
Next: S03 (Make the driver the status and admin touchpoint).
```

A pending review adds `Review C01 waits after S04: …`, and the last blocked report
adds `Blocker: …`. Every line comes from `execution`, `status`, `current_step`,
`active_attempt`, `steps`, `pending_checkpoint`, and `progress` fields, so the
spoken answer cannot drift from the ledger. `mission progress` adds detail when the
human wants the history rather than the state.

**Admin.** When the human asks for a change, the driver runs it through an existing
command and confirms the outcome from `mission action="steps"`:

- `mission action="edit"` (`step edit`) for instructions, acceptance criteria,
  output name, agent, or checks,
- `mission action="retry"` (`retry`) to put a failed step back to pending,
- `mission action="fail"` to end the active attempt as failed,
- a checkpoint decision only when the human gives it.

Steering never overwrites a concurrent write. `action="edit"` always names the
revision the answer was built from (`--revision`, taken from the `status` read). If
the ledger moved in between, the CLI refuses with `revision_conflict` and the step
keeps its text; the driver re-reads, re-applies the human's words, and says so. The
`#426` guard therefore stays load-bearing for mid-flight changes. Two CLI rules also
shape the answer: `step edit` needs no active attempt (`busy`) and no pending review
(`review_pending`), so the driver ends or retries the running attempt first and
tells the human that it did. `reset` stays CLI-only, because it invalidates later
progress and needs an explicit human decision.

## Ask the commander

A captain pane has no watcher, so a blocked captain writes a durable question
instead of painting an `ask_user_question` menu:

```sh
mission ask dotfiles/x --text "Which branch name should the migration use?" \
  --step S02 --attempt attempt-1 --kind decision
mission ask --list dotfiles/x            # pending and delivered asks
```

The CLI writes `6_missions/dotfiles/x/asks/<UTC-stamp>-<ask-id>.json` with
`{id, handle, step, attempt, kind, text, at}` and prints the id and the path. It
needs no token and no lock, so a captain that holds no claim can still ask. Kinds
are `blocked` (the default), `question`, and `decision`. Empty text is refused
with `usage`, an unknown handle with `not_found`, and a closed record with
`closed_mission` plus the new-mission hint.

The receiving half runs in the commander's own Pi session. At a session start the
missions extension asks the Rex API whether its block sits in the window labeled
`commander` of its own Rex session, caches the answer, and re-checks it about once
a minute; nothing outside the ask drain depends on it. While that answer is yes,
the session polls every mission's asks about every five seconds and, only while
it is idle and has no pending message, delivers each undelivered ask as one
follow-up message. Consecutive asks from one handle arrive batched, at most five
asks per drain, oldest first. Each line names the mission, the step, and the
kind — `[mission dotfiles/x · S02 · decision] …` — and a decision ask carries the
command that answers it:

```
mission checkpoint accept|revise dotfiles/x C01 --note "…"
```

Delivery writes `delivered_at` and `delivered_to` into the ask's own file, so a
commander restart cannot deliver it twice. With no commander session — extension
unloaded, not the commander, or the commander away — nothing drains and nothing
is lost: the asks stay on disk until that session returns.

`ask_user_question` is not in the captain loadout, so a captain cannot paint a
menu nobody watches. The commander keeps it.

## The launch description

`mission plan REPO/SLUG [--mux rex]` is the read-only launch description. It
returns the rank vocabulary (session `army`, windows `commander` and
`captain-<slug>`, subagent session `mission-<slug>`), the captain argv and the
captain brief text, the mission worktree and branch, and an ack token. The plan
owns those names; no adapter spells them itself. `--mux` is accepted so a caller
can say which surface it deploys to, and the description never depends on it.

The ack token is derived from the vault, the handle, and the branch, not reserved,
so the same mission answers with the same JSON twice. `mission launch --ack`
records it, and it never becomes the launch intent: the token says the seats
exist, while the intent is a reservation a captain consumes. `plan` writes
nothing: it creates no worktree, claims no attempt, and records no launch. A
mission with no worktree answers `worktree_required`; a recorded checkout that is
gone, `worktree_missing`; a closed mission, `closed`.

Mission slugs are unbounded, so a seat label is derived, not copied: the rank
prefix plus the slug, cut to 32 characters with a short digest of the whole slug
when it does not fit. Plan and deploy read that one label, so the same mission
always gets the same name and two long slugs never share one.

The launch prompt text lives in the CLI, not in the Pi extension. `mission
deploy` reserves the intent, renders the brief for it, and seats it in one call,
so one place owns the wording and the id a captain reads is the id the record
holds. `mission plan` stays the read-only description for a caller that only
wants to look.

## Deploy a mission

`mission deploy REPO/SLUG --mux rex|herdr` turns one plan into seats. Deploy owns
the decisions and the adapters own the mux vocabulary: a small `seat` interface in
`go/mission/cmd/mission/seat.go` asks for the sessions, the captain window, focus,
clear, and the captain's placement, and `rexSeat` and `herdrSeat` implement it. An
unknown `--mux` is refused with `mux_unsupported` before deploy reads anything.

Deploy reads the plan, then reserves the launch intent (a `launch-<uid>` id), then
creates only what is missing: the `army` session with its `commander` window, the
mission's `mission-<slug>` session, and its `captain-<slug>` window in army. The
captain window runs the plan's argv and a brief rendered from that reserved
intent, so the captain attaches with the id the record holds. The ack lands last,
with the plan's derived token beside the reserved intent.

Both adapters seat the captain the same way, because the seat is the plan's and
not the mux's: a login shell reads the plan's `exec env …` line, and deploy then
verifies that pi took the foreground. What differs is only how the line reaches
the shell and what seat identity it carries.

A Rex window takes the captain as its own command, so that seat is one phase:
`session.new_window` is asked for a window whose command is
`$SHELL -l -c <exec line>`, and Rex runs it. There is no prompt, no readiness
wait, no write, and no submit — zsh reads the line as its `-c` argument, and
`exec` replaces it with pi, so the block's foreground is pi from the start. The
line starts the plan's absolute pi with `REX_SESSION=army`,
`PI_SUBAGENT_SESSION=<mission-<slug>>`, and `PI_SUBAGENT_CWD=<worktree>`; the
brief arrives as pi's first message. It does not name `REX_BLOCK`: Rex sets that
in the environment of the program it starts in a block, so the captain already
reads its own block, and a window command cannot carry an id that does not exist
until the window has been created.

This replaced a typed line, and the reason is measured. Deploy used to open a
window on `zsh -l`, poll the block's `pwd` method for readiness, then type the
exec line and send the newline as its own write. But Rex answers `pwd` with an
empty object about 0.02 s after the window exists, before the shell has a working
cwd, so the gate passed instantly and the line was typed into a still-starting
`zsh -l`: written in that window it was dropped or truncated, the shell ended up
inside an open quote, and the mission stayed `ready` with no attempt. Four
deploys failed that way. A window command cannot race a prompt.

The verification stays, because Rex accepting the window says only that the
window exists, not that pi came up in it. Deploy polls the block's `process`
until it reports pi (the foreground, or an ancestor under the login shell), and
retries that bounded wait once; then it fails with the block, the window, and the
foreground it saw. The retry repeats the check, not a submit, because a window
command cannot be re-sent. It never opens a second window, because the label
would name two.

### Seating a captain

The captain's window runs the human's login shell, `$SHELL -l` (`/bin/sh -l`
when `$SHELL` is unset, or is not a runnable absolute path), with the exec line
as its `-c` argument on Rex. The shell reads the account's profile before `exec`
replaces it with pi. The captain's environment is then the human's environment:
`PATH` comes from the login profile, not from the multiplexer and not from a list
the seat carries.

That parity is the point of the shape. A captain seated from the multiplexer's
minimal `PATH` lost `mission` (`spawn mission ENOENT`, so mission tracking was
unavailable), lost `rex` (the subagent gate stayed closed, so it could deploy no
trooper at all), and `mission deploy` answered `executable "pi" not found in
PATH`. Sourcing the profile instead of listing directories keeps the captain's
environment identical to the human's on every machine.

pi is still named by absolute path (`captainPi`), so the seat never relies on a
profile to find it; the login shell supplies everything else.

A repeated deploy focuses the live captain window and creates nothing, so one key
press cannot seat two captains. Liveness is the seat's own foreground process in
both muxes, so a captain that has just arrived is never mistaken for a dead one.
A resumable deployment keeps its intent: a failure part way leaves the record
unacknowledged, and the next press reserves nothing new and finishes the same
deployment.

### Seating in Herdr

Herdr's units are not Rex's, so the adapter maps the plan onto them rather than
inventing names:

| Plan | Rex | Herdr |
| --- | --- | --- |
| army session `army` | a Rex session | a workspace labeled `army`, found by label and created once |
| commander window `commander` | the army session's first window | the army workspace's root tab, renamed |
| captain window `captain-<slug>` | a window in army | a tab in the army workspace, cwd the mission worktree |
| subagent session `mission-<slug>` | a Rex session troopers open windows in | the seat's `PI_SUBAGENT_SESSION`: Herdr has no session object, and troopers are tabs beside their captain |

Seating is two phases here, unlike Rex. `tab create` opens a tab on the human's
login shell and names its pane; deploy polls `pane process-info` until that pane
reports a foreground process, writes the exec line with `pane send-text`,
submits it with `pane send-keys enter`, and polls the foreground until it is pi.
If the shell is still the foreground it re-sends the Enter once, then fails with
the pane, the tab, and what the foreground still reports. A Herdr tab has no
window command of its own, so the tab can be brought up while its shell is still
starting, and the readiness poll is what keeps a write from landing in a shell
that does not yet read its terminal.

The Herdr exec line carries no seat identity: Herdr sets `HERDR_PANE_ID` and
`HERDR_WORKSPACE_ID` on the pane itself, so the captain reads its own seat from
its environment. The Rex line names `REX_SESSION=army`, the session's label,
because mission identities are labels; `REX_BLOCK` is Rex's own answer in the
block's environment. Everything else is the one `seatExecLine`:
`PI_SUBAGENT_SESSION`, `PI_SUBAGENT_CWD`, the plan's absolute pi, its `--tools`
allowlist, and the brief last.

Herdr reports the Pi session file for the agent it detects in the tab. Deploy
records it on the reserved intent when Herdr answers with one, so a later launch
or attach adopts that session instead of starting another; the captain records
the same file itself when it attaches.

`prefix+n` (`mission_deploy_pick`) opens the deployment picker: a floating layer
listing `mission ready`, previewed with `mission show`. Enter deploys the chosen
mission; Escape exits 0 and changes neither the vault nor Rex.

### Seating a captain

A captain must start under the login shell. Its `PATH` then matches the human's,
and the three binaries every captain needs resolve:

| Binary | Why the captain needs it |
| --- | --- |
| `pi` | the seat is a pi process; deploy starts it by absolute path |
| `rex` | the subagent gate checks it, so children can be spawned at all |
| `mission` | every lifecycle call: attach, claim, progress, verify, finish |

A non-login shell such as `/bin/sh -s` sees only the multiplexer's `PATH`, which
holds none of the three. Seat through a login shell (`zsh -l`, or `sh -l`) and
start pi by absolute path, so the environment is the human's and the binary is
found even when the login profile is not read.

Check that a captain can actually start before you trust the seat. Three
commands, run in the captain's own block:

```sh
command -v pi rex mission          # all three must print a path
mission --json show dotfiles/<slug> | jq -r '.data.state.active_attempt'
rex capture -s mission-<slug> -b <block> --trim --unwrap | tail -5
```

A bound attempt and a live pane mean the seat works. The failure signatures name
the missing half, so read them literally:

| Message | What is missing |
| --- | --- |
| `spawn mission ENOENT` | `~/.local/bin` is not on the captain's `PATH` |
| `Subagents require a terminal multiplexer` | `rex` is not on its `PATH`, or `REX_SESSION`/`REX_BLOCK` are unset |
| `executable "pi" not found in PATH` | deploy passed a bare `pi` instead of an absolute path |
| `Restore the mission's Herdr attachment before continuing` | the record still points at the old seat; re-attach |

### Move a captain to another seat

A seat is bound to a session id, and the extension checks that binding on every
lifecycle call (`surfaceSession` in `core.mjs`). Moving a captain between Herdr
and Rex therefore keeps the conversation but loses the binding, and the next
lifecycle call refuses with `Restore the mission's Herdr attachment before
continuing`.

Move it in three steps:

1. Stop the old process, so only one writer owns the session file.
2. Resume that session file in the new block, with `REX_SESSION`, `REX_BLOCK`,
   and `PI_SUBAGENT_CWD` set, under the login shell.
3. Re-attach in the new seat: `mission attach REPO/SLUG --session-id … --cwd …
   --workspace "$REX_SESSION" --pane "$REX_BLOCK" --agent mission-captain`.

Step 3 is not optional. Without it the transcript survives and the mission does
not: every lifecycle call fails, and the captain reports warnings instead of
work. The attempt it held stays attached to the session id, so a re-attach lands
in the same attempt rather than opening a second one.

## Mission desk

`mission ui` opens a full-width Inbox. It puts decisions, blocked work, and PRs
ready for review ahead of background work. Press `1`, `2`, or `3` to switch
between Inbox, Table, and Repos. Use `/` to search, `[` / `]` to filter, and
`v` for a side preview on wide terminals. When there is active work, the
default Inbox summarizes queued and historical missions. Table shows them all.

Press `Enter` to open the selected mission, step, or tool call. `Esc` returns to
the previous view with its selection. In a mission, `[` / `]` switch detail
tabs. In a step, `f` follows the latest call. Opening a call holds the selection
while the feed updates. Scroll its text with `j` / `k` or Page Up / Page Down.

The checkpoint and known PR and CI status stay visible while inspecting a call.
The desk reads GitHub through an authenticated `gh` and distinguishes a missing
PR from an unavailable lookup. A draft or a completed implementation with a
confirmed missing PR still needs a handoff. The Step Evidence card shows the
latest recorded direct check results for that step's attempt. The Inbox shows
a PR as ready for review after the mission's steps are done and reported CI
checks pass.
The step feed reads saved Pi calls and results, including registered subagent
sessions it can still access. When a transcript is unavailable, the feed uses
the recorded lifecycle metadata. To capture a frame, use
`mission render --view step --handle REPO/SLUG --id S01 --color`.

## Launch from the desk

`mission ui` is a Go TUI. Press `L` on the selected mission to ask for a launch.
The desk writes one request file at
`${MISSION_STATE_DIR:-${XDG_STATE_HOME:-~/.local/state}/pi-missions}/launches/<repo>--<slug>.json`,
with `state: pending`, `handle`, `repo`, and its owner seat.

The desk has no launch path of its own. A Pi session in that repository claims the
request and calls the same `start` action the `mission` tool uses, so the worktree,
the launch reservation, and the captain's seat come from one code path: the
action hands the launch to `mission deploy --mux rex|herdr`, and the CLI seats it.

Each request carries the seat that asked: `owner_workspace` (`HERDR_WORKSPACE_ID`),
`owner_label` (`HERDR_PANE_ID`), and `owner_common` (the absolute git common dir).
The sweep picks one request per tick, in this order:

1. A request addressed to this session's workspace. A captain that already owns a
   mission still serves it, because its seat is a tab of that workspace.
2. An unaddressed request, from a desk that ran outside Herdr. Any idle session of
   the repository may claim it.
3. A request whose addressed workspace is gone. Only a session in the same checkout
   family adopts it, so a sibling clone never starts another checkout's mission.

A request addressed to a live workspace elsewhere waits for that workspace. A
request from another repository is left for that repository's session, and a driver
never launches.

The session sweeps every two seconds while it is idle, and again after each turn
settles.

The claim is the file: a second reader finds `claimed` and stops, so one press
cannot start two drivers. A second press on the desk finds a live request and
rewrites nothing; the desk shows "Launch already pending" instead. The session
writes `state: started` with the launch id and the Herdr agent it created
(`workspace`, `pane`, `session_file`), or `state: failed` with the error, and the
desk shows either on its next two-second refresh. A started request reads
`launch started · Herdr agent in <workspace>`. A failed request can be pressed for
again.

## Progress and completion

Structured reports include status (`working`, `blocked`, `needs-input`, `ready`),
summary, next action, blocker, and optional evidence paths. The CLI captures hashes
and deduplicates stable event IDs, refusing changed payloads for an existing ID.
A progress call that names `--actor` (or `actor` in the mission tool) also appends
the trooper's report to the attempt: who reported, the state reached, the summary,
the next action, and the time. An attempt keeps one row per trooper, so a subagent
that finishes `blocked`, is resumed, and finishes `ready` leaves the final state
rather than the one it left behind; both completions stay in the append-only
progress stream. The extension sends one report per finished interactive subagent
through the same outbox as its lifecycle hooks, so a reload replays the report
under its original ID instead of appending a second copy, and a judge step records
the judge rather than the worker that spawned it. A report whose trooper name
starts with `judge` also carries that subagent's `--session-id`/`--session-file`,
because the CLI refuses a judge progress that names no session; a judge report
that has no session id can never be delivered, so it is never queued and one
warning names the trooper instead.
Evidence belongs to the current attempt. Lifecycle hooks record only event metadata,
tool names/call IDs, session identity, and transcript snapshots. They omit tool
arguments and outputs. Transcripts themselves can contain sensitive conversation
content; they are intentionally preserved in the mission vault.

### Reading the troopers

The mission desk shows reports in two places. The mission's second tab
(` Troopers `, between Overview and Attempts) renders one row per report of the
attempt being watched: the active attempt while it carries reports, otherwise the
newest attempt that does, so a finished attempt's rows outlive its active slot.
Each row is a state glyph, the trooper's name, its age, and its summary. `✓` green
means ready, `◉` aqua means still working, and `◆` yellow means blocked or waiting
on input.

The newest of those rows also surfaces as a line in the mission header, so
the ground is readable without leaving the Overview tab: `TROOPER`, the same state
glyph, the name, the age, and the summary. The header updates on the desk's
two-second refresh tick — a trooper that finishes while the human watches changes
the header without a key press. The row is clipped to the pane width: on a narrow
pane the summary yields first, then the age, then the name. A mission with no
reports keeps the header quiet: no placeholder line, no empty brackets.

The CLI holds one active attempt per mission. `finish`/`fail` report an outcome.
An attached Pi session retains ownership until a normal run settles with no queued
messages, registered child agents, or registered external waits. The adapter then
calls `settle`. Required checks must pass before success; evidence changes invalidate
their proof. Settlement records a Pi turn boundary, never a fictitious process exit.
Unregistered detached jobs are outside this contract and must not be used as writers.

Human reviews pause progression after their step. The user reviews the result
and check evidence before an explicit accept or revise decision. A waiting review
never blocks driver tools: it blocks the next step, `step edit`, and `finish`.
Neither the extension nor skill approves reviews. Mission checks complement the
existing CI workflows and do not start nested validation runs.

## Judge flow

Every verification runs through a judge subagent, never through the driver. After
the work subagent reports, the driver calls `mission action="judge"`. That call
returns the judge task plus the artifact path, the step's acceptance criteria, the
check list, and one capability path. The driver spawns one judge subagent with the
returned task verbatim, in its own session and never the work subagent's session.

The capability is how the judge reaches the CLI without borrowing the driver's
session. `action="judge"` writes the attempt token to
`$MISSION_STATE_DIR/judges/<session-key>/<attempt>.token` (mode 0600, directory
0700) and returns only that path. The task carries the path, so the token itself
enters no prompt, no tool result, and no child environment; the judge's own shell
expands the file into `--token`. Same-user processes are already inside this trust
boundary. The file is one-shot: the driver's `verify`, `finish`, or `fail` deletes
it, and a session start clears any leftover from a crash.

The judge then:

1. reads the artifact in full and judges it against the acceptance criteria,
2. runs the CLI check run itself with `mission verify`, using the capability,
3. reads that run's check verdicts, summaries, and evidence paths, and
4. records its verdict with reasons as one progress entry, citing the artifact:

```sh
mission --json --vault "$VAULT" progress REPO/SLUG --attempt ATTEMPT \
  --token "$(cat CAPABILITY)" --event-id judge-ATTEMPT \
  --status ready --summary "verdict: pass — <reasons>" \
  --evidence artifacts/NNN/step-NN.md
```

A failed verdict records `--status blocked --blocker "<what must change>"`
instead. The judge edits no file, writes no step artifact, and never calls
`finish`. The driver calls `verify` and `finish` only after a judge records a pass.

The record keeps its shape. The check run fills `verifications[]` with its
`results`, verdicts, and evidence; the verdict with reasons is one `progress`
entry of the same attempt. No `state.md` field, vault directory, or CLI command
changes for this flow.

## Reload and recovery

Credentials and unacknowledged lifecycle events live in
`$MISSION_STATE_DIR` or `$XDG_STATE_HOME/pi-missions` (default
`~/.local/state/pi-missions`). Files are mode 0600, keyed by vault and session ID.
Credentials are persisted before claiming, never placed in a prompt, tool result,
or child environment. Hooks queue locally before delivery and retry with the same IDs.
Repeated deliveries cannot create duplicate events. A record that cannot be read
blocks editing tools and degrades read and bash-class tools to a warning, so a
driver can investigate its own tracking. Inactive steps block editing tools.

Shutdown snapshots the transcript and parks the attempt without releasing its
owner. Resume the same Pi session file in the mission worktree, in a seat of the
same kind you left it in: a Rex block with `REX_SESSION` and `REX_BLOCK`, or a
Herdr pane whose cwd is the mission worktree. Export the original `MISSION_VAULT`,
`MISSION_BIN`, and `MISSION_STATE_DIR` there.
A launched driver reads those paths from its own pane environment, so they must
be exported there when the layout is not the default: `MISSION_VAULT` defaults
to `~/vault`, `MISSION_BIN` to `mission` on PATH, and `MISSION_STATE_DIR` to
`~/.local/state/pi-missions`. The preview launcher supplies its CLI and config
automatically. `/mission attach`
recovers a claim whose acknowledgement was lost. The driver is not a subagent
registry entry: steer it with `rex send -s army -b <block> <text>` in Rex, or
`herdr agent prompt <pane> <text>` in Herdr, or resume its session file in the
same seat. A resume that changes seat kind, such as Herdr to Rex, also needs the
re-attach described in [Seating a captain](#seating-a-captain).
An operator must resolve a missing credential, abandoned launch, or crashed
verifier; this version has no takeover or lease expiry command.

Every save carries the revision it was loaded from and refuses to replace a
ledger that already moved (`revision_conflict`), so a record held across a claim
can never drop that claim. Each mission keeps `journal.jsonl`: one line per save
with its timestamp, base revision, new revision, attempts, and the command that
wrote it. A refused save writes a line too. `mission repair REPO/SLUG` replays an
interrupted step edit and re-admits `attempts/NNN.md` projections that the ledger
no longer lists. It restores the owning attempt and step, and restores a step
whose re-admitted attempt passed its checks.

Transcript snapshots are limited to 16 MiB. The vault ledger and cached hook outbox
are local files, with atomic replacements. Vault synchronization is not a multi-host
lease service. Same-user processes are trusted; token flags are capability transport,
not an isolation boundary. Branch/worktree cleanup and publishing remain with the
existing repository workflow.

## Validation

Run `bash scripts/test-missions.sh`. It uses the real Go CLI, temporary vaults and
Git worktrees, and a simulated Pi/Herdr boundary. The extension loader smoke also
imports the real factory with stubbed external packages. These tests prove the
local adapter contract. They do not prove live Herdr attachment, model behavior,
or recovery from machine power loss. A live pilot is still needed before unattended use.
