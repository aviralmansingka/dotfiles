# nm-install — CI test doc

## Purpose

This suite guards the owned No Mistakes lifecycle: the installer
`scripts/install-no-mistakes`, the rollback `scripts/rollback-no-mistakes`,
and the wrapper `pi/bin/no-mistakes-daemon`. It runs offline, with fake
assets under `scripts/fixtures/nm-install/`. It complements the verifier
`scripts/verify-no-mistakes-installation` (V01) and does not repeat the
V01 lifecycle run.

## Overview (merged PRs)

PR #105 added the pinned install, the rollback, and the wrapper. PR #278
moved the bridge into Herdr and kept these three scripts as the owned
surface. The suite pins the contracts those PRs set: pinned digests, exact
versions, lock ownership, verified rollback, and wrapper exports.

## What the suite covers

`scripts/test-nm-install.sh` runs 21 checks:

- Offline install through `NO_MISTAKES_ASSET`: pinned version, manifest, `agent: pi` config, skill, no temps, no lock.
- Idempotent re-run: same inode and manifest, no rollback copy.
- SHA mismatch: a wrong pin and a corrupt byte abort before any target change.
- Exact version: an asset that reports a different version aborts.
- Trap cleanup: a failed init leaves no half-state; a retry repairs it.
- Version replacement: a different pin reinstalls and keeps a verified rollback; the same pin skips it.
- Refusals: no prior manifest, a tampered manifest, and a wrong-agent config abort; the binary stays untouched.
- Lock: a live owner pid is respected by both scripts; a reaped pid and a non-numeric pid are reclaimed.
- Rollback: the prior binary returns, NM_HOME history stays intact, a second rollback changes nothing.
- Wrapper, run via `sh`: telemetry and update-check exports, NM_HOME default and override, PI dir, PATH, `daemon run --root`, argument checks, clean missing-binary failure.
- Mutations: the suite removes one guard at a time in sandbox copies; each removal must let the regression in.

## How to run

Default mode prints SKIP for a missing primitive and exits 0:

    sh scripts/test-nm-install.sh

STRICT mode fails on a missing primitive. Use it in CI:

    STRICT=1 sh scripts/test-nm-install.sh

The suite needs `sh`, `tar`, `awk`, `sed`, `git`, `mktemp`, a SHA-256 tool,
and a supported platform: darwin-arm64 or linux-amd64. Each sandbox lives
under `mktemp` and uses stub `launchctl`, `systemctl`, and `pi` binaries.
No sandbox touches the real HOME, NM_HOME, launchd, or systemd.

## Runtime and SLA

Each check prints PASS, FAIL, or SKIP with surface, reason, and timing.
The run takes about 1 s. The SLA is 30 s. The suite exits non-zero on any
FAIL. A corrupt fixture tarball always fails, in both modes.

## Coverage result

Every function and exit contract maps to an owner:

| Surface | Covered by |
| --- | --- |
| Installer helpers, platform pick, worktree check | suite + V01 |
| Installer `has_exact_version` gates | suite + V01 + mutation |
| Installer lock loop, reclaim, live rejection, release | suite + V01 + mutation |
| Installer offline asset path; curl download path | suite; V01 (fixture curl) |
| Installer archive digest pin; tar member checks | suite + V01 + mutation; V01 |
| Installer idempotent skip, replacement, rollback save | suite + V01 |
| Installer refusals, config guard, skill rules | suite (skill rules also V01) |
| Installer Darwin plist checks and `restart_daemon` | V01 (simulated); suite on a Darwin host |
| Installer and rollback Linux fallback of `restart_daemon` | suite + V01 |
| Rollback artifact checks, restore, repair, NM_HOME intact | suite + V01 (V01 covers digest damage) |
| Wrapper functions and exit contracts | suite + mutation |

## Known gaps

- The live daemon stays host-only; `scripts/verify-no-mistakes-live` gates it with `NO_MISTAKES_VERIFY_LIVE=1`.
- A real GitHub download stays out of CI; the pinned-version freshness check needs network and runs on a schedule only.
- The Linux systemd branch of `restart_daemon` needs a real user unit; the fixture `systemctl` forces the fallback branch, so CI restarts nothing.
- Darwin plist failure branches run only on a Darwin host through the fixture `launchctl`; CI on Ubuntu skips them.
