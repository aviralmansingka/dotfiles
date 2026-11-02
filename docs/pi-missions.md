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
(cd scripts/mission-cli && go build -o bin/mission .)
./scripts/pi-missions
```

Run the preview in a Herdr pane. It uses this checkout's Pi configuration, bundled
mission-worker profile, extension, and skill. Keep this checkout while its sessions
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

In Pi, `/missions` selects a mission and action. `/mission start REPO/SLUG` launches
its owner. Agents use the deferred `mission` tool via `tool_search`. Its actions
are `list`, `create`, `steps`, `edit`, `status`, `start`, `attach`, `next`, `progress`,
`verify`, `finish`, and `fail`. Tool results never include claim credentials.

## Workspace and ownership

A repository keeps its existing primary Herdr workspace. `start` resolves it by
Git common directory and creates a background tab there. It does not call Herdr's
worktree create/open commands, which can create a separate workspace on the
installed version. If the primary workspace is absent or ambiguous, start refuses.

Each mission gets `~/.herdr/worktrees/<repo>/mission-<slug>` on
`task/mission-<slug>`, initially from local `main`. The CLI records the base commit.
An existing branch must carry this mission's ownership marker to be reused.
The same path and branch remain bound across steps, retries, and revisions.
Ownership is single-host and exclusive across missions in that vault. Unrelated
vaults do not share a lock or ownership index.

For an already running Pi session, use `/mission attach REPO/SLUG` from the root
of its non-main linked worktree in the repository's primary workspace. The CLI
checks the Pi session header, repository identity, cwd, durable owner, and active
attempt. It adopts that worktree without copying code or moving the session.
Attachment to main, a second mission in the same worktree, or a different owning
session is refused. Herdr remains responsible for preventing duplicate live
attachments to the same Pi session file.

`start` persists a launch intent before opening a tab. The mission-worker first
attaches through the tool using that intent. A launch receipt stores its session
file. Repeating start returns the recorded runtime instead of spawning again.
An uncertain launch remains reserved for inspection; it is never timed out into a
second writer automatically. Runtime session identity remains bound after an
attempt completes. Use `next` explicitly to claim the next eligible step.

Newly started mission-workers receive a continuation prompt after a successful
step when the mission is ready for more work. They keep the same session and
worktree. Existing sessions attached for progress tracking use explicit `next`.
Both modes pause at checkpoints; accepting one does not silently start another run.

## Progress and completion

Structured reports include status (`working`, `blocked`, `needs-input`, `ready`),
summary, next action, blocker, and optional evidence paths. The CLI captures hashes
and deduplicates stable event IDs, refusing changed payloads for an existing ID.
Evidence belongs to the current attempt. Lifecycle hooks record only event metadata,
tool names/call IDs, session identity, and transcript snapshots. They omit tool
arguments and outputs. Transcripts themselves can contain sensitive conversation
content; they are intentionally preserved in the mission vault.

The CLI holds one active attempt per mission. `finish`/`fail` report an outcome.
An attached Pi session retains ownership until a normal run settles with no queued
messages, registered child agents, or registered external waits. The adapter then
calls `settle`. Required checks must pass before success; evidence changes invalidate
their proof. Settlement records a Pi turn boundary, never a fictitious process exit.
Unregistered detached jobs are outside this contract and must not be used as writers.

Human checkpoints pause the mission after their step. The user reviews the result
and check evidence before an explicit accept or revise decision. Neither the
extension nor skill approves checkpoints. Mission checks complement the existing
No Mistakes pipeline and do not start nested validation runs.

## Reload and recovery

Credentials and unacknowledged lifecycle events live in
`$MISSION_STATE_DIR` or `$XDG_STATE_HOME/pi-missions` (default
`~/.local/state/pi-missions`). Files are mode 0600, keyed by vault and session ID.
Credentials are persisted before claiming, never placed in a prompt, tool result,
or child environment. Only non-secret CLI/vault/cache paths travel in a launch's
loadout snapshot. Hooks queue locally before delivery and retry with the same IDs.
Repeated deliveries cannot create duplicate events. CLI failures block further
tracked tool work until recording recovers. Inactive steps block editing tools.

Shutdown snapshots the transcript and parks the attempt without releasing its
owner. Resume the same Pi session file in the mission worktree and primary Herdr
workspace with the original MISSION_VAULT, MISSION_BIN, and MISSION_STATE_DIR.
The preview launcher supplies its CLI and config automatically. `/mission attach`
recovers a claim whose acknowledgement was lost. `subagent_message` still steers
live owners through the existing registry, but refuses its disposable automatic
resume path for a stopped durable mission. Use Herdr/Sidekick to resume it instead.
An operator must resolve a missing credential, abandoned launch, or crashed
verifier; this version has no takeover or lease expiry command.

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
