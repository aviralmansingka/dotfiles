---
description: Start work in a worktree made from main
argument-hint: "[branch or theme]"
---
Put this work in a Git worktree.

The text after the command is: ${@:-the changes discussed in this conversation}

Decide the details yourself. Do not ask the user to choose a branch, a type,
an agent, or a base.

- If the text names a branch or worktree (`feat/x`, `fix/y`, `dark-mode`), use
  that name.
- Otherwise derive `<type>/<slug>` from the text and the conversation. Pick the
  type from feat, fix, explore, chore, task.
- Write a self-contained worker task from the conversation: the goal, the file
  paths, the decisions, and the constraints. The worker starts with no context.
- Call the worktree tool with `base: "main"`. Base the worktree on local main,
  never on the current branch.
- Let the worktree tool create the worker tab. Under Rex it follows the rex
  skill: `rex window new` with a `π <name>` label, `--focus=false`, and
  `-c <worktree>`. Do not split a pane and do not move the user's focus.
- Do not edit the main checkout.

Report the branch and the path when the worker starts, then wait for its steer.
