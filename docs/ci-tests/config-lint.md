# config-lint CI tests

## Purpose

`scripts/test-config-lint.py` guards the config files that had no test suite: it parses every
file, checks the structure of each file class, and blocks absolute user paths. It runs offline,
never changes `$HOME`, and never uses the network.

## Overview (merged PRs)

- **#8/#9 portability drift.** Machine-specific absolute paths broke portability twice. The tripwire
  fails on any new `/home/<user>` or `/Users/<user>` path in a tracked config.

## What the suite covers

- **C1-C3 parse gates.** Every tracked TOML, JSON, and YAML file parses (PyYAML, then ruby, then a
  loud failure); a malformed file fails with its name.
- **C4 starship.** Module blocks are known modules; format-string `$token`s name modules.
- **C5 aerospace.** `[mode.main]` exists; every mode has a binding table; keys, commands, `mode`
  targets, startup hooks, and window-detected runs all resolve.
- **C9 git config.** `git config --list` parses it; `user.name` and `user.email` are set; the
  OS-specific `credential.helper` stays out of the tracked file with its explanatory comment
  (B24); the no-op `[editor] tool` key stays gone.
- **C10 lazygit.** Top-level keys are lazygit sections; keybinding and diff-renderer shapes hold.
- **C14 portability tripwire.** No tracked scope file holds an absolute user path.

The tmuxinator, k9s, neovide, omarchy, code-snippet, and blinksh checks were removed together
with their config packages in the dead-code cleanup.

## How to run

Run `./scripts/test-config-lint.py`. It prints one PASS, FAIL, or SKIP line per finding; every FAIL
names the file and the reason, and it exits non-zero on any FAIL. It needs `git` and Python 3.11+;
YAML needs PyYAML or ruby. Run `--selftest` to prove each check fails on a mutated mktemp sandbox
copy; it never touches the worktree.

## Runtime and SLA

Reruns give the same result. One run takes under 0.1 s, the selftest under 0.5 s; the budget is 30 s.

## Coverage result

All 5 tracked files in scope are checked:

| File | Checks |
| --- | --- |
| `aerospace/.aerospace.toml` | C1, C5, C14 |
| `git/.config/git/config` | C9, C14 |
| `git/.config/git/ignore` | C14 only; patterns, no structure |
| `git/.config/lazygit/config.yml` | C3, C10, C14 |
| `starship/.config/starship.toml` | C1, C4, C14 |

The repo-config suite owns the herdr config class (#156-#158); this suite does not repeat it.

## Known gaps

- The aerospace and lazygit allow-lists are vendored from the current files. Add a new value in
  the same change that uses it, or the suite fails.
- `docs/ci-tests/repo-config.md` still lists starship and lazygit as unowned. This suite owns
  them now; update that doc when the lanes merge.
