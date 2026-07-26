---
name: vault-hunter-checkpoint
description: Serialize, commit, and optionally push an exact allowlist of Vault Hunter vault changes while preserving unrelated state and verifying required ancestry. Use only when the main Vault Hunter driver delegates invocation, checkpoint one, progress, or checkpoint two.
---

# Vault Hunter Checkpoint

Own the Git envelope around vault changes already accepted and written by the main Vault Hunter driver. Do not interpret
or edit lifecycle state, Task evidence, Feature status, backlog prose, or any file content.

## Required input

Require:

- checkpoint mode: `invocation`, `one`, `progress`, or `two`
- vault root and expected branch
- stable lock owner, normally the preallocated Registry Run ID
- exact path allowlist used when acquiring the lock
- commit message
- expected included lifecycle/evidence changes
- captured invocation date for backlog-path validation

Refuse broad staging such as `git add -A`, `git add .`, or an unspecified path set.

## Shared lock

The driver must acquire the repository-wide lock before reading canonical state for an edit, hold it across the complete
edit/validation/commit/push envelope, and pass the same owner and allowlist here:

```sh
~/dotfiles/scripts/vault-hunter-vault-lock acquire <vault-root> <owner> <vault-relative-path>...
```

Verify `status` reports the exact owner and path set before touching the index. The lock lives in the shared Git common
directory, so all local vault worktrees serialize on it. Never steal or auto-expire another owner. A stale lock requires
proof that its driver and vault edit are no longer live before an explicit owner-authorized release.

## Shared safety checks

1. Verify the exact lock owner/path set, vault root, branch, upstream, status, and unresolved merge state.
2. Re-read the allowlisted canonical files and current `HEAD` under the lock. Another worker may have committed since
   the driver last observed them; reject stale proposed content rather than overwriting it.
3. Record unrelated staged, unstaged, and untracked paths. If any unrelated path is already staged, stop without
   changing the index; preservation is more important than forcing the checkpoint.
4. Confirm every allowlisted path exists in the intended added/modified/deleted state.
5. Run `git diff --check` against the allowlisted changes and any project-structure check required by vault
   instructions.
6. Stage only the exact allowlist, require every staged path to be allowlisted, show the staged name/status summary,
   and commit with the supplied message.
7. Perform the mode-specific push/ancestry checks while still holding the lock.
8. Release with `vault-hunter-vault-lock release <vault-root> <owner>` only after the commit leaves no owned unstaged or
   staged edits. Retain the lock on pre-commit failure so another worker cannot absorb partial canonical edits.
9. Return the commit and tree plus preserved unrelated state. Never create a vault pull request.

## Modes

### `invocation`

- Require the lifecycle transition and invocation backlog entry in the same allowlist and commit.
- Do not push.

### `one`

- Require the canonical Task note, complete verifier ledger, invocation lifecycle commit, and matching backlog stage.
- Push the invocation and checkpoint-one commits together.
- Verify the pushed remote contains the checkpoint-one commit.
- Do not activate a verifier or write implementation state.

### `progress`

- Enclose every accepted mid-Run canonical update after checkpoint one: verifier evidence, active-stage movement,
  specification feedback, PR/CI state, or another parent-owned lifecycle decision.
- Require the canonical Task/Issue and matching backlog entry; include the Feature note only when its authoritative
  checklist or derived status changes.
- Commit the exact allowlist. Push only when explicitly requested, and if pushed verify the remote contains that commit.
- Never advance another Run's target entry while updating a shared Feature note or weekly backlog.

### `two`

- Require final Task evidence/status, authoritative Feature checklist/status, completed backlog entry, and cleanup
  evidence.
- Require vault `main`; if prepared elsewhere, stop and let the driver explicitly land it on `main` first.
- Push `origin main`, run `git fetch origin main:refs/remotes/origin/main`, and require the checkpoint-two commit to be
  an ancestor of `origin/main`.
- Completion fails when remote-main verification fails.

## Handoff

Return one JSON object containing mode, branch, lock owner/release state, exact paths, starting HEAD, commit, tree, push
result, remote ref and ancestry when required, preserved unrelated state, and blockers. The main Vault Hunter driver alone advances the timeline after
accepting this handoff.
