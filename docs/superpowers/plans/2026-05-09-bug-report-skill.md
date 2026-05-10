# `/bug-report` Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/bug-report` skill that drives a rigid eight-phase process — triage, gather, reproduce, minimize, re-verify, hypothesize, emit prompt, hand off — converting a vague bug description into a minimized, executed, re-verified repro plus a structured investigation prompt.

**Architecture:** Single-file skill at `claude/.claude/skills/bug-report/SKILL.md`. The file is a markdown document with YAML frontmatter that Claude loads via the Skill tool. Discipline is encoded as explicit phase exit criteria, hard rules, and a red-flags table. Deployment is via GNU stow (the `claude` package), so the source file lives in the dotfiles repo and is symlinked to `~/.claude/skills/`.

**Tech Stack:** Markdown + YAML frontmatter (skill file), GNU stow (deployment), `superpowers:writing-skills` (verification).

**Spec:** `docs/superpowers/specs/2026-05-09-bug-report-skill-design.md`

---

## File Structure

- **Create:** `claude/.claude/skills/bug-report/SKILL.md` — the skill file (single artifact for this plan).
- **Verify:** `~/.claude/skills/bug-report/SKILL.md` — symlink target after stow.

No other files are created or modified. The skill is self-contained.

---

### Task 1: Skeleton — frontmatter, intro, announce, phase table, hard rules

**Files:**
- Create: `claude/.claude/skills/bug-report/SKILL.md`

- [ ] **Step 1: Create the skill directory**

```bash
mkdir -p /Users/aviral/dotfiles/claude/.claude/skills/bug-report
```

Run from any cwd. Verify with `ls /Users/aviral/dotfiles/claude/.claude/skills/bug-report` — directory exists, empty.

- [ ] **Step 2: Write the skeleton SKILL.md**

Write `claude/.claude/skills/bug-report/SKILL.md` with this exact content:

````markdown
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
````

- [ ] **Step 3: Verify the file parses as valid frontmatter**

Run:

```bash
head -5 /Users/aviral/dotfiles/claude/.claude/skills/bug-report/SKILL.md
```

Expected output: starts with `---`, contains `name: bug-report`, contains `description:` line, ends with `---` on the 4th non-empty line. Frontmatter is valid YAML.

- [ ] **Step 4: Commit**

```bash
git add claude/.claude/skills/bug-report/SKILL.md
git commit -m "$(cat <<'EOF'
Skeleton for /bug-report skill

Frontmatter, announcement rule, when-to-apply triggers, the eight-phase
machine table, and hard rules that apply across all phases. Phase
mechanics added in follow-up commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Phase 1 (Triage) and Phase 2 (Gather repro) mechanics

**Files:**
- Modify: `claude/.claude/skills/bug-report/SKILL.md` (append after the "Hard rules" section)

- [ ] **Step 1: Append phase mechanics for Triage and Gather**

Append this content to `claude/.claude/skills/bug-report/SKILL.md`:

````markdown

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
````

- [ ] **Step 2: Verify the file structure**

Run:

```bash
grep -c "^### Phase" /Users/aviral/dotfiles/claude/.claude/skills/bug-report/SKILL.md
```

Expected output: `2` (Phase 1 and Phase 2 sections present).

- [ ] **Step 3: Commit**

```bash
git add claude/.claude/skills/bug-report/SKILL.md
git commit -m "$(cat <<'EOF'
bug-report: add Triage and Gather-repro phase mechanics

Phase 1 reads cwd signals (git, manifests, dirs, the bug one-liner)
to surface up to three candidate systems, with explicit fallbacks for
0/1/2-candidate cases. Phase 2 uses a covering checklist driven one
question per turn.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Phase 3 (Reproduce) mechanics

**Files:**
- Modify: `claude/.claude/skills/bug-report/SKILL.md`

- [ ] **Step 1: Append Phase 3 mechanics**

Append this content to `claude/.claude/skills/bug-report/SKILL.md`:

````markdown

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
````

- [ ] **Step 2: Commit**

```bash
git add claude/.claude/skills/bug-report/SKILL.md
git commit -m "$(cat <<'EOF'
bug-report: add Reproduce phase with negotiation protocol

Phase 3 attempts execution and records an evidence buffer entry per
command. When blocked (auth, missing deps, hardware), the skill
negotiates a fallback (user-runs, mock, reduced path) instead of
silently giving up or advancing on faith.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Phase 4 (Minimize) and Phase 5 (Re-verify) mechanics

**Files:**
- Modify: `claude/.claude/skills/bug-report/SKILL.md`

- [ ] **Step 1: Append Phase 4 and Phase 5 mechanics**

Append this content to `claude/.claude/skills/bug-report/SKILL.md`:

````markdown

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
````

- [ ] **Step 2: Commit**

```bash
git add claude/.claude/skills/bug-report/SKILL.md
git commit -m "$(cat <<'EOF'
bug-report: add Minimize and Re-verify phase mechanics

