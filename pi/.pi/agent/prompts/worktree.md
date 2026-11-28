---
description: Start isolated work in a Pi tab for human follow-up
argument-hint: "[branch or theme]"
---
An explicit `/worktree` request opts in to a separate tab. Otherwise, start a
worktree session only when the user will need to review, steer, or resume the
work there and the work benefits from Git isolation. For bounded work with
no human follow-up in its own tab, stay in the current checkout or use a
subagent. Follow the repository's checkout rules.

The text after the command is: ${@:-the changes discussed in this conversation}

Decide the details yourself. Do not ask the user to choose a branch, a type,
or a base.

- If the text names a branch or worktree (`feat/x`, `fix/y`, `dark-mode`), use
  that name.
- Otherwise derive `<type>/<slug>` from the text and the conversation. Pick the
  type from feat, fix, explore, chore, task.
- Call the worktree tool with `base: "main"` and a required, non-empty
  `task`. Include the goal, relevant context, and checks. The tool refuses a
  missing, empty, or whitespace-only task, so always write one; there is no
  idle tab.

Opening a tab is not proof that the task was dispatched. Check the result:

- If `details.dispatched` is true, the new Rex tab owns the task. Use the
  returned steer line for follow-ups. Do not duplicate the work or poll it.
- If dispatch did not happen, use the returned steer line if it targets an
  existing Pi session. Otherwise, continue at `details.cwd` yourself or pass
  it as the subagent's `cwd`. Run commands and edit files in that checkout.

Do not do the task in the parent checkout. Report the branch, the path, and
where the task is running.
