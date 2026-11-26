---
description: Start work in a worktree made from main
argument-hint: "[branch or theme]"
---
Put this work in a Git worktree, and do the work there.

The text after the command is: ${@:-the changes discussed in this conversation}

Decide the details yourself. Do not ask the user to choose a branch, a type,
or a base.

- If the text names a branch or worktree (`feat/x`, `fix/y`, `dark-mode`), use
  that name.
- Otherwise derive `<type>/<slug>` from the text and the conversation. Pick the
  type from feat, fix, explore, chore, task.
- Call the worktree tool with `base: "main"`. Base the worktree on local main,
  never on the current branch. It takes `branch`, `base`, and an optional
  `task`.
- Do not edit the main checkout. Not one line.

Then continue the work in the checkout you just got. Two routes, pick one and
say which:

- **Dispatch.** Pass `task` with the concrete job. Under Rex the new tab's pi
  starts on it, so the work runs there while this session stays free. Steer it
  afterwards with the `rex send -b <block>` line the result returns, and read
  its screen with `rex capture -b <block>`. Do not poll it.
- **Do it here.** Work at `details.cwd`: `cd` there for commands, and use
  absolute paths under it for read, edit, and write.

Never edit the parent checkout and never call the worktree tool to "park" work
you then do in place. If the ack says the tab already existed, the task was not
sent: use the steer line, or work at the path.

Report the branch, the path, and which route you took.
