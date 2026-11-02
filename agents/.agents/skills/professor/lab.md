# lab — put the concept under the hands

Read this file when the learner's goal is operational: run it, build it,
measure it, break it, or read a real system. A lab turns a confirmed concept
into a command the learner owns.

A lab is not a demo. The learner types every command and reads every result.
You predict, then compare the prediction with what really happened.

## When to run a lab

- The goal contract names an action on a real system.
- A concept is confirmed and its meaning depends on what the machine does.
- A measurement or output is disputed, and observation settles it.
- The learner asks to try it, and the plan allows the time.

Do not run a lab to avoid teaching. If the learner cannot say what the command
should do, the node is not ready. Teach it in `learn.md` first.

## Grounding predictions

Every command call carries a `prediction` — the exact output or state you
expect, and why. The prediction is the instrument:

- Write the prediction **before** the learner runs the command.
- State the observable: the line, the exit status, the counter, the field.
- Name the mechanism that produces it. A prediction without a mechanism is a
  guess, and a match proves nothing.

A command with no prediction is a demo. A demo has no verdict.

## Command design

- **One command, one target.** The command must test the node under work.
- **Smallest discriminating command.** Prefer the shortest command that
  separates the two live possibilities. Do not chain five commands when two
  lines decide the question.
- **Read-only first.** Inspect before you change. Change only when the goal
  needs a change.
- **Reversible and scoped.** A lab must not damage the host, the repo, or a
  remote resource. State the blast radius before a write command.
- **Real environment.** The learner's own host, repo, or remote target. A
  toy substitute teaches a toy lesson.

## Run it

Use the `run-command` instrument (`instruments.md`). The learner drives it:

- `y` copies the command and focuses the output field. Use it when typing the
  command is part of the lesson.
- `r` runs it in a visible Neovim terminal and captures output plus exit
  status. Use it when reading the result is the learning target.

You receive the command and the observed output together. Never run the
command yourself, except to ground a prediction on a machine the learner
cannot reach. Say so when you do.

## Read the mismatch

If the output differs from the prediction, that difference is the lesson.
Decide which case holds:

1. **Host drift.** The machine changed since you wrote the prediction. Confirm,
   then correct the prediction.
2. **Your model was wrong.** The mechanism you named does not produce this
   output. Say so plainly and repair the model in `learn.md` style.
3. **The learner mistyped.** Read the command before you read the output.
4. **No output.** The learner could not paste it, or the command failed on
   their side. Ask for the exit status. An empty submission is data, not
   disobedience.

Then choose one: retry the command, or drop to `quiz` and diagnose the
misconception before another command.

Never present an ungrounded prediction as an observed fact.

## Debrief — the hands are not the head

A command proves the hands. It does not prove the head. After a clean run,
ask one `explain` question that forces the mechanism in the learner's own
words: which construct did the command touch, and why that one?

Skip the debrief only when the node was already confirmed by `explain` and the
lab was pure application.

## Exit

The lab ends when the observed output matches a grounded prediction and the
learner can name the mechanism. Record the confirmed node in `session.md`.
Then choose: the next node in `learn.md`, or `revise` when the material is
earned and needs staying power.
