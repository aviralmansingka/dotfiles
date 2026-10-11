# nvim markdown layer — CI tests

## Purpose

This suite guards the markdown layer of the Neovim config: the link
helpers, the mermaid renderer, the ANSI fences, and the plugin wiring.
It runs headless, offline, and with no plugin manager.

## Overview (merged PRs)

- **#99 ANSI fences.** `helpers/markdown_ansi.lua` renders ANSI colors
  inside fenced blocks. The suite keeps the reload and byte contracts.
- **#159 PencilSoft wrap.** PencilSoft re-enabled wrap in markdown buffers.
  The suite asserts the final window state: wrap stays off.
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
  section labels in the picker items. The FileType callback runs PencilSoft
  and still leaves wrap, number, and relativenumber off. The octo callback
  keeps its own width and format state. Every `<leader>` key is present,
  and `<leader>mm` reaches the mermaid guard. The wiring sets the parser,
  the conceal options, and the fence-detection autocmds; markdownlint
  skips herdr scrollback buffers.

## How to run

Run `scripts/test-nvim-markdown.sh` from the repository root. The script
finds nvim on `PATH`, else in `~/.local/share/bob`, and runs each spec
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
- `plugins/markdown.lua`: the pencil config, the lint opts, the wiring, and
  the `ft`, `fT`, and `mm` handlers are exercised. The `vf`, `vt`, `ot`,
  `ob`, and `ol` handlers belong to other clusters. The suite found no
  source bug; no source file changed.

## Known gaps

- Live mmdflux rendering, the real float display, and colorscheme
  rendering stay untested. They need a live binary and a real UI.
- The plugin has no enable/disable toggle and no timer debounce. The
  pending map acts as the debounce. The suite pins that state instead.
- The grok-mermaid node script runs stubbed, so its body is never run.
  The autolist keymap wiring stays untested; it needs the autolist plugin.
