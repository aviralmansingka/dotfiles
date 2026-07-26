---
name: vault-hunter-checkpoint
description: Commit and optionally push an exact allowlist of Vault Hunter vault changes while preserving unrelated state and verifying required remote-main ancestry. Use only when the main Vault Hunter driver delegates invocation, checkpoint one, or checkpoint two.
---

# Vault Hunter Checkpoint

Own the Git envelope around vault changes already accepted and written by the main Vault Hunter driver. Do not interpret
or edit lifecycle state, Task evidence, Feature status, backlog prose, or any file content.

## Required input

Require:

- checkpoint mode: `invocation`, `one`, or `two`
- vault root and expected branch
- exact path allowlist
- commit message
- expected included lifecycle/evidence changes
- captured invocation date for backlog-path validation

Refuse broad staging such as `git add -A`, `git add .`, or an unspecified path set.

## Shared safety checks

1. Verify vault root, branch, upstream, status, and unresolved merge state.
2. Record unrelated staged, unstaged, and untracked paths. If any unrelated path is already staged, stop without
   changing the index; preservation is more important than forcing the checkpoint.
3. Confirm every allowlisted path exists in the intended added/modified/deleted state.
4. Run `git diff --check` against the allowlisted changes and any project-structure check required by vault
   instructions.
5. Stage only the exact allowlist, require every staged path to be allowlisted, show the staged name/status summary,
   and commit with the supplied message.
6. Return the commit and tree plus preserved unrelated state. Never create a vault pull request.

## Modes

### `invocation`

- Require the lifecycle transition and invocation backlog entry in the same allowlist and commit.
- Do not push.

### `one`

- Require the canonical Task note, complete verifier ledger, invocation lifecycle commit, and matching backlog stage.
- Push the invocation and checkpoint-one commits together.
- Verify the pushed remote contains the checkpoint-one commit.
- Do not activate a verifier or write implementation state.

### `two`

- Require final Task evidence/status, authoritative Feature checklist/status, completed backlog entry, and cleanup
  evidence.
- Require vault `main`; if prepared elsewhere, stop and let the driver explicitly land it on `main` first.
- Push `origin main`, run `git fetch origin main:refs/remotes/origin/main`, and require the checkpoint-two commit to be
  an ancestor of `origin/main`.
- Completion fails when remote-main verification fails.

## Handoff

Return one JSON object containing mode, branch, exact paths, commit, tree, push result, remote ref and ancestry when
required, preserved unrelated state, and blockers. The main Vault Hunter driver alone advances the timeline after
accepting this handoff.
