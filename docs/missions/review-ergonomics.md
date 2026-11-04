# Review ergonomics: stable decisions, no tool lockout

- Status: `design`
- Applies to: `go/mission` (CLI), `pi/.pi/agent/extensions/missions` (Pi
  extension)
- Mission: `dotfiles/fix-review-ergonomics-stable-decisions-no-tool-lockout`
- Observed: 2026-11-03, mission `dotfiles/telethon-voice-notes`

This document records the observed failures, then defines the contract that S02
and S03 implement. It changes no stored schema. Storage keeps the `checkpoints`
and `pending_checkpoint` keys; the human surface calls them reviews.

This mission has no checkpoints, so it cannot show the defect live. The tests
below are the evidence.

## Observed failure modes

### F1 — A required revision self-invalidates

The owner decision required `--revision`. The ledger advances on every mutation,
including session start, tool start, tool end, and progress. The worker kept
working while the owner read the result. The revision moved from 420 to 436 to
442. Every decision based on a read revision failed with `revision_conflict`.

The revision is a debugging value. It is not a concurrency token: the review id,
the pending checkpoint status, and the evidence hash already identify exactly
what the owner reviewed.

### F2 — The error reveals requirements one at a time

`mission checkpoint` validated `--human`, then `--actor`, then `--note`, then
`--revision`. The owner learned one requirement per attempt. `--note` appeared
only after the first two flags were present. A four-flag command took several
round trips.

### F3 — No stable machine line

`mission show` had no parseable revision on the human surface, and the mission
tool's status summary did not expose one either. The committed `state.md` is a
projection into a git-backed vault, so it lags the live file between
auto-commits. An agent could not hand the owner one command that was correct at
the moment the owner ran it.

Verified 2026-11-04: the JSON record does carry `state.revision`, but no surface
emits a ready `next_command`. The design puts both at the top level of `show`.

### F4 — A pending checkpoint took the worker's tools away

While a checkpoint was pending, the extension refused every non-mission tool.
The worker could not read its own artifact, run a command, or investigate the
defect the owner was reading. The owner had to relay commands by hand.

A review is a gate on progression, not on investigation. Only the transition to
the next step needs the owner.

### F5 — The surface named the wrong thing

The stored name `checkpoint` appeared in prompts, panel labels, and errors, but
the owner makes a review decision on an attempt result. The two words made the
panel and the skill disagree.

## Design principles

- P1 — The owner surface is one stable command. It never needs a ledger value.
- P2 — A review gates progression, not tools.
- P3 — One error lists every requirement, with a copy-paste example.
- P4 — The machine surface gives one command that is correct now, or `null`.
- P5 — A decision records a human attestation. No agent tool reaches it.
- P6 — `--json show` is the authority. Never parse `state.md`, and never parse
  the vault history, for a live value.

## Decision contract (human surface)

### Grammar

```
mission checkpoint accept|revise REPO/SLUG [C01] --note TEXT [--actor NAME]
```

Examples:

```
mission checkpoint accept dotfiles/telethon-voice-notes C01 --note "I saw the voice note arrive twice"
mission checkpoint revise dotfiles/telethon-voice-notes --note "Use the user session, not the bot"
```

Rules:

- The first word after `checkpoint` is the decision verb: `accept` or `revise`.
- The review id is optional. When omitted, the single pending review is the
  target.
- When more than one review is pending, the command lists the pending ids and
  refuses.
- `--note` is required and must contain a non-whitespace character.
- `--actor` is optional. Resolution order:
  1. `--actor` when supplied.
  2. `git config --get user.name` in the current directory.
  3. `$USER`.
  4. Error `actor_required`.
- `--human` stays accepted as a deprecated no-op. The decision verb implies the
  attestation.
- `--revision` is accepted only on the legacy form. It is never required, and it
  is never shown on the human surface. A supplied value is checked, then ignored
  after one retry.
- Argument order never matters. Flags may appear before or after the
  positionals.

### Review resolution

The CLI resolves the target inside one vault lock:

1. Read the record.
2. Take `state.pending_checkpoint` as the candidate id.
3. When the owner supplied an id, require that id to equal the candidate.
4. Require `state.checkpoints[id].status == "pending"`.
5. Resolve the revision from the record it just read.

There is no read-then-write window between resolution and mutation, so a
concurrent agent turn cannot invalidate the target.

### Revision and conflict handling

- The review id plus the evidence hash is the concurrency token.
- A conflict exists only when the pending id changed, the review is no longer
  pending, the evidence hash changed, or the brief hash changed.
- When a legacy caller supplies `--revision` and it does not match: re-read once
  and retry. If the retry also mismatches, fail with `revision_conflict` and the
  current revision in the message.
- Never loop more than once.
- A repeated decision with the same review id, decision, note, and actor returns
  the record with `already_decided: true`. It does not append a second
  `Decision` entry.

### Evidence changed during the review

The decision checks `state.checkpoints[id].evidence_hash` against the file. Two
cases exist:

