# ops — CI checks

## Purpose

This page documents the ops test scripts. The scripts check the Terraform,
systemd, and launchd files in this repo. They run offline, with no cloud
credentials.

## What the suite covers

`scripts/test-terraform.sh` checks `ops/terraform` and `ops/devbox`:

- No `.tf` file sets a `profile` attribute (#7).
- The OIDC `sub` condition scopes the trust policy to this repo (#8).
- The CI role has no AdministratorAccess-style grant (#16).
- Every AWS resource in `ops/devbox` gates its count on
  `devbox_enabled`; false gives a zero-instance plan (#10).
- The `name_prefix` variable exists and names the devbox resources (#20).
- Every DNS record uses the VPS IP attribute, not a literal (#6).
- `terraform fmt -check` runs when the terraform binary exists.
- `terraform validate` runs only with `TF_VALIDATE=1`; `init` downloads
  providers, so it is network-gated. The static checks are the offline lane.

`scripts/test-service-units.py` checks `systemd/` and `launchd/`:

- Every unit file parses. Required sections and keys exist.
- Every `.service` ExecStart uses an explicit interpreter. A bare script
  path can fail with status 203/EXEC (#142).
- Every `.timer` references a tracked `.service` file.
- `systemd-analyze verify` runs when the binary exists.
- Every plist parses; `Label` matches the file name; `ProgramArguments` exists.
- Repo-relative paths in units and plists point at files in this repo.

## How to run

Default mode, for local hosts. A missing tool prints SKIP; the script exits 0:

    ./scripts/test-terraform.sh
    ./scripts/test-service-units.py

STRICT mode, for CI. A missing tool FAILs. CI installs terraform first.
For validate, also set `TF_VALIDATE=1`; it needs network:

    STRICT=1 ./scripts/test-terraform.sh
    STRICT=1 ./scripts/test-service-units.py

## Runtime and SLA

Each check prints PASS, FAIL, or SKIP with file, reason, and timing. Both
scripts finish in under 1 s; the SLA is 30 s. Reruns match.

## Coverage result

The scripts enumerate the tracked files with `git ls-files`. Every tracked
file gets a check. Each `.tf` file gets no-profile, fmt, and validate. Each
systemd file gets parse, repo-paths, and verify, plus the interpreter check
for `.service` units and timer-target for `.timer` units. Each plist gets
parse, keys, and repo-paths.

- `ops/terraform` (7): dns.tf, github.tf, iam.tf, main.tf, oidc.tf,
  providers.tf, variables.tf.
- `ops/devbox` (3): devbox.tf, providers.tf, variables.tf.
- `systemd/.config/systemd/user` (6): dotfiles-auto-sync.service,
  pi-stt-worker.service, pi-telegram.service, pi-whatsapp.service,
  vault-auto-sync.service, whatsapp-bridge.service (host-only ExecStart
  path, SKIP). The pr-digest and flight-checkin-reminders units were
  removed together with their feature (the retired-units list in
  README.md records them).
- `launchd/Library/LaunchAgents` (3): com.aviral.dotfiles-auto-sync.plist,
  com.aviral.no-mistakes.plist, com.aviral.vault-auto-sync.plist.

## Known gaps

- `terraform plan` and `apply` stay path-gated. They need credentials.
  `validate` needs `init`, which downloads providers; keep it behind
  `TF_VALIDATE=1`.
- `ops/terraform/iam.tf` attaches AdministratorAccess to the admin group.
  This grants the human user full access. The suite does not fail on it.
  The owner must decide if it stays.
- Host paths stay host-side: `%h/bin`, `$HOME/bin`, `%h/projects`,
  `$HOME/vault`. Verify those units on their target hosts.
