---
description: Start work in a worktree made from main
argument-hint: "[branch or theme]"
---
Put this work in a Git worktree.

The text after the command is: ${@:-the changes discussed in this conversation}

Decide the details yourself. Do not ask the user to choose a branch, a type,
or a base.

- If the text names a branch or worktree (`feat/x`, `fix/y`, `dark-mode`), use
  that name.
- Otherwise derive `<type>/<slug>` from the text and the conversation. Pick the
  type from feat, fix, explore, chore, task.
- Call the worktree tool with `base: "main"`. Base the worktree on local main,
  never on the current branch. It takes only `branch` and `base`: it opens a
  user-driven session, it does not launch a subagent.
- Do not edit the main checkout.
- Report the branch, the path, and the tab or session it opened. That tab is
  the human's: do not send it a task, do not poll it, and do not claim the work
  is done.

Work in that worktree only when the human asks you to.
