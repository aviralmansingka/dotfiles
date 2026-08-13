# Development Workspace Context

Terms for coordinating Neovim workspace tabs with Herdr runtime state while keeping Neovim authoritative for interactive workspace identity.

## Language

**Workspace Tab**:
A Neovim tab that owns a folder identity and its Tab Buffers. It exists independently of Herdr and is the authority used when launching an agent.
_Avoid_: project tab, worktree tab

**Unbound Tab**:
A normal Neovim tab with no folder identity. It never creates or focuses Herdr state.
_Avoid_: workspace tab

**Tab Buffer**:
A normal listed buffer recorded as a member of a Workspace Tab. Membership is established by entering the buffer from that tab and remains until the buffer is deleted.
_Avoid_: global buffer, visible buffer

**Global Buffer**:
A normal listed buffer in Neovim's process-wide buffer registry, regardless of Workspace Tab membership.
_Avoid_: tab buffer

**Herdr Workspace**:
A runtime project context created or reused when an agent launches from a Workspace Tab, identified by its Herdr workspace ID. It may outlive the Workspace Tab that caused its creation.
_Avoid_: Neovim workspace, workspace tab, worktree

**Herdr Binding**:
The optional runtime association from a Workspace Tab to the Herdr Workspace selected or created for its agents.
_Avoid_: workspace tab identity

**Workspace State**:
The aggregate agent state reported for a Herdr Workspace by Herdr itself. Neovim displays this state but never derives it from individual agents.
_Avoid_: Neovim status, inferred status

**Worktree**:
A Git checkout whose creation, opening, and removal are owned entirely by Herdr. Neovim does not expose or manage the worktree lifecycle.
_Avoid_: workspace

## Vault Work

**Vault Hunter**:
The skill that routes ambiguous work to Vault Scout and executes an autonomous-ready Vault Task with a registered, sequential Herdr crew. The driving parent owns Run sequencing and canonical vault mutations; No Mistakes owns independent review and final verifier certification.
_Avoid_: vault skill, parent-owned review or verifier certification

**Run Registry**:
A versioned durable store of immutable Run observations emitted by the active Vault Hunter driver. Schema version 1 retains participant, lifecycle, and evidence histories; schema version 2 adds typed verifier attempts and parent decisions, participants and workers, runtime telemetry, and auditor verdicts. Reader APIs remain forward-readable while producer APIs strictly validate known contracts, and the Registry never becomes the authority for vault lifecycle, goal advancement, acceptance, or completion.
_Avoid_: workflow engine, completion authority

**Atlas**:
A read-only projection of Run Registry observations and live Herdr status. When those sources disagree, Atlas labels recorded and live state separately instead of reconciling or advancing either source.
_Avoid_: run controller, registry writer

**Registered Participant**:
A Task Run participant whose exact Herdr and agent-session identities are recorded in the Run Registry and can therefore be correlated with Atlas.
_Avoid_: any Sidekick row, inferred participant

**Vault Hunter Crew**:
The sequential `verifier-builder`, `convergence-engineer`, and `delivery-steward` processes whose exact Run, Pi session, and Herdr custody is owned by the production crew extension. The Run Registry adapter remains separate, and process completion or telemetry never implies evidence acceptance.
_Avoid_: generic inline subagents, Registry adapter, acceptance authority

**Atlas Companion**:
The read-only Atlas process attached exactly once to an eligible Task Run. T16 owns starting and stopping it; Atlas T03 owns its command and attachment semantics.
_Avoid_: driver, orchestrator

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
The continuous Task Run timeline covers checkpoint one; verifier construction; single-writer implementation convergence; No Mistakes review, documentation, lint, tests, and final verifier certification; push, pull request, CI, and merge; then exact resource cleanup and checkpoint two. Crew personas hand off and close sequentially.
_Avoid_: parallel crew writers, parent-owned delivery review, uncertified landing

**Verifier Cycle**:
The convergence engineer works against a frozen ordered verifier manifest and returns results for a named candidate. No Mistakes later executes the complete manifest against one frozen commit and tree in its dedicated certification phase; any fix invalidates that certification candidate.
_Avoid_: affected-check-only certification, ordinary test success as certification

**Verifier Entry**:
A stable `V01`, `V02`, … item in a Vault Task note recording one externally observable behavior, its exact check, baseline-red proof, and latest result.
_Avoid_: unnumbered acceptance note

**Refactor Gate**:
The point after every Verifier Entry has reached green once. Refactoring may improve implementation or verifier structure without changing behavior or weakening checks, and the full verifier set must return to green afterward.
_Avoid_: feature expansion

**Review Refactor**:
The No Mistakes fix pass that addresses accepted independent-review findings before the candidate returns through review and final verifier certification.
_Avoid_: Hunter parent review, review-only report

**Review and Certification Loop**:
The No Mistakes-owned loop that settles review findings and fixes, then certifies the complete declared verifier manifest on one frozen candidate tree before push, pull request, or CI. The external No Mistakes binary does not yet implement the required `certify` phase, so Vault Hunter delivery remains blocked at that boundary rather than emulating certification.
_Avoid_: generic reviewer substitution, parent acceptance of verifier attempts, claiming current certification support

**Pull Request Evidence**:
The links to every implementation pull request created during a Task Run, preserved in the canonical Vault Task note with final merge evidence. Vault updates are committed and pushed directly without a vault pull request.
_Avoid_: terminal-only PR report, vault PR

**Vault Checkpoint**:
One of two pushed Task Run states: the in-progress Task Spec and verifier plan before coding, or the completed evidence after the implementation pull request merges.
_Avoid_: per-cycle vault commit

**Landing Gate**:
The No Mistakes-owned delivery boundary after successful final verifier certification, covering push, pull request, required CI, repairs, merge, and declared merged-main checks. Vault Hunter never bypasses repository protections, and certification must precede push, pull request, or CI.
_Avoid_: manual protection bypass, landing without certification

**Workspace Cleanup Gate**:
The final Task Goal where Vault Hunter closes every Herdr tab in the task's Herdr Workspace and every Neovim Workspace Tab bound to it, verifies they are gone, records final task evidence, and pushes the completed vault checkpoint. Other Herdr Workspaces and Unbound Tabs remain untouched.
_Avoid_: closing only the active feature tab, closing unrelated tabs

**Feature Issue**:
A temporary decision or investigation note stored under the owning Vault Feature's `issues/` directory. A Wayfinder effort groups its `map.md` and numbered decision tickets under `issues/<effort>/`; these are Feature Issues, not implementation tasks.
_Avoid_: task, project-wide issue when ownership is known

**Project Issue**:
A temporary issue stored under a Vault Project while its feature ownership is unknown or genuinely cross-feature. Move a Wayfinder effort intact to its owning feature once that ownership becomes clear.
_Avoid_: permanent home for owned work
