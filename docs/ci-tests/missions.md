# Mission tests

Run `bash scripts/test-missions.sh` from the repository root.
Use Go 1.26 or later and Node 20 or later. Download Go modules before the test run.
CI sets up Go from the module file and caches the dependencies.

The suite runs Go tests and vet. It builds a temporary CLI binary. Node tests then
call that binary with temporary vaults and Git worktrees. The suite does not open
Herdr panes, call a model, or change the user's vault.

The tests check exclusive claims, stable worktree bindings, existing session
attachment, launch intent deduplication, structured progress and evidence hashes,
hook retries, transcript copies, checkpoint pauses, and verified completion.
They check that a normal turn without a completion report keeps its owner.
They also check that an interrupted turn cannot settle a completion report.

Go cases pin the ledger commit point, and the storage half of that contract is
tested beside the store it pins (`internal/adapters/vaultfs`). A save of a record
read before a claim is refused with `revision_conflict`. Two actors with different
lock directories (`vaultfs.WithLockDir`, a second `TMPDIR`) reproduce the
lost-claim incident through the store's write transaction, and the same
compare-and-swap stops it. The journal names every writer, refused saves
included. `mission repair` re-admits an orphaned `attempts/NNN.md` projection,
restores the owning attempt and step, replays an interrupted step edit, and
keeps a passed step passed. The extension tests pin the gate: a tracking record
that fails degrades read and bash-class tools to a warning and keeps blocking
edits.

Four context cases pin the attempt every emitted line names. Each one asserts on
the rendered text: the claim a seat reads, the context `show` returns, the driver
lines, and the brief file `MISSION_BRIEF` points at. The first case claims a
step, ends that attempt as failed, then claims the step again. It proves that the
idle ledger names no attempt at all, that the claim the re-claim returns names
the new attempt id, that it does not name the previous one, that `show` renders
the new one, that the brief file was re-rendered with it, and that
`MISSION_ATTEMPT` names it. The second case removes the attempt record and leaves
`active_attempt` set, the shape of the 2026-11-05 wedge. It proves that the
context, the driver lines, and the step context name no attempt id and say the
ledger lists none, that an id from an earlier sequence is not named either, and
that the emitter refuses with `stale_attempt` instead of handing a seat that
claim. The third case proves that each claim's brief carries its own step and its
own attempt id. The fourth proves that the driver lines name the listed attempt,
that a reported attempt makes them carry `mission finish`, and that an idle
mission gets no attempt id. The extension cases pin the same contract from the
other side: after a re-claim the injected context names the new attempt id and
the old one is gone, a ledger that lists no attempt produces no attempt id, and a
hook the CLI can no longer accept is dropped instead of wedging the outbox while
a transient failure still retries.

The abandon cases pin the commander's escape for an attempt whose owner is gone.
The first case claims a step and records a real child process as the attempt pid.
It proves that `abandon` refuses with `busy` while that process lives. The
attempt, the step, and the active owner stay unchanged. The second case kills
and reaps that child. It proves that `abandon` releases the attempt without the
token. The answer names the attempt and the step. The record keeps an
`attempt-abandoned` event with the note, and the step stays failed. Then `retry`
and a fresh claim take the step again. The third case refuses an attempt with no
inspectable process: no pid, or a pid from another host. That refusal names
`mission repair`, and a foreign pid is never probed. Other cases pin the usage
refusals, an unknown attempt, a repeat abandon reported as `already: true` with
no write, `attempt_terminal` for an attempt that ended another way, the refusal
of a closed mission, and the dispatch entry that reads `--attempt` and `--note`.

Eight repair reconciliation cases pin the dead-attempt reconciliation. The first case claims a
step, records a real child process, then kills and reaps that child. It backdates
every stamp on the attempt. It proves that `repair` ends the attempt as `failed`,
names the attempt and the step in an `attempt-reconciled` event, clears the
active owner, and leaves the step closable by `retry` and a fresh claim. The
second case records a live child and backdates the same stamps. It proves that
the attempt stays `running`, that the owner stays set, and that no event is
written. The third case kills the child but leaves the stream inside the quiet
window. It proves that a fresh stream keeps the attempt running, so the window
does not misread a working process. The fourth case uses a claim with no pid, the
shape of a Pi seat. It proves that `repair` ends that uninspectable attempt after
the quiet window, and that the event says the process was never inspectable.
There `repair` deliberately differs from `abandon`, which refuses such an
attempt.

