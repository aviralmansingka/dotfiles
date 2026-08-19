---
name: nvim
description: "Open a vim editor session in the folder the agent is working with. Launches vim as a vertical split in the current Herdr tab. If an editor is already running in that tab, sends files to the existing instance instead of launching a new one. Use when the user wants to open an editor for the current workspace or specific files, says 'open in vim'/'nvim', 'edit', or types /nvim."
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

If the user references a file by name rather than by path (e.g. "the
readme"), resolve it yourself before calling the script — the script
does not do natural-language resolution.
