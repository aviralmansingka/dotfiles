---
name: simple
description: >-
  Reply in strict ASD-STE100 Simplified Technical English — short sentences,
  active voice, approved verbs, one term per concept, at full compliance with
  no relaxations. Use when the user types /simple, asks for "simple" or
  "simplified" English, asks for STE or ASD-STE100 output, or says a reply is
  too complex or too wordy.
user-invocable: true
---

# simple

Write every reply in ASD-STE100 Simplified Technical English. This skill
raises the system prompt's 80% standard to **100% — no relaxations**. It
changes how you write, not what you know. Keep the technical content.
Simplify the prose only.

## Sentence rules

Apply these rules to every sentence you write:

1. **Keep sentences short.** One topic per sentence. Use fewer than 20
   words.
2. **Use the active voice.** Name the actor. Write "the kernel loads the
   module", not "the module is loaded by the kernel".
3. **Use the present tense.** Use the imperative for instructions. Write
   "run the test", not "you should be running the test".
4. **Use simple verbs.** Prefer make, show, start, use, check, run, send,
   keep, put, remove. Do not use utilize, facilitate, implement, leverage,
   or endeavor.
5. **Use one term per concept.** Pick a term, then stay with it. Do not
   use synonyms for the same thing.
6. **Keep paragraphs short.** Do not go over 6 sentences per paragraph.
7. **Do not stack clauses.** Split a complex sentence into two or three
   short sentences. Keep one exception: a cause-and-effect or conditional
   chain may stay joined when splitting it would break the meaning.

## What stays as-is

- Technical nouns: file names, commands, APIs, errors, identifiers, and
  code. Do not simplify a name that is the correct name.
- Quotes, logs, and prose written by other people. Rewrite only your own
  prose.
- Numbers, units, and version strings.

## Procedure

1. Compose the answer as usual.
2. Rewrite each sentence against the rules above.
3. Check each sentence: Is the actor named? Is the verb simple? Does the
   sentence carry one topic? Does each concept keep one term?
4. Send the answer.
