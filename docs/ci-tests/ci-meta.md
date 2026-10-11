# CI meta layer

## Purpose

This document explains the CI workflow, `.github/workflows/ci.yml`.

## CI structure and path gating

- `changes` — diffs against the merge base; writes area outputs.
- `lint` — always runs: syntax sweeps plus the CI self-check.
- `pi-tests` — runs only when files under `pi/` or `agents/` change.
- `nvim-tests` — runs only when `nvim/` or `scripts/test-nvim-*` changes.
- `scripts-tests` — runs only when `scripts/`, `systemd/`, `launchd/`,
  `gh-dash/`, a root config, or a declared path changes.
- `ops-tests` — runs only when files under `ops/` change.
- `result` — always reports, with `if: !cancelled()`. Make it the
  required check; a skipped area job does not fail it, a failed one does.

A `ci.yml` change starts every area job; an undeclared `*.md` change
starts none (declared paths beat the strip; no trigger filter, PR #175).

## Discovery and exclusions

CI discovers test files with `git ls-files` globs, never a written list
(PRs #227, #257, #279: hand lists drift; tests go missing silently).

- `pi-tests`: `pi/.pi/agent/extensions/**` and `agents/**` filtered to
  `*.test.mjs`, plus `pi/bin` `test_*.py` via unittest; installs `uv`,
  `lua5.4`, and jiti+typebox on step env.
- `scripts-tests`: `scripts/test-*`, minus routed files; the suffix
  picks the runner — `.mjs` node, `.sh` bash, `.py` python3. The
  nm-install entry runs with `STRICT=1`.
- `nvim-tests`: every `scripts/test-nvim-*.sh`, plus a headless `-u`
  `NONE` spec loop over the top-level specs in
  `nvim/.config/nvim/tests/`. The job builds a pinned treesitter go
  parser (`dap_eval_spec` parses go; runners ship no parser).
- `ops-tests`: `scripts/test-terraform*` with `STRICT=1` (terraform from
  `hashicorp/setup-terraform`); `TF_VALIDATE=1` stays off (it downloads
  providers).

Self-wiring path headers: an entry declares its trigger paths in a
`# Paths:` header (`// Paths:` for `.mjs` entries). The `changes` job
harvests every header into the gate of the job that runs the entry; the
self-check proves it with a synthetic `zsh/**` diff against the real
gate logic.

Live-environment tests stay out of CI via the exclusion table
`scripts/ci-tier2-exclusions.txt` (osc52, PTY render, tmux focus, the
sidekick-dependent mapping spec). The self-check fails on stale entries,
hand-listed tests, dropped routing, or a trigger `paths:` filter.

`scripts/test-extension-loader.mjs` is the loader smoke: it jiti-imports
every `.ts` under `pi/.pi/agent/extensions/` (never `.mjs` modules),
asserts each top-level file exports a default factory (PR #230 class),
checks `settings.json` entries, and bootstraps jiti without env.

## How to run locally

```sh
npm install --prefix /tmp/meta-jiti jiti@2 typebox@1.3.27
export JITI_PATH=/tmp/meta-jiti/node_modules/jiti/lib/jiti.cjs
export NODE_PATH=/tmp/meta-jiti/node_modules
node scripts/test-ci-self.mjs   # self-check
```

## Runtime and SLA

Local timings, serial: `pi-tests` 30 s, `nvim-tests` 10 s, `scripts-tests`
6 s, `lint` 2 s, `ops` 0.1 s — 49 s total. GitHub runs jobs in parallel:
expect 2-3 minutes end to end (target: 5 or less); timeouts make hangs red.

## Known gaps

- apt neovim on noble is 0.9.5 (tree-sitter 0.20.8, parser ABI 14):
  never use it for the nvim lane; the nvim and pi jobs install a
  pinned official tarball (v0.12.6).
- `nvim-tests` runs only the no-plugin specs (`verify-nvim` needs the
  full set); `mermaid.corpus.mjs` needs real binaries — both stay local.
- Many agents share this worktree; tests go red mid-edit and green
  again — a clean checkout tells regressions from WIP.
