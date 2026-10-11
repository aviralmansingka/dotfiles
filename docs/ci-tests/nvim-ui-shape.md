# nvim ui-shape test suite

## Purpose

This suite reads each Neovim UI and bootstrap file as a plain table in a headless editor. It pins the configuration keys of each file and catches drift that a parse check cannot see.

## Overview

The suite runs `nvim --headless -u NONE` and loads each spec file with
`dofile`. It starts no plugin manager. It opens no network socket.

Two defects drove this suite. First, the treesitter file ships two
fragments for one plugin. `vim.tbl_deep_extend` cannot merge lists, so
the table `opts` of the first fragment overwrites the base list, and
the function `opts` of the second fragment extends it. Before this
suite, the merged list named `tsx` and `typescript` twice. The fix
removed both entries from the base table. The suite now pins the full
merged list.

Second, lazy.nvim kept `rocks.enabled` on, but no plugin here uses
luarocks. The `checkhealth lazy` test then tried to install hererocks
on every machine. The fix set `rocks.enabled = false`, and the suite
pins this value. The suite also guards the bootstrap branch in
`config/lazy.lua`. That branch clones lazy.nvim from the network; the
test stubs the file system so it stays dead.

## What the suite covers

- colorizer: filetypes, `user_default_options`, load event.
- fidget: progress, display, notification, and window options.
- gitsigns: sign glyphs; every keymap `on_attach` sets; each map stays buffer-local and carries a description.
- trouble: load command, key list, behavior flags, symbols mode, icons.
- treesitter: the merged `ensure_installed` list; no parser appears twice.
- treesitter-context: load event; `max_lines`.
- which-key: the single `<leader>v` vault group.
- snacks-picker: file and grep sources, layout preset, `<C-b>` removal, `<leader>fp`.
- extend-mini-files: preview window width; the `<leader>e` key.
- toggleterm: terminal window options only.
- config/lazy.lua: extras import list; `rocks.enabled = false`; the `plugins` import resolves; the bootstrap branch never runs.
- config/keymaps.lua: exactly one insert-mode map, `<C-/>` to `<Esc>`.
- config/autocmds.lua: the `require("config.indent")` chain registers `IndentStance`.
- after/ftplugin/markdown.lua: the real `FileType` event sets `textwidth` 80, `colorcolumn` 80, `wrap`.
- luasnippets/groovy.lua: 13 snippets, every trigger, the dependency template, with LuaSnip stubbed.

## How to run

Run `scripts/test-nvim-ui-shape.sh` from the repository root. The
script finds nvim on `PATH`, else in `~/.local/share/bob`. Each check
prints its own `PASS` line with a timing. The script exits non-zero
when any check fails. When nvim is absent, the script prints `SKIP`
and exits zero; set `STRICT=1` to make the absence a failure.
The shared `scripts/test-nvim-headless.sh` also runs this spec by glob.

## Runtime and SLA

The whole entry finishes in about 25 ms on this host. The SLA is 60 s
for the entry and 30 s per case. Every case stays deterministic: no
`vim.wait`, no sleep above 10 ms. Run the entry twice before you merge.

## Coverage result

| File | Covered | Not covered |
|---|---|---|
| colorizer, fidget, treesitter, treesitter-context, which-key | all opts keys | — |
| gitsigns | signs, all keymap shape | map handlers (live plugin) |
| trouble | cmd, keys, flags, modes, icons | kind icon glyphs (spot check) |
| snacks-picker | picker opts, key shape | `<leader>fp` handler body |
| extend-mini-files | opts, key shape | handler body (live plugin) |
| toggleterm | terminal opts only | terminal key behavior (live) |
| config/lazy.lua | imports, rocks, defaults | bootstrap branch (dead by design) |
| config/keymaps.lua, config/autocmds.lua, after/ftplugin/markdown.lua | full behavior | — |
| luasnippets/groovy.lua | all triggers, templates | real LuaSnip expansion |

## Known gaps

These surfaces need a live environment. They stay out of this suite:
neovide GUI options and key handling; vim-tmux-navigator, which needs
a live tmux server; toggleterm key behavior in a live terminal; the
live apply of colorschemes; the lazy.nvim bootstrap branch, which
needs the network.
