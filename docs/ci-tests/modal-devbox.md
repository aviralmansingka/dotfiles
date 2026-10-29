# modal-devbox CI tests

## Purpose

`scripts/test-modal-devbox.py` guards the Modal devbox definition
(`ops/modal-devbox/devbox.py`) offline: it keeps the devbox image in lockstep
with the Packer provisioning pipeline and blocks removed-CLI references and
secret leaks. It runs with no network, no Modal account, no `modal` binary,
and no `$HOME` mutation.

## What the suite covers

- **M1 apt parity.** The Modal `apt_install` set is a superset of the Packer
  list parsed from `ops/packer/scripts/install_system_packages.sh`; extras
  are exactly `openssh-server` + `ca-certificates` (the documented Modal
  additions). Any other drift fails.
- **M2 stow parity.** Every stowed package exists in the pinned dotfiles tree
  (`git ls-tree` of `DOTFILES_REF` — the worktree can drift from the pin);
  the core set (`zsh tmux nvim starship git`) is always stowed; `git` is
  stowed late (after the build-time HTTPS clones, per the `url.insteadOf`
  rewrite).
- **M3 layer discipline.** Every `run_commands` layer carries a
  `# --- Phase N` comment, one per call, at least the 5 Packer phases —
  keeps the cache-stable layer order reviewable.
- **M4 GPU allowlist.** Exactly the research-verified set; B200/B300 stay
  excluded (CUDA 13.1+ constraint, compute-tier pricing).
- **M5 secret hygiene.** No token/key literals (`sk-`, `ghp_`, `AKIA`,
  private-key PEM, …) in `devbox.py`, `entrypoint.sh`, or the runbook.
- **M6 entrypoint structure.** `bash -n` clean; links `nvim-share`,
  `nvim-state`, `cache`, `repos`, `vault` (obsidian.nvim), `zsh_history`
  into `/persist`; execs sshd foreground with password auth off.
- **M7 dotfiles pin.** `DOTFILES_REF` is a full 40-hex SHA on an HTTPS
  GitHub URL.
- **M8 runbook accuracy.** The README mentions the real commands (`devbox ssh`,
  `modal run ops/modal-devbox/devbox.py`, `modal container stop`, `--gpu`)
  and no shipped file references removed CLI groups (`modal proxy`,
  `modal attach`, `modal sandbox`, `interactive_snooze`). The research
  report is exempt — it documents their removal.
- **M9 wrapper structure.** `bash -n` clean over `devbox/.local/bin/devbox`;
  the `ssh`/`start`/`status`/`stop` subcommands, the nohup backgrounded
  launcher, the `::main`/`::status`/`::stop` entrypoint refs, the
  `MODAL_DEVBOX_PY` resolution fallback, the `CONNECT`-line contract, and
  the cached-CONNECT fast path are all present.
- **M10 mason tools.** `MASON_TOOLS` in devbox.py covers every
  `ensure_installed` entry in `nvim/.config/nvim/lua/plugins/mason.lua`
  (the suite's Paths include that file, so edits retrigger it) plus
  `clangd`/`codelldb` from the LazyVim lang extras.

## Selftest

`--selftest` rebuilds the checks against mutated mktemp copies (extra apt
package, `B200` in the allowlist, `git` stowed early, an injected `ghp_`
literal, a broken `--detach` in the wrapper) and proves the matching checks
fail; a clean copy must pass. The real worktree is never touched.

## How to run

```sh
scripts/test-modal-devbox.py              # suite
scripts/test-modal-devbox.py --selftest   # prove checks fail on mutations
```

Runtime ≈ 0.02 s (M6 shells out to `bash -n`). Syntax coverage for
`devbox.py` also comes free from `scripts/nm-lint.sh` (`py_compile` over
tracked Python) and `bash -n` over tracked shell in
`.github/workflows/ci.yml`.
