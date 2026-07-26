---
name: agent-issue-triage
description: Discover, interactively triage, and weekly-review ordinary Neovim and Pi Agent vault issues. Use for confirmed keep, defer, close, or split decisions; weekly review is read-only.
compatibility: Requires Python 3 and a vault using the 1_projects hierarchy.
allowed-tools: Bash
---

# Agent Issue Triage

Use the `triage.py` helper beside this file as the one discovery and mutation
path. Resolve it from this skill directory; the current directory may instead
be the vault.

Defaults are vault `/Users/aviral/vault` and projects `neovim,pi-agent`. Accept
`--vault` and `--projects` overrides from the skill invocation.

## Modes

- `/skill:agent-issue-triage triage [--vault PATH] [--projects NAMES]`
- `/skill:agent-issue-triage weekly [--vault PATH] [--projects NAMES]`

Start triage by running:

```sh
python3 <skill-directory>/triage.py --vault <vault> --projects <names>
```

Weekly review runs the same command with `--weekly`. It is strictly read-only:
show its deterministic listing and do not offer or perform a mutation. The
listing includes every ordinary non-`done` issue, including deferred issues and
open children made by a split. Closed issues and completed split parents are
excluded because their status is `done`.

## Interactive triage contract

Work on one selected issue at a time.

1. Before asking for a disposition, explicitly ask the user to supply or confirm
   the **user-facing outcome**, then the **smallest next action**. Do this even
   when the note already has values.
2. Only after both are confirmed, ask for `keep`, `defer`, `close`, or `split`.
3. Do not routinely ask for priority or order. Ask only when the user says
   relative scheduling matters or the selected issue/children cannot be placed
   among same-feature siblings without that decision. Otherwise preserve the
   existing values and omit those options.
4. For a split, collect and confirm at least two children. Every child needs a
   lowercase-hyphen slug, title, user-facing outcome, and smallest next action.
   Ask child priority/order under the same limited rule. Put the exact confirmed
   array in a temporary JSON file outside the vault, with keys `slug`, `title`,
   `outcome`, `next_action`, and optional `priority`/`order`.
5. Generate a preview, without `--apply`, using the helper options below. Show
   the complete preview and ask whether to apply **that exact mutation**. A
   rejection, uncertainty, or anything other than explicit approval ends the
   attempt; do not edit files and do not invoke `--apply`.
6. After explicit approval only, rerun the exact preview command with
   `--apply <confirmation-token>`. If the token is stale or a new preview is
   needed, show the new preview and ask again. Never combine multiple issues
   under one confirmation.

Mutation preview shape:

```sh
python3 <skill-directory>/triage.py \
  --vault <vault> --projects <names> \
  --issue <vault-relative-path> --action <keep|defer|close|split> \
  --outcome <confirmed-outcome> --next-action <confirmed-action> \
  [--priority <value>] [--order <integer>] \
  [--children-file /tmp/confirmed-children.json]
```

The helper prints a diff and confirmation token but changes nothing. Use the
same arguments plus `--apply <token>` only after approval. Delete a temporary
children JSON file after the attempt.

`keep` and `defer` preserve the issue's existing non-done status. `close` sets
status to `done`. `split` stages every confirmed child, publishes all children,
and only then sets the parent to `done`; a failed publication rolls back newly
published children and leaves the parent open. Every action records the
confirmed outcome, next action, and disposition in `## Triage`.

Do not infer or implement Telegram or voice-note capture policy.

## Deterministic manual fixture

From the repository root:

```sh
rm -rf /tmp/t09-v02-vault
cp -R .agents/skills/agent-issue-triage/fixtures/manual-vault /tmp/t09-v02-vault
cd /tmp/t09-v02-vault
pi --no-session --no-extensions --skill /private/tmp/vh-agent-issue-triage-t09/.agents/skills/agent-issue-triage
```

Then invoke:

```text
/skill:agent-issue-triage triage --vault . --projects neovim,pi-agent
/skill:agent-issue-triage weekly --vault . --projects neovim,pi-agent
```

Use a fresh fixture copy for each mutation scenario. `keep-candidate.md`,
`defer-candidate.md`, `close-candidate.md`, and `split-candidate.md` provide the
corresponding paths. `already-deferred.md` and `already-closed.md` make weekly
inclusion/exclusion visible before mutation.
