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
- mission zsh-to-nix S01: `PATH` and the machine-neutral exports belong to the
  flake (`home.sessionPath`/`home.sessionVariables` in
  `nix/modules/shared/default.nix`). No tracked zsh file assigns `PATH`;
  `.zshenv` sources the generated `hm-session-vars.sh` behind an existence
  check.
- mission zsh-to-nix S02: the shell assembles itself from the same module.
  `programs.starship`, `programs.zoxide`, `programs.direnv` and `programs.fzf`
  replace the three `eval "$(<tool> init zsh)"` hooks, and the four aliases are
  `programs.zsh.shellAliases`. `zsh/.zshrc` keeps only text with no declarative
  form: the `vim` and `osc52-copy` functions, the nvim bracketed-paste guard,
  and the `TERM` pin. The nvm, oh-my-zsh curl-installer and google-cloud-sdk
  blocks are gone.

## What the suite covers

`scripts/test-zsh.sh` runs twelve checks:

- `zsh-syntax`: `zsh -n` parses every tracked `zsh/` file.
- `env-owner`: no tracked zsh file assigns `PATH`; the profile owns it. A
  re-introduced `export PATH=...` overrides `home.sessionPath` silently, so
  the suite fails on it.
- `zshenv-path`: `zsh -c` with only `.zshenv` sourced resolves the five tools
  and `EDITOR` through a stub `hm-session-vars.sh`, and leaves `PATH` exactly
  as inherited when that file is absent.
- `zshenv-exit0`: sourcing `.zshenv` alone exits 0 and never needs `.zshrc`.
- `term-rc`: `.zshrc` exports `TERM=xterm-256color` in both shell modes.
- `term-env`: `.zshenv` leaves `TERM` alone and never sets `xterm-ghostty`.
- `term-content`: no tracked zsh file references `xterm-ghostty`.
- `dead-config`: no tracked zsh file carries a block for a tool the fleet does
  not have (`NVM_DIR`, the oh-my-zsh `curl -fsSL` installer, the
  google-cloud-sdk path and completion includes).
- `alias-targets`: every `programs.zsh.shellAliases` target resolves. The
  reader takes `name = "value";` lines from the `shellAliases` block of
  `nix/modules/shared/default.nix` and reports any line it cannot read as a
  failure instead of skipping it. A binary target resolves in a stub PATH; a
  path target is a repo file or allowlisted.
- `profile-owner`: the module declares `programs.starship.enable`,
  `programs.zoxide.enable`, `programs.direnv.enable`, `programs.fzf` and
  `shellAliases`, and no tracked zsh file evals a tool init.
- `guard-behavior`: `.zshrc` sourced with the tools absent exits 0.
- `idempotent`: sourcing `.zshenv` and `.zshrc` twice adds no duplicate PATH
  entries and keeps the PATH value stable.

## How to run

Default mode: a missing zsh prints SKIP; the script exits 0.

    ./scripts/test-zsh.sh

STRICT mode, for CI: a missing zsh FAILs. CI installs zsh first.

    STRICT=1 ./scripts/test-zsh.sh

Selftest mode mutates copies of `zsh/` (and of the shared module, for the two
checks that read it) and expects each check to FAIL:

    SELFTEST=1 ./scripts/test-zsh.sh

## Runtime and SLA

The script builds fake homes with `mktemp` and runs zsh through `env -i`. A
stub `curl` blocks network calls in the sandbox. Each check prints PASS,
FAIL, or SKIP with file, reason, and timing. The script finishes in under
2 s; selftest mode takes about 5 s. The SLA is 30 s.

## Coverage result

The suite enumerates tracked files with `git ls-files`. The repo tracks two
files. Both get checks:

- `zsh/.zshenv`: syntax, no PATH assignment, the hm-session-vars contract
  (sourced when present, PATH untouched when absent), exit 0, TERM
  leave-alone, no-ghostty, idempotence.
- `zsh/.zshrc`: syntax, no PATH assignment, TERM export in both shell modes,
  no-ghostty, no dead tool block, no eval-based tool init, idempotence.
- `nix/modules/shared/default.nix` (the `zsh/**` sibling this suite reads):
  the program modules, `shellAliases`, and every alias target.

`~/.zshenv`, `~/.zprofile`, and `~/.zshrc` are installed by Home Manager
(`programs.zsh` with `envExtra`/`initContent` reading these two files), so the
suite tests the text, not a stow link.

The `rg`, `ls`, `inv`, `ghd` aliases resolve in the stub PATH. (The former
host-only `dvim` alias was removed with the dead-code cleanup; the allowlist
mechanism stays armed for a future host-only alias.)

The suite tests the shell text and the module that owns the rest. It does not
evaluate the flake, so it cannot prove the generated `~/.zshrc` on its own;
`nix eval --offline '.#homeConfigurations.remote.config.home.file."./.zshrc".text'`
is the manual check for that.

## Known gaps

- The suite never evaluates the flake (CI has no Nix): it reads the module as
  text, so a `programs.*` option renamed upstream is not caught here. The
  deploy switch is the check for that.
- The `vim` and `osc52-copy` definitions are functions, not aliases. The suite
  does not test them.
- zsh built-in default aliases are not repo definitions. The suite does not
  test them.
- The tracked files define no abbreviations. The suite does not test them.