Phase 4 reduces the repro by priority targets (steps, inputs, flags,
assertion narrowness). Phase 5 enforces two independent checks before
closing: minimized steps still run cleanly, AND the original bug is
still the one that surfaces. Either failure loops back to Phase 4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Phases 6 (Hypothesize), 7 (Emit prompt), 8 (Hand off) mechanics

**Files:**
- Modify: `claude/.claude/skills/bug-report/SKILL.md`

- [ ] **Step 1: Append the final three phases**

Append this content to `claude/.claude/skills/bug-report/SKILL.md`:

`````markdown

### Phase 6 — Hypothesize

Produce 2–4 ranked root-cause hypotheses. Each one MUST cite specific evidence captured in phases 2–5. Format:

> **Hypothesis:** cache-key collision in `s3_download.py:get_cached_path`.
> **Evidence:** minimized repro shows two distinct s3 keys hashing to the same cache filename in step 4 output line 2 of the evidence buffer.

Hypotheses without explicit evidence citations are NOT allowed. If you cannot cite evidence for a hypothesis, drop it or return to Phase 3/5 to gather more.

### Phase 7 — Emit prompt

Print exactly one fenced block to chat with this structure (copy literally; substitute the bracketed placeholders):

````
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
````

This is the skill's only persisted artifact — there is no file output. The chat block IS the deliverable.

### Phase 8 — Hand off

Immediately invoke `superpowers:systematic-debugging` with the emitted prompt as input. The same session continues into investigation. Do not wait for user confirmation; the user requested investigation by invoking `/bug-report`.
`````

- [ ] **Step 2: Verify all 8 phases are present**

Run:

```bash
grep -c "^### Phase" /Users/aviral/dotfiles/claude/.claude/skills/bug-report/SKILL.md
```

Expected output: `8`.

- [ ] **Step 3: Commit**

```bash
git add claude/.claude/skills/bug-report/SKILL.md
git commit -m "$(cat <<'EOF'
bug-report: add Hypothesize, Emit-prompt, Hand-off phases

Phase 6 enforces evidence citation for every hypothesis. Phase 7
prints a single structured fenced block with system, minimized repro,
evidence, mode, hypotheses, and an investigation request. Phase 8
auto-invokes superpowers:systematic-debugging in the same session.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Anti-patterns / Red-flags table

**Files:**
- Modify: `claude/.claude/skills/bug-report/SKILL.md`

- [ ] **Step 1: Append the Red flags section**

Append this content to `claude/.claude/skills/bug-report/SKILL.md`:

````markdown

## Red flags

These thoughts mean STOP — you're rationalizing past a phase exit criterion:

| Thought | Reality |
|---------|---------|
| "User already described the bug, I can skip Triage." | Triage is on the record. Confirm the system explicitly. |
| "The repro looks obvious, no need to actually run it." | Phase 3 closes on **observed** failure, not described failure. |
| "I already minimized this in my head while reading." | Each reduction is a re-run, not a guess. Phase 4 requires execution. |
| "I re-verified by reading the code path." | Re-verify means re-execute. Reading is not running. |
| "I'll skip evidence buffer for the obvious commands." | Phase 6 needs cited evidence. No buffer = no hypotheses. |
| "Hypothesis feels right, I can emit the prompt now." | Hypotheses without phase 2–5 citations are not allowed. |
| "User seems impatient, I'll combine phases." | The user invoked this skill *because* they wanted the discipline. Combining phases defeats the purpose. |
````

- [ ] **Step 2: Commit**

```bash
git add claude/.claude/skills/bug-report/SKILL.md
git commit -m "$(cat <<'EOF'
bug-report: add red-flags table for phase-skipping rationalizations

Encodes the failure modes the rigid phase machine exists to prevent.
Each row maps a tempting shortcut to the phase exit criterion it
would violate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Stow and verify symlink

**Files:**
- No code changes. This task verifies deployment.

- [ ] **Step 1: Run stow for the claude package**

```bash
cd /Users/aviral/dotfiles && stow claude
```

Expected: no output (success). On conflict, stow prints which paths conflict — investigate before forcing.

