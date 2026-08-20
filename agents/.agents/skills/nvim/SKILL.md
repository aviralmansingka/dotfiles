---
name: nvim
description: "Open a vim editor session in the folder the agent is working with. Launches vim as a vertical split in the current Herdr tab. If an editor is already running in that tab, sends files to the existing instance instead of launching a new one. When the cwd is inside a dotfiles checkout, uses the local nvim config instead of ~/.config/nvim. Use when the user wants to open an editor for the current workspace or specific files, says 'open in vim'/'nvim', 'edit', or types /nvim."
---

# Open Editor

Open a vim session for the current workspace or specific files. Vim
launches as a **vertical split to the right of the agent pane** in the
current Herdr tab. If an editor is already running in the current tab,
files are sent to the existing instance — a second instance is never
launched.

## Usage

Run the bundled shell script from this skill directory:

```bash
# Open vim at the agent's cwd
./nvim-open.sh "$(pwd)"

# Open specific files (relative paths resolved against cwd)
./nvim-open.sh "$(pwd)" src/main.ts src/util.ts
```

The script handles:
- **Detecting an existing editor** in the current Herdr tab via `herdr
  pane list` + `herdr pane process-info`, looking for `vim` or `nvim`.
- **Sending files to an existing editor** via `herdr pane send-text`
  with `:e <file>` ex commands (paths escaped with fnameescape
  semantics). The editor pane is focused using `herdr pane neighbor` +
  `herdr pane focus`.
- **Launching a new editor** via `herdr pane split --current --direction
  right` + `herdr pane run` when no editor exists.
- **tmux fallback** when Herdr is unavailable.
- **PATH augmentation** for common nvim installations (bob version
  manager, homebrew) that may not be on the agent's PATH.

## Dotfiles worktree config detection

When the cwd is inside a dotfiles checkout — including a git worktree or
any folder holding a branch of dotfiles code — the script detects the
local nvim config and launches nvim with `XDG_CONFIG_HOME` pointing at
it, so the editor uses the worktree's config instead of the global
`~/.config/nvim`.

Detection walks up the directory tree from cwd looking for
`nvim/.config/nvim/init.lua`. If found, `XDG_CONFIG_HOME` is set to
`<that-dir>/nvim/.config` for the launched nvim process.

When a dotfiles config is detected but an existing editor is already
running in the tab, files are still sent to it, but a warning is printed
noting that the existing editor may be using a different config. Close
and relaunch `/nvim` to pick up the worktree config.

If the user references a file by name rather than by path (e.g. "the
readme"), resolve it yourself before calling the script — the script
does not do natural-language resolution.
