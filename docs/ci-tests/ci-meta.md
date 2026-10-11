# CI meta layer

## Purpose

This document explains the CI workflow, `.github/workflows/ci.yml`.

## CI structure and path gating

- `changes` — diffs against the merge base; writes area outputs.
- `lint` — always runs: syntax sweeps plus the CI self-check.
- `pi-tests` — runs only when files under `pi/` or `agents/` change.
- `nvim-tests` — runs only when `nvim/` or a `scripts/test-nvim-*`
  suite changes.
- `scripts-tests` — runs only when `scripts/`, `systemd/`, `launchd/`,
  `gh-dash/`, a root config, or a test-declared path changes.
- `ops-tests` — runs only when files under `ops/` change.
- `result` — always reports, with `if: !cancelled()`. Make it the
  required check; a skipped area job does not fail it, a failed one does.

A `ci.yml` change starts every area job; an undeclared `*.md` change
starts none — a path an entry declares beats the strip. The trigger has
no `paths:` filter (PR #175: it stops a required check from reporting).

## Discovery and exclusions

CI discovers test files with `git ls-files` globs, never a written list
(PRs #227, #257, #279: hand lists drift; tests go missing silently).

- `pi-tests`: `pi/.pi/agent/extensions/**` and `agents/**` filtered to
  `*.test.mjs`, plus `pi/bin` `test_*.py` via unittest; installs `uv`
  and `lua5.4` (run-command compiles recorded Lua chunks).
- `scripts-tests`: `scripts/test-*`, minus routed files; the suffix
  picks the runner — `.mjs` node, `.sh` bash, `.py` python3.
- `nvim-tests`: every `scripts/test-nvim-*.sh`, plus a headless `-u
  NONE` spec loop over `nvim/.config/nvim/tests/` (`pcall` + `cquit`
  turns a failure into a non-zero exit).
- `ops-tests`: `scripts/test-terraform*` with `STRICT=1` (terraform from
  `hashicorp/setup-terraform`); `TF_VALIDATE=1` stays off — it downloads
  providers.

Self-wiring path headers: a `scripts/test-*` entry declares its trigger
paths in a `# Paths:` header (`// Paths:` for `.mjs` entries). The
`changes` job harvests every header into the gate of the job that runs
the entry, so a new entry wires itself. The self-check proves it with a
synthetic diff: a `zsh/**` change must trigger the job that runs
`test-zsh.sh`.

Live-environment tests stay out of CI. The exclusion table
`scripts/ci-tier2-exclusions.txt` holds `test-osc52.sh`,
`test-pi-hidden-thinking-render.py`, `test-sidekick-view-focus.lua`
(live env), plus `herdr_agent_mapping_spec.lua` (sidekick clone). The
self-check fails on stale entries, hand-listed tests, dropped routing,
or a trigger `paths:` filter.

`scripts/test-extension-loader.mjs` is the loader smoke. It jiti-imports
every `.ts` under `pi/.pi/agent/extensions/` and asserts each top-level
file exports a default factory (PR #230 class: one bad file broke every
pi session) and checks the `+extensions/...` entries in `settings.json`.

## How to run locally

```sh
npm install --prefix /tmp/meta-jiti jiti@2 typebox@1.3.27
export JITI_PATH=/tmp/meta-jiti/node_modules/jiti/lib/jiti.cjs
export NODE_PATH=/tmp/meta-jiti/node_modules
node scripts/test-ci-self.mjs            # self-check
```

## Runtime and SLA

Local timings: `pi-tests` 22-26 s, `nvim-tests` 9 s, `scripts-tests` 7 s,
`lint` 2 s, loader smoke 0.2 s. GitHub runs jobs in parallel: expect 2-3
minutes end to end (target: 5 or less); each test has a timeout.

## Known gaps

- `nvim-tests` runs only the no-plugin specs (`verify-nvim` needs the
  full set); `mermaid.corpus.mjs` needs real binaries — both stay local.
- Many agents share this worktree; tests go red mid-edit and green
  again — a clean checkout tells regressions from WIP.