- The worker changed the artifact before the owner decided. Fail with
  `evidence_changed` and
  `next_command = mission review reopen REPO/SLUG C01 --note "Refreshed after the worker fix"`.
- The owner runs `mission review reopen REPO/SLUG [C01] --note TEXT`. The CLI
  rebinds the pending review to the current artifact, records the new hash, and
  returns the new `next_command`.

`review reopen` is an owner command. It never accepts the review. Attestation
still needs the decision verb.

### One error, every requirement

Every refusal for a decision carries all facts the owner needs:

| Code | Message shape | `next_command` |
| --- | --- | --- |
| `review_not_pending` | no pending review; lists pending ids when they exist | `mission show REPO/SLUG` |
| `review_ambiguous` | several reviews are pending; lists each id and question | the decision line with one id |
| `review_id_mismatch` | `C02` is not the pending review; the pending review is `C01` | the decision line with `C01` |
| `note_required` | a note is required to record the decision | the decision line with `--note "..."` |
| `actor_required` | supply `--actor`; `git config user.name` and `$USER` are empty | the decision line with `--actor NAME` |
| `evidence_changed` | the reviewed evidence changed after the review opened | `mission review reopen ...` |
| `brief_changed` | the mission brief changed after the review opened | `mission show REPO/SLUG` |
| `human_required` | legacy form only: `--human` records the attestation | the legacy line with `--human` |

Each message ends with one copy-paste line. Example for `note_required`:

```
error: a note is required to record the decision
  mission checkpoint accept dotfiles/telethon-voice-notes C01 --note "Reviewed the evidence"
```

The command validates every requirement before it returns the first error. It
reports all missing requirements in one message, in this order: review target,
note, actor, evidence, brief.

### Legacy form

The existing form still works for one release:

```
mission checkpoint REPO/SLUG --id C01 --decision accept --human --actor NAME --note TEXT [--revision N]
```

It maps onto the new path. `--human` is required there, `--revision` is
optional, and the same error and retry rules apply. Both forms append the same
`Decision` record.

## Machine contract (`--json show`)

`mission --json show REPO/SLUG` returns the record plus three derived fields.

```json
{
  "ok": true,
  "data": {
    "handle": "dotfiles/telethon-voice-notes",
    "revision": 442,
    "mission": { "...": "unchanged" },
    "state": { "...": "unchanged, including state.revision" },
    "pending_review": {
      "id": "C01",
      "question": "Does the capture cover the retry path?",
      "evidence": "artifacts/003/step-02.md"
    },
    "next_command": "mission checkpoint accept dotfiles/telethon-voice-notes C01 --note \"Reviewed the evidence\""
  }
}
```

Field rules:

- `revision`: integer. Identical to `data.state.revision`. It is the stable
  parse path.
- `pending_review`: object or `null`. Exactly three keys:
  - `id` — the review id, such as `C01`.
  - `question` — the review question from the mission definition.
  - `evidence` — the artifact path, relative to the mission directory.
  - The evidence hash stays internal. It is not part of the contract.
- `next_command`: string or `null`. The single command that advances the mission
  now.
  - Pending review: the accept form of the decision line, with the recorded
    handle and id.
  - No pending review, and the last attempt is reported and unsettled:
    `mission finish REPO/SLUG`.
  - Otherwise: `null`.
- `state.pending_checkpoint` stays for one schema version as a deprecated
  mirror. Its value equals `pending_review.id` when a review is pending.
- `mission --json list` adds `revision` and `pending_review.id` per row, so a
  picker needs no second call.

The agent hands the owner exactly this line:

```
Review C01 is waiting. Decide with:
  mission checkpoint accept dotfiles/telethon-voice-notes C01 --note "Reviewed the evidence"
```

### Human surfaces

The mission panel and the desk render the same facts:

```
review     C01 · Does the capture cover the retry path?     waiting
evidence   artifacts/003/step-02.md
next       mission checkpoint accept dotfiles/telethon-voice-notes C01 --note "Reviewed the evidence"
```

The revision appears on the status line as `rev 442`. It is informational. No
surface asks the owner to type it.

## Review semantics (non-blocking)

### Status rules

| Mission status | Meaning | Worker tools | Next step |
| --- | --- | --- | --- |
| `ready` | a step can be claimed | blocked until a step is active | allowed |
| `running` | an attempt owns the step | allowed | blocked |
| `waiting` | a review follows a non-final step | allowed | blocked |
| `review` | a review follows the final step | allowed | blocked |
| `done` | the mission is complete | allowed | none |
| `failed` | the mission ended in failure | allowed | none |

### The gate

`missionToolBlock` in `core.mjs` gates by status. The rule becomes:

- Inspection tools always pass: `read`, `grep`, `find`, `ls`, `tool_search`,
  `mission`, `run-command`, `mermaid`.
- `waiting` and `review` pass every tool. A pending review never blocks a worker
  tool.
- The only blocked call is `mission` with `action: "finish"` while a review is
  pending. The tool result names the review id and the `next_command`.
