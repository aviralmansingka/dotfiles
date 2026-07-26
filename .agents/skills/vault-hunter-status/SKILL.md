---
name: vault-hunter-status
description: Observe all Vault Hunter Runs or drill into one Task Run using the aggregate observer, compact Atlas journey viewer, and typed Run Registry CLI. Use when asked for Vault Hunter status, progress, journey stage, participants, live children, evidence, or parent/child costs.
compatibility: Requires Go, jq, and the dotfiles Vault Hunter commands; Herdr is optional for live driver status.
---

# Vault Hunter Status

Read observations only. Never append Registry records, edit the vault, resume work, accept evidence, or infer canonical
completion. The Task note and active Vault Hunter parent remain lifecycle authority.

## Install

```sh
cd ~/dotfiles
mkdir -p ~/.local/bin
go build -o ~/.local/bin/vault-hunter-registry ./cmd/vault-hunter-registry
go build -o ~/.local/bin/vault-hunter-atlas ./cmd/vault-hunter-atlas
ln -sfn "$PWD/scripts/vault-hunter-observe" ~/.local/bin/vault-hunter-observe
```

Require `~/.local/bin` on `PATH`. Verify with:

```sh
command -v vault-hunter-observe vault-hunter-atlas vault-hunter-registry
```

## Observe all Runs

```sh
vault-hunter-observe                 # same as: vault-hunter-observe list
vault-hunter-observe --watch         # every 60 seconds
vault-hunter-observe --watch 5
vault-hunter-observe --color=always  # force the rich dark-cell table
vault-hunter-observe --color=never   # plain text for files and pipes
vault-hunter-observe --json
```

Color defaults to `auto`: rich ANSI styling is used only on a capable TTY and is disabled by `NO_COLOR`, `TERM=dumb`,
redirection, or `--color=never`. JSON is always unstyled. `--watch` requires a terminal, clears and redraws the same
screen on each interval, hides the cursor while active, and restores it on exit; it never appends repeated tables.

Report driver status, latest non-telemetry observation, active/finished children, captured parent/child costs, update
time, Task, and Run ID. State explicitly that costs cover automatically observed usage only and older Runs may be
partial.

## Select one Task

Prefer exact Task title or exact Run ID:

```sh
RUN=$(vault-hunter-observe --json |
  jq -r '.[] | select(.task == "<exact task title>") | .run_id')

vault-hunter-observe run "$RUN"
vault-hunter-observe run "$RUN" --json
vault-hunter-observe run "$RUN" --color=always  # ANSI table for this Run only
```

When the user asks for ANSI status for a specific Run, resolve its exact ID and use `run "$RUN" --color=always`. Preserve
and return the emitted SGR bytes; do not replace the command with JSON or a Markdown table. `run` also supports `--watch`
for a live single-Run view.

If title matching returns zero or multiple IDs, show the candidates and ask the user to choose; never guess.

## Open the compact journey

```sh
vault-hunter-observe atlas "$RUN"
vault-hunter-observe atlas "$RUN" --snapshot --width 100 --height 30
```

Atlas reads one Registry snapshot at startup. Reopen it for fresh observations. Use `j`/Down and `k`/Up to select goals,
Enter to toggle detail, and `q` to quit.

## Inspect the typed Registry record

```sh
vault-hunter-observe record "$RUN"
vault-hunter-observe registry "$RUN"  # alias
```

Parent-authored journey without automatic child/cost telemetry:

```sh
vault-hunter-observe journey "$RUN"
```

Verifier evidence:

```sh
vault-hunter-observe evidence "$RUN"
```

## Reporting

- Label Registry and Atlas values as observations.
- Separate parent usage from synchronous child usage.
- Treat a started child without finished/interrupted telemetry as unresolved, not necessarily live.
- Distinguish a human gate from completion.
- When canonical status is requested, read the exact Task/Feature note after identifying it from the Registry record and
  report any disagreement instead of reconciling it.
