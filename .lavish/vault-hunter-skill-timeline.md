# Vault Hunter Skill and Decision Timeline

## Goal

Create a repo-local skill that launches work from the Obsidian vault while keeping the vault's Project, Theme,
Feature, Task, Validation, and Issue hierarchy canonical.

## Modes

### Feature Run

1. Load the owning project, theme, and feature.
2. Run Grill with Docs and Domain Modeling.
3. Draft or refine the ordered task plan and stable verifier entries.
4. Update the feature and stop before implementation.

### Task Run

1. Resolve one stable Vault Task.
2. If it is only a checkbox, use its checkbox and nested bullets as input to Grill with Docs and create a task note.
3. Store the To Spec structure in that task note.
4. Draft stable `V01`, `V02`, ... verifier entries.
5. Start a Codex goal that marks the task in progress, commits, and pushes vault checkpoint one.
6. Run each verifier as an independent goal. Prove it red against the baseline; update the current verifier and
   implementation until the active suite is green. An already-green current branch is valid when baseline-red proof
   exists.
7. Start a Refactor Gate goal after every verifier has been green once. Preserve behavior and assertion strength and
   return the full suite to green.
8. Start a Review Convergence goal. Repeat independent review, fixes/refactoring, verifier additions when uncovered
   behavior appears, and the full suite until no relevant issue remains. Use separate coding and reviewing subagents
   when that improves independence.
9. Start a PR goal that captures final verifier evidence, pushes the implementation, opens the PR, and arms auto-merge
   under existing repository policy. Final evidence does not get its own goal.
10. Always start a landing goal. It owns CI, all CI repairs, auto-merge, and checks against merged `main`; when CI is
    already green it completes quickly.
11. Start the final cleanup goal. Close every Herdr tab in the task's Herdr Workspace and every bound Neovim Workspace
    Tab, verify they are gone, add PR/final/post-merge/cleanup evidence to the task note, synchronize statuses, commit
    directly to the vault repository, and push. Do not touch other workspaces or open a vault PR.

### Wayfinder Run

1. Chart a map and numbered decision tickets under `issues/<effort>/`.
2. If feature ownership is unknown, start under the project-level `issues/`.
3. Move the whole effort beneath the owning feature once ownership becomes clear.
4. Promote durable resolutions into the feature.
5. Produce the ordered task and verifier plan, then stop before implementation.

## Durable Vault Artifacts

- `feature.md`: canonical capability and authoritative `TNN` checklist.
- `tasks/NN-<task>.md`: Task Spec, `VNN` verifier ledger, evidence, and implementation PR links.
- `issues/<effort>/map.md`: Wayfinder destination and decision index.
- `issues/<effort>/NN-<decision>.md`: one decision ticket.

## Decisions So Far

1. Vault Hunter orchestrates existing skills rather than replacing the vault hierarchy.
2. Feature Run stops after the task and verifier plan.
3. Checkbox-only Task Runs begin with Grill with Docs and create a durable task note.
4. To Spec supplies structure, but Vault stores it; no duplicate tracker issue is created.
5. Every verifier must prove red on the baseline. It need not be forced red on the current branch.
6. Wayfinder uses feature-local issues rather than implementation tasks.
7. Each Wayfinder effort gets one directory containing its map and numbered tickets.
8. Ownership-unknown Wayfinder work starts in project issues and moves intact when ownership resolves.
9. Task notes use stable `V01`, `V02`, ... verifier entries.
10. Refactoring begins only after the first complete green suite.
11. Local review and Review Refactor repeat until all relevant issues are resolved; review may add verifiers for
    uncovered behavior.
12. Task notes retain implementation PR links; the vault never gets a PR.
13. Vault state is pushed at two checkpoints, not after every verifier cycle.
14. Implementation PRs arm auto-merge and obey existing CI and repository protections.
15. After post-merge checks, the task workspace is automatically cleared from both Herdr and Neovim.
16. The implementation PR opens only after the review/refactor/verifier loop settles.
17. Codex shows one continuous timeline whose restartable goals cover checkpoint one; each verifier; Refactor Gate;
    Review Convergence; PR plus final evidence; always-present CI/landing; then workspace and vault cleanup. Goals do
    not receive ordinal labels.

## Confirmed Goal Timeline

- Final verifier evidence belongs to the PR goal, not a separate goal.
- The post-PR goal always exists and owns CI, repairs, auto-merge, and merged-main checks.
- The final goal owns both workspace cleanup and the completed vault checkpoint.

## Still to Resolve

- Whether Vault Hunter wraps, narrows, or supersedes `work-on-vault-feature`.
- Exact branch/worktree isolation and recovery rules for a general implementation repository.
- Final skill location, trigger description, interface metadata, and forward-test cases.

## Current Documentation Changes

- `CONTEXT.md`: new Vault Hunter vocabulary.
- `.agents/skills/vault/SKILL.md`: feature-local issues, verifier ledger, refactor/review, PR evidence, and checkpoints.
- `/Users/aviral/vault/1_projects/projects.md`: matching canonical vault semantics.
- `.agents/skills/vault-hunter/` now contains the skill contract and Codex interface metadata.
- Vault tasks capture the follow-up eval suite and TUI implementation work.

## Persisted TUI Reference

What should a read-only Vault Hunter TUI emphasize while a human inspects the same task state?

Four reference variants are included in the Lavish artifact and switch with `?variant=A`, `D`, `B`, or `C`:

- **A — Operations Board:** phase rail, active verifier ledger, and evidence pane.
- **D — Vault Hunter Atlas:** a 78-column × 17-row replacement for Herdr's bottom-right active-agent panel. Its
  left column shows the selected task's goal timeline; its right column shows where the selected verifier goal is in
  its baseline-red-to-active-green journey. The bottom-left workspace tree remains unchanged and drives the selection.
- **B — Picker + Preview:** a Snacks-style preview, compact run list, and fuzzy input.
- **C — Execution Journal:** a chronological stream optimized for understanding how the run reached its current state.

Every variant places the active `/goal` directly below the run header and shows the surrounding timeline without
numbering its goals. Active verifier stages use a small live spinner. The flow diagrams use the same restartable
boundaries and terminal theme; their rounded decisions are color-coded, with legends directly below.

The reference borrows the repo's Gruvbox Material palette, compact borders, and Sidekick status vocabulary:
`› working`, `! blocked`, `● done`, and `· idle`. It is the persisted visual source for the TUI implementation
task, not production code itself.

## Verification Note

`/Users/aviral/vault/scripts/verify-project-structure` currently reaches pre-existing missing-wikilink failures. It
reported no failure caused by the new feature-local issue structure.
