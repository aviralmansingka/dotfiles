# `/bug-report` skill — design

**Date:** 2026-05-09
**Author:** Aviral Mansingka
**Status:** Design (awaiting user review before plan)

## Goal

Convert a vague bug description into a *minimized, executed, re-verified* reproduction plus a structured investigation prompt that a fresh investigator (human or LLM) can use to find root cause and propose a fix. Models the discipline of a test engineer: nothing advances on assumption; reproduction must be observed, then minimized, then re-verified.

## Non-goals

- Actually fixing the bug. The skill ends by handing off to `superpowers:systematic-debugging` in the same session.
- Filing tickets in external trackers (Linear, GitHub Issues).
- Persisting the report to disk. Output is chat-only (per user preference).

## Triggers

User-invocable skill. Activates on:

- Explicit: `/bug-report` or `/bug-report <one-liner>` (e.g., `/bug-report modal_host_bench doesn't check if s3 files are downloaded before bench start`).
- Implicit phrasings to be matched by the frontmatter `description`:
  - "file a bug for X"
  - "help me reproduce X"
  - "I think there's a bug where…"
  - "X isn't behaving right and I need a clean repro"

## Architecture: rigid phase machine

The skill's spine is a fixed sequence of eight phases. At skill start, Claude creates a `TaskCreate` task per phase. Each phase has an explicit exit criterion; phases MUST NOT close until that criterion is met.

| # | Phase | Exit criterion |
|---|---|---|
| 1 | Triage | User has confirmed which system(s) the bug lives in, picked from a top-3 derived from cwd signals. |
| 2 | Gather repro | A written candidate set of steps covering env, entry point, inputs, expected, observed, frequency, recent changes, adjacent state. |
| 3 | Reproduce | Claude executed the steps and observed the failure — OR Claude and user negotiated an alternative repro path (user-runs-and-pastes, mock, smaller test case) and the alternative is recorded. |
| 4 | Minimize | Repro reduced to smallest reliable form (fewer steps, smaller inputs, fewer dependencies, narrower assertion). |
| 5 | Re-verify | The minimized repro has been executed again, and (a) every step still runs cleanly up to the failure point, AND (b) the *original* observed bug still surfaces. If either fails, return to phase 4. |
| 6 | Hypothesize | 2–4 ranked root-cause hypotheses, each tied to concrete evidence captured in phases 2–5. |
| 7 | Emit prompt | Final structured investigation prompt printed to chat in a single fenced block. |
| 8 | Hand off | Auto-invoke `superpowers:systematic-debugging` with the emitted prompt as input. |

### Hard rules across all phases

- No skipping ahead. If the user's first message contains repro details, still perform Triage explicitly so system identification is on the record.
- One question per turn during Gather and Minimize. Prefer `AskUserQuestion` when the answer space is small; free-form otherwise.
- After every executed command in Reproduce and Re-verify, record `<command> · exit=N · <1–3 line excerpt>`. This becomes the evidence base for hypotheses.

## Phase mechanics

### Phase 1 — Triage

Read signals in this order, stop when 3 plausible systems are found:

1. `git remote -v` and the local repo name.
2. Manifest files: `pyproject.toml`, `package.json`, `Cargo.toml`, `go.mod`, `MODULE.bazel`, `BUILD`/`BUILD.bazel`.
3. Top-level directory names and the first paragraph of any `README`.
4. The bug one-liner itself — match named symbols against modules discovered above (e.g., "modal_host_bench" → directory match).

Present the top-3 via `AskUserQuestion`. The "Other" escape is provided automatically by the tool.

### Phase 2 — Gather repro

Drive a Q&A using a covering checklist (canonical list lives in `SKILL.md`):

- **Environment** — OS, branch/SHA, build mode, relevant tool versions
- **Entry point** — exact command, exact UI action, exact API call
- **Inputs** — args, env vars, files/data, auth state
- **Expected** — what the user thought would happen
- **Observed** — what actually happened (output, error, hang, crash, wrong value)
- **Frequency** — always / N% / saw-once
- **Recent changes** — commits, dep bumps, env changes the user is aware of
- **Adjacent state** — other processes, network conditions, prior commands

Skip items the user already supplied. Multiple-choice (`AskUserQuestion`) when the answer space is small (frequency, mode); free-form for descriptive items.

### Phase 3 — Reproduce

Claude attempts execution of the gathered steps. After each command, record `<cmd> · exit=N · <1–3 line excerpt>` into a running evidence buffer.

