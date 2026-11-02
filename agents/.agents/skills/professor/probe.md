# probe — set the goal, locate the edge

Read this file before Phase 0. It covers two jobs that never merge:

- Phase 0 turns a topic into one approved goal contract.
- Phase 1 locates the edge of the learner's understanding on every strand
  the goal depends on.

The phase ends when the learner approves the goal and each strand has a
bracket. Teaching starts in `learn.md`, never here.

## Phase 0 — Goal grill (never skip)

A topic is not yet a learning goal. Before probing knowledge or preparing
material, talk with the learner until both of you agree on one bounded
outcome. This is a short conversation, not an intake form.

- Start from the standing view. `status.md` names what the vault already
  holds on this topic. If records exist, say in one or two lines what is held
  and what is weak. Then grill only the unresolved dimensions.
- Use `ask_user_question` for every grilling turn. Ask **one question per
  call** and adapt it to the previous answer; never dump a questionnaire into
  chat.
- Ask only about unresolved dimensions. Usually this takes 1–3 discovery
  questions, with a hard cap of four before proposing a goal.
- Pin down: what the learner wants to do **without help**, the real context
  in which they will do it, their present sticking point, and what observable
  performance would count as success. Ask about time or depth only when it
  changes scope.
- Prefer concrete contrasts over vague prompts when the learner is unsure:
  for example, operating a tool, debugging it, or explaining its mechanism
  are different goals.
- If the request is too broad for one session, negotiate a narrow first goal
  and park the rest; do not quietly turn it into a curriculum.
- When the vault shows a gap that the request does not cover, name it once,
  then let the learner choose. Do not redirect the goal on your own reading.

Synthesize the answers into a **goal contract**:

> By the end of this session, I can [observable action] [specific object] in
> [real context] without [support being removed], demonstrated by [check].

Reject verbs such as “learn,” “know,” or “understand” unless the sentence also
names observable behavior. Present the proposed contract, explain any narrowing
in one sentence, then use `ask_user_question` to ask the learner to approve or
edit it. **Put the full goal contract inside the `ask_user_question` call
itself** — the question text or the `details` field — never only in preceding
chat: the panel floats above the conversation and the learner may not see what
was written above it. The approval prompt must be fully self-contained: restate
the contract verbatim, then offer approve / edit options. Do not enter Phase 1
until approval is explicit. Record the approved contract in `session.md`;
every later question, research task, DAG node, and exercise must earn its place
by serving that contract.

## Phase 1 — Probe (never skip)

After the goal contract is approved, locate the learner's zone of proximal
development. Find the **edge** of their understanding — the frontier where
reliable knowledge turns into guesswork — along every strand the lesson will
depend on. Mostly quiz — options let you map the edge cheaply — with some
explain once a strand starts feeling familiar, one question at a time, each
adapted to the last answer.

- **The edge is only located when it's bracketed.** Per strand you need both a
  floor (something he gets right) and a ceiling (something he gets wrong). One
  side alone tells you almost nothing.
- **All-correct is not "done" — the questions were too easy.** Escalate
  difficulty sharply until something finally breaks.
- **Announce and scaffold every probe question.** A probe is a *cold* question —
  by design it comes before any teaching — but it must never *read* as random.
  Two rules, both mandatory:
  - **State the frame inside the tool call.** The `quiz`/`explain` panel floats
    above the conversation, so the probe framing cannot live only in preceding
    chat text. Put it in the `question` or `details` field itself: that this is
    a cold probe, what source to reason from (`contextFiles`), and what
    established fact it builds on ("using the intra-warp bank model you just
    confirmed…").
  - **Give a reasoning entry point, not the answer.** One line naming where the
    derivation starts — the exact index expression or mechanism to look at — so
    the learner attempts a motivated derivation rather than guessing among
    options. Never scaffold so far that the options are given away.

  A probe question with no visible entry point means a miss cannot be
  attributed — it measures confusion about the *question*, not the *concept*,
  and the probe's edge-location is void.
- **Tag every probe `stage: "probe"`.** md-log routes those verdicts to
  `<session>-probes.md`. A mistagged probe pollutes the journal; a mistagged
  teaching check hides a verdict.
- **Binary-search the edge.** On a hit, jump difficulty up sharply; on a miss,
  narrow back in to pin exactly where the frontier sits.
- **One wrong answer is not a cue to start teaching.** Characterize the miss
  first: careless slip, isolated gap, or systematic misconception.
  Misconceptions matter most — a confidently-held wrong model must be
  dislodged, not topped up — so dig into its extent before moving on.
- **Probe locates the edge; it never fills it.** Once a strand's edge is
  bracketed, stop probing that strand. The session exists to add knowledge —
  probing past the bracket is avoidance of teaching, not diagnosis.
- **Map every strand the lesson rests on**, bounded by relevance to the goal.

## Exit — the probe report

Before moving to `learn.md`, write a short report in chat:

- **Held** — the strands and facts the learner already commands.
- **Brackets** — per strand, the highest correct item and the first miss.
- **Misconceptions** — every wrong model found, with its extent.
- **Plan input** — the roots the plan may assume, and the roots it must teach.

Record the report under `## Probe strands` in `session.md` if the session will
resume. Probe results feed Phase 2. They never replace it.
