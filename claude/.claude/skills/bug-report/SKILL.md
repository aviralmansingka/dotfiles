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
