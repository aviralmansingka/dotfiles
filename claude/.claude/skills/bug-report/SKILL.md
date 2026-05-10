---
name: bug-report
description: Use when the user types /bug-report, asks to file/reproduce a bug, or describes a defect they want investigated. Drives a rigid eight-phase machine — triage, gather, reproduce, minimize, re-verify, hypothesize, emit prompt, hand off — so vague bug descriptions become minimized, executed, re-verified repros before any investigation begins. Output is chat-only.
---

# Bug Report

Convert a vague bug description into a *minimized, executed, re-verified* reproduction plus a structured investigation prompt that a fresh investigator (human or LLM) can use to find root cause and propose a fix.

This skill models the discipline of a test engineer: nothing advances on assumption. Reproduction must be observed, then minimized, then re-verified.

**Announce at start:** "I'm using the bug-report skill to triage and reproduce <one-line bug summary>."

## When this skill applies

- Explicit invocation: `/bug-report` or `/bug-report <one-liner>`.
- Implicit phrasings:
  - "file a bug for X"
  - "help me reproduce X"
  - "I think there's a bug where…"
  - "X isn't behaving right and I need a clean repro"

## Architecture: rigid phase machine

At skill start, you MUST create a `TaskCreate` task per phase below. Each phase has an explicit exit criterion. **A phase MUST NOT close until that criterion is met.**

| # | Phase | Exit criterion |
|---|---|---|
| 1 | Triage | User has confirmed which system(s) the bug lives in, picked from a top-3 derived from cwd signals. |
| 2 | Gather repro | A written candidate set of steps covering env, entry point, inputs, expected, observed, frequency, recent changes, adjacent state. |
| 3 | Reproduce | You executed the steps and observed the failure — OR you and the user negotiated an alternative repro path (user-runs-and-pastes, mock, smaller test case) and the alternative is recorded. |
| 4 | Minimize | Repro reduced to smallest reliable form (fewer steps, smaller inputs, fewer dependencies, narrower assertion). |
| 5 | Re-verify | The minimized repro has been executed again, and (a) every step still runs cleanly up to the failure point, AND (b) the *original* observed bug still surfaces. If either fails, return to phase 4. |
| 6 | Hypothesize | 2–4 ranked root-cause hypotheses, each tied to concrete evidence captured in phases 2–5. |
| 7 | Emit prompt | Final structured investigation prompt printed to chat in a single fenced block. |
| 8 | Hand off | Auto-invoke `superpowers:systematic-debugging` with the emitted prompt as input. |

## Hard rules across all phases

- **No skipping ahead.** If the user's first message contains repro details, still perform Triage explicitly so system identification is on the record.
- **One question per turn** during Gather and Minimize. Prefer `AskUserQuestion` when the answer space is small; free-form otherwise.
- **Evidence buffer.** After every executed command in Reproduce and Re-verify, record `<command> · exit=N · <1–3 line excerpt>`. This becomes the evidence base for hypotheses in phase 6.
- **No silent edits to the repro.** Every change to the steps — addition during Gather, reduction during Minimize — is announced and acknowledged before being treated as canonical.

## Phase mechanics

### Phase 1 — Triage

Read signals from the cwd in this order, stopping when you have 3 plausible candidate systems:

1. `git remote -v` and the local repo name.
2. Manifest files: `pyproject.toml`, `package.json`, `Cargo.toml`, `go.mod`, `MODULE.bazel`, `BUILD`/`BUILD.bazel`.
3. Top-level directory names and the first paragraph of any `README`.
4. The bug one-liner itself — match named symbols against modules discovered above (e.g., "modal_host_bench" → directory match).

Present candidates via `AskUserQuestion`. The "Other" escape is supplied automatically by the tool.

**Edge cases:**

- **3+ candidates:** show top-3.
- **2 candidates:** show both, plus a synthetic "I'm not sure / something else" option to satisfy the 2–4-option minimum.
- **0–1 candidates:** skip multiple-choice; ask free-form: "I couldn't infer a clear system from cwd. Which system is this bug in?" Once the user answers, record it and proceed.

The phase closes when the user has picked or named a system, and you have written it into the running notes for this bug.

### Phase 2 — Gather repro

Drive a Q&A using this covering checklist. Skip items the user has already supplied. Multiple-choice (`AskUserQuestion`) when the answer space is small; free-form for descriptive items.

- **Environment** — OS, branch/SHA, build mode, relevant tool versions
- **Entry point** — exact command, exact UI action, exact API call
- **Inputs** — args, env vars, files/data that must be present, auth state
- **Expected** — what the user thought would happen
- **Observed** — what actually happened (output, error, hang, crash, wrong value)
- **Frequency** — always / N% / saw-once
- **Recent changes** — commits, dep bumps, env changes the user is aware of
- **Adjacent state** — other processes, network conditions, prior commands

Ask one item per turn. The phase closes when every item above has either an answer from the user or an explicit "not applicable" decision.

### Phase 3 — Reproduce

Attempt execution of the gathered steps. After each command, record one line into the evidence buffer:

```
<cmd> · exit=N · <1–3 line excerpt of output>
```

**Negotiation protocol.** When a step fails for an *unrelated* reason — missing dependency, missing auth, hardware not present, prod-only data, flaky timing — pause and ask:

> "I can't run step N because `<reason>`. Options:
> (a) you run it and paste the output;
> (b) we mock `<thing>`;
> (c) we cut step N and try a smaller path.
> Which?"

Record the chosen option as part of the evidence buffer. If the user runs a step and pastes output, that pasted output counts as observed evidence — copy the relevant lines into the buffer.

The phase closes only when the bug has been **observed** — directly by you, or by the user via a negotiated alternative whose output you have seen and recorded. A described-but-unobserved repro does NOT close the phase.

If after honest negotiation the bug still cannot be observed, stop and tell the user. Do not advance to Minimize on faith.

### Phase 4 — Minimize

Iterate with the user. Reduction targets, in priority order:

1. **Drop steps** that don't change the outcome. If many steps, binary search.
2. **Shrink inputs** — smaller file, shorter string, fewer rows.
3. **Remove optional flags and env vars.**
4. **Tighten the assertion** — what is the *narrowest* observable that proves the bug?

Each candidate reduction is treated as a hypothesis to be tested by re-running, not as a guess. After each attempted reduction, write down what was dropped and why dropping it appeared safe before re-running.

The phase closes when no further reduction can be applied without one of the Re-verify checks failing.

### Phase 5 — Re-verify

Run the minimized repro fresh — start a new shell or clear state where appropriate. Record evidence-buffer lines as in Phase 3.

Two checks must both pass:

- **(a) Steps still run.** Every step in the minimized repro executes cleanly up to the failure point.
- **(b) Same bug.** The observed failure is the *same bug* — same error class, same wrong value, same symptom — not a different bug introduced by minimization.

**Failure handling:**

- If (a) fails, the minimization broke the path. Revert to the last working version of the repro and loop back to Phase 4.
- If (b) fails, the minimization removed something load-bearing for the bug itself. Revert and try a different reduction. Loop back to Phase 4.

Phase 5 closes only when both (a) and (b) hold on a fresh run.
