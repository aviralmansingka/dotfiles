---
name: vault-hunter
description: Execute one autonomous-ready vault Task from any conversation or agent runtime, using bounded workers, recorded verifier evidence, independent review, and parent-owned canonical decisions. Use when invoked as $vault-hunter with a Task or other work reference; route ambiguous or under-specified work to $vault-scout before implementation.
---

# Vault Hunter

Execute one ready Task. Treat Pi, Codex, Herdr, and other agent systems as interchangeable hosts for the same workflow.
The driving parent owns the Run, routing, evidence acceptance, and canonical vault writes.

## Domain

- A **Project** contains Themes; a **Theme** contains Features; a **Feature** contains Tasks.
- An **Issue** captures work that is not ready for autonomous execution.
- A **Task** contains one or more Goals, stable Verifiers, and required Evidence.
- A **Goal** states an outcome. A **Verifier** decides whether it holds. **Evidence** is the reproducible, immutable
  output of running that verifier against a named implementation.
- A **Run** records one attempt to execute a Task.

The vault is canonical for hierarchy and status. The Run Registry records attempts, participants, evidence metadata,
parent decisions, and cost. Atlas displays that state but never advances it. Herdr owns visible process, workspace, and
worktree custody. No Mistakes-style delivery supplies independent diff review, targeted tests, and landing confidence;
it does not replace Hunter authority.

## Admission gate

Accept a Task from any conversation, vault link, path, checkbox, or issue reference. Continue only when it has:

- explicit Goals and boundaries;
- stable Verifier IDs with exact commands or manual observations;
- expected evidence and reproduction metadata;
- resolved decisions and an implementation repository or bounded non-repository target; and
- a linked prototype or an explicit explanation of why existing behavior is concrete enough.

If any item is missing, invoke `$vault-scout` on the source Issue or supplied text and stop before implementation.

## Start the Run

1. Resolve the canonical Task and owning Feature. Preserve unrelated state.
2. Open or resume one Registry Run through the host's available adapter. In Pi, use `vault_hunter_preflight`,
   `vault_hunter_run`, and `vault_hunter_record` as compatibility tools until generic Registry operations replace them.
3. Bind the exact driver, repository, branch, worktree, and Herdr identity when present. A non-Pi or headless Run uses
   the same domain contract without inventing Herdr identity.
4. The parent creates or reuses the Task-owned implementation worktree and a Herdr workspace for implementation,
   review, verification, and delivery workers; `$vault-hunter-worker` receives those exact resources and never
   provisions a route itself. Use a headless route only when the user explicitly requests it or Herdr cannot represent
   the work, and record that exception before launch.
5. Mark only this Task and Feature checklist item in progress, add one weekly backlog timeline, and use
   `$vault-hunter-checkpoint` for serialized vault commits.

Never let a child write the vault. Only the parent accepts or rejects evidence and changes canonical state.

## Execute

Work one Goal and one verifier gate at a time:

1. Capture a small accepted context capsule: Task contract, instructions, base, branch, head/tree, and relevant paths.
2. Run the verifier on the original baseline and record the attempt, including command, exit, tree, artifact reference,
   and SHA-256. Do not require a persistent verifier steward.
3. Launch one bounded implementation worker for the smallest slice that can satisfy the active verifier.
4. Run targeted checks, then the active complete verifier set, against an immutable head/tree.
5. Require every verifier execution—pass, fail, interruption, or retry—to write an immutable Registry attempt.
6. Read the compact Registry result capsule, not raw verifier output. Accept, reject, or supersede the exact attempt.
   If the capsule is insufficient, launch a cheap read-only certification auditor; record its own traced Run and verdict
   before the parent decides.
7. Update Task evidence only after acceptance, then activate the next gate.

An audit-ready signal means sufficient evidence exists to inspect. An auditor verdict is advisory. Only the parent may
certify a verifier or update canonical Goal, Task, or Feature state.

## Agent routing

- Default every delegated worker to the Pi coding agent (`pi`). Do not substitute Codex, Claude, or another runtime
  unless the user explicitly requests it or the task requires a capability Pi cannot provide, such as Codex computer
  use; record the reason before launch.
- Launch implementation, review, verification, and delivery workers as visible, Herdr-tracked `$vault-hunter-worker`
  sessions by default. Headless subagents are the exception for tiny read-only work where visibility adds no value, or
  when the user explicitly requests them; never use a headless writer by default.
- Give every child one Goal, exact inputs, an allowlist, validations, output shape, and stop conditions.
- Use a fresh read-only Pi agent for independent diff review. Pin base, head, tree, and Task contract; require findings
  with severity and path/line, or an explicit clean verdict.
- Name visible sessions `pi-<feature-slug>-<run-key>-<role>`.
- Never run parallel writers in one worktree. Children may produce repository changes and evidence, but not vault
  status, acceptance, or completion decisions.

Registry hooks may observe child lifecycle automatically. Correlate each child with the stable Task Goal and stage;
runtime completion alone is not acceptance.

## Review, evidence, and landing

After all verifiers first pass:

1. Run one independent diff review and fix accepted blocker or major findings.
2. Rerun affected verifiers and the complete declared set.
3. Use `$vault-hunter-check` for exact frozen checks when applicable.
4. For user-visible behavior, capture reviewable screenshots or video. For ANSI-capable CLIs, capture an ANSI-preserving
   terminal screenshot in addition to semantic assertions and transcripts.
5. Open or update the implementation PR with `## Verifiers` and `## Evidence`, mapping every artifact to a stable
   verifier and reviewed commit/tree. Do not bypass required human merge approval.
6. After merge, record the merged PR and commit identity, clean only Run-owned resources, and use
   `$vault-hunter-checkpoint` to complete the Task and backlog on vault `main`. Verify the merged ref only when the Task
   explicitly declares a post-merge verifier or the user requests it.

Use `atlas` for Run status when available. Until Atlas reaches parity, `$vault-hunter-status` is a read-only
compatibility surface. Neither status path may accept evidence or advance work.

## Stop conditions

Stop on unresolved specification ambiguity, overlapping Task ownership, unrecorded verifier output, changed evidence
identity, an active foreign writer, unsafe Git state, failed canonical checkpoint, or missing required human approval.
Record the exact frontier without interpreting missing telemetry as success.

## Handoff

Report the Task and Feature links, Run ID, accepted Goals and verifier evidence, implementation and merge state,
Registry decisions, vault checkpoint commits, cleanup, remaining blockers, and preserved unrelated state.
