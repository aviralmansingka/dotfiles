---
name: vault-hunter
description: Drive one canonical vault-backed run while delegating small definite work to bounded Pi subagents. Use when invoked as $vault-hunter with a Feature, Task, Issue, checkbox, or Wayfinder reference.
---

# Vault Hunter

Drive one vault-backed request from the primary Pi session. The parent is the sole lifecycle decision-maker, handoff
acceptor, Run Registry producer, and vault writer. Small definite work defaults to bounded synchronous headless `subagent`
children whose lifecycle is observed automatically. An implementation Task uses one persistent Herdr-visible verifier steward from the first baseline check
through post-merge verification so verifier context is not rebuilt for every `Vnn`; other Herdr-visible sessions remain
router exceptions for work that benefits from opening, steering, or resuming a terminal. For read-only Run discovery,
journey drill-down, participant telemetry, evidence, and cost inspection, follow
`$vault-hunter-status`; status inspection never starts, resumes, accepts, or advances a Run.

## Hard boundaries

- The canonical vault note and the active parent decide status, acceptance, evidence, and completion.
- The Run Registry contains durable observations only. A child process state, Registry state, or Atlas display never
  advances canonical work.
- Children never edit or commit the vault. The parent alone edits the target note, Feature checklist, weekly backlog,
  and checkpoints. Every canonical edit runs under the shared vault checkpoint lock and ends in an immediate exact-path
  commit. Never launch or wait for a child while the lock is held or Run-owned vault edits are uncommitted.
- Primary target notes have one active Run owner. Multiple Runs may share a Feature note, weekly backlog, vault branch,
  and checkout only through the serialized commit flow below; never use shared aggregate paths as a reason to block
  otherwise disjoint Task/Issue owners. Stop only for overlapping primary targets or an unresolved stale lock.
- Keep one active writer in an implementation worktree. The persistent verifier steward may edit only accepted verifier
  paths and must be idle before an implementation/fix writer starts; the implementation writer must be idle before the
  steward repairs a verifier. Parallelize reads, review, and isolated checks, not ordinary writes.
- Preserve unrelated Git, Herdr, Neovim, and filesystem state.
- A formal child is any delegated agent whose result may influence the Run. Launch each formal headless child directly
  through synchronous `subagent`; the runtime hook records technical identity as role `<agent>` and Goal
  `subagent/<agent>`, plus participant, start, finish, hashes, usage, and interruption observations. The parent correlates
  that execution to the stable stage Goal through its decision observation. Child completion remains observational and
  never advances or accepts a formal stage.
- After the parent minimally resolves the invocation target, all mechanical discovery that may inform routing,
  specification, implementation, verification, review, or landing is performed by bounded headless children. The
  parent may validate returned facts but never fills missing discovery itself; launch another bounded child instead.

## Invocation

Accept `$vault-hunter <reference>`, where the reference is a Feature, Task, Issue, checkbox, Wayfinder reference, vault
path, `path:line`, or wikilink. Capture the local invocation time and timezone once.

Before substantive discovery:

1. Resolve only enough vault context to identify the target and owner. Preallocate the stable Registry Run ID and use it
   as the vault lock owner for the entire Run.
2. Call `vault_hunter_preflight` once before any vault edit. It must validate the current Pi session's exact Herdr
   workspace/tab/pane/terminal binding and cwd. If it fails, stop without writing a blocker checkpoint; fix the host
   binding and begin a fresh invocation attempt.
3. Acquire `~/dotfiles/scripts/vault-hunter-vault-lock` with the vault root, Run ID, and exact invocation allowlist. If
   another owner holds it, wait without editing; after acquisition re-read every allowlisted file and current `HEAD`.
4. Mark the target in progress:
   - Feature: `status: in-progress`
   - Task: Feature checklist `[-]` and linked Task `status: in-progress`
   - Issue or Wayfinder effort: owning note or map `status: in-progress`
5. Add the single weekly backlog entry below.
6. Follow `$vault-hunter-checkpoint` in `invocation` mode with the exact lock owner and owned paths. Commit, release the
   lock, but do not push.
