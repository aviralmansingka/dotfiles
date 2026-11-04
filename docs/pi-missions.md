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
`verify`, `finish`, and `fail`. Tool results never include claim credentials.

## Workspace and ownership

A repository keeps its existing primary Herdr workspace. `start` registers the
mission checkout as a Herdr **worktree workspace** with
`herdr worktree open --cwd <primary checkout> --path <mission worktree> --no-focus`.
That call is idempotent: it returns the workspace Herdr already links to the
repository, and creates one on first launch. The worker runs in that
workspace's first tab, or in a new tab there when the workspace is already open
(the previous session may still be parked on that pane). Herdr groups per-worktree
workspaces under the repository, so one repository still owns one repository
workspace plus its linked worktree workspaces.

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
If the Herdr workspace or the checkout is deleted but the `mission/<slug>` branch
remains, `start` recreates the checkout at the recorded path and re-registers it
with `herdr worktree open`. It never creates a second branch or checkout. A
branch checked out elsewhere is reported, not duplicated.
A closed mission is refused instead: `/cleanup` closes the record when it removes
the checkout, so a retired mission never revives it. Start a new mission for new
work.
Ownership is single-host and exclusive across missions in that vault. Unrelated
vaults do not share a lock or ownership index.

For an already running Pi session, use `/mission attach REPO/SLUG` from the root
of its non-main linked worktree in one of the repository's Herdr workspaces — the
mission's own worktree workspace, or the repository's primary workspace for a
mission bound before worktree workspaces existed. The CLI
checks the Pi session header, repository identity, cwd, durable owner, and active
attempt. It adopts that worktree without copying code or moving the session.
Attachment to main, a second mission in the same worktree, or a different owning
session is refused. Herdr remains responsible for preventing duplicate live
attachments to the same Pi session file.

`start` persists a launch intent, registers the Herdr worktree, opens the worker
tab, and starts the worker as a full Pi agent in that pane
(`herdr agent start <name> --kind pi --pane <pane>`). The worker is not a
subagent: it carries no subagent identity, loadout file, wall-clock timer, or
watchdog. Its environment is the pane's own, and Pi loads the repository
configuration and the missions skill in that worktree. `start` then
waits up to 60 s for the agent to reach its prompt (`herdr agent wait`), submits
the first task (`herdr agent prompt`), and reads the session file from
`herdr agent get` before it records the launch receipt. The task names that
launch id, and the worker attaches with it through the tool.

Herdr agent names are unique for the server. A launch names the worker
`mission-<slug>`. A name that another session holds takes a short handle hash
once; if that name is taken too, the launch fails and names the pane that holds
it. The launch never renames another session's agent.

A launch receipt stores its session
file. Repeating start returns the recorded runtime instead of launching again.
An uncertain launch remains reserved for inspection; it is never timed out into a
second writer automatically. Runtime session identity remains bound after an
attempt completes. Use `next` explicitly to claim the next eligible step.

A launched worker receives a continuation prompt after a successful
step when the mission is ready for more work. It keeps the same session and
worktree. Existing sessions attached for progress tracking use explicit `next`.
Both modes pause at checkpoints; accepting one does not silently start another run.
A waiting review blocks the next step and `finish` only. The worker keeps every tool.

## Launch from the desk

`mission ui` is a Go TUI. Press `L` on the selected mission to ask for a launch.
The desk writes one request file at
`${MISSION_STATE_DIR:-${XDG_STATE_HOME:-~/.local/state}/pi-missions}/launches/<repo>--<slug>.json`,
with `state: pending`, `handle`, `repo`, and its owner seat.

The desk has no launch path of its own. A Pi session in that repository claims the
request and calls the same `start` action the `mission` tool uses, so the worktree,
the launch reservation, and the worker tab come from one code path. That action
opens the mission worktree as the repository's Herdr workspace, creates its tab,
and starts the worker agent there.

Each request carries the seat that asked: `owner_workspace` (`HERDR_WORKSPACE_ID`),
`owner_label` (`HERDR_PANE_ID`), and `owner_common` (the absolute git common dir).
The sweep picks one request per tick, in this order:

1. A request addressed to this session's workspace. A captain that already owns a
   mission still serves it, because the worker runs in its own worktree workspace.
2. An unaddressed request, from a desk that ran outside Herdr. Any idle session of
   the repository may claim it.
3. A request whose addressed workspace is gone. Only a session in the same checkout
   family adopts it, so a sibling clone never starts another checkout's mission.

A request addressed to a live workspace elsewhere waits for that workspace. A
request from another repository is left for that repository's session, and a worker
never launches.

The session sweeps every two seconds while it is idle, and again after each turn
settles.

The claim is the file: a second reader finds `claimed` and stops, so one press
cannot start two workers. A second press on the desk finds a live request and
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
the judge rather than the worker that spawned it.
Evidence belongs to the current attempt. Lifecycle hooks record only event metadata,
tool names/call IDs, session identity, and transcript snapshots. They omit tool
arguments and outputs. Transcripts themselves can contain sensitive conversation
content; they are intentionally preserved in the mission vault.

### Reading the troopers

The mission desk shows reports in two places. The detail pane's second tab
(` Troopers `, between Overview and Attempts) renders one row per report of the
attempt being watched: the active attempt while it carries reports, otherwise the
newest attempt that does, so a finished attempt's rows outlive its active slot.
Each row is a state glyph, the trooper's name, its age, and its summary. `✓` green
means ready, `◉` aqua means still working, and `◆` yellow means blocked or waiting
on input.

The newest of those rows also surfaces as a line in the desk's refresh header, so
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
never blocks worker tools: it blocks the next step, `step edit`, and `finish`.
Neither the extension nor skill approves reviews. Mission checks complement the
existing CI workflows and do not start nested validation runs.

## Reload and recovery

Credentials and unacknowledged lifecycle events live in
`$MISSION_STATE_DIR` or `$XDG_STATE_HOME/pi-missions` (default
`~/.local/state/pi-missions`). Files are mode 0600, keyed by vault and session ID.
Credentials are persisted before claiming, never placed in a prompt, tool result,
or child environment. Hooks queue locally before delivery and retry with the same IDs.
Repeated deliveries cannot create duplicate events. A record that cannot be read
blocks editing tools and degrades read and bash-class tools to a warning, so a
worker can investigate its own tracking. Inactive steps block editing tools.

Shutdown snapshots the transcript and parks the attempt without releasing its
owner. Resume the same Pi session file in the mission worktree and primary Herdr
workspace with the original MISSION_VAULT, MISSION_BIN, and MISSION_STATE_DIR.
A launched worker reads those paths from its own pane environment, so they must
be exported there when the layout is not the default: `MISSION_VAULT` defaults
to `~/vault`, `MISSION_BIN` to `mission` on PATH, and `MISSION_STATE_DIR` to
`~/.local/state/pi-missions`. The preview launcher supplies its CLI and config
automatically. `/mission attach`
recovers a claim whose acknowledgement was lost. A worker is not a subagent
registry entry: steer it with `herdr agent prompt <pane> <text>`, or resume its
session file in that pane with Herdr/Sidekick.
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
