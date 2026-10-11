# nvim DAP eval-helper test suite

## Purpose

This suite tests the debug eval helpers in `lua/plugins/dap.lua`. It runs
with no editor UI, no plugin manager, no network, and no debugger. The
spec is `nvim/tests/ci/dap_eval_spec.lua`.

## Overview (merged PRs)

- #23: a second `dapui.setup` call tripped E565 during Lazy config. The
  fix moved the icons into `opts`; Lazy merges them. The suite pins that
  shape: `opts` only, no `config` key.
- #24/#27: an accidental revert of the eval helpers shipped inside #24.
  The merge in #27 kept the revert; no test caught the loss. This suite
  pins every symbol through the real closures, so the same loss fails.
- #29: java STRINGIFY stays identity. The java adapter already returns
  the toString form.

## What the suite covers

- Symbol regression: `dap_eval_repl_split`, `expression_under_cursor`,
  `range_contains`, STRINGIFY, and the `<localleader>r` binding must stay
  reachable from the real spec closures (`H.upvalue`).
- `range_contains` matrix on a real buffer, bundled go parser: one-line
  node, multi-line node, nil node. Start and end are inclusive; each
  outside edge is false.
- `expression_under_cursor`: on `w.Header().Set("a", b)` the cursor inside
  `Header` yields `w.Header()`, not the whole chain. The cursor on a
  keyword, whitespace, an empty line, or a filetype with no parser
  yields nil.
- STRINGIFY dispatch: python wraps in `str()`; go, delve, and java stay
  identity. An unknown type falls back to identity.
- `dap_eval_repl_split`: no dap module, no session, a running session,
  no expression — each path notifies or returns, none throws. Happy
  path: one REPL open, reuse, focus back on the source window.
- Hover lifecycle, state steered, no timers: request payload, float
  open, keymaps, `last_expr` tracking, re-eval suppression,
  hover-buffer guard, focus branch, error path.
- `dap_yank_stringify` guards and dispatch; `get_cursor_expression` text
  and repl guard; `find_repl_window` detection; the FileType autocmd
  fires live and binds `<localleader>y`.

## How to run

Run `scripts/test-nvim-dap.sh` from the repository root. It finds nvim on
`PATH`, else in `~/.local/share/bob`, and runs the spec with
`nvim --headless -u NONE`. It prints one PASS line per case plus timing,
and exits non-zero on any FAIL. With no nvim, the default prints SKIP
and exits zero; `STRICT=1` makes it FAIL.

## Runtime and SLA

The entry finishes in about 30 ms. The SLA is 60 s per entry and 5 s per
spec. Every case stays deterministic: stubbed dap sessions, a synchronous
`vim.schedule` shim, no sleeps, no timers.

## Coverage result

| Function | Covered | Not covered |
|---|---|---|
| `range_contains`, `expression_under_cursor`, `get_cursor_expression` | full | — |
| STRINGIFY, `find_repl_window`, `dap_eval_repl_split`, `dap_yank_stringify` | full | — |
| `dap_eval_hover`, `_eval_state`, FileType autocmd | full, state steered | — |
| `close_hover`, CALL_TYPES, EXPRESSION_TYPES | indirect, via another function | direct call |
| idle autocmd, `reset_idle_timer` | structure only | timer behavior |

## Known gaps

- Real DAP sessions, delve plumbing, dap-ui live windows, the nvim-dap
  `config` body, and the 2 s idle timer all need a live debugger or a
  real event loop. Not tested. The spec clears the idle autocmds.
- Latent defect, not fixed: the manual focus branch in `dap_eval_hover`
  is dead code. Only the idle timer calls the function, always with
  `auto`. If a keymap ever calls it, the focused preview float closes
  at once: the preview close handler fires when the cursor leaves the
  source buffer. The spec pins the branch logic with a plain float.
  No code change was made.
- The register `+` prints a warning in the headless run: no clipboard
  provider exists there. The spec reads the unnamed register instead.
