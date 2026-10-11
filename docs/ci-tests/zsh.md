# zsh — CI checks

## Purpose

This page documents the zsh test script. The script checks the tracked zsh
dotfiles offline, with no network and no `$HOME` writes.

## Overview (merged PRs)

- #13, #20: a non-interactive shell must find cargo, starship, uv, zoxide,
  and direnv. `.zshenv` prepends `~/.cargo/bin` and `~/.local/bin`.
- #21: the shell must export `TERM=xterm-256color`, never `xterm-ghostty`.
  That leak broke RGB colors and the clipboard in tmux and SSH.
- #26: every alias target must resolve.

## What the suite covers

`scripts/test-zsh.sh` runs ten checks:

- `zsh-syntax`: `zsh -n` parses every tracked `zsh/` file.
- `zshenv-path`: `zsh -c` with only `.zshenv` sourced resolves the five tools
  from stub home bin dirs, prepended on PATH.
- `zshenv-exit0`: sourcing `.zshenv` alone exits 0 and never needs `.zshrc`.
- `term-rc`: `.zshrc` exports `TERM=xterm-256color` in both shell modes.
- `term-env`: `.zshenv` leaves `TERM` alone and never sets `xterm-ghostty`.
- `term-content`: no tracked zsh file references `xterm-ghostty`.
- `alias-targets`: every alias in `.zshrc` resolves. A binary target
  resolves in a stub PATH; a path target is a repo file or allowlisted.
- `guard-struct`: starship, zoxide, and direnv init blocks carry
  `command -v` guards.
- `guard-behavior`: `.zshrc` sourced with the tools absent exits 0.
- `idempotent`: sourcing `.zshenv` and `.zshrc` twice adds no duplicate PATH
  entries and keeps the PATH value stable.

## How to run

Default mode: a missing zsh prints SKIP; the script exits 0.

    ./scripts/test-zsh.sh

STRICT mode, for CI: a missing zsh FAILs. CI installs zsh first.

    STRICT=1 ./scripts/test-zsh.sh

Selftest mode mutates copies of `zsh/` and expects each check to FAIL:

    SELFTEST=1 ./scripts/test-zsh.sh

## Runtime and SLA

The script builds fake homes with `mktemp` and runs zsh through `env -i`. A
stub `curl` blocks network calls in the sandbox. Each check prints PASS,
FAIL, or SKIP with file, reason, and timing. The script finishes in under
1 s; selftest mode takes about 1 s. The SLA is 30 s. Reruns match exactly.

## Coverage result

The suite enumerates tracked files with `git ls-files`. The repo tracks two
files. Both get checks:

- `zsh/.zshenv`: syntax, PATH contract, exit 0, TERM leave-alone,
  no-ghostty, idempotence.
- `zsh/.zshrc`: syntax, TERM export in both shell modes, no-ghostty, alias
  targets, guards, idempotence.

The suite asserts the starship, zoxide, and direnv guards. The bun, gcloud,
and nvm blocks use file guards and run no commands; they stay out of scope.
The `rg`, `ls`, `inv`, `ghd` aliases resolve in the stub PATH. `dvim` targets
a Neovim checkout outside this repo; the script holds it on the host-only
allowlist.

## Known gaps

- The oh-my-zsh install block in `.zshrc` uses curl. The suite does not test
  it. Stubs keep the sandbox offline.
- The `vim`, `mvim`, and `osc52-copy` definitions are functions, not
  aliases. The suite does not test them.
- zsh built-in default aliases are not repo definitions. The suite does not
  test them.
- The tracked files define no abbreviations. The suite does not test them.
