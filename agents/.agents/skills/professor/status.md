# status — where the learner stands

Read this file at the start of every professor session. It answers two
questions without teaching: **where is the learner now**, and **what is the
next move in the loop**.

## Read the record

The record is the source. Memory is not.

1. **The propositions.** Every note carries the practice record. Read the
   frontmatter only:

   ```bash
   vault="${PI_VAULT_DIR:-$HOME/vault}"
   for f in "$vault"/2_knowledge/propositions/*.md; do
     awk -v id="$(basename "$f" .md)" '
       /^(review_due|review_last|review_streak|review_result|last_rung|needs_teach|demonstrated|tags):/ {
         print id "|" $0
       }' "$f"
   done
   ```

2. **The sessions.** Look for open arcs and their progress:

   ```bash
   ls -d ./professor-lessons/*/ "$vault"/professor-lessons/*/ 2>/dev/null
   ```

   Read `session.md` in each. Look for the goal contract, the `[x]` marks, and
   any deliverable. Read loosely: the files vary in shape.

3. **The filters.** When the learner names a topic, keep only notes whose
   `tags` or `id` match. Do not widen the filter to make the answer longer.

## Rank the material

Order the candidates with these rules, first match first:

1. **`needs_teach: true`** — a structural miss awaits repair. The next move is
   `learn`.
2. **`review_result: unsolved`** — the last practice failed. The next move is
   `revise`.
3. **`review_due` on or before today** — due now. The next move is `revise`.
4. **`last_rung` at R3 or higher, with a clean solve** — available only with
   help. The next move is `revise` at a lower rung.
5. **A mode missing from `demonstrated`** — taught and recalled, never
   composed. The next move is `revise` in the missing mode.
6. **An open session with unconfirmed nodes** — the arc is unfinished. The next
   move is `learn`, at the first unconfirmed node.
7. **No record on the topic** — the learner is at the start. The next move is
   `probe`.

A lesson is not evidence. A target taught yesterday and never practised is
undemonstrated. Say so when it matters.

## Survey mode

The learner may ask for an inventory instead of a lesson: "probe me", "do not
teach", "where are my gaps". Run probe-only.

- Read the record first. The vault names what is held.
- Probe the gaps with `quiz` and `explain` only.
- No `lesson` call in a survey. One lesson turns the survey into teaching.
- End with three lists: held, ranked gaps, and one next move.

If the learner asks to teach afterwards, that is a new session.

## Answer in this shape

Keep it short. The learner wants a position, not a report.

- **One line of position.** "Nine propositions on CUDA timing. Six hold; two
  are due; one needs teaching."
- **Held — do not re-teach.** Grouped, five bullets at most.
- **Weak — ordered.** One line each: the gap, the evidence, the phase that
  fixes it.
- **Due now.** The count, then the oldest three by name.
- **Next move.** Exactly one recommendation, with the phase and the reason.
  Offer the alternative in one line. Do not list five options.

When the survey is deeper than a topic, or the learner asks for the full
picture, write `gap-inventory.md` beside `session.md`:

- **What is already held (do not re-teach).**
- **Ranked gap clusters.** Highest first, by weight, size, and the presence of
  active misconceptions. Each cluster carries the evidence and one proposed
  session topic.
- **Suggested launch order.**

`~/vault/professor-lessons/ncp-diagnostic/gap-inventory.md` is the reference
shape.

## Rules

- **A held target ends the session.** When the probe shows the learner already
  holds the goal, say so in one line and stop. Do not teach it.
- **No teaching in a status turn.** If the learner asks a question about the
  material, answer it in one line and return to the position. Teach only when
  they choose to.
- **No invented gaps.** Every weakness names its evidence: a note field, a
  session line, or a miss you observed. Silence in the record is not a gap.
- **No fresh rubric.** A status survey walks what the record covers. When the
  topic has a real rubric you have not probed, the next move is `probe`, not a
  guess.
- **One recommendation.** A list of five moves is not a decision.
- **Never recite the whole vault.** The learner asked where they stand, not for
  the index.
- **Empty record.** Say it plainly in one line, then route to `probe`.
