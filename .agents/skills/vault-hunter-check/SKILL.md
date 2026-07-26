---
name: vault-hunter-check
description: Execute an exact Vault Hunter check set against a named baseline, branch, or merged ref and return timestamped, hashed evidence without choosing checks or editing canonical state. Use when delegated by Vault Hunter verifier, refactor, release-readiness, or post-merge stages.
---

# Vault Hunter Check

Execute declared checks and package their evidence. Do not design verifiers, change implementation, weaken assertions,
interpret product intent, edit the vault, commit, push, merge, or choose additional commands.

## Required input

Require:

- repository and expected clean worktree
- exact commit or ref under test
- ordered commands supplied by the owning stage
- evidence label, such as `T01.V01.EX01` or `post-merge`
- exact transcript and JSON-manifest output paths outside the source worktree
- whether execution must use the existing worktree or a temporary detached worktree
- expected baseline-red or successful outcome

Return an unresolved-input blocker rather than discovering missing commands or widening scope.

## Execute

1. Record UTC timestamp, repository, branch/ref, commit, tree, status, and the exact ordered commands before running.
2. For detached execution, fetch only the named remote ref, create one temporary detached worktree at the fetched
   commit, and verify it is clean. Never switch the Task worktree's branch.
3. Run commands in order without rewriting them. Capture combined output and each exit status in the supplied
   transcript path.
4. Stop on an unexpected result. Do not repair code, tests, environment, or permissions unless the owning stage sends
   a new exact instruction.
5. Record final commit, tree, and cleanliness. For post-merge checks, also record fetched remote commit, parent
   ancestry, and any exact diff scope requested by the owning stage.
6. Hash the transcript with SHA-256 and write the recorded inputs and results to the supplied JSON-manifest path.
7. Remove only a temporary worktree created by this execution and verify its path is gone. Update the manifest with
   cleanup status.

## Handoff

Return only:

- evidence label and expected outcome
- timestamp and exact commands with exit statuses
- relevant concise output
- commit, tree, and requested ancestry or diff-scope facts
- transcript and JSON-manifest paths plus transcript SHA-256
- original and temporary worktree cleanliness/cleanup
- blockers or `None`

Baseline-red output is working evidence, not a second durable evidence item. Only an accepted successful run may
populate the owning verifier's existing `EX01`; the Vault Hunter driver makes that decision and writes the vault.
