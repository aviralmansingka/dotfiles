---
name: vault-hunter-status
description: Observe active Vault Hunter Runs or drill into one Task Run through read-only Registry and Atlas projections. Use when asked for Vault Hunter status, progress, journey stage, participants, evidence, or a live single-Run view.
compatibility: Requires Go, jq, and the dotfiles Vault Hunter commands; Herdr is optional for live driver status.
---

# Vault Hunter Status

This is an observation-only workflow over the active Run Registry. It never retires Runs, infers staleness, appends
observations, edits the canonical vault, resumes work, or accepts evidence. Registry and Atlas values are observations;
the canonical vault note and active parent remain authoritative.

## Install

```sh
cd ~/dotfiles
mkdir -p ~/.local/bin
ln -sfn "$PWD/scripts/vault-hunter-observe" ~/.local/bin/vault-hunter-observe
go build -o ~/.local/bin/vault-hunter-status ./cmd/vault-hunter-status
go build -o ~/.local/bin/vault-hunter-registry ./cmd/vault-hunter-registry
go build -o ~/.local/bin/vault-hunter-atlas ./cmd/vault-hunter-atlas
```

`vault-hunter-observe` is the canonical entry point; `vault-hunter-status` remains available as an additional command.
Require `~/.local/bin` on `PATH`, then verify both with `command -v vault-hunter-observe vault-hunter-status`.

## Observe the active Run Registry

```sh
vault-hunter-observe                 # same as: vault-hunter-observe list
vault-hunter-observe --json
vault-hunter-observe --color=never

vault-hunter-status                  # same as: vault-hunter-status list
vault-hunter-status list --json
```

Discovery includes active Runs only; there is no retired fallback or retired listing. `vault-hunter-observe` enriches
Registry observations with exact live Herdr driver correlation plus active/finished child and captured parent/child
usage. `vault-hunter-status` is the Registry-only projection. Redirected `auto` output is plain, and JSON is always
unstyled even with `--color=always`.

## Select one Task Run

Prefer an exact Task title or exact Run ID:

```sh
RUN=$(vault-hunter-observe --json |
  jq -r '.[] | select(.task == "<exact task title>") | .run_id')

vault-hunter-observe run <run-id>
vault-hunter-observe run <run-id> --json
vault-hunter-observe run <run-id> --color=always

vault-hunter-status run <run-id>
vault-hunter-status run <run-id> --json
vault-hunter-status run <run-id> --color=always
```

For a specific Run's ANSI status with live Herdr and usage projection, use
`vault-hunter-observe run <run-id> --color=always`. Use `vault-hunter-status run <run-id> --color=always` for the
Registry-only status row. Both emit real SGR bytes for only that selected Run; preserve those bytes rather than
replacing the output with JSON or a Markdown table. If title matching returns zero or multiple IDs, show the candidates
and ask the user to choose; never guess.

## Inspect one Run

```sh
vault-hunter-status record <run-id>
vault-hunter-status registry <run-id>
vault-hunter-status journey <run-id>
vault-hunter-status evidence <run-id>
vault-hunter-status atlas <run-id>
```

`record` and `registry` are aliases for the full active Run Registry record. `journey` excludes automatic child and
parent-usage telemetry, `evidence` shows verifier observations, and `atlas` reuses the Task Run Atlas projection.

## Watch one Run

```sh
vault-hunter-observe run <run-id> --watch
vault-hunter-observe run <run-id> --watch 5
vault-hunter-status watch <run-id>
vault-hunter-status watch <run-id> --interval=5s
```

Watch is selected-Run-only and requires a TTY. It clears and redraws a bounded view, hides the cursor while active, and
restores the cursor when interrupted. The observer form retains live Herdr and usage projection; the status form shows
the Registry-only row. Both remain read-only and do not invoke orchestration commands.

## Reporting

- Label Run Registry and Atlas values as observations, not canonical status.
- Separate captured parent usage from automatically observed child usage; older Runs may be partial.
- Treat started children without finished/interrupted telemetry as unresolved, not necessarily live.
- Distinguish a human gate from completion.
- When canonical status is requested, read the exact Task or Feature note identified by the record and report any
  disagreement instead of reconciling it.
