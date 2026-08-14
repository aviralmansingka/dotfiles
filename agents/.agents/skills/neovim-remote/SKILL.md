---
name: neovim-remote
description: Take high-level actions in the running neovim session via its RPC socket — open files, jump to lines, read buffers, get diagnostics, run ex commands, and inspect editor state. Use when the user asks to do something in their editor, open/navigate files, check diagnostics, or says "in my editor" / "in neovim".
---

# Neovim Remote

Control the running neovim session through its RPC socket. The `nvimr` script
auto-discovers the socket, runs lua via RPC, and returns text output.

## Setup

No setup needed. The script is self-contained at `./nvimr` in this skill
directory. It auto-discovers the nvim Unix socket from the nvim temp dir
(`${TMPDIR}nvim.<user>/*/nvim.<pid>.0`) and verifies liveness before use.

Set `NVIM_BIN=` to override the nvim binary path if `nvim` is not on `PATH`.
Set `NVIM_LISTEN_ADDRESS=` to force a specific socket.

## Commands

All commands are run as `./nvimr <command> [args]` from this skill directory.

### Inspect editor state
```bash
./nvimr socket              # Print the discovered socket path
./nvimr state               # Current buf, cursor, mode, cwd, window list
./nvimr buffers             # List all listed, loaded buffers
./nvimr diag [buf]          # Diagnostics for buffer (default: current)
./nvimr read [buf] [n]      # First n lines of buffer (default: current, 50)
```

### Take actions
```bash
./nvimr open <path> [line]  # Open file in an editable window, goto line
./nvimr goto <line> [col]   # Move cursor in current editable window
./nvimr cmd <ex-command>    # Run ex command (e.g. "w", "grep foo", "lopen")
./nvimr keys <keys>         # Send raw keystrokes (see caveat below)
./nvimr lua <file>          # Run an arbitrary lua file, get printed output
```

## How it works

- **Socket discovery**: globs `${TMPDIR}nvim.<user>/*/nvim.<pid>.0`, tests each
  with `nvim --server SOCK --remote-expr '1'`, returns the first live one.
- **Lua execution**: writes lua to a temp file, wraps it in a `print`-capturing
  harness, and runs `nvim --server SOCK --remote-expr 'luaeval("load(...)()", ...)'`.
  The `load(...)()` trick is the only reliable way to run multi-line lua via
  `--remote-expr`.
- **Window selection**: `open` and `goto` skip terminal/nofile/quickfix windows
  and pick the first editable window, so they work even when a terminal pane
  has focus.

## Caveats

- **`keys` is unreliable when a terminal buffer has focus.** Terminal buffers
  capture `--remote-send` input. Prefer `cmd` (ex commands via `vim.cmd`) or
  `open`/`goto` for navigation.
- **No persistent notification history.** Noice keeps messages in memory only
  and its manager is not introspectable via RPC. Use `:Noice` inside nvim to
  browse notification history.
- **Socket is ephemeral.** The path changes every nvim session (random temp dir
  + PID). The script re-discovers on every invocation, so this is fine.

## Usage examples

```bash
# Open a file at a specific line
./nvimr open ~/vault/AGENTS.md 23

# Check what's in the current buffer
./nvimr read 0 20

# Get diagnostics for the current buffer
./nvimr diag

# Run an ex command
./nvimr cmd "grep -i 'TODO' %"
./nvimr cmd "lopen"

# Inspect full editor state
./nvimr state
```