7. Only after that commit succeeds, call `vault_hunter_run` with the preallocated Run ID and canonical target identity.
   Store its returned Run ID in the same backlog entry on the next accepted vault edit. This call revalidates and
   atomically registers the preflighted interactive driver placement; never infer or append placement separately.
8. If Registry creation or interactive Herdr registration fails, stop before dispatching a formal child.
9. Use the fixed configured roster (`delegate`, `context-builder`, `worker`, `reviewer`) without spending turns listing or
   inspecting agent capabilities. If the required `subagent` tool or named profile is unavailable, stop before model
   execution; do not improvise another runtime.

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

## Concurrent vault commit flow

Treat the Task/Issue note as the Run's exclusive primary path. Feature notes and weekly backlog files are shared
aggregate paths. Distinct Runs may update them concurrently only by serializing the whole canonical transaction:

1. Acquire `~/dotfiles/scripts/vault-hunter-vault-lock acquire <vault-root> <run-id> <exact paths...>` before reading for
   an edit. The lock is repository-wide across local vault worktrees.
2. Re-read every allowlisted file and `HEAD` after acquisition. Locate this Run's backlog entry and target checklist item
   by exact identity; preserve every other Run's entries and status.
3. Apply only this Run's accepted canonical update. Run the required checks and `$vault-hunter-checkpoint` in
   `invocation`, `one`, `progress`, or `two` mode while retaining the lock.
4. Release only after an exact-path commit leaves no owned staged or unstaged edits. If validation or commit fails,
   retain the lock until the parent repairs or rolls back its partial edit.

Never sleep, ask the user, dispatch a child, or perform implementation work while holding the lock. Never auto-remove a
foreign lock. This is a local-machine lock; cross-machine workers require a separate remote coordination mechanism.

## Runtime router

Choose the cheapest runtime that preserves the stage's real needs.

| Work | Default | Escalate to full Herdr Codex only when |
|---|---|---|
| Exact lookup, Git/CI status, hash, immutable check | `delegate` via `subagent` (configured Luna/low) | Authentication or live operator interaction is required |
| Mechanical context inventory: hierarchy, repository, instructions, Git state, and key paths | `delegate` via `subagent` (configured Luna/low) | Never escalate for synthesis; return a compact evidence pack and stop |
| Task verifier construction, repair, declared checks, complete reruns, and post-merge verification | One persistent `$vault-hunter-worker` verifier steward, registered once and steered one goal at a time | Required for every implementation Task; replace only after a proven terminal failure and explicit parent decision |
| Specification draft and verifier judgment | `context-builder` via `subagent` (configured strong model), accepted context pack plus exact canonical files | A concrete ambiguity requires live human exploration, or the same terminal must remain open across a human checkpoint |
| Implementation or approved fix slice | `worker` via `subagent`, exact worktree | A manual UI/demo or live steering is materially useful |
| Independent review | `reviewer` via `subagent`, no edits | The human explicitly wants to inspect or interact with the reviewer |
| Refactor judgment | `reviewer` headlessly; one `worker` only for accepted changes | The investigation is genuinely exploratory and interactive |
| Pure human approval checkpoint | Parent | Never delegate |
| Interactive prototype, TUI/manual acceptance | `$vault-hunter-worker` | Always use Herdr for this row |
| Vault edits, acceptance, lifecycle decisions, Registry decisions | Parent | Never delegate |
| Checkpoint Git envelope | Parent follows `$vault-hunter-checkpoint` | Never delegate merely for visibility |

Do not encode a whole Task Run as one unattended subagent chain. Launch and steer one formal stage at a time so the
parent can inspect the handoff, record its decision, and choose the next stage. The verifier steward is one registered
session reused across those parent-controlled stages, not permission to run ahead. Independent read-only jobs may run
in parallel as separate `subagent` calls. Never launch parallel writers into the same worktree.

## Formal child contract

### Headless child

Call `subagent` once per child with the chosen agent, exact cwd/worktree, and a compact prompt containing the stable
stage Goal ID, instructional role, outcome, accepted inputs and exact file allowlist, invariants, validation, output
shape, and stop rules. Goal ID and instructional role are child-facing context; the synchronous runtime hook records the
technical tool-call identity under `subagent/<agent>`. Permit only directly relevant imports, callers, and tests beyond
that allowlist. Do not request external research unless the stage explicitly requires it. Include Ponytail constraints
directly in implementation/fix prompts and the exact check contract directly in validation prompts because children
start with no inherited context or skills.

