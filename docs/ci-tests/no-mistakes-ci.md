# No-mistakes: how to use the CI tests

This is the runbook for no-mistakes step agents and gates in this repository.
It tells you which commands to run, which rules to follow, and where the
details live. Read it before you improvise anything.

## Purpose

The repository pins the no-mistakes Test and Lint steps to offline runners
(`.no-mistakes.yaml`). A step agent never invents a test harness. The
2026-10-11 professor-test incident proved the hazard: an improvised live
harness launched a detached tmux server, a real pi session, and nvim
processes that leaked on every retry.

## Commands

- Lint: `scripts/nm-lint.sh`
- Test: `scripts/nm-test.sh`

Both mirror the jobs in `.github/workflows/ci.yml`. They discover targets
with `git ls-files`, so a new test joins them without edits. Both run
offline. `nm-test.sh` skips a suite when a tool is missing (exit 127) and
never hangs; `nm-lint.sh` fails when a lint tool is missing — install the
tool or report the gap.

## What the suites cover

- `pi/.pi/agent/extensions/**/*.test.mjs` — every pi extension domain.
- `scripts/test-*` — zsh, tmux, ghostty, config lint, install smoke,
  no-mistakes install, repo config, repo parity, service units, and the
  pre-wave suites (auto-git-sync, gh-dash-open-pr, herdr-clean-handoff,
  herdr-flash-copy, herdr-annotate-install, pi-live-config,
  pi-hidden-thinking).
- `pi/bin` telegram daemon unittests.
- The nvim and terraform lanes run in CI with their own binaries. On a host
  with `nvim` or `terraform`, you may also run `scripts/test-nvim-*.sh` and
  `scripts/test-terraform.sh`; both self-skip when the binary is absent.

See `docs/ci-tests/README.md` for the per-component coverage table and the
full index of domain docs. Read the domain doc before you change code in
that domain: it lists the contracts the suite pins.

## Rules

1. Run the pinned commands. Do not build a live harness. Do not spawn real
   pi sessions, nvim instances, tmux or herdr servers, or panes.
2. Stay offline. No network, no `$HOME` mutation. The suites are
   deterministic: two runs give the same result.
3. A red test means one of two things: the code broke a pinned contract, or
   the test expectation is wrong. Prove which before you change either.
   Never delete or weaken a test to go green.
4. A skip is not a failure. If a tool is missing, install it or report the
   skip; do not "fix" the suite.
5. Respect the SLA: each test file under 5 s, each entry under 60 s. If a
   suite turns slow, that is a finding — report it.
6. When you add coverage, follow the house pattern: a new
   `scripts/test-<name>.*` entry with a `# Paths:` header (`// Paths:` for
   .mjs), offline and deterministic, dual mode (SKIP by default, FAIL under
   `STRICT=1`), plus a `/simple` doc in `docs/ci-tests/`. The CI and the
   no-mistakes runners pick it up without any list edits.

## Tier 2

Live-environment tests never run in CI and never belong in a gate: see
`scripts/ci-tier2-exclusions.txt`. The mermaid corpus
(`pi/.pi/agent/extensions/mermaid.corpus.mjs`) is a pre-merge local gate; it
needs real binaries and skips cleanly without them.
