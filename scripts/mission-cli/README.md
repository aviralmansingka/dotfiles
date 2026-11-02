# Mission CLI

Vault-backed mission and attempt ledger, with JSON as the default agent interface.
The optional Charm UI is available with `mission ui`. Requires Go 1.26+ on macOS or
Linux. This source continues the earlier mission prototype; existing vault records
remain readable and the process-managed `run` contract remains available.

From the dotfiles checkout:

```sh
./scripts/install-missions
mission --json help
```

The Pi integration, lifecycle rules, preview launcher, and recovery instructions
are documented in [Pi missions](../../docs/pi-missions.md).
The agent protocol is in the [missions skill](../../agents/.agents/skills/missions/SKILL.md).

Data lives under `$MISSION_VAULT/6_missions/<repo>/<mission-slug>/` (default
`~/vault`). `mission repo add` registers a checkout per host. Each mission stores
its brief, ordered steps, human checkpoints, attempt history, structured progress,
check evidence, and transcript snapshots. The local vault lock is single-host;
synced copies do not provide a distributed claim protocol.

Use title-only `--step` arguments when creating work, then `steps` and `step edit`
to customize it. Presets are `nonempty-artifact`, `json-valid`, and `go-test`.
Checks run outside the vault lock and bind their evidence to the artifact and
declared source fingerprint. They do not make arbitrary shell commands hermetic.
Do not change the brief or edit generated state while an attempt is active.

`workspace` prepares or adopts one linked worktree per mission. It accepts a local
base branch, records the starting commit, and never creates a Herdr workspace.
`attach` binds an existing Pi session after checking its file header and worktree.
`progress` stores status, summary, next action, blocker, and hashed evidence using
stable event IDs. A `ready` report does not pass a step. `finish` reports completion;
the Pi 1.5+ adapter later calls `settle` at its final settlement boundary, and the CLI runs checks.

Claims are local capabilities, not an OS security boundary. Same-user processes
can read the vault and credential cache. The `--human` flag records an explicit
attestation; it does not authenticate a human. Required checks and runtime hooks
assume a trusted local adapter. This version does not automatically recover a
lost credential, replace an owner, clear a crashed verifier, or retry an ambiguous
launch. Preserve the ledger and inspect the existing owner first.

Run `bash scripts/test-missions.sh` from the repository root for Go tests, vet,
and the Pi adapter contract tests using a real CLI and isolated Git worktrees.
No model request or live Herdr process is required.
