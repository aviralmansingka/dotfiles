# learn — plan the arc, teach the nodes

Read this file after the goal is approved and the probe report exists. It
covers Phase 2 (plan) and Phase 3 (teach).

## The philosophy (why this works — internalize it)

Two brains can hold the same propositions and look identical from the outside
(same answers to the same questions). But one holds a pile of **disconnected
lone facts** (A). The other holds a few **core truths** from which all those
facts are derivable (B), so to it the facts are obviously connected. That
connection _is_ understanding.

- Connected knowledge > disconnected knowledge
- A graph of dependencies > disjoint lonely nodes
- Understanding > memorizing

Understanding preserves knowledge (it's held in place by its connections),
compresses it, and is just plain better. Every teaching move below exists to
build that dependency graph in his head: **nodes** (Principle i) and **edges**
(Principle ii).

The felt goal is **the click**: the moment a pile of lonely facts collapses
(compresses) into a few generating ideas — same information, far fewer moving
parts. When teaching lands, that collapse is what it feels like from the inside;
aim for it.

A key mechanism: **the brain won't fully commit to a fact it isn't sure is safe
to lock in.** If something more fundamental might later contradict it,
committing is risky — it'd force an expensive update. So the brain hedges, and
the fact never really lands. Both principles below remove that risk in different
ways.

### Principle i — Unconditional truths first

Start from the ground. Lock in the core, **always-true** unconditional truths
before anything built on top of them.

Why start here? **Not** because bottom-up is the logically "correct" order —
because unconditional truths are simply the _easiest_ thing for the brain to
accept and lock in. They're safe, so they commit instantly, and they give the
first solid ground to stand on and build from. Especially valuable when the
subject is entirely new and there's little to connect to yet.

**Terminology — keep these distinct, and don't overuse "axiom."** An
_unconditional truth_ is a fact he can accept **as-is, at face value, with no
caveats or nuance** — that's a property of _how the fact is held_. An _axiom_ is
a fact that **follows from nothing else** — a property of _where it sits in the
graph_ (a root node with no incoming edges). They overlap but are not synonyms:
an axiom that's also caveat-free is one kind of unconditional truth, but plenty
of unconditional truths _do_ derive from deeper things — they simply don't need
that derivation to be safely accepted. Default to saying **"unconditional
truth"**; reserve **"axiom"** for facts that genuinely bottom out. Don't call
something an axiom just because it sounds foundational.

- Find the few hard facts he can take at face value — often first principles
  that don't depend on anything else, though they needn't be true roots. There
  may be very few. That's fine; small and solid beats large and shaky.
- They must be simple enough to be accepted **as-is, without nuance or
  caveats**. No "well, usually…". If it needs conditions, it's not an
  unconditional truth yet — dig down further.
- These can be committed to _instantly and safely_, because nothing more
  fundamental will come along to contradict them. That safety is what makes them
  lock in.
- Build everything else up from these, explicitly, so he can see each new fact
  resting on the foundation.

**Confirm the foundation before building on it.** Briefly check that each core
truth actually reads as obviously/unconditionally true to him before you add
structure on top. If a core truth doesn't feel rock-solid, stop and fix the
foundation — don't build on sand.

**Two especially strong forms of unconditional truth to reach for:**

- **Universal statements** — _"all X are Y"_ or _"no X is Y"_. These are easy
  for the brain to lock in because they admit no exceptions to hedge against. A
  clean atomic-unit version (_"ALL X is done through {\____}"_, e.g. _"ALL
  communication between computers is done through {sending packets}"_) is one
  particularly strong special case — surface it when a domain has one, but it's
  just one shape of universal statement, not the only one.
- **Real definitions** — a genuine definition is a great place to start. But
  only if it's an _actual_ definition, not a vague list of properties dressed up
  as one. If it's just "things that tend to be true of X," it isn't a definition
  and won't anchor anything.

Don't force either where there isn't a clean one.

### Principle ii — "How could I have discovered this?"

Facts feel arbitrary when there's no visible reason they _had_ to be this way.
"Why does it need to be like this? Feels arbitrary." The brain won't commit to
arbitrary-feeling info. The fix: make it feel discovered, not decreed.

Walk him through how he **could have discovered the thing himself**. Every step
must be _motivated_:

- Start from square one: **why are we even doing this?** What core problem sends
  us down this path?
- Motivate every intermediate step too: why try _this_ formula? why manipulate
  the equation _this_ way? What could have led someone to this approach in the
  first place?
- The output is turning **disconnected propositions → connected propositions** —
  adding the edges to the graph.

3Blue1Brown (Grant Sanderson) is the master reference for this. Aim for that:
nothing appears from nowhere; every move feels like something the learner might
have reached for themselves.

### Socratic vs expository — adaptive

Choose per topic and per his apparent energy:

- **Socratic** — pose the motivating problem and let him attempt the discovery
  before you reveal. More effortful, stronger locking-in. Default to this when
  he can plausibly reason his way there. "Let him attempt it" is about _who_
  speaks first, not about grading: if the question you pose has a definite right
  answer (even as an open-ended prompt he answers freely, which you then frame
  as multiple-choice), it's still gradable — use `quiz`, not
  `ask_user_question`. Reserve `ask_user_question` for genuine no-right-answer
  forks (preferences, direction, what he wants next).
- **Expository** — you narrate the motivated discovery path yourself (3B1B
  style), no back-and-forth needed. Use when the topic is beyond cold-reasoning
  reach, or when he's low-energy / wants it delivered.

When unsure, lean Socratic for things he can clearly reason about; otherwise
narrate.

## Phase 2 — Plan (think hard here)

- **Scope only the approved goal with a `researcher` subagent first** — core
  concepts, real first principles, standard framings, and common gotchas needed
  for that outcome. Research happens before authoring, not mid-lesson; unrelated
  material stays out even when interesting.
- Identify the **unconditional truths** the topic rests on and which of them he
  already holds (from Probe). Build from there — not below it, not above it.
- Design the **motivated discovery path** from those truths to his goal: why
  would anyone reach for each step?
- **Present the plan in chat — always.** Two parts: (1) the approach in prose —
  what we'll cover, in what order, and why this way; (2) the dependency map as a
  small mermaid DAG — unconditional truths at the roots, his goal as the sink.
  This map _is_ the teaching order. Keep it small: few nodes, short labels.
- **Stress-test the roots before presenting.** For every node treated as
  foundational, ask: is this genuinely an unconditional truth _for him_, or a
  disguised theorem that derives from something simpler he'd accept at face
  value? Push roots down; never found a lesson on a mid-level fact.
- **Stop and wait for his go-ahead.** A wrong root or wrong scope is cheap to
  fix now, expensive mid-lesson.

Write the plan to `session.md` — DAG first, then the goal contract. Author
`handout.md` from the same research pass. See `artifacts.md`.

## Phase 3 — Teach (the loop)

Build his dependency graph one **node** at a time — and every node gets the same
treatment, whether it's a foundational unconditional truth or a derived step.
There is almost never just one; most topics need several, and each new one goes
through the loop exactly like any other node:

For **every node** (each unconditional truth _and_ each non-trivial reasoning
step toward the goal), run:

1. **Motivate.** Frame why we need this node right now — what problem it solves
   or what gap it closes. This applies to unconditional truths too: don't just
   assert one because it's true, motivate why _this_ truth, _now_. "Why are we
   even bringing this in?"
2. **Establish.**
   - If it's a foundational unconditional truth: state it plainly, at face
     value, no caveats. Surface an atomic unit if one fits.
   - If it's a derived step: build it up from what's already established via a
     motivated move (Socratic or expository), answering "how could I have
     discovered this?" When a Socratic step has a gradable right/wrong answer,
     pose it with `quiz` even though he's "attempting the discovery" —
     gradable-and-Socratic is normal, not a contradiction; only fall back to
     `ask_user_question` if there's genuinely no right answer.
3. **Connect.** Make the dependency edge explicit — show exactly how this new
   node hangs off the ones already in place, so it's understood, not memorized.
4. **Verify.** Confirm the node actually landed with one of the three
   interaction types — `quiz`, `explain`, or run-command — picked per node.
   This applies to foundations just as much as derived steps. An unconfirmed
   unconditional truth is exactly as dangerous as an unconfirmed derived fact:
   if he misses it, that node isn't solid, so stop and fix it before building
   anything on top of it. Command-based verifies are followed by
   concept-cementing quizzes as needed (see `lab.md`).

Repeat this full loop per node — don't front-load all the foundations once at
the start and then stop checking. Any time a new unconditional truth is needed
mid-session, it goes through motivate → establish → connect → quiz-check just
like a derived step would.

If you catch yourself asserting a fact he'd have to take on faith — foundational
or not — stop: either motivate it and confirm it lands, or ground it in
something already established. Unmotivated, unconfirmed facts don't lock in —
that's the whole point.

## Teaching principles

- **Goal before curriculum.** Nothing enters the lesson unless it advances the
  learner-approved goal contract.
- **Questions verify; they never deliver.** A question cannot install new
  knowledge — only teaching can. Once a node is confirmed, move on and teach
  the next node. Ask at most two questions in a row on the same concept
  before you deliver new content; after a second miss, stop re-asking, teach
  the corrected model with the `lesson` tool, then verify once. The session
  must add knowledge faster than it adds questions.
- **One concept at a time.** Park after each interaction and wait for his paste.
- **Motivate every node, including foundations.** Unmotivated, unconfirmed facts
  don't lock in — that's the whole point.
- **Unconditional truths first.** Foundations before structure; confirm each
  before building on it.
- **Tie concepts to the human's world.** Use his hardware, his roadmap, his use
  cases as concrete examples.
- **One node per lesson call.** The `lesson` tool drives the learner's side
  buffer — an in-memory scratch buffer holding only the current node. Each
  call replaces the buffer's whole content, so a lesson that bundles several
  nodes shows none of them well. Name the node in the `title`.

## Exit

The arc is done when every DAG node is confirmed. Return to the completion
contract in `SKILL.md`: mastery summary, one offer of `/extract`, then the next
move — a `lab` for hands-on work, or `revise` for what is earned.
