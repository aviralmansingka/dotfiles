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
One Go case pins the mission identity: branch `mission/<slug>`, a linked checkout
under the worktree root, the `branch.<name>.missionOwner` marker, reuse on reland,
and refusal of an unmarked `mission/<slug>` branch. The extension cases stub
`herdr` and pin the `herdr worktree open` registration plus the workspace the
mission-worker tab lands in; no Herdr call is made. Two more extension cases pin
the agent-name collision: a stale holder is renamed with the exact `herdr agent
rename` argv and the launch retries once, while a working holder keeps its name
and the failure names its pane. They also pin that a failed launch releases its
launch intent, and that a launch pane which hosts an agent keeps it.

The extension test file also runs in the Pi test job. Without MISSION_TEST_BIN,
it runs only the pure adapter tests and marks CLI integration cases as skipped.
The script test entry supplies the binary and runs those cases. A missing Go
toolchain fails that entry. Its path header selects it for mission changes.

These tests do not prove live Pi or Herdr behavior. Use a separate pilot for that.
The expected local warm run is under 30 seconds. CI allows 120 seconds per entry.
