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
  private-key PEM, …) in `devbox.py`, `entrypoint.sh`, the runbook, or the
  wrapper.
- **M6 entrypoint structure.** `bash -n` clean; links `nvim-share`,
  `nvim-state`, `nvim-bob` (nvim installs + bob's `used` marker),
  `cache`, `repos`, `vault` (obsidian.nvim), `zsh_history` into `/persist`;
  repoints the `nvim` shim at bob's proxy (`nvim-bin/nvim`); execs sshd
  foreground with password auth off.
- **M7 dotfiles pin.** `DOTFILES_REF` is a full 40-hex SHA on an HTTPS
  GitHub URL.
- **M8 runbook accuracy.** The README mentions the real commands (`devbox ssh`,
  `modal run ops/modal-devbox/devbox.py`, `modal container stop`, `--gpu`)
  and no shipped file references removed CLI groups (`modal proxy`,
  `modal attach`, `modal sandbox`, `interactive_snooze`). The research
  report is exempt — it documents their removal.
- **M9 wrapper contract.** `bash -n` clean over `devbox/.local/bin/devbox`;
  the contract strings that couple it to `devbox.py` (`::main`, `::status`,
  `::stop`, `::snapshot`, the `CONNECT` line format, `MODAL_DEVBOX_PY`) are
  present. Behavior is proven by M16, not by grepping names.
- **M16 wrapper behavior.** Executes the wrapper against stubbed `modal` and
  `ssh` CLIs and asserts real behavior: `--help` usage, unknown-subcommand
  failure, a cold `devbox ssh` starting via `::main` and caching the CONNECT
  line, a warm attach reusing the cache without restarting, `--new` bypassing
  the cache and forwarding start flags, and `devbox stop` clearing the cache.
  This is the check that caught the `--new`-hit-the-cache bug.
- **M10 mason tools.** `MASON_TOOLS` in devbox.py covers every
  `ensure_installed` entry in `nvim/.config/nvim/lua/plugins/mason.lua`
  (the suite's Paths include that file, so edits retrigger it) plus
  `clangd`/`codelldb` from the LazyVim lang extras.
- **M11 manifest schema.** `ops/modal-devbox/secrets-manifest.json` is
  valid JSON covering the planned inventory exactly (`devbox-env`,
  `devbox-mcp-*`, `devbox-telegram`/`-whatsapp`/`-stt-client`,
  `devbox-pi-auth`, `devbox-gh`, `devbox-ssh`, opt-in `devbox-aws`);
  required keys per MODE (`dotenv`/`file`/`command`); sources and targets
  are relative paths under `$HOME`; names unique; variable names are
  valid; no value-looking strings (the suite's SECRET_PATTERNS).
- **M12 sync-script structure.** `scripts/modal-secrets-sync` is executable
  and `bash -n` clean; references `--dry-run`, `--only`, `--aws`, `--force`,
  `umask 077`, `mktemp -d` with a cleanup `trap`/`rm -rf`, and
  `--from-json`; never cats/echoes the temp payload files (values are a
  leak); no token literals.
- **M13 materialization wiring.** `entrypoint.sh` defines the
  `materialize_env`/`materialize_file` helpers (0600 perms, `base64 -d`,
  the guarded `~/.zshenv` include for `GH_TOKEN`) and the
  `#@devbox-materialize@#` marker; `devbox.py` splices manifest-generated
  calls over the marker, probes workspace secrets (`Secret.objects.list()`)
  so a fresh workspace boots, mounts them via `from_name`, and appends the
  ephemeral `DEVBOX_SSH_PUBLIC_KEY` `from_dict` secret **last** (later
  entries win key clashes — research §8.4).

## Selftest

`--selftest` rebuilds the checks against mutated mktemp copies (extra apt
package, `B200` in the allowlist, `git` stowed early, an injected `ghp_`
literal, a wrapper whose `nohup` launch was replaced, a wrapper whose cached
fast path was renamed, a bad manifest mode, a value-looking manifest string,
a name outside the inventory, a removed temp-cleanup trap, a `cat` of the
temp payload in the sync script, 0644 instead of 0600 in the entrypoint, the
ephemeral key secret mounted first, a `-cudnn` CUDA base, an `nvcc` symlink,
and a runbook with `clangd --check` removed, and an entrypoint whose
first-boot seeding was removed) and proves the matching checks
fail; a clean copy must pass. The real worktree is never touched.

## How to run

```sh
scripts/test-modal-devbox.py              # suite (M1–M17)
scripts/test-modal-devbox.py --selftest   # prove checks fail on mutations
```

Runtime ≈ 1 s (M6/M9 shell out to `bash -n`; M16 executes the wrapper and M17
the entrypoint, both in throwaway trees). Syntax coverage for `devbox.py` also
comes free from `scripts/nm-lint.sh` (`py_compile` over tracked Python) and
`bash -n` over tracked shell in `.github/workflows/ci.yml`.
