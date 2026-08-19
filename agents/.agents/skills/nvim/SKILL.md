---
name: nvim
description: "Open a Neovim/vim editor session in the folder the agent is working with. Launches vim as a vertical split in the current Herdr tab. If an editor is already running in that tab, sends files to the existing instance instead of launching a new one. Accepts natural-language file references (e.g. 'the readme', 'the extension file') and resolves them via a small LLM call, prompting with a multiple-choice selection if uncertain. Use when the user wants to open an editor for the current workspace or specific files, says 'open in vim'/'nvim', 'edit', or types /nvim."
---

# Open Editor

Open a vim session for the current workspace or specific files. Vim
launches as a **vertical split to the right of the agent pane** in the
current Herdr tab. If an editor is already running in the current tab,
files are sent to the existing instance — a second instance is never
launched.

## Natural-language file resolution

The `/nvim` command accepts both direct file paths and natural-language
references:

- **Direct paths**: `/nvim src/main.ts README.md` — opens those files
  directly.
- **Natural language**: `/nvim the readme` or `/nvim open the extension
  file we just edited` — runs a small LLM call to resolve the reference
  against the files in the agent's cwd.

If the LLM is confident about the match, the file is opened automatically.
If it is uncertain, a **numbered multiple-choice menu** is presented in the
terminal — the user selects the intended file by number or presses Enter
to cancel.

## Invocation

Call the `nvim_open` tool to perform the launch. Pass the agent's current
working directory as `cwd`.

- **`/nvim`** (no arguments) → call `nvim_open` with `cwd` set to the
  agent's cwd and no `files`. Opens vim at the workspace root.

- **`/nvim <file> [<file>...]`** → call `nvim_open` with `cwd` set to the
  agent's cwd and `files` set to the listed paths or natural-language
  references. Relative paths are resolved against `cwd`.

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

1. **Resolve file references:** direct file paths are used as-is.
   Natural-language queries are resolved via a small LLM call that lists
   files in the cwd and asks the model to match. Uncertain matches prompt
   a numbered multiple-choice selection.
2. **Detect existing editor:** the extension inspects every pane in the
   current Herdr tab via `herdr pane list` + `herdr pane process-info`,
   looking for a foreground process named `vim` or `nvim`.
3. **If an editor exists:** files are sent to the running instance (via
   nvim's RPC socket, discovered by PID, with a `herdr pane send-text`
   fallback). With no files, the existing pane is focused. No second
   instance is launched.
4. **If no editor exists:** a new pane is created with
   `herdr pane split --current --direction right` and `vim` is launched
   in it. Focus moves to the editor pane.
5. **No Herdr:** falls back to a tmux split, or prints a manual command.