The fifth and sixth cases pin the session file as evidence. The fifth records a
session file older than the window, then backdates the stamps. It proves that
`repair` ends the attempt and that the event names the stale session file. That
is the incident shape: a Pi attempt with no pid whose recorded session went
silent. The sixth records a session file written now and backdates the stamps. It
proves that the attempt stays `running` and that the busy refusal of `next` names
`mission repair` with the handle. The seventh case moves the attempt to another
host with a pid, a fresh local session file, and backdated stamps. It proves that
`repair` changes nothing: the attempt stays `running`, no event is written, and
the revision does not move. An eighth case leaves a quiet attempt on a step that
already passed. It proves that `repair` never demotes the passed step and leaves
its attempt for `mission abandon`.

Close cases pin the retirement contract: close after every step passes, refusal
of open work that names the unfinished step ids and the `--force` hint, a forced
close that records its note and timestamp, an idempotent second close that
returns `already: true`, and live-work commands refused with code `closed` and a
pointer at a new mission. They also pin that a closed mission never appears as
ready work, and that `repair` refuses a closed mission without losing its
replay-or-adopt behavior: the ledger cases above still pass unchanged.

One Go case pins the mission identity: branch `mission/<slug>`, a linked checkout
under the worktree root, the `branch.<name>.missionOwner` marker, reuse on reland,
and refusal of an unmarked `mission/<slug>` branch.

The catalog cases split the same way. The Git facts — the repository a path
belongs to, a checkout's root and Git directory, the state of an existing path
against the mission branch, the worktree that holds a branch, the refs and branch
names it probes, and the ownership marker — are pinned beside the adapter that
answers them, in `internal/adapters/gitworktree`, which also runs the commands
that create the mission branch, mark it, and keep or revive its checkout. The Pi
session header is read in `internal/adapters/pisession`, whose cases pin a
missing first line, an undecodable line, and an unreadable file. The policy cases
run against a fake `mission.Catalog` in `cmd/mission`: the binding order
(`wrong_repository`, then `isolated_worktree_required` for a path that is not its
own checkout root, the primary checkout, a detached HEAD, or a mainline branch,
then `worktree_busy` for another mission or another mission's running attempt),
and the host the core records and refuses by, which a fake answers for a second
machine. The adoption and revival cases stay end to end on real Git, because they
prove the rules and the checkouts they decide about together.

The check cases are split by what they need. The core's verdict loop — the
declared order, the blocked-after-failure rule, the demotion of a passed check
whose input moved, a checker that refuses a check, and the evidence log it
writes — runs against a fake `mission.Checker` in `cmd/mission`, so no process
starts and no checkout is needed. The cases that need a real Git checkout, the
module-root scope, and the 1 MiB output cap live in `internal/adapters/checks`
with the presets they describe. Three cases still run real processes end to end
through the ledger: the go-test case that holds the vault lock open, the two
`cmd:` cases, and the truncation case.

The deploy cases pin the seat seam. A recording Rex server and a recording Herdr
server each satisfy one adapter, and every deploy case installs both: a `--mux
rex` deployment makes no Herdr call and a `--mux herdr` one makes no Rex call, and
an unknown mux is refused before either is asked. Both muxes answer the same plan
decisions (army session, `captain-<slug>`, `mission-<slug>`), and both seats are
built by the one `seatExecLine` — Rex adds only `REX_SESSION`, because it sets
`REX_BLOCK` in the block's own environment. The Herdr cases pin the mapping (a
workspace labeled `army` with a renamed `commander` root tab, the captain's tab in
the mission worktree), the readiness poll before the write, the split write
(`pane send-text`, then `pane send-keys enter`), one retried submit, a live
captain that is focused and never duplicated, a dead one whose tab is closed
before a fresh seat, and the session file Herdr reports. The Rex cases pin the
window command (`$SHELL -l -c <exec line>`, the plan cwd, the login shell's base
name) and that nothing is ever written into the block, the verification and its
one retry, the block-and-window error text, focus, replacement, and the dead-seat
clear.

The extension's launch cases are one pair now: a launch calls `mission deploy
<handle> --mux herdr|rex` for the mux its environment names, spawns no Herdr
process at all, and adopts the runtime from `mission show`; a launch that found
the captain already seated reports `launched: false`.

The extension test file also runs in the Pi test job. Without MISSION_TEST_BIN,
it runs only the pure adapter tests and marks CLI integration cases as skipped.
The script test entry supplies the binary and runs those cases. A missing Go
toolchain fails that entry. Its path header selects it for mission changes.

These tests do not prove live Pi or Herdr behavior. Use a separate pilot for that.
The expected local warm run is under 30 seconds. CI allows 120 seconds per entry.
