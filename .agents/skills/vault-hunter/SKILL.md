---
name: vault-hunter
description: Execute one autonomous-ready vault Task with a registered three-persona Herdr crew, No Mistakes review and verifier certification, and parent-owned canonical vault decisions. Use when invoked as $vault-hunter with a Task or other work reference; route ambiguous work to $vault-scout.
---

# Vault Hunter

Execute one ready Task. The driving parent owns sequencing, the Run, and every canonical vault mutation. The Crew owns
only exact child process custody and safe process observations. No Mistakes owns independent review and final verifier
certification.

## Domain and authority

- A **Project** contains Themes; a **Theme** contains Features; a **Feature** contains Tasks.
- An **Issue** is unresolved work. A ready **Task** has Goals, stable Verifiers, and required Evidence.
- A **Run** records one execution attempt. The vault remains canonical for hierarchy and status.
- `vault-hunter-run.ts` is the Registry/Atlas adapter. `vault-hunter-crew.ts` owns Herdr child processes. Do not combine
  those responsibilities or treat process completion as acceptance.
- The parent alone writes Task, Feature, backlog, and checkpoint state. Children never edit the vault.
- No Mistakes, not the parent, independently reviews the candidate and records accepted final verifier attempts and
  certification in the Run Registry.

## Admission gate

Continue only when the supplied Task has:

- explicit Goals, boundaries, and resolved decisions;
- stable Verifier IDs with exact commands or manual observations;
- expected evidence and reproduction metadata;
- an implementation repository or bounded non-repository target; and
- a linked prototype, or an explicit reason existing behavior is concrete enough.

If any item is missing, invoke `$vault-scout` and stop before implementation.

## Start the Run

1. Resolve the exact Task and Feature and preserve unrelated state.
2. In Pi, run `agent_run_preflight`, then create or reopen the Run through `atlas_create` and the typed Atlas reads.
   Bind the exact driver session, repository, branch, worktree, and complete Herdr tuple.
3. Create or reuse one Task-owned implementation worktree and one Task-specific Herdr workspace. Every crew child gets
   a dedicated one-pane tab in that same workspace.
4. Write the invocation and checkpoint through `$vault-hunter-checkpoint`. Never let a child write canonical vault
   state.
5. Before any launch or after parent reload/resume/crash, inspect the automatically reconnected crew. Resolve any
   ownership mismatch or active foreign writer before advancing.

## Crew tools and custody

Use only these typed process tools for formal crew personas:

- `vault_hunter_crew_launch`: reserve a tab, start Pi without the Task, register exact ownership, then release the
  bounded prompt.
- `vault_hunter_crew_send`: send one exact follow-up to an existing child.
- `vault_hunter_crew_release`: retain a verifier-builder during grace, close after a validated handoff, or abort incomplete exact Run-owned custody.
- `vault_hunter_crew_inspect`: read bounded safe telemetry; it never certifies work.

A launch is fail-closed and two-phase:

1. reserve one dedicated tab in the parent's exact Herdr workspace;
2. start Pi with no Task prompt, only the child companion extension, no discovered extension commands/skills/templates, and no active model tools; pass Run, Goal, role, journal, participant, and release-token identity by environment;
3. resolve the child Pi session plus workspace, tab, pane, and terminal, and durably register the exact participant and
   worker lifecycle in the Run;
4. release the Task prompt only after registration succeeds; and
5. on any failure, close the exact reserved tab, verify cleanup, and do not allow Task work to begin.

Reject a launch unless recovery completed, the current parent exactly owns the Run/workspace/cwd, and no prior crew persona retains active or unreconciled custody. The three personas run sequentially, so only one crew write lease can exist. Never move, rename, close, or infer ownership of foreign resources.

The parent automatically reconnects live children by exact Run and agent-session identity. A persistent Run-wide crew
widget shows live role, lifecycle, tab, retention, verifier-builder grace, and the latest safe steering summary/hash. Retention restores from durable parent tool history. Prompt Activities remain immutable and
may show only the prompt-local Crew snapshot returned by that tool call.

### Steering and telemetry

The parent is the primary steerer, but direct child-tab steering is allowed. The child companion projects every direct
prompt as only a control-character-free first line (160 characters maximum) plus SHA-256 of the full prompt. Never
mirror the full prompt, raw output, secrets, or reasoning.

Per-child JSONL journals live under `${XDG_STATE_HOME:-~/.local/state}/vault-hunter/crew/<run>/<participant>.jsonl`.
They are mode `0600` in `0700` directories, rotate at 1 MiB, and retain only the current file plus `.1` and `.2`.
Allowed records are identity-safe lifecycle, tool/command summary and argument hash, bounded character-count progress,
numeric usage, steering summary/hash, and final handoff summary/hash plus validated-label presence. Event identity and sequence are fixed to the child, and journal symlinks/non-regular files are rejected. Journal events are process facts, not Registry
truth or evidence acceptance.

