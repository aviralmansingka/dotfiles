---
name: nvim
description: "Open a Neovim editor session in the folder the agent is working with. Launches nvim as a vertical split in the current Herdr tab. If nvim is already running in that tab, sends files to the existing instance instead of launching a new one. Use when the user wants to open nvim for the current workspace or specific files, says 'open in nvim', 'edit in neovim', or types /nvim."
---

# Open Neovim

Open a Neovim session for the current workspace or specific files. Neovim
launches as a **vertical split to the right of the agent pane** in the current Herdr
tab. If nvim is already running in the current tab, files are sent to the
existing instance — a second instance is never launched.

## Invocation

Call the `nvim_open` tool to perform the launch. Pass the agent's current
working directory as `cwd`.

- **`/nvim`** (no arguments) → call `nvim_open` with `cwd` set to the agent's
  cwd and no `files`. Opens nvim at the workspace root.

- **`/nvim <file> [<file>...]`** → call `nvim_open` with `cwd` set to the
  agent's cwd and `files` set to the listed paths. Relative paths are resolved
  against `cwd`.

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

1. **Detect existing nvim:** the extension inspects every pane in the current
   Herdr tab via `herdr pane list` + `herdr pane process-info`, looking for a
   foreground process named `nvim`.
2. **If nvim exists:** files are sent to the running instance (via nvim's RPC
   socket, discovered by PID, with a `herdr pane send-text` fallback). With no
   files, the existing nvim pane is focused. No second instance is launched.
3. **If no nvim exists:** a new pane is created with
   `herdr pane split --current --direction right` and `nvim` is launched in it.
   Focus moves to the nvim pane.
4. **No Herdr:** falls back to a tmux vertical split, or prints a manual command.
