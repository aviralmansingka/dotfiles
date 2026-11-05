# CI tests — overview and index

This directory holds one `/simple` doc per test domain. This file is the
index: what exists, what it covers, how to run everything, and the rules the
suites follow. Source of record for the CI design: `.github/workflows/ci.yml`
and `docs/ci-test-surfaces.md` (the plan). Landed-fix and issue tracker:
`docs/code-enhancements-from-testing.md`.

## Per-component coverage

pi agent extensions (job `pi-tests`, gated on `pi/**` + `agents/**`):

| Domain | Suite | Coverage | Runtime |
|---|---|---|---|
| Renderer core | tool-call-renderer-public.test.mjs (+ usage, thinking-title, web-fetch, web-search) | see docs/ci-tests/renderer.md | 2.5 s |
| Python tool | python.test.mjs | see docs/ci-tests/python-tool.md | 2.35 s |
| Subagents + editor | interactive-subagents.test.mjs, nvim-open.test.mjs | see docs/ci-tests/subagents.md | 1.1 s |
| User input | user-input/** (10 files) + quiz/explain/ask | see docs/ci-tests/user-input.md | 0.48 s |
| Run-command | run-command.test.mjs | see docs/ci-tests/run-command.md | 1.22 s |
| Lesson journal | md-log / lesson / focus-buffer tests | see docs/ci-tests/journal.md | 3.1 s |
| Practice (problem / conclude) | practice.test.mjs | see docs/ci-tests/practice.md | 0.05 s |
| Mermaid v2 | mermaid.test.mjs | see docs/ci-tests/mermaid.md | 0.44 s |
| Tuicr | tuicr.test.mjs | see docs/ci-tests/tuicr.md | 1.7 s |
| Telegram daemon | pi/bin unittest (155 cases) | see docs/ci-tests/telegram.md | 1.1 s |
| Loader | scripts/test-extension-loader.mjs | 26 factories + 23 nested + settings entries | 0.2 s |
| OpenGateway provider | opengateway.test.mjs | provider registration + model metadata | 0.13 s |
| Missions | missions/missions.test.mjs + scripts/test-missions.sh | see docs/ci-tests/missions.md | under 30 s warm |

Neovim (job `nvim-tests`, gated on `nvim/**`): offline headless harness
(`nvim/.config/nvim/tests/ci/`) + ten entries `scripts/test-nvim-*.sh`;
33 specs green in ~0.74 s. Domains: octo, dap-eval, markdown/mermaid/links,
plugin-configs, ui-shape, picker-actions, ask-pipeline, workspaces,
send-orchestration, base suite. Coverage is inventory-based: every
behavior-relevant export is exercised or listed as a gap in its doc.

Scripts, configs, infra (job `scripts-tests` + `ops-tests`):

| Component | Entry | Checks | Runtime |
|---|---|---|---|
| zsh layer | test-zsh.sh | 19 | 0.42 s |
| tmux + ghostty + terminfo | test-tmux.sh, test-ghostty.sh | 17 + 11 | 0.36 s |
| Config lint (starship, aerospace, git) | test-config-lint.py | 8, 5 files | 0.06 s |
| install.sh | test-install-smoke.sh | 46 | 2.9 s |
| Repo config (skills frontmatter, stow parity, gh-dash, settings, Brewfile, herdr TOML) | test-repo-config.py | 10 | 0.20 s |
| Repo parity (skills store, docs accuracy) | test-repo-parity.py | 3 suites | 0.37 s |
| Terraform invariants | test-terraform.sh | 18 (20 w/ TF_VALIDATE=1) | 0.1–22 s |
| systemd + launchd units | test-service-units.py | 47 | ~0.5 s |
| CI meta (structure, routing, gate matching, discovery) | test-ci-self.mjs | 20 synthetic gate cases | — |
| Merge queue submit helper | test-gh-dash-enqueue-pr.sh | 8, fake gh boundary | 0.1 s |
| Worktree pi runner | test-pi-dev.sh | 19, fake pi on PATH, no live session | 0.9 s |
| rataflow-view + visualize/artifact skills | test-rataflow.py | 9 offline + 16 cargo (opt-in) | 0.05 s |
| justfile build recipes | test-just-build.py | see docs/ci-tests/just-build.md | 0.02 s |

Existing wired suites (pre-wave): auto-git-sync, gh-dash-open-pr,
herdr-clean-handoff, herdr-flash-copy, herdr-annotate-install,
pi-live-config, pi-hidden-thinking. The merge-queue helper joins them; its
flow is `docs/merge-queue.md`.

## Totals

81 discovered tests. Local serial run ≈ 44 s; CI critical path ≈ 2–3 min
(setup dominates) — inside the 5-minute SLA. Two consecutive full rounds
showed zero flakes.

## How to run

Local replication of the CI environment:

```sh
npm install --prefix /tmp/ci-jiti jiti@2 typebox@1.3.27
export JITI_PATH=/tmp/ci-jiti/node_modules/jiti/lib/jiti.cjs \
       NODE_PATH=/tmp/ci-jiti/node_modules
```

- Everything CI runs: read the step scripts in `.github/workflows/ci.yml`
  (the lint job also runs `node scripts/test-ci-self.mjs`).
- One extension suite: `node pi/.pi/agent/extensions/<name>.test.mjs`.
- One scripts entry: `bash|python3|node scripts/test-<name>.*`.
- Terraform validate (network-gated, opt-in): `TF_VALIDATE=1
  STRICT=1 scripts/test-terraform.sh`.

## Rules every suite follows

- Offline, deterministic, hermetic: no network, no live herdr/tmux/nvim
  server, no `$HOME` mutation, no sleeps over 100 ms, fake binaries on PATH
  before import, env saved and restored in `finally`.
- Behavior assertions only — never source-text greps.
- SLA: each test file under 5 s; each entry under 30–60 s; the whole CI
  under 5 min. Every CI invocation is wrapped in `timeout 120`.
- Dual mode: a missing tool means SKIP with a message by default (local),
  and FAIL under `STRICT=1` (CI).
- Self-wiring: a new `scripts/test-*` entry declares `# Paths: <globs>`
  (or `// Paths:` for .mjs) and the changes job routes those paths to the
  job that runs it. No hand-written test lists anywhere.
- Tier 2 (live environment, never in CI) is recorded in
  `scripts/ci-tier2-exclusions.txt`: osc52, hidden-thinking-render,
  sidekick-view-focus, herdr_agent_mapping spec. The mermaid corpus
  (`mermaid.corpus.mjs`) is a pre-merge local gate, not CI.
- Every domain doc follows the `/simple` style with the sections Purpose /
  Overview / What the suite covers / How to run / Runtime and SLA /
  Coverage result / Known gaps.

## Index of domain docs

ci-meta · config-lint · install-smoke · journal · just-build · mermaid · nvim ·
nvim-ask · nvim-dap · nvim-markdown · nvim-octo · nvim-picker ·
nvim-plugin-configs · nvim-send · nvim-ui-shape · nvim-workspaces · ops ·
pi-dev · practice · python-tool · rataflow · renderer · repo-config · repo-parity ·
run-command · subagents · telegram · terminal · tuicr · user-input · zsh