The call is synchronous: inspect its returned handoff directly. Do not call management list/get/status/wait merely to
confirm configured capabilities or completion. Runtime observations capture bounded execution and cost, not canonical
acceptance. If a writer call is interrupted or fails ambiguously, quarantine its cwd, inspect the worktree delta, and do
not launch a replacement writer until no child process remains or the Run is explicitly blocked.

A useful handoff reports changed paths, commands and exit codes, commit/tree when applicable, concise findings,
remaining risks, and decisions requiring the parent. Child completion is not acceptance. If the formal child exits
failed after producing an apparently complete artifact, do not rerun it automatically or accept it directly. Launch
exactly one `delegate` read-only validator through `subagent` to report only the artifact hash and
required shape, repository cleanliness, and exact runtime error. The parent alone decides whether the failure is
independent of the result and whether to accept the artifact.

### Herdr-visible child

After checkpoint-one human approval for an implementation Task, launch exactly one `$vault-hunter-worker` with role
`verifier-steward` in the Task worktree. Its first prompt contains the accepted context capsule, complete verifier ledger,
exact authoritative runtime/source seams, verifier-only edit allowlist, and V01 baseline goal. Immediately after its
validated launch, call `vault_hunter_record` with one participant containing the complete Herdr
workspace/tab/pane/terminal tuple and exact agent-session identity. Never record a partial Herdr tuple or consume its
handoff before registration. If registration fails, stop and close only the captured tab.

Keep that exact verifier session open and idle after every handoff. Send each later baseline, verifier repair, affected
check, complete-suite rerun, final check, and post-merge check as an exact follow-up goal to the same session; never
launch a fresh verifier/check child merely to obtain clean context. Record terminal state and each parent acceptance
separately, but register the participant only once. A timeout is not grounds for replacement. If the session is proven
dead or unreachable, record interruption, preserve its accepted context capsule and finding/check ledger, and obtain an
explicit parent decision before launching one replacement steward. Other Herdr-visible children remain router
exceptions and close after their accepted handoff unless continuity is explicitly required.

### Parent observations

After evaluating a handoff, call `vault_hunter_record` with a unique deterministic event ID to record the parent's
accepted, rejected, blocked, or superseded decision, and set lifecycle `goalId` to the stable stage Goal from the child
prompt. Include the accepted tree/hash or event timestamp in that append ID; keep `Vnn`/`EX01` in `verifierId`, not as
the append ID. Reuse the same explicit `observedAt` when retrying a participant write. Record accepted verifier evidence
through the evidence shape. Runtime observations identify the actual `subagent` tool call; parent observations identify
the canonical stage Goal. They remain separate, and neither automatically advances the other. After Run creation, an observation append failure is a reported,
retryable telemetry gap; it never overrides an independently accepted canonical vault decision.

## Resolve and route

Build or reuse one compact context pack before specification judgment. When current accepted evidence does not already
contain it, use a cheap `delegate` to read, in order, the project index, project README, owning Theme, Feature, and
selected Task or Issue, then report only ownership, route, implementation repository, applicable `AGENTS.md`, live Git
state, reusable Task worktree/Herdr state, and exact relevant paths. It makes no specification decisions and stops after
the inventory. Reuse a still-current accepted pack on resume instead of launching another discovery child.

For Feature or Task specification, give the strong `context-builder` the accepted pack inline plus the exact canonical
files and explicitly mark hierarchy, ownership, Git state, instructions, roster, and relevant paths as settled inputs.
It follows only directly relevant imports, callers, and tests needed for unresolved contract or verifier questions; it
must not repeat settled discovery, inspect agent capabilities, scan the whole repository, or use external research unless
a named requirement cannot otherwise be resolved. The parent validates only changed or decision-critical claims rather
than replaying the inventory. Stop after the canonical contract and concrete ambiguities are complete. Ask the user only
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
the handoff and repository evidence, record the parent decision, then acquire the shared vault lock and update the Task
note and backlog through a `progress` checkpoint. The parent may
perform small mechanical reads only to validate a handoff; if required evidence is missing, it launches another bounded
child rather than discovering the answer itself. It does not redo delegated investigation or implementation.