Closing a child must close its exact tab, remove all three possible journal files, verify their absence, and record that
cleanup proof. A missing or corrupt journal degrades inspection to exact Registry/Herdr lifecycle only. It never implies
handoff, verifier success, certification, or Task success.

## Three-persona timeline

### 1. Verifier builder

Launch `verifier-builder` first when verifier construction or sharpening is needed. Give it the Task contract, stable
Verifier IDs, baseline, exact paths, output manifest shape, and stop conditions. It may build the declared verifier
boundary and capture baseline-red observations, but it cannot accept evidence or alter canonical state.

After its structured handoff is durable, the widget shows a 30-second grace period. The parent or user may retain it
with `vault_hunter_crew_release { disposition: "retain" }`; otherwise it closes automatically when idle. A retained
verifier-builder requires an explicit close. Do not start convergence until verifier-builder custody has closed.

### 2. Convergence engineer

Launch exactly one `convergence-engineer` with the frozen verifier manifest, baseline facts, allowed implementation
paths, and required checks. It owns the only active implementation write lease. Iterate with
`vault_hunter_crew_send` while its bounded context remains valid.

Require a handoff containing base/head/tree, changed paths, ordered verifier results, artifacts/hashes, risks, and
blockers. Normal close is refused until every required handoff label is durable; use `disposition: "abort"` to close incomplete custody without implying success. Then explicitly close it. **Convergence must hand off and close before delivery starts**; do not suspend its
write tools or leave it open beside delivery.

### 3. Delivery steward

Launch `delivery-steward` only after convergence is closed. It drives the existing No Mistakes gate with the full user
intent and frozen candidate, including review, tests, docs, lint, certification, push, PR, and CI. It does not perform
an extra Hunter-owned review and does not ask the parent to accept verifier attempts individually.

The steward requires a validated labeled handoff and explicit release. Abort, rather than normally close, incomplete delivery custody. Preserve it at an unresolved No Mistakes gate or human
approval boundary; close it only when no follow-up continuity is needed.

## No Mistakes certification boundary

No Mistakes must implement a dedicated `certify` phase with this contract:

1. Run after review findings, fixes, tests, documentation, and lint have settled, and before push, PR, or CI.
2. Freeze and report one candidate commit and tree. Any subsequent fix invalidates certification and returns through
   the existing fix/re-review loop before certifying a new tree.
3. Execute the Task's complete ordered verifier manifest, not only affected checks. Every attempt records verifier ID,
   specification and environment hashes, invocation, command/cwd, candidate commit/tree, timestamps, exit status,
   authenticated result-manifest path/hash, and diagnostics or interruption.
4. Directly append the final `verifier_attempt` observations and `verifier_decision: accepted` observations to the exact
   Run Registry revision. Certification succeeds only when every declared verifier has a passed final attempt on the
   same frozen tree and an accepted decision. Record retry relations and failed/interrupted attempts rather than
   overwriting them.
5. Emit one bounded certification result mapping every Verifier ID to its accepted attempt, manifest hash, candidate
   tree, and Registry revision. The parent consumes that result for canonical evidence/checkpoint writes; it does not
   call `atlas_accept_verifier_attempt` itself.
6. Keep certification failures inside No Mistakes's normal gate/fix/re-review loop. Findings that would change user
   intent cross the existing `ask-user` boundary unless the user supplied standing `--yes` consent.

Do not emulate this phase outside No Mistakes, skip it, or interpret ordinary test success as certification. Until the
external No Mistakes binary implements this contract, delivery is blocked at certification; document the limitation
rather than claiming a certified Run.

## Evidence, landing, and canonical updates

- Use `$vault-hunter-check` for exact frozen checks only when the Task or No Mistakes manifest delegates them.
- Capture user-visible artifacts required by the Task, including ANSI-preserving terminal evidence where applicable.
- After No Mistakes certification, the parent verifies the returned Run/tree mapping and writes Task evidence through
  `$vault-hunter-checkpoint`. The parent does not make per-verifier accept/reject decisions.
- No Mistakes owns push, PR, and CI. Do not bypass required human merge approval.
- After merge, record PR and commit identity, close only exact Run-owned resources, and complete Task/Feature/backlog
  state through checkpoint two. Run post-merge verification only when declared by the Task or requested by the user.

## Stop conditions

Stop on specification ambiguity, overlapping Task ownership, an active foreign or second convergence writer, changed
candidate identity, missing verifier attempts, failed certification, corrupt ownership identity, unsafe Git state,
failed canonical checkpoint, or missing human approval. Preserve live children needed for follow-up and report the exact
frontier. Missing telemetry is never success.

## Handoff

Report Task and Feature links, Run ID, crew participants and closure state, candidate commit/tree, No Mistakes review and
certification result, verifier evidence mapping, PR/merge state, checkpoint commits, journal/resource cleanup proof,
remaining blockers, and preserved unrelated state.