When a step fails for an *unrelated* reason (missing dep, missing auth, hardware not present), pause and negotiate:

> "I can't run step 3 because `<reason>`. Options: (a) you run it and paste output; (b) we mock `<thing>`; (c) we cut step 3 and try a smaller path. Which?"

The negotiation outcome is recorded alongside the evidence. The phase closes only when the bug has been *observed* — directly by Claude, or by the user via a negotiated alternative whose output Claude has seen.

### Phase 4 — Minimize

Iterate with the user. Reduction targets, in priority order:

1. Drop steps that don't change the outcome (binary search if many).
2. Shrink inputs — smaller file, shorter string, fewer rows.
3. Remove optional flags and env vars.
4. Tighten the assertion — what is the *narrowest* observable that proves the bug?

Each candidate reduction is treated as a hypothesis to be tested by re-running, not as a guess. Write down what was dropped and why dropping it appeared safe.

### Phase 5 — Re-verify

Run the minimized repro fresh. Two checks must both pass:

- **(a)** Every step in the minimized repro still executes cleanly up to the failure point.
- **(b)** The observed failure is the *same bug* — same error class, same wrong value, same symptom — not a different bug introduced by minimization.

Failure handling:

- If (a) fails: minimization broke the path. Revert to the last working version of the repro.
- If (b) fails: minimization removed something load-bearing. Revert and try a different reduction.

Loop back to phase 4 on either failure. Phase 5 closes only when both (a) and (b) hold.

### Phase 6 — Hypothesize

Produce 2–4 ranked root-cause hypotheses. Each one cites specific evidence from phases 2–5. Format:

> Hypothesis: cache-key collision in `s3_download.py:get_cached_path`. Evidence: minimized repro shows two distinct s3 keys hashing to the same cache filename in step 4 output.

Hypotheses without explicit evidence citations are not allowed.

### Phase 7 — Emit prompt

Print exactly one fenced block to chat with this structure:

```
# Bug investigation: <one-line title>

## System(s)
<systems confirmed in Triage>

## Minimized reproduction
Environment: <os, branch, sha, versions>
Steps:
  1. <step>
  2. <step>
  ...
Expected: <one line>
Observed: <one line>
Frequency: <always | N% | seen-once>

## Evidence captured
- <command> · exit=<N> · <excerpt>
- <command> · exit=<N> · <excerpt>
...

## Repro execution mode
<direct | negotiated: user-runs / mock / reduced-path — explain>

## Hypotheses (ranked)
1. <hypothesis> — evidence: <citation>
2. <hypothesis> — evidence: <citation>
...

## Investigation request
Please find the root cause for the bug above. Start with hypothesis 1.
For each hypothesis, state what file/function to inspect and what observation
would confirm or refute it. Do not propose a fix until root cause is confirmed.
```

### Phase 8 — Hand off

Immediately invoke `superpowers:systematic-debugging` with the emitted prompt as input. The same session continues into investigation.

## Anti-patterns the skill must explicitly forbid

Encoded in `SKILL.md` as a "Red flags" table tied to phases:

- "User already described the bug, skipping Triage." — No. Triage is on the record.
- "Repro looks obvious, I'll skip running it." — No. Phase 3 closes on *observed* failure.
- "Already minimized in my head." — No. Each reduction is a re-run, not a guess.
- "Re-verified by reading the code." — No. Re-verify means re-execute.
- "Hypothesizing before reproduction." — No. Phase 6 cites phase 2–5 evidence.

## Installation

- **File:** `/Users/aviral/dotfiles/claude/.claude/skills/bug-report/SKILL.md`
- **Stow target:** `~/.claude/skills/bug-report/SKILL.md`
- **Codex parity:** out of scope for this iteration. The Codex skills directory currently mirrors only `adding-nvim-language-support` and `vault`. Mirror later if the skill proves useful in Codex contexts.
- **Frontmatter:**
  - `name: bug-report`
  - `description: Use when the user types /bug-report, asks to file/reproduce a bug, or describes a defect they want investigated. Drives a rigid phase machine — triage, gather, reproduce, minimize, re-verify, hypothesize — then auto-hands off to systematic-debugging. Output is chat-only.`

## Out of scope (deferred)

- Persisting bug reports to a file or external tracker.
- Codex mirror.
- Multiple-language coverage beyond what cwd manifest scanning naturally supports.
- A registry of "known systems" — current design relies entirely on cwd signals plus user confirmation.
