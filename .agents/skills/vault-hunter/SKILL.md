---
name: vault-hunter
description: Drive one canonical vault-backed run while delegating small definite work to bounded Pi subagents. Use when invoked as $vault-hunter with a Feature, Task, Issue, checkbox, or Wayfinder reference.
---

# Vault Hunter

Drive one vault-backed request from the primary Pi session. The parent is the sole lifecycle decision-maker, handoff
acceptor, Run Registry producer, and vault writer. Small definite work defaults to bounded headless `subagent`
children. Use a full Herdr-visible Codex session only when a human benefits from opening, steering, or resuming its
terminal.

## Hard boundaries

- The canonical vault note and the active parent decide status, acceptance, evidence, and completion.
- The Run Registry contains durable observations only. A child process state, Registry state, or Atlas display never
  advances canonical work.
- Children never edit or commit the vault. The parent alone edits the target note, Feature checklist, weekly backlog,
  and checkpoints. Never launch or wait for a child while Run-owned vault edits are uncommitted; keep transient stage
  activity in the Registry and write canonical vault updates only inside an immediate checkpoint envelope.
- Do not edit vault paths owned by another active Vault Hunter Run. If another Run may overlap the target note, Feature
  checklist, weekly backlog, or branch, stop before editing until ownership is unambiguous.
- Keep one writer in an implementation worktree. Parallelize reads, review, and isolated checks, not ordinary writes.
- Preserve unrelated Git, Herdr, Neovim, and filesystem state.
- A formal child is any delegated agent whose result may influence the Run. Launch every formal headless child directly
  through `subagent`; the call is synchronous and does not create a durable Run Registry participant.
- After the parent minimally resolves the invocation target, all mechanical discovery that may inform routing,
  specification, implementation, verification, review, or landing is performed by bounded headless children. The
  parent may validate returned facts but never fills missing discovery itself; launch another bounded child instead.

## Invocation

Accept `$vault-hunter <reference>`, where the reference is a Feature, Task, Issue, checkbox, Wayfinder reference, vault
path, `path:line`, or wikilink. Capture the local invocation time and timezone once.

Before substantive discovery:

1. Resolve only enough vault context to identify the target and owner.
2. Mark the target in progress:
   - Feature: `status: in-progress`
   - Task: Feature checklist `[-]` and linked Task `status: in-progress`
   - Issue or Wayfinder effort: owning note or map `status: in-progress`
3. Add the single weekly backlog entry below.
4. Follow `$vault-hunter-checkpoint` in `invocation` mode with the exact owned vault paths. Commit but do not push.
5. Only after that commit succeeds, call `vault_hunter_run` with the canonical target identity. Store its returned Run ID
   in the same backlog entry on the next accepted vault edit. For an interactive parent, this call atomically resolves
   and validates the current Herdr workspace/tab/pane/terminal tuple and exact Pi session binding; never infer or append
   driver placement separately.
6. If Registry creation or interactive Herdr registration fails, stop before dispatching a formal child.

Before the invocation commit, emit no plan or clarification beyond the host's minimal skill acknowledgment.

### Weekly backlog entry

Use the captured invocation date and `~/vault/3_logs/YYYY-Www/backlog.md`, with ISO week-numbering year and zero-padded
week. Follow `~/vault/AGENTS.md`, reuse the date heading, and create missing scaffolding.

```md
- [-] Vault Hunter — [[<vault-relative-target>|<label>]]
  - Invoked <local date, time, and timezone> from `$vault-hunter <reference>`.
  - Registry: `<run-id>`
  - Recap: <optional one-sentence frontier or outcome>
  - Timeline
    - Done — Invocation lifecycle committed
    - Active — <current stage>
    - Pending — <later stage>
```

Use one root checkbox. Timeline rows are plain nested bullets with `Done`, `Active`, `Pending`, or `Blocked`; do not add
nested unchecked boxes. Keep one Active stage. Update this entry in place under its original invocation date on resume.
Commit backlog edits only with an owned lifecycle checkpoint. At completion, make every stage Done and the root `[x]`.

## Runtime router

Choose the cheapest runtime that preserves the stage's real needs.

| Work | Default | Escalate to full Herdr Codex only when |
|---|---|---|
| Exact lookup, Git/CI status, baseline command, hash, immutable check | `delegate` via `subagent` (configured Luna/low) | Authentication or live operator interaction is required |
| Mechanical context inventory: hierarchy, repository, instructions, Git state, and key paths | `delegate` via `subagent` (configured Luna/low) | Never escalate for synthesis; return a compact evidence pack and stop |
| Specification draft and verifier judgment | `context-builder` via `subagent` (configured strong model), accepted context pack plus exact canonical files | A concrete ambiguity requires live human exploration, or the same terminal must remain open across a human checkpoint |
| Implementation or approved fix slice | `worker` via `subagent`, exact worktree | A manual UI/demo or live steering is materially useful |
| Independent review | `reviewer` via `subagent`, no edits | The human explicitly wants to inspect or interact with the reviewer |
| Refactor judgment | `reviewer` headlessly; one `worker` only for accepted changes | The investigation is genuinely exploratory and interactive |
| Pure human approval checkpoint | Parent | Never delegate |
| Interactive prototype, TUI/manual acceptance | `$vault-hunter-worker` | Always use Herdr for this row |
| Vault edits, acceptance, lifecycle decisions, Registry decisions | Parent | Never delegate |
| Checkpoint Git envelope | Parent follows `$vault-hunter-checkpoint` | Never delegate merely for visibility |

