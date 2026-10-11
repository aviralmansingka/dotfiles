# install-smoke CI tests

## Purpose

`scripts/test-install-smoke.sh` runs the offline parts of `install.sh`
against a `mktemp` fake `HOME`, with no service contact. The suite
proves that the deployment works, repeats safely, and fails safely.

## Overview (merged PRs)

- **#11** wrote the install pipeline. The stow list then drifted from
  the package directories. This smoke reads the stow lines from
  `install.sh` and runs them, so a new line changes what it does.
- **#199** added guarded optional steps. A missing tool must make a
  step skip, not abort under `set -e`. This smoke checks each guard
  in the text and runs the guarded steps with the tools absent.
- **#201** found stow-list drift in both directions. This smoke keeps
  a sentinel per package; a stow line or a sentinel without its
  partner fails the plan phase.

## What the suite covers

- **Lint and plan.** `bash -n` accepts `install.sh`. The suite extracts
  every `stow` line and gates each one as `install.sh` does:
  `launchd` needs Darwin, `omarchy` its binary, `systemd` the
  `systemctl` command; the phase-5 `stow -R` restow stays out.
- **Deploy.** The suite runs the stow commands, `pi-settings-sync`,
  `tic`, and the git stow in the order of `install.sh`. It checks
  exit 0, that every symlink resolves into the repository, and that
  the only real files are what `pi-settings-sync` and `tic` write.
- **Idempotence.** A second run exits 0, keeps the symlink set, prints
  no error about an existing target, and keeps the real `$HOME` intact.
- **Guarded optional steps.** With `brew`, `gh`, `omarchy`, `herdr`,
  and `codex` absent from the path, each guarded step skips and does
  not abort under `set -e`. The `|| true` and `||` fallbacks are also
  checked in the text.
- **Conflict.** A real file sits where stow wants a symlink. The run
  fails, prints the stow conflict, and keeps the file.
- **Failure containment.** A stub `stow` passes one call, then fails.
  The failure surfaces, the rollback removes what the stub placed, and
  no half-stowed tree stays. The hook link also runs twice in the
  sandbox copy; the shared `.git` stays untouched.

## How to run

```bash
scripts/test-install-smoke.sh            # missing stow or node gives SKIP
STRICT=1 scripts/test-install-smoke.sh   # a missing tool gives FAIL
```

Set `INSTALL_SH=<copy>` to point at a mutated copy of `install.sh`:
a removed guard, a phantom package, or broken syntax exits 1.

## Runtime and SLA

One run takes about 1 s on Linux. The SLA is 60 s; a longer run fails.

## Coverage result

- Smoked: the `rm -f` pre-clean; the stow lines; `pi-settings-sync`;
  `tic` terminfo; `stow systemd` when `systemctl` exists; the hook link.
- Guard smoked, step not run: `herdr integration install pi`;
  `gh extension install`; `herdr integration install codex`;
  `install-nm-herdr-bridge`.
- Skipped with reason: `stow launchd`, `install-no-mistakes`
  (macOS-only); `stow omarchy` (binary absent); `stow -R zsh`.
- Not smoked, network: Homebrew and `brew bundle`; the installer
  curls; rustup, cargo, bob, `npm ci`; Oh My Zsh, zsh plugins, TPM.
- Not smoked, live service: the guarded `herdr integration install pi`
  (its `command -v herdr` guard is smoked statically and dynamically; the
  live integration still needs a real herdr); Herdr Flash; the annotate
  reviewer.

## Known gaps

- **macOS-only phases.** `stow launchd` and `install-no-mistakes` run
  only on Darwin; the smoke skips them with a reason. The `aerospace`
  and `ghostty` configs stow on Linux, but the apps do not start.
- **Silent guards.** `install.sh` skips a guarded step without a
  message; the smoke prints the skip reason for each gated step.
- **Intentional nvim root entries.** `stow nvim` links
  `.markdownlint-cli2.yaml` and `.markdownlint-rules/` into the `$HOME`
  root on purpose: markdownlint-cli2 picks up `~/.markdownlint-cli2.yaml`
  as the default config for every project, and nvim's conform/markdown
  wiring passes that exact path. The stray `tool-call-rendering-prototypes.md`
  that used to sit beside them was relocated to `docs/` (C35), and the
  `pkgshape` phase fails if any other file lands at the nvim package root.