### Specification and checkpoint one

Use a headless strong-model `context-builder` for the specification draft unless the work itself requires an interactive
prototype or manual UI evaluation. Give it the accepted compact context pack and canonical Task files so it spends its
context on contract and verifier judgment rather than rediscovery. Produce the canonical Task contract and complete
verifier ledger. After accepting the handoff, the parent acquires the shared vault lock, re-reads the canonical files, writes the Task and
backlog updates, and immediately follows `$vault-hunter-checkpoint` in `one` mode without yielding, launching another
child, or leaving Run-owned vault changes uncommitted. Push the invocation and Task-note
commits directly; never open a vault PR.

Stop before implementation. Mark `Blocked — Awaiting human evaluation`, report the Task link, verifier ledger,
checkpoint commits, and exact decision requested. A pure approval is handled by the parent. When feedback requires more
specification work, launch a new bounded follow-up child with the canonical Task, accepted context capsule, prior
handoff, checkpoint evidence, and exact feedback. Children cannot be resumed; same-terminal continuity requires a
deliberately chosen Herdr exception.
After the parent accepts the resulting specification, launch and register the one persistent verifier steward, then
activate V01. Do not launch it before approval or launch another verifier steward for later `Vnn` entries.

### One persistent verifier, one goal at a time

Before launching an implementation or fix writer, require a clean worktree except for explicitly accepted source
changes. Treat runtime-generated files as owned debris: remove only the current Run's
artifacts when safe, or block the writer. Never silently include runtime artifacts in implementation commits.

For each verifier in order, steer the same registered verifier steward and wait for a parent decision between goals:

1. Send the steward the exact original-baseline goal and `$vault-hunter-check` contract for the active `Vnn`.
2. If the verifier unexpectedly passes, send the same steward one verifier-repair goal. It may edit only the accepted
   verifier paths and must return idle after proving the intended baseline red; do not launch a replacement writer.
3. After accepting the baseline, require the steward to be idle, then launch one implementation writer for the smallest
   approved product slice.
4. After the implementation writer returns idle and its handoff is accepted, send the steward the current immutable
   head/tree and exact affected plus active complete check set. It must not reuse results from an older head.
5. Accept only concrete green evidence, record Registry evidence, then acquire the shared vault lock and use a
   `progress` checkpoint to update that verifier's `EX01` and activate the next verifier.

Keep the steward open between `Vnn` entries and provide only the new immutable head, newly accepted decisions, and next
verifier goal; do not resend repository inventories, transcripts, or settled context. An earlier slice may legitimately
make a later independently-red verifier green. Accept it; never manufacture failure.

### Refactor gate

After every verifier has been green once, launch a read-only refactor review. If it identifies changes worth doing now,
launch one writer for only those changes. Send the resulting immutable head and complete declared check set to the same
verifier steward using the `$vault-hunter-check` contract. Defer polish.

### Review convergence

Launch fresh-context independent review children with distinct, non-overlapping angles when useful. Synthesize findings
in the parent. Launch one product writer for accepted product fixes. After that writer is idle, send any accepted
verifier strengthening plus the new immutable head to the same verifier steward; then have that steward rerun affected
and complete checks. Review again only when material changes warrant it. Stop when no bug or major
specification/architecture violation remains; do not chase optional polish.

### PR, CI, and landing

Every implementation PR description must contain these reviewable sections before the Run can reach human merge:

- `## Verifiers` — list every stable `Vnn`, the observable contract, exact command or manual observation, result, and
  accepted commit/tree plus transcript or artifact SHA-256. Do not substitute a generic test summary.
- `## Evidence` — embed or link labeled visual evidence for each changed user-visible state and map every artifact to
  its verifier. Use screenshots by default. Use an MP4 when motion, timing, transitions, or a multi-step interaction is
  the behavior under review. Capture on the actual target platform when platform rendering or integration matters;
  include required dimensions, fallback/error states, and before/after states where relevant.

