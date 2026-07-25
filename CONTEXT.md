# Development Workspace Context

Terms for coordinating Herdr and Neovim while keeping Herdr authoritative for terminal workspace state.

## Language

**Herdr Workspace**:
A project context owned by Herdr, identified by its Herdr workspace ID. It may represent a Git worktree, a primary checkout, or a non-Git directory.
_Avoid_: Neovim workspace, project, worktree when referring to the Herdr object

**Workspace Tab**:
A Neovim tab bound at runtime to exactly one Herdr Workspace. At most one Workspace Tab may be bound to a given Herdr Workspace in a Neovim process.
_Avoid_: project tab, worktree tab

**Unbound Tab**:
A normal Neovim tab with no Herdr Workspace identity. It never causes Herdr focus changes.
_Avoid_: workspace tab

**Workspace State**:
The aggregate agent state reported for a Herdr Workspace by Herdr itself. Neovim displays this state but never derives it from individual agents.
_Avoid_: Neovim status, inferred status

**Worktree**:
A Git checkout whose creation, opening, and removal are owned entirely by Herdr. Neovim does not expose or manage the worktree lifecycle.
_Avoid_: workspace

## Vault Work

**Vault Hunter**:
The skill that routes a Vault Feature, Vault Task, or Wayfinder effort into its appropriate planning or execution flow.
_Avoid_: vault skill

**Vault Hunter Atlas**:
The two-column Herdr view that replaces the bottom-right active-agent panel for a selected Vault Hunter task. Its left
column shows the Task Goal Timeline; its right column shows the selected Verifier Cycle's progress from baseline red
through active green. The bottom-left workspace tree remains unchanged and drives the Atlas selection.
_Avoid_: Goal Inspector, workspace journey

**Feature Run**:
A Vault Hunter run that refines a Vault Feature into an ordered, verifier-backed task plan and stops before task implementation.
_Avoid_: feature execution

**Task Run**:
A Vault Hunter run that executes one Vault Task. A checkbox-only task is first refined from its checkbox and nested bullets through Grill with Docs into a durable task note.
_Avoid_: feature run, raw checkbox execution

**Task Spec**:
The To Spec structure stored in the canonical Vault Task note before execution. It is not published as a separate tracker issue.
_Avoid_: GitHub execution issue, duplicate spec

**Task Goal Timeline**:
The continuous Task Run timeline whose restartable Codex goals cover vault checkpoint one; each Verifier Entry; Refactor Gate; Review Convergence; opening the implementation pull request while capturing final evidence; CI, repairs, merge, and merged-main checks; then workspace and vault cleanup. Final evidence is part of the pull-request goal, not a separate goal. Goal boundaries do not need ordinal labels.
_Avoid_: one monolithic task goal, final-evidence-only goal

**Verifier Cycle**:
One independent Codex goal in a Task Goal Timeline: prove one planned verifier red against the baseline, then update the current verifier and implementation until the complete active verifier set is green. A verifier that already passes on the current implementation remains valid when its baseline-red evidence is preserved.
_Avoid_: artificial failure

**Verifier Entry**:
A stable `V01`, `V02`, … item in a Vault Task note recording one externally observable behavior, its exact check, baseline-red proof, and latest result.
_Avoid_: unnumbered acceptance note

**Refactor Gate**:
The point after every Verifier Entry has reached green once. Refactoring may improve implementation or verifier structure without changing behavior or weakening checks, and the full verifier set must return to green afterward.
_Avoid_: feature expansion

**Review Refactor**:
The post-review pass that fixes every bug found by local code review before the complete verifier set runs again.
_Avoid_: review-only report

**Review Convergence Loop**:
The dedicated Task Goal that repeats local review, Review Refactor, and the complete active-verifier run until no bugs or major spec or architecture violations remain. It may use separate coding and reviewing subagents, and review may add a stable Verifier Entry for newly uncovered behavior; the implementation pull request opens only after convergence.
_Avoid_: one-shot review, opening a pull request with relevant findings

**Pull Request Evidence**:
The links to every implementation pull request created during a Task Run, preserved in the canonical Vault Task note with final merge evidence. Vault updates are committed and pushed directly without a vault pull request.
_Avoid_: terminal-only PR report, vault PR

**Vault Checkpoint**:
One of two pushed Task Run states: the in-progress Task Spec and verifier plan before coding, or the completed evidence after the implementation pull request merges.
_Avoid_: per-cycle vault commit

**Landing Gate**:
The always-present post-PR Task Goal that owns required CI, repairs, auto-merge, and merged-main checks, or mergeable status plus the complete local verifier set when no CI exists. Vault Hunter never bypasses repository protections.
_Avoid_: manual protection bypass

**Workspace Cleanup Gate**:
The final Task Goal where Vault Hunter closes every Herdr tab in the task's Herdr Workspace and every Neovim Workspace Tab bound to it, verifies they are gone, records final task evidence, and pushes the completed vault checkpoint. Other Herdr Workspaces and Unbound Tabs remain untouched.
_Avoid_: closing only the active feature tab, closing unrelated tabs

**Feature Issue**:
A temporary decision or investigation note stored under the owning Vault Feature's `issues/` directory. A Wayfinder effort groups its `map.md` and numbered decision tickets under `issues/<effort>/`; these are Feature Issues, not implementation tasks.
_Avoid_: task, project-wide issue when ownership is known

**Project Issue**:
A temporary issue stored under a Vault Project while its feature ownership is unknown or genuinely cross-feature. Move a Wayfinder effort intact to its owning feature once that ownership becomes clear.
_Avoid_: permanent home for owned work
