Build two approved features on this branch. Work only in this worktree. Do not run live pi sessions, do not run `/extract`, and do not write to `~/vault`; this task is code and skill text only.

# Feature 1 — optional thinking field on quiz answers

Repo: `<repo>` (this worktree).

## `pi/.pi/agent/extensions/quiz.ts`

Current flow is `select` → `feedback` (verdict + explanation). Insert a phase: `select` → `thinking` → `feedback`.

- Change both `let phase` declarations (`askSingleChoice` and `askMultiChoice`) to `"select" | "thinking" | "feedback"`.
- Single-select: on Enter over a real option, or over "Other", set `chosen`/`dontKnow` as today, then set `phase = "thinking"` instead of `"feedback"`.
- Multi-select: `submit()` sets `phase = "thinking"` instead of `"feedback"`.
- Create a `thinkingEditor` beside `steeringEditor` in both functions, using the same construction as `makeSteeringEditor` (a separate editor, so steering text never leaks in).
- In the thinking phase: render the question and the option list exactly as in the select phase, with NO verdict, NO correct marks, and NO explanation. Below the options render a prompt line `› your thinking (optional)` and the editor's wrapped lines. Bottom hint: `Enter see verdict · Esc skip`.
- Input handling in the thinking phase: Enter submits `thinkingEditor.getText().trim()` (an empty string is valid) and moves to `feedback`; Esc moves to `feedback` with empty thinking; all other keys go to the editor. Keep Ctrl+P too-hard handling in the select phase only.
- Focus: the thinking editor must receive input and be focused when the phase is thinking. Keep the existing panel focus handling intact.
- `QuizResponse` gains `thinking?: string`. `QuizResultDetails` gains `thinking?: string`. `buildResult` stores it.
- The tool result text the agent sees gains, when non-empty, a line `Thinking: <text>` after the selected/correct lines and before `Explanation:`.
- `renderResult`: render a muted `Thinking: …` line when details.thinking is non-empty, near the existing `details.note` rendering.
- Update the quiz tool description: state that the answer may carry a `thinking` field with the learner's reasoning, that it is optional, and that the agent must read it.

Keep the change minimal: no new files, no new dependencies, no restyling.

## `pi/.pi/agent/extensions/md-log.ts`

- `QuizDetails` gains `thinking?: string`.
- `formatQuizEntry`: after the option list and before `**Why:**`, add when non-empty:
  `**Your thinking:**` then a blank line then a blockquote of the text with each line prefixed `> `.

## `agents/.agents/skills/professor/SKILL.md`

- In the Quiz protocol, add one bullet: every quiz answer may carry the learner's `thinking`; read it in full before grading or reacting. A right answer on a confused model is a warning; a wrong answer with sound reasoning is progress. Thinking fields are often dictated speech, so read them leniently for transcription noise.
- Keep the file's existing voice and formatting. Do not touch `fix-code` (already removed) or the instrument lists.

## Tests

- Extend `pi/.pi/agent/extensions/quiz-result.test.mjs` with a case that a result carrying `thinking` renders and formats it.
- Extend `pi/.pi/agent/extensions/md-log.test.mjs` to pin the journal entry with `**Your thinking:**`.
- Do not add new test files.

# Feature 2 — `/extract`: session journal → vault propositions

## `pi/.pi/agent/extensions/md-log.ts`

Add a third command next to `/lessons` and `/probes`:

```ts
pi.registerCommand("extract", {
  description: "Turn this session's journal into proposition notes in the vault",
  handler: async (_args, ctx) => { ... },
});
```

Handler behavior:
- Resolve the journal with `resolveJournalPath(ctx)`. If none, `ctx.ui.notify("No session journal yet.", "warning")` and return.
- Vault dir: `process.env.PI_VAULT_DIR ?? join(homedir(), "vault")`.
- Export a pure `buildExtractionPrompt(journalPath: string, vaultDir: string): string` for the test, and call it from the handler.
- Send it with `pi.sendUserMessage(prompt)`.
- The prompt must be self-contained: name the journal absolute path, the propositions directory (`<vault>/2_knowledge/propositions`), and point to the `Knowledge extraction` section of the professor skill at `~/.agents/skills/professor/SKILL.md`. It must say: read the journal fully, extract, link-or-create, and never touch review fields of an existing note.

## `agents/.agents/skills/professor/SKILL.md`

Add a `## Knowledge extraction` section with exactly this contract:

**Source.** The session journal only (lessons plus teaching quiz/explain verdicts). Never the probe log. Never the session transcript.

**Output.** One note per proposition: `<vault>/2_knowledge/propositions/<slug>.md`. Slug is lowercase a-z, 0-9, hyphens. Created once and permanent.

**Frontmatter on creation:**

```yaml
---
id: <slug>
aliases: ["<verbatim phrasing from the lesson>"]
tags: [proposition, <topic-slug>]
sources: ["[session](../../professor-lessons/<task>/session.md)"]
created: YYYY-MM-DD
review_due: YYYY-MM-DD      # creation date + 1 day
review_streak: 0
review_last: null
review_result: new
demonstrated: []
last_rung: null
needs_teach: false
---
```

**Body:**

```md
# <Short Name>

<The proposition at full precision. One claim. True on its own terms.>

## Chains

- [[premise-a]] + [[premise-b]] → <Short Name of this note>
```

`## Chains` holds only chains whose conclusion is this note; all premises of one chain stay on one line joined with ` + `. A chain with a single premise is one link. Omit the section when the note has no incoming chains.

**Procedure.**
1. Read the whole journal.
2. List every proposition the teaching established: one claim each, minimal and precise. List every chain: the premises used together, and what they imply.
3. For each proposition, `grep` the propositions directory for its statement and aliases before creating anything. On a match, update that note: append the new verbatim alias and the new source. Never change its statement, name, id, or review fields. Conservative rule: duplicates are acceptable, wrong merges are not.
4. Create the missing notes. Create premise notes too when a chain names one that does not exist.
5. Report one line: created N notes, updated M.

**Rules.** No learner ratings, no understanding levels, no lesson prose, no quiz text. The statement is objective; the learner's thinking never enters the note. Reruns are safe: they only add aliases and sources. Never delete a note.

## Gate reminder

In `### Completion gate`, append one sentence: after the mastery summary, offer `/extract` once; do not run it without an explicit yes.

## Tests

- Extend `pi/.pi/agent/extensions/md-log.test.mjs` for `buildExtractionPrompt`: it names the journal path, the propositions dir, and the skill path.

# Gates and commit

- Run the two suites exactly as `scripts/nm-test.sh` runs them (read the script for the runner command), plus `bash scripts/nm-lint.sh`.
- `bash scripts/nm-test.sh` has known baseline failures on this repo (nvim suites, ghostty, nm-install, repo-parity, interactive-subagents rex lookup). Do not fix those. Confirm your two suites pass and that you added no new failures.
- `grep -rn "fix-code" . --exclude-dir=.git` must stay empty.
- Commit once: `Add quiz thinking field and journal extraction command`.
- Report: files edited, exact new behaviors, test results, and anything you could not verify.