Every Task PR also gets one reviewed `$lavish` verifier explainer after the ledger is stable. Give each `Vnn` its own
section with a small accessible responsive inline SVG and concise text below it naming what the verifier proves and what
it deliberately leaves out. For terminal, CLI, infrastructure, or agent-workflow Tasks, default to a terminal-first
ANSI/TUI composition using the Gruvbox Material palette and real status semantics; for product UI Tasks, match the
product's design system instead. Diagrams must visualize accepted facts, not invent architecture or substitute for the
exact command/manual evidence.

Include the explainer under `## Evidence` and label it honestly as verifier evidence when it directly visualizes accepted
results, or as a problem/verifier explainer when it only teaches the review surface. Map either label to the relevant
`Vnn`. A generated explainer never replaces screenshots or MP4s required to prove changed user-visible behavior.
Refresh and re-review it after any material verifier or behavior change.

Pin evidence and explainers to the reviewed implementation commit or a durable PR attachment, never a local path,
mutable branch URL, or homelab preview alias, and verify every link loads from the rendered PR. A non-visual change may
use a compact transcript or machine-readable artifact as its behavioral proof, but it still includes the verifier
explainer and retains `## Evidence`. The release worker may not report the PR ready while either section, verifier
mapping, artifact hash, explainer, or required visual state is missing.

1. Send the final complete check set to the same verifier steward and refresh each existing `EX01` in place from
   accepted evidence bound to the reviewed head/tree.
2. Launch a bounded release worker to push implementation, publish the reviewed verifier explainer plus any required
   screenshots or MP4 evidence, and open or update the PR with the complete description contract above. Never arm
   auto-merge.
3. Use one synchronous `delegate` observer child to render/read the live PR description, verify all evidence and explainer links load, and report
   discrete CI/approval status. Do not keep an agent alive merely to poll.
4. Fix CI failures or PR-evidence gaps through the same single-writer and verifier loop. Never bypass branch protection
   or approval.
5. When ready, report the verifier/evidence sections and wait for explicit human merge.
6. After merge, give the same verifier steward the fetched merged-main commit and temporary detached worktree for the
   registered post-merge check; do not launch a fresh check child.

### Cleanup and checkpoint two

After accepted post-merge evidence:

1. Confirm no interrupted writer process remains. Synchronous headless children have observational Registry records but
   no durable controllable Pi artifact. After accepted post-merge evidence, close the exact persistent verifier-steward
   tab and verify its registered agent/session/tab/pane/terminal tuple is gone.
2. Close only other exact Herdr tabs, workspaces, and bound Neovim workspace tabs captured as created for this Run. If none
   were created, skip Herdr/Neovim cleanup. Preserve reusable and unrelated state.
3. Remove only owned temporary worktrees/branches after ancestry and cleanliness checks.
4. Acquire the shared vault lock, re-read the Task, Feature, and backlog, then add final verifier, PR, merge, post-merge,
   participant, and cleanup evidence to the Task note.
5. Set the Task `status: done`, change only this Task's Feature checklist item to `[x]`, re-derive Feature status from the
   now-current full checklist, and complete only this Run's backlog entry.
6. Follow `$vault-hunter-checkpoint` in `two` mode with the exact lock owner and vault allowlist. Accept completion only after push,
   fetch, and proof that the checkpoint is ancestral to `origin/main`.
7. Record the parent `run/done` observation only after checkpoint two succeeds. It remains observational.

## Resume and disagreement

On resume, use the canonical Task/backlog as authority and parent-authored Registry observations as supporting evidence.
Headless child execution cannot be replayed; repeat only the first unfinished canonical stage. If canonical state and
Registry observations disagree, report the mismatch and let the parent decide; never auto-advance, auto-fail, or rewrite
the vault from runtime state.

## Completion

Report the Feature/Task links, Registry Run ID, interactive participant summary, implementation PR and merge state,
accepted verifier and post-merge evidence, backlog entry, vault checkpoint commits, remote-main proof, cleanup evidence,
and preserved unrelated dirty state or deferred polish.
