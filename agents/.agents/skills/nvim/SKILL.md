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

## Invocation

Call the `nvim_open` tool to perform the launch. Pass the agent's current
working directory as `cwd`. If the user references a file by name rather
than by path, resolve it yourself before calling the tool — the extension
does not do natural-language resolution.

- **`/nvim`** (no arguments) → call `nvim_open` with `cwd` set to the
  agent's cwd and no `files`. Opens vim at the workspace root.

- **`/nvim <file> [<file>...]`** → call `nvim_open` with `cwd` set to the
  agent's cwd and `files` set to the listed paths. Relative paths are
  resolved against `cwd`.

## Example tool call

```json
{
  "name": "nvim_open",
  "parameters": {
    "cwd": "/home/user/project",
    "files": ["src/main.ts", "src/util.ts"]
  }
}
```

## Behavior

1. **Detect existing editor:** the extension inspects every pane in the
   current Herdr tab via `herdr pane list` + `herdr pane process-info`,
   looking for a foreground process named `vim` or `nvim`.
2. **If an editor exists:** files are sent to the running instance
   via `herdr pane send-text` with `:e <file>` ex commands (paths escaped
   with fnameescape semantics). The editor pane is focused using
   `herdr pane neighbor` + `herdr pane focus`. With no files, just the
   existing pane is focused. No second instance is launched.
3. **If no editor exists:** a new pane is created with
   `herdr pane split --current --direction right` and `vim` is launched
   in it. Focus moves to the editor pane.
4. **No Herdr:** falls back to a tmux split, or prints a manual command.
