# run-command CI tests

## Purpose

The suite guards the `run-command` extension. The tool shows one command to
the user. The user runs it. The tool captures the output. The tests keep
every capture path working.

## What the suite covers

- **C1 capture wrapper.** The tests run `buildNvimTerminalScript` under
  `sh`, `bash`, `zsh`, and `dash`. A missing shell is skipped. The tests
  check: markers stay out of the captured file; the EXIT trap records the
  exit code; `exit N` inside the subshell keeps the wrapper alive; the
  pipeline status acts as fallback when the trap fails. `extractMarkedOutput`
  handles echo-corrupted buffers, partial markers, missing markers, and a
  non-numeric status.
- **C2 Lua RPC escaping.** A fake `nvim` records every `--remote-expr`
  payload. The tests decode each payload back through the Vim string rules.
  Every Lua chunk must survive the JS, JSON, and Vim round trip. No chunk may
  hold a raw newline inside a Lua string literal. A Lua interpreter, when
  installed, must compile every chunk under `load()`.
- **C3 nvim discovery and float lifecycle.** A fake `herdr` stages pane
  responses. The tests check: both `--listen` argv forms parse;
  `NVIM_LISTEN_ADDRESS` overrides discovery; the pid-based default socket
  works; the focused pane wins; the same-tab pane beats the other-tab pane; a
  dead socket is skipped. The float path closes its window and wipes its
  buffer. The host pane stays open. With no drivable nvim, the code splits a
  new pane and closes that pane after the run.
- **C4 large-paste expansion.** Both manual submit paths send the expanded
  paste. The visible editor keeps the compact marker. Small pastes and
  auto-capture stay unchanged.
- **C5 y copy-and-focus.** The `y` key copies the command and focuses the
  output field. The hint text switches. The clipboard is stubbed.
- **Panel guards.** `Esc` cancels an auto-run. A float that cannot open shows
  an error; manual paste still submits. An empty command, a missing UI, and
  an aborted signal return the correct status. `Enter` on an empty field
  focuses the field.
- **Self-description.** The description, promptSnippet, and promptGuidelines
  keep the learning-only clause.

## How to run

```sh
npm install --prefix /tmp/rc-jiti jiti@2 typebox@1.3.27
export JITI_PATH=/tmp/rc-jiti/node_modules/jiti/lib/jiti.cjs
export NODE_PATH=/tmp/rc-jiti/node_modules
node pi/.pi/agent/extensions/run-command.test.mjs
```

Set `RUN_COMMAND_SHOW_PANEL=1` or `RUN_COMMAND_SHOW_RENDERERS=1` to print
panel frames.

## Runtime and SLA

The suite runs in about 1.3 s. The budget for the file is 5 s. The suite is
offline and deterministic. It spawns real shells plus fake `nvim` and
`herdr` binaries from a temp PATH. One staged partial poll adds 250 ms; that
delay comes from the production wait loop, not from the test. All other
waits use 2 ms event-loop ticks with a bound.

## Coverage result

c8, `--include` on `run-command.ts` and `run-command/**`:

| File | Statements | Before |
|------|-----------|--------|
| run-command.ts | 95.6 % | 54.4 % |
| run-command/nvim-terminal.ts | 100 % | 100 % |
| run-command/render.ts | 98.7 % | 98.7 % |

## Known gaps

- The 120 s hard timeout path is not covered.
- The `getuid` socket fallback without `XDG_RUNTIME_DIR` is not covered.
- The split-pane launch failure branches are not covered. The float failure
  branch is covered.
- The Lua compile gate skips when no Lua interpreter is installed.
- Some reported uncovered lines are jiti source-map artifacts, not dead code.
