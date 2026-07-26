---
name: agent-issue-triage
description: Discover, interactively triage, weekly-review, and explicitly create or update ordinary Neovim and Pi Agent vault issues, including from Telegram voice transcripts. Mutations always require preview confirmation.
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
- Telegram voice transcript handling under the explicit-intent policy below

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

## Telegram voice-note policy

**Explicit intent only.** A transcript that merely sounds like a bug, task, or
issue does not create or update an issue. Respond normally; do not run a
mutation preview and do not write to the vault. Treat only a direct request to
create an issue or update an issue as mutation intent. Use the transcript and
message identifier already supplied by the caller. Do not alter Telegram
transport or transcription, and do not add keyword or generalized intent
parsing.

For an explicit create request:

1. Require a named existing owner in `project/feature` form. Never guess a
   project, theme, or feature. A missing, unknown, or multiply resolved owner is
   ambiguous: ask for clarification and perform no write.
2. Confirm the lowercase-hyphen slug, title, user-facing outcome, and smallest
   next action. Preserve the Telegram message identifier and complete
   transcript as source metadata.
3. Generate a no-write preview:

   ```sh
   python3 <skill-directory>/triage.py \
     --vault <vault> --projects <names> \
     --create-owner <project/feature> --slug <slug> --title <title> \
     --outcome <confirmed-outcome> --next-action <confirmed-action> \
     --source-id <telegram-message-id> --transcript <complete-transcript>
   ```

4. Show the complete preview and ask whether to apply that exact creation. Only
   after explicit approval, rerun the same command with `--apply <token>`.
   Return the helper's created vault-relative path. The created note is placed
   in the uniquely resolved feature's `issues/` directory and includes a
   `## Source` block with channel, kind, message ID, owner, and transcript.

For an explicit update request:

1. Require an exact vault-relative issue path or an exact title that resolves to
   one open ordinary issue. Use `--issue <path>` for the former or
   `--issue-reference <exact-title>` for the latter. Resolution is exact, not
   fuzzy. If no issue or multiple issues match, quote the candidates when
   available, ask for an exact path, and perform no preview or write.
2. Follow the interactive triage contract: confirm outcome, next action, and
   disposition; preview one issue; then apply only after explicit approval.
   The helper resolves the identity before producing a confirmation token, so
   an ambiguous reference remains a no-write clarification.

A rejection, uncertainty, missing owner/identity, or anything other than
explicit confirmation ends the mutation attempt without `--apply`.

## Deterministic V02 manual fixture

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

## Deterministic V03 Telegram fixture

`fixtures/telegram-voice-v03/cases.json` is the canonical four-case transcript
fixture. Its vault is isolated from the real vault. From the repository root:

```sh
rm -rf /tmp/t09-v03-vault
cp -R .agents/skills/agent-issue-triage/fixtures/telegram-voice-v03/vault /tmp/t09-v03-vault
cd /tmp/t09-v03-vault
pi --no-session --no-extensions --skill /private/tmp/vh-agent-issue-triage-t09/.agents/skills/agent-issue-triage
```

Present each case's transcript and supplied fields as already-transcribed
Telegram voice-note context, using a fresh vault copy for every case. Expected
manual behavior is: issue-like statement/no intent responds with no mutation;
explicit create under `pi-agent/agent-issue-triage` previews, confirms, creates,
and returns the path with source metadata; exact update previews, confirms, and
changes only `exact-update.md`; ambiguous `Shared Voice Update` asks for an
exact path and writes nothing. These are manual expectations, not an automated
claim about the Telegram conversation or transport.
