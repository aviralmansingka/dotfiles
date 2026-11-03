# instruments — deliver, ask, verify

Read this file before the first `lesson`, `quiz`, `explain`, or run-command
call in a session.

Four instruments serve different jobs. Pick by how sure you are of the learner's
position, not by variety.

| Instrument | Job | Use when |
|---|---|---|
| `lesson` | deliver one node | new material, a corrected model, a rebuilt prerequisite |
| `quiz` | map and check | you are **not** confident where he is; options diagnose the misconception |
| `explain` | retrieve in his words | you are **somewhat** comfortable; prose forces production, not recognition |
| run-command | prove the hands | the work lives on a real machine |

Most of Probe is quiz, with some explain. Teach mixes all three per node.
The instrument's own tool description owns its interaction and grading
mechanics. This file owns what the tool cannot do: composition and evaluation.

`lesson`, `quiz`, `explain`, and run-command are extension tools. Always invoke
them as tools; never simulate one in chat.

## lesson

Teaching delivery through the `lesson` extension tool
(`pi/.pi/agent/extensions/lesson.ts`). The body lands in the durable session
journal and shows in the learner's side buffer, which holds only the current
node. Use it every time you deliver new material: node content, corrected
models after a miss, prerequisite rebuilds.

- Title it with the node name. Keep one node per call.
- The buffer is the learner's reading surface. Never dump lesson content into
  the console instead.
- When the result is `unavailable`, no editor opened. Restate the essential
  idea in the conversation, and give the learner time to read before the
  question that follows.

## quiz

Concept checks, terminology, and "why" questions, through the `quiz` extension
tool (`pi/.pi/agent/extensions/quiz.ts`). It grades the answer and returns the
chosen option, the correct option, and any `thinking` the learner typed.

### Composing questions

- **Title every quiz and explain.** Every call passes `title`: short (under 40
  characters), naming the node under test and the teaching goal — `Node E —
  ROV drop scope`, never `Question 3`. The panel heads with it, the journal
  records it as the entry heading, and no timestamp goes in any heading.
- **Deliver the node's lesson first.** One `lesson` call scoped to that node
  only, so the node buffer holds exactly what the question drills. Earlier nodes
  stay open for nvim-side cycling. `h` and Ctrl+H focus the current buffer, `H`
  opens the journal; in a quiz panel use `h`, and in explain use `h` before
  composing or at the verdict. Alt is owned by the window manager.
- **Tag every Phase-1 probe with `stage: "probe"`.** Cold probes land in the
  probe log, not the journal. Teaching checks omit `stage` (or pass
  `"teach"`) and land in the journal. A mistagged probe pollutes the teaching
  transcript; a mistagged teaching check hides a verdict from the arc.