- The `ready` rule is unchanged: a session with no active step cannot change
  repository files until it claims a step.
- The CLI is the authority. The extension gate is an early, readable copy of the
  same rule.

Tests must pin all four rows: `edit`, `bash`, and `write` pass during a review;
`mission` with `action: "finish"` is refused.

### Progression gate

`next`, `claim`, `pickup`, and `step edit` refuse while a review is pending. The
error code is `review_pending`. The message names the review id and the
`next_command`. The old code `checkpoint_pending` maps to `review_pending` for
one release.

### Finish gate

`mission finish` refuses while a review is pending, except for the settled
attempt that created the review. That case stays a no-op, as today.

```
error: review C01 is waiting
  Decide with: mission checkpoint accept dotfiles/telethon-voice-notes C01 --note "Reviewed the evidence"
  Or request a revision: mission checkpoint revise dotfiles/telethon-voice-notes C01 --note "..."
```

The owner decision clears the review:

- `accept` moves the mission to `ready` (or `done` after the final step) and
  records the decision.
- `revise` invalidates the reviewed step and every later step, then moves the
  mission to `ready`. Earlier evidence stays in the vault.

### Attestation

- The decision verb records the actor, the note, the review id, the attempt, the
  evidence hash, and the time.
- No agent tool exposes the decision. The `mission` tool has no decision action,
  the extension registers no decision tool, and the skill states that only the
  owner decides.
- The CLI records an attestation, not an authentication. It cannot prove who
  typed the command. It requires a note and an actor for every decision, and it
  keeps the record immutable.
- The deprecated `--human` flag stays accepted so scripts can state the
  attestation explicitly.

## Extension changes

- `panel.mjs`
  - `checkpointArgs` emits the new form:
    `["checkpoint", action, handle, id, "--note", note]`.
  - It drops `--revision` and `--human`, and it omits `--actor` so the CLI
    resolves `git user.name`.
  - Panel labels read `Review`, not `Checkpoint`.
- `core.mjs`
  - `missionToolBlock` implements the table above.
  - `next_command` is passed through from the CLI. The extension never builds
    one.
- `index.ts`
  - The `mission` tool keeps its actions. No decision action is added.
  - The auto-continue injection already stops on a pending review. Keep that
    guard.
  - The context prompt says "reviews" and points to `next_command`.

## Migration note (missions that already use checkpoints)

There is no schema migration.

- Existing missions keep their `checkpoints` map, `pending_checkpoint`, and
  `decisions` list. Read and write paths are unchanged.
- A mission parked in `waiting` or `review` becomes non-blocking as soon as the
  new CLI and extension load. No command, repair, or edit is needed.
- The pending checkpoint is the pending review. The new decision form needs no
  revision.
- Existing decisions stay valid. Repeating a decision returns `already_decided`
  and appends nothing.
- Older binaries read the same `state.md` after the change, because nothing new
  is persisted. New binaries read older missions without a compatibility branch.
- The legacy command form works for one release after the change. Then remove
  `--human`, `--id`, `--decision`, and `--revision`.
- The stored word `checkpoint` stays in field names. Only prompts, panel labels,
  errors, and docs say "review".
- Downgrade path: an older binary still accepts the legacy form. It will require
  `--revision`, so read `state.revision` from `--json show` before you use an
  older binary.

## Acceptance tests for S02 and S03

S02 covers the decision surface and the machine contract:

| Test | Proves |
| --- | --- |
| `TestDecisionNeedsNoRevision` | the new form accepts with no revision, after many agent mutations |
| `TestDecisionRetriesOnceOnRevisionConflict` | a stale legacy revision costs one retry, then succeeds |
| `TestDecisionErrorListsEveryRequirement` | missing note and missing actor arrive in one error with a copy-paste line |
| `TestShowEmitsRevisionPendingReviewNextCommand` | the three derived fields match the record |
| `TestShowNextCommandNullWhenIdle` | `next_command` is `null` with nothing pending |
| `TestDecisionIdempotent` | a repeated decision records one entry |
| `TestLegacyCheckpointForm` | the old form still works and maps to the same record |

S03 covers the non-blocking semantics:

| Test | Proves |
| --- | --- |
| `TestPendingReviewPassesWorkerTools` | `edit`, `bash`, and `write` pass during a review |
| `TestPendingReviewBlocksMissionFinish` | only `mission` with `action: finish` is refused |
| `TestNextRefusedWhileReviewPending` | progression stays closed until the decision |
| `TestFinishErrorNamesReviewAndCommand` | the error carries the review id and `next_command` |
| `TestAcceptClearsReview` | accept opens the mission and records the attestation |
| `TestReviseInvalidatesLaterSteps` | revise reopens the reviewed step and keeps earlier evidence |

## Out of scope

- No new storage schema, and no change to the evidence hashing rules.
- No agent decision path. No auto-accept, no timeout, and no implied consent.
- No change to worktree ownership, launch, settle, or check execution.
- No nested pipeline. The repository's No Mistakes flow stays the shipping gate.