Do not encode a whole Task Run as one subagent chain. Launch one formal stage at a time so the parent can inspect the
handoff, record its decision, and choose the next stage. Independent read-only jobs may run in parallel as separate
`subagent` calls. Never launch parallel writers into the same worktree.

## Formal child contract

### Headless child

Call `subagent` once per child with the chosen agent, exact cwd/worktree, and a compact prompt containing the stable
Goal ID and role, outcome, accepted inputs and exact file allowlist, invariants, validation, output shape, and stop rules.
Permit only directly relevant imports, callers, and tests beyond that allowlist. Do not request external research unless
the stage explicitly requires it. Include Ponytail constraints directly in implementation/fix prompts and the exact
check contract directly in validation prompts because children start with no inherited context or skills.

Before launch, inspect the selected agent's configured model and tools. If a required capability is unavailable, choose
a compatible configured agent or stop before spawn; optional unavailable tools must not turn a completed bounded
handoff into a failed formal stage.

The call runs synchronously in an isolated Pi process and returns only its result. It creates no durable child session,
Registry participant, restart replay, pause/resume control, or background completion signal. Do not claim Registry-backed
child evidence for these children. If a writer call is interrupted or fails ambiguously, quarantine its cwd, inspect the
worktree delta, and do not launch a replacement writer until no child process remains or the Run is explicitly blocked.

A useful handoff reports changed paths, commands and exit codes, commit/tree when applicable, concise findings,
remaining risks, and decisions requiring the parent. Child completion is not acceptance. If the formal child exits
failed after producing an apparently complete artifact, do not accept it directly: launch one `delegate` read-only
validator to report only the artifact hash and required shape, repository
cleanliness, and exact runtime error. The parent alone decides whether the failure is independent of the result and
whether to accept the artifact.

### Herdr-visible child

Use `$vault-hunter-worker` only for a router exception. Immediately after its validated launch, call
`vault_hunter_record` with one participant containing the complete Herdr workspace/tab/pane/terminal tuple and exact
agent-session identity. Never record a partial Herdr tuple or consume its handoff before registration. If registration
fails, stop and close only the captured tab. Record terminal state separately. Keep a genuinely interactive session open
when continuity is required; otherwise close only its captured owned tab after accepting the handoff.

### Parent observations

After evaluating a handoff, call `vault_hunter_record` with a unique deterministic event ID to record the parent's
accepted, rejected, blocked, or superseded decision. Include the accepted tree/hash or event timestamp in that append
ID; keep `Vnn`/`EX01` in `verifierId`, not as the append ID. Reuse the same explicit `observedAt` when retrying a
participant write. Record accepted verifier evidence through the evidence shape. Runtime terminal observations and
parent acceptance observations remain separate. After Run creation, an observation append failure is a reported,
retryable telemetry gap; it never overrides an independently accepted canonical vault decision.

## Resolve and route

Build or reuse one compact context pack before specification judgment. When current accepted evidence does not already
contain it, use a cheap `delegate` to read, in order, the project index, project README, owning Theme, Feature, and
selected Task or Issue, then report only ownership, route, implementation repository, applicable `AGENTS.md`, live Git
state, reusable Task worktree/Herdr state, and exact relevant paths. It makes no specification decisions and stops after
the inventory. Reuse a still-current accepted pack on resume instead of launching another discovery child.

For Feature or Task specification, give the strong `context-builder` that accepted pack plus the exact canonical files.
It follows only directly relevant imports, callers, and tests needed for unresolved contract or verifier questions; it
does not repeat hierarchy/Git discovery, scan the whole repository, or use external research unless a named requirement
cannot otherwise be resolved. Stop after the canonical contract and concrete ambiguities are complete. Ask the user only
if a material ambiguity remains.

Route by target:

- **Feature:** refine stable ordered Tasks and planned observable verifiers, store the accepted plan, then stop before
  implementation.
- **Task:** execute the Task timeline below.
- **Issue or Wayfinder effort:** use result-only headless children for bounded research, let the parent write
  every ticket/map/Feature decision, then stop before implementation. Do not use `wayfinder_subagents` because its AFK
  children write tracker notes and violate this skill's sole vault-writer boundary.

## Canonical Task contract

An executable Task note contains these sections in order:

- `## Intent` — one sentence
- `## Decisions and boundaries` — constraints not expressible by verifiers, or `None`
- `## Verifiers` — stable `V01`, `V02`, … ledger
- `## Unresolved decisions` — genuine blockers, or `None`
- `## Evidence` — PR, merge, post-merge, and cleanup evidence