- [ ] **Step 2: Verify the symlink resolves**

Run:

```bash
ls -la ~/.claude/skills/bug-report/SKILL.md
readlink ~/.claude/skills/bug-report/SKILL.md
```

Expected:
- `ls -la` shows a symlink (`l` in mode field).
- `readlink` returns a path containing `dotfiles/claude/.claude/skills/bug-report/SKILL.md`.

- [ ] **Step 3: Verify the file is readable through the symlink**

Run:

```bash
head -5 ~/.claude/skills/bug-report/SKILL.md
```

Expected output: same frontmatter as the source file (starts with `---`, has `name: bug-report`).

- [ ] **Step 4: No commit**

Stow operations don't change tracked files. Skip the commit step for this task.

---

### Task 8: Verification dry-run via writing-skills

**Files:**
- No code changes. This task validates the skill behaves correctly.

- [ ] **Step 1: Invoke the writing-skills skill for verification**

Invoke `superpowers:writing-skills` with the goal of verifying the bug-report skill before deployment. Follow whatever verification protocol writing-skills prescribes (it may include a fixture invocation or a structural review).

- [ ] **Step 2: Structural sanity check on the SKILL.md**

Run these checks and confirm each:

```bash
# Frontmatter is valid: opens and closes with ---
head -1 /Users/aviral/dotfiles/claude/.claude/skills/bug-report/SKILL.md
# Expected: ---

awk '/^---$/{n++} n==2{print NR; exit}' /Users/aviral/dotfiles/claude/.claude/skills/bug-report/SKILL.md
# Expected: a small line number (closing --- of the frontmatter block)

# All 8 phases present
grep -c "^### Phase" /Users/aviral/dotfiles/claude/.claude/skills/bug-report/SKILL.md
# Expected: 8

# Red flags table present
grep -c "^## Red flags" /Users/aviral/dotfiles/claude/.claude/skills/bug-report/SKILL.md
# Expected: 1

# Announcement rule present
grep -c "Announce at start" /Users/aviral/dotfiles/claude/.claude/skills/bug-report/SKILL.md
# Expected: 1

# Hand-off target referenced
grep -c "superpowers:systematic-debugging" /Users/aviral/dotfiles/claude/.claude/skills/bug-report/SKILL.md
# Expected: at least 2 (architecture table + Phase 8 mechanics)
```

- [ ] **Step 3: Fixture dry-run (manual)**

Open a fresh Claude session in a directory that contains a real bug to triage (or an example like `modal_host_bench`). Type:

```
/bug-report modal_host_bench doesn't check if s3 files are downloaded before bench start
```

Confirm Claude:
1. Announces "I'm using the bug-report skill to triage and reproduce …".
2. Creates eight TaskCreate items, one per phase.
3. Begins with Triage — does NOT jump to repro questions.
4. Uses `AskUserQuestion` (or free-form fallback for 0/1 candidate cases) for system selection.
5. Only after Triage closes, moves to Gather.

If any of these fail, that's a bug in the skill — open a follow-up to fix the corresponding section.

- [ ] **Step 4: Final commit (only if dry-run uncovered fixes)**

If the dry-run produced fixes, commit them with a message like:

```bash
git add claude/.claude/skills/bug-report/SKILL.md
git commit -m "$(cat <<'EOF'
bug-report: dry-run fixes from writing-skills verification

<describe what was wrong and what changed>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If the dry-run was clean, no commit needed.

---

## Self-review notes

Before declaring this plan ready for execution:

1. **Spec coverage.** Every section of `docs/superpowers/specs/2026-05-09-bug-report-skill-design.md` maps to a task:
   - Goal/non-goals → Task 1 (intro section).
   - Triggers → Task 1 ("When this skill applies").
   - Phase machine table + hard rules → Task 1.
   - Phase 1 mechanics + edge cases → Task 2.
   - Phase 2 mechanics → Task 2.
   - Phase 3 mechanics + negotiation protocol → Task 3.
   - Phase 4 mechanics → Task 4.
   - Phase 5 mechanics → Task 4.
   - Phase 6/7/8 mechanics → Task 5.
   - Anti-patterns → Task 6.
   - Installation → Task 7.
   - Out of scope (Codex parity, file persistence, registry) → not implemented (correct, deferred per spec).

2. **No placeholders.** Every code/markdown block is the literal content to write. No "TBD", no "implement later".

3. **Type / name consistency.** The handoff target is `superpowers:systematic-debugging` everywhere. The skill name is `bug-report` everywhere. The frontmatter description matches the spec.
