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

Four Go cases pin the ledger commit point. A save of a record read before a claim
is refused with `revision_conflict`. Two actors with different lock directories
(`Store.LockDir`, a second `TMPDIR`) reproduce the lost-claim incident through
`mutate`, and the same compare-and-swap stops it. The journal names every writer,
refused saves included. `mission repair` re-admits an orphaned
`attempts/NNN.md` projection, restores the owning attempt and step, and keeps a
passed step passed. The extension tests pin the gate: a tracking record that
fails degrades read and bash-class tools to a warning and keeps blocking edits.

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

The deploy cases pin the seat seam. A recording Rex server and a recording Herdr
server each satisfy one adapter, and every deploy case installs both: a `--mux
rex` deployment makes no Herdr call and a `--mux herdr` one makes no Rex call, and
an unknown mux is refused before either is asked. Both muxes answer the same plan
decisions (army session, `captain-<slug>`, `mission-<slug>`), and both seats are
built by the one `seatExecLine` — Rex adds only `REX_SESSION`/`REX_BLOCK`. The
Herdr cases pin the mapping (a workspace labeled `army` with a renamed `commander`
root tab, the captain's tab in the mission worktree), the readiness poll before
the write, the split write (`pane send-text`, then `pane send-keys enter`), one
retried submit, a live captain that is focused and never duplicated, a dead one
whose tab is closed before a fresh seat, and the session file Herdr reports. The
Rex cases keep pinning the same readiness, split write, verification, focus,
replacement, and error text as before.

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