Draft every verifier before coding. Each entry names externally observable behavior, exact command or manual
observation, expected baseline-red behavior, one immutable task-qualified evidence ID `Tnn.Vnn.EX01`, and Latest state.
`EX01` is the accepted successful run only: command/manual check, timestamp, result, implementation commit/tree, and
transcript or artifact SHA-256. Replace it in place when superseded; never add `EX02` or separate red/provenance/rerun
evidence items.

## Task timeline

Maintain one continuous backlog timeline. For each stage: record parent activation, dispatch through the router, inspect
the handoff and repository evidence, record the parent decision, then update the Task note and backlog. The parent may
perform small mechanical reads only to validate a handoff; if required evidence is missing, it launches another bounded
child rather than discovering the answer itself. It does not redo delegated investigation or implementation.

### Specification and checkpoint one

Use a headless strong-model `context-builder` for the specification draft unless the work itself requires an interactive
prototype or manual UI evaluation. Give it the accepted compact context pack and canonical Task files so it spends its
context on contract and verifier judgment rather than rediscovery. Produce the canonical Task contract and complete
verifier ledger. After accepting the handoff, the parent writes the Task and backlog updates and immediately follows
`$vault-hunter-checkpoint` in `one` mode without
yielding, launching another child, or leaving Run-owned vault changes uncommitted. Push the invocation and Task-note
commits directly; never open a vault PR.

Stop before implementation. Mark `Blocked — Awaiting human evaluation`, report the Task link, verifier ledger,
checkpoint commits, and exact decision requested. A pure approval is handled by the parent. When feedback requires more
specification work, launch a new bounded follow-up child with the canonical Task, prior handoff, checkpoint evidence,
and exact feedback. Children cannot be resumed; same-terminal continuity requires a deliberately chosen Herdr exception. Activate V01 only
after the parent accepts the resulting specification.

### One goal per verifier

Before launching an implementation or fix writer, require a clean worktree except for explicitly accepted source
changes. Treat runtime-generated files as owned runtime debris: remove only the current Run's
artifacts when safe, or block the writer. Never silently include runtime artifacts in implementation commits.

For each verifier in order:

1. Launch a bounded check child to prove the original baseline red using `$vault-hunter-check`.
2. If the verifier unexpectedly passes, launch one bounded writer to repair the verifier until it detects the gap.
3. Launch one implementation writer for the smallest approved slice.
4. Launch the check child against the current branch and complete active verifier set.
5. Accept only concrete green evidence, update that verifier's `EX01`, record Registry evidence, then activate the next
   verifier.

An earlier slice may legitimately make a later independently-red verifier green. Accept it; never manufacture failure.

### Refactor gate

After every verifier has been green once, launch a read-only refactor review. If it identifies changes worth doing now,
launch one writer for only those changes. Run the complete declared check set through `$vault-hunter-check`. Defer polish.

### Review convergence

Launch fresh-context independent review children with distinct, non-overlapping angles when useful. Synthesize findings
in the parent. Launch one writer for accepted fixes, strengthen the owning stable verifier when uncovered behavior needs
proof, rerun affected and complete checks, and review again only when material changes warrant it. Stop when no bug or
major specification/architecture violation remains; do not chase optional polish.

### PR, CI, and landing

1. Launch a final check child and refresh each existing `EX01` in place from accepted evidence.
2. Launch a bounded release worker to push implementation and open the PR. Never arm auto-merge.
3. Use `delegate` observer children for discrete CI/approval status reads. Do not keep
   an agent alive merely to poll.
4. Fix CI failures through the same single-writer and verifier loop. Never bypass branch protection or approval.
5. When ready, report and wait for explicit human merge.
6. After merge, launch a bounded check child against a temporary detached worktree at fetched merged main.

### Cleanup and checkpoint two

After accepted post-merge evidence:

1. Confirm no interrupted writer process remains. Synchronous headless children have no Registry participant or durable
   Pi artifact.
2. Close only exact Herdr tabs, workspaces, and bound Neovim workspace tabs captured as created for this Run. If none
   were created, skip Herdr/Neovim cleanup. Preserve reusable and unrelated state.
3. Remove only owned temporary worktrees/branches after ancestry and cleanliness checks.
4. Add final verifier, PR, merge, post-merge, participant, and cleanup evidence to the Task note.
5. Set the Task `status: done`, Feature checklist `[x]`, derive Feature status, and complete the backlog entry.
6. Follow `$vault-hunter-checkpoint` in `two` mode with the exact vault allowlist. Accept completion only after push,
   fetch, and proof that the checkpoint is ancestral to `origin/main`.
7. Record the parent `run/done` observation only after checkpoint two succeeds. It remains observational.

## Resume and disagreement

On resume, use the canonical Task/backlog as authority and the Registry plus live process/worktree evidence as observations.
Continue at the first unfinished canonical stage. If canonical state, Registry observations, and
live runtime disagree, report the mismatch and let the parent decide; never auto-advance, auto-fail, or rewrite the
vault from runtime state.

## Completion

Report the Feature/Task links, Registry Run ID, participant summary, implementation PR and merge state,
accepted verifier and post-merge evidence, backlog entry, vault checkpoint commits, remote-main proof, cleanup evidence,
and preserved unrelated dirty state or deferred polish.