- **Always pass `contextFiles`.** Every `quiz` call must include the
  `contextFiles` array — the file(s) the question drills (the kernel, the
  config, the lesson section, the command's source). This renders an `o`
  shortcut in the panel so he can open the exact source while the quiz stays
  active, grounding the question in the artifact instead of testing recall in a
  vacuum. When uncertain whether a file is relevant, include it anyway: a false
  positive (an irrelevant file surfaced) is cheaper than a false negative (no
  context attached). Never omit it on the theory that he "should know it cold."
- **One question per tool call.** Never multi-part; never a batch of questions
  in one message.
- **Probe-stage quizzes are self-contained.** During Phase 1, the question (or
  `details`) must state that it is a cold probe, name the source to derive
  from, and offer a one-line reasoning entry point — see `probe.md`. A probe
  quiz without these reads as random and measures the wrong thing.
- **Write the correct claim first, then mutate it into distractors** — state
  what someone holding a specific misconception would claim, in the same
  skeleton, grain size, and register. Evenness by construction, not by audit.
- **Bare claims only — no justification in any option.** The number-one giveaway
  is the correct option carrying its own reasoning. All reasoning goes in the
  tool's `explanation` field, revealed only after he answers.
- **No asymmetric bolding or length.** If you can tell which option is right
  without knowing the material, regenerate — don't patch.

### Evaluating answers

- **Bounded terminology is the bar.** The tool grades right/wrong; you grade
  precision. If his language is loose — "the thing that does the network stuff"
  when the answer is "the netdev's IFF_UP flag via netlink" — correct it and
  teach him the exact terms.
- **Read the `thinking` field first.** Every quiz answer may carry the learner's
  `thinking` — the reasoning he typed before seeing the verdict. Read it in full
  before grading or reacting. A right answer on a confused model is a warning; a
  wrong answer with sound reasoning is progress. Thinking is often dictated
  speech, so read it leniently for transcription noise.
- **Correct assumptions explicitly.** A wrong answer reveals a misconception —
  name it, explain why it's wrong, and re-ask in a different form before moving
  on. Treat an ungraded Other (`dontKnow`) result as an honest signal to teach,
  not a failure. Ctrl+P (`tooHard`) is a request to teach and retry simpler.
- **Drill into why, not just what.** Follow a correct answer with a "why"
  question when the model feels shallow. "Why does the interface need to be
  admin-up before it can report carrier?" not just "What flag does ip link
  set?" Stop when the answer is solid. A chain that repeats the same point
  adds no knowledge.
- **Don't move on until confirmed — but don't loop either.** Mark confirmed
  when he articulates it in the correct terminology. After a second miss on
  the same concept, stop re-asking: teach the corrected model with the
  `lesson` tool, then verify once more. A third re-ask of the same question is
  a teaching failure, not persistence.
- **Show progress.** After every few exchanges, note how many nodes are
  confirmed vs remaining. Record confirmed nodes in `session.md` (mark each
  `[x]`), so progress survives a context reset.

## explain

Prose retrieval through the `explain` extension tool
(`pi/.pi/agent/extensions/explain.ts`). A floating panel above the prompt shows
the question; the response field is focused immediately (nothing to navigate).

- You must supply **`expected`**: the claims a correct answer must contain,
  including the exact terminology you want and the misconceptions to watch for.
- On submit, a quick **grader fork** (one model call, no session, spinner shown
  in the panel) grades the answer against those claims and returns a letter
  grade (A–F) and a verdict — correct, partially_correct, or incorrect — plus
  **per-quote terminology refinements** (his own words quoted verbatim, what's
  loose, and the precise term that should replace it).
- The verdict is advisory: you own the pedagogical response — right-but-loose
  language gets sharpened, a revealed misconception gets named and re-asked in a
  different form.
- An empty submission is an honest "I don't know" — it skips grading; teach
  into it, don't punish it.
- Phrase questions to force mechanism and exact terms ("name the kernel
  construct this touches and why"), never open-ended musing — grill him on
  precision.

## run-command

Hands-on verification through the run-command extension tool
(`pi/.pi/agent/extensions/run-command.ts`). A floating panel above the prompt
supports two user-driven paths: `y` copies the command and focuses the output
field for manual execution and pasting; large pastes stay compact in the
visible field but are expanded in full when submitted. `r` runs it in a visible
Neovim `:term dm` pane and automatically captures output plus exit status.

You receive the command and observed output **together**, plus the `prediction`
you passed with the call. Grading is output against that grounded prediction.
Prefer `y` when typing the command is part of the lesson; use `r` when
observing and interpreting its result is the learning target. The pedagogy of
prediction, command design, and mismatch diagnosis lives in `lab.md`.

## Prose and formatting

**Always use the `/simple` skill for lessons and handouts.** This rule is
explicit: lesson bodies and handouts are written under `/simple`, every time.
Before you write a lesson body, the handout, or any other learner-facing prose,
read `~/.agents/skills/simple/SKILL.md` and apply its rules. This covers lesson
bodies, `handout.md`, quiz questions, options, and explanations, explain
prompts and details, panel text, `session.md`, and teaching chat. All of it
follows ASD-STE100 at full compliance with no relaxations: short sentences,
active voice, approved verbs, one term per concept. The system prompt's 80%
relaxation does not apply to teaching surfaces. This holds for every session;
the learner does not need to type `/simple`.

**The lesson never lives in thinking.** Thinking blocks are clipped or hidden
in the learner's view. Lesson substance — derivations, explanations, grounded
answers, corrections, quiz design — must land in visible text, a quiz/explain
panel, or an artifact file. Thinking may plan the lesson; it must not be the
lesson. This applies regardless of model: on models whose reasoning is
returned in full, the visible text must still carry the teaching, not a
two-line pointer to reasoning the learner cannot read.

### Markdown quality gate — perfect, no silent failures

After writing or re-rendering an artifact file, **validate it**:

1. Run a markdown linter or conformance check on the file.
2. **No warnings are acceptable** except line length inside table rows (tables
   may run long). Do NOT suppress linter rules via a config file to make
   warnings disappear — fix the underlying formatting. The only acceptable
   config disablement is for rules that are genuinely inapplicable to the
   artifact corpus (e.g., MD040 code-fence language tags if the existing files
   don't use them and consistency matters). Every other rule must be satisfied
   by fixing the content, not by disabling the check.
3. **Check ASCII diagrams for jagged edges.** Artifact files often contain ASCII
   art boxes and diagrams. A jagged edge is a misaligned right border — one or
   more lines in the box have a different character width than the others,
   pushing the closing `│` or `┐` to a different column. This is the most common
   formatting defect in hand-authored ASCII art. After writing any fenced code
   block containing a box diagram (lines with `┌`, `│`, `└`, `┐`, `┘`), run a
   width check: every line in the block must have the same character count. A
   one-line shell check:

   ````bash
   # Print any content lines whose length differs from the first content line
   grep -v '^```' | awk 'NR==1{first=length($0)} length($0)!=first{printf "line %d: %d chars (expected %d): %s\n", NR, length($0), first, $0}'
   ````

   If any lines are off by even one character, fix the padding before presenting
   the lesson. Pay special attention to lines containing multi-byte Unicode
   characters (→, ✓, ✗, bullets) — these count as one character but may render
   at a different width in some terminals, and the trailing-space padding must
   account for the character count, not the byte count.

4. If there are issues, **surface them explicitly** — fix and re-validate before
   presenting.
5. Never fail silently. If the markdown has problems, say so, fix them, and
   re-check. The human should never open an artifact file and find broken
   formatting.
