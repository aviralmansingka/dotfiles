---
name: nvimr
description: >-
  Drive a running Neovim session over its RPC socket: list sessions in Herdr
  panes, open files, jump to lines, read buffers, get diagnostics, and run Ex
  commands. Use when the user asks to inspect or control an existing editor,
  check editor diagnostics, or says "in my editor" or "in Neovim".
---

# nvimr — neovim remote control

Control a running neovim session through its RPC socket. The `nvimr` script
auto-discovers the socket and runs lua via RPC, returning text output. It is
**Herdr-aware**: it can enumerate nvim sessions running inside Herdr panes and
target a specific pane's nvim.

## Setup

No setup needed. The script is self-contained at `./nvimr` in this skill
directory. nvim serves a default RPC socket at
`/run/user/<uid>/nvim.<pid>.0` automatically (no `--listen` flag required); the
`nvim` skill's launcher also opens a socket for nvimr to find.

Override knobs (env):
- `NVIM_BIN=` — nvim binary path if `nvim` is not on `PATH`.
- `NVIM_LISTEN_ADDRESS=` — force a specific socket path (wins over all auto-discovery).
- `HERDR_TIMEOUT=` — seconds for herdr CLI calls (default 5).

## Discovery and targeting

`nvimr` resolves a socket in this order:
1. `NVIM_LISTEN_ADDRESS` (explicit env).
2. The **focused Herdr pane's** nvim, if that pane is running nvim.
3. Any Herdr pane running nvim (first live).
4. Glob all nvim sockets (`/run/user/<uid>/nvim.*.0` and the nvim-skill temp
   dir), newest mtime first, first live one.

To target a specific pane instead of auto-resolving:

```bash
./nvimr --pane w43:p6 state
./nvimr --pane w43:p6 open ~/vault/AGENTS.md 23
```

To list every nvim session Herdr can see:

```bash
./nvimr sessions
```

A pane→socket link is made by reading the nvim process's `--listen <path>` from
`/proc/<pid>/cmdline`, else falling back to nvim's default
`/run/user/<uid>/nvim.<pid>.0` (the PID is embedded in the filename).

## Commands

All commands run as `./nvimr <command> [args]` from this skill directory.

### Sessions and targeting
```bash
./nvimr sessions            # List nvim sessions in herdr panes
./nvimr --pane <id> <cmd>   # Run <cmd> against a specific pane's nvim
```

### Inspect editor state
```bash
./nvimr socket              # Print the resolved socket path
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

- **Socket discovery**: prefers Herdr panes (see Discovery above), then globs
  `${TMPDIR}nvim.<user>/*/nvim.*.0` and `/run/user/<uid>/nvim.*.0`, tests each
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
- **Socket is ephemeral.** The path changes every nvim session (PID / temp dir).
  The script re-discovers on every invocation, so this is fine.
- **Herdr not running.** If herdr is unavailable, nvimr falls back to the socket
  glob and `NVIM_LISTEN_ADDRESS`. `sessions` prints nothing.
- **A pane's nvim must be the foreground process** for `--pane` and `sessions`
  to see it. nvim embedded as a non-interactive subprocess (`nvim --embed` without
  a tty in a pane) may show a socket but is not a drivable editor session —
  `sessions` filters by the pane's foreground process being `nvim`.

## Usage examples

```bash
# List nvim sessions across herdr panes
./nvimr sessions

# Target the focused pane's nvim
./nvimr open ~/vault/AGENTS.md 23
./nvimr diag

# Target a specific pane
./nvimr --pane w3Z:p1 open src/main.ts 42
./nvimr --pane w3Z:p1 read 0 20

# Inspect what's in the current buffer
./nvimr read 0 20

# Run an ex command
./nvimr cmd "grep -i 'TODO' %"
./nvimr cmd "lopen"
```
