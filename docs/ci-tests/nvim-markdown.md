# nvim markdown layer — CI tests

## Purpose

This suite guards the markdown layer of the Neovim config: the link
helpers, the mermaid renderer, the ANSI fences, and the plugin wiring.
It runs headless, offline, and with no plugin manager.

## Overview (merged PRs)

- **#99 ANSI fences.** `helpers/markdown_ansi.lua` renders ANSI colors
  inside fenced blocks. The suite keeps the reload and byte contracts.
- **#159 soft wrap.** vim-pencil is removed. Markdown keeps `wrap=false`,
  `textwidth=99`, and `colorcolumn=100` from `after/ftplugin/markdown.lua`,
  because the save hook hard-wraps prose at a visible width. LazyVim's
  `lazyvim_wrap_spell` autocmd sets markdown wrap on, so
  `lua/config/autocmds.lua` registers a later FileType autocmd that wins.
- **#181/#182/#272 mermaid render.** Mermaid fences render as ASCII art.
  The suite guards the render paths and the auto-render state machine.

## What the suite covers

- `markdown_links_spec`: the treesitter walk uses the parser bundled with
  nvim, not Mason. It tests URL select inside and around, URL edit through
  a stubbed input, URL-aware paste, the plain-paste fallback, the `+`
  register fallback, and the keymaps for markdown and octo buffers. A
  cursor with no link under it is a no-op.
- `mermaid_render_state_spec`: the suite stubs mmdflux and grok-mermaid. It
  asserts the bare argv, the stdin pipe, and the TERM env. A non-zero exit
  notifies and never crashes. Empty output and an empty fence notify too.
  `setup_inline` registers its autocmds once. The images.scm shadow removes
  the mermaid pattern and keeps math. A missing engine caches one error
  line per fence body. The pending map absorbs repeat triggers; a warm
  cache never re-spawns. Folds reveal on cursor entry; `foldtext` dims.
- `markdown_ansi_autocmds_spec`: a simulated reload registers the
  ColorScheme autocmd exactly once. A cleared group is restored when
  colorschemes switch. Parsing is pure across repeats. Conceal marks never
  rewrite buffer bytes. A yank returns the raw ANSI, byte for byte.
- `markdown_plugin_spec`: the suite loads the plugin file as a plain table
  and pins `vim.fn.expand` to a mktemp tree, never `~/vault`. It tests the
  pure path helpers, the prefix filters, the habit-section skip, and the
  section labels in the picker items. It also asserts that no vim-pencil
  entry exists, since the markdown ftplugin owns wrap, width, and the guide.
  Every `<leader>` key is present,
  and `<leader>mm` reaches the mermaid guard. The wiring sets the parser,
  the conceal options, and the fence-detection autocmds; markdownlint
  skips herdr scrollback buffers.
- `markdown_reader_spec`: the reader column helper, against a real window
  layout. It asserts the eligibility rules (markdown only, never octo, never
  a herdr scrollback capture, never a non-prose buftype), the 100-cell
  column and the 8-cell margin, and the auto rule (the column opens
  wherever it fits, and a narrow window stays alone). Open and
  close must leave two fillers, a centered text area, soft wrap off while
  open, the entry values back on exit, and `q`/`<Esc>` mapped only while
  open. `:write` keeps the fillers. A resize re-cuts them, a too-narrow
  resize, a buffer switch to an octo buffer, and a closed editing window
  drop them.
- `markdown_motions_spec`: `h`/`l`/`w`/`b`/`e` in markdown buffers, against
  the two conceal layers. The treesitter highlighter supplies the inline-link
  conceal (the `conceal ""` captures from the parser bundled with nvim, so no
  plugin bootstrap is needed); renderer extmarks supply the wiki-link brackets
  and a hidden destination. It asserts the forward and backward crossings,
  counts (`3l`, `2w`), multiword labels, UTF-8 byte columns, and the native
  fallbacks (`conceallevel=0`, no `n` in `concealcursor`, highlighter
  stopped, non-markdown buffers). Operator-pending and visual mode keep the
  native motions, and `.` still repeats the last change.

## How to run

Run `scripts/test-nvim-markdown.sh` from the repository root. The script
finds nvim on `PATH` and runs each spec
with `nvim --headless -u NONE` and the shared harness. It pins
`XDG_CONFIG_HOME` to a temp copy of the query shadow, so no stowed config
is read. A missing nvim prints SKIP and exits zero; `STRICT=1` makes it
fail. The shared headless entry also runs these by glob.

## Runtime and SLA

The entry finishes in about 0.08 seconds. Each spec stays under 25
milliseconds. The budget is 5 seconds per spec and 60 seconds for the
entry. The script fails on any spec failure or budget breach.

## Coverage result

- `markdown_links.lua`: all four exports are exercised.
- `mermaid_render.lua`: `render_float`, `setup_inline`, and `foldtext` are
  exercised here. `foldexpr` belongs to `mermaid_render_spec.lua`.
- `markdown_ansi.lua`: `setup` and `parse` are exercised here; `decode`
  and `encode` belong to `markdown_ansi_spec.lua`.
- `plugins/markdown.lua`: the lint opts, the wiring, and the `ft`, `fT`,
  and `mm` handlers are exercised. The `vf`, `vt`, `ot`, `ob`, and `ol`
  handlers belong to other clusters.
- `helpers/reader.lua`: `eligible`, `column_width`, `should_auto`, `enable`,
  `close`, `toggle`, `maybe_auto`, and `setup` are exercised. The filler
  windows and the resize path run against the headless screen.

## Known gaps

- Live mmdflux rendering, the real float display, and colorscheme
  rendering stay untested. They need a live binary and a real UI.
- The reader column is proven on the headless screen only; the real display
  (width 100 in a wide terminal) needs a live UI.
- The plugin has no enable/disable toggle and no timer debounce. The
  pending map acts as the debounce. The suite pins that state instead.
- The grok-mermaid node script runs stubbed, so its body is never run.
  The autolist keymap wiring stays untested; it needs the autolist plugin.
