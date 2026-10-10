# Neovim Mermaid rendering (ASCII path)

Mermaid ```` ```mermaid ```` fences render as **ASCII/Unicode art** inside
Neovim — no headless Chromium, no ImageMagick. Two surfaces:

1. **Inline auto-render** (default): every fence in a markdown buffer renders
   automatically as Unicode box-drawing art in virtual lines below the fence,
   via the [`grok-mermaid`](https://www.npmjs.com/package/grok-mermaid) npm
   package — the same engine the pi agent TUI uses. The engine returns spans
   tagged with semantic classes (`border`/`text`/`edge`/`edgeLabel`/`title`),
   which map to `MermaidAscii*` highlight groups (gruvbox hexes matching the
   Ghostty palette: gray frames, aqua edges, fg labels, yellow edge labels;
   see `CLS_HL`/`CLS_FG` in the helper). Re-applied on `ColorScheme`.
2. **On-demand float** (`<leader>mm`): runs [`mmdflux`](https://github.com/kevinswiber/mmdflux)
   on the fence under the cursor and pops its ANSI-colored output in a Snacks
   terminal float. Use this when you want mmdflux's color (`classDef`/`linkStyle`)
   or its layout.

The inline-image (snacks.image + mmdc → PNG) path was prototyped and
**rejected** by the captain (render looked bad even after scale/size tuning);
see [Image path: tried and rejected](#image-path-tried-and-rejected) below.

## Inline auto-render (grok-mermaid)

- Helper: `nvim/.config/nvim/lua/helpers/mermaid_render.lua` (`setup_inline`,
  `render_buf`). Enabled from `plugins/markdown.lua` (render-markdown.nvim
  `init`) next to `helpers.markdown_ansi`.
- Fences are found with the same treesitter walk as the float path; each
  fence body is hashed (`sha256`) and the rendered art cached, so edits only
  re-render the changed fence. Renders run through `vim.system` → `node`,
  async, max one render in flight per fence.
- **Source hidden, revealed on cursor:** each fence is one `foldmethod=expr`
  fold (fence lines included) shown as a single dim `▸ mermaid source (N
  lines) — cursor here to edit` line. The art anchors to the line **above**
  the fence — virt_lines on a folded line do not render (verified with
  `nvim_win_text_height`), so anchoring outside the fold keeps the art
  visible while closed. `CursorMoved`/`CursorMovedI` open the fold while the
  cursor is inside the fence and close it when the cursor leaves. Buffer-local
  ranges live in `vim.b.mermaid_fences`; TS node end ranges are half-open
  (`end_col == 0` ⇒ `end_row` one past the last fence line) and are pulled
  back before folding.
- Engine resolution: `npm root -g` first, then pi's bundled copy
  (`~/.pi/agent/install/releases/*/node_modules/grok-mermaid`). Install with
  `npm install -g grok-mermaid`.
- snacks.image's mermaid PNG pipeline is disabled by the query shadow
  `nvim/.config/nvim/queries/markdown/images.scm` (a non-`extends` copy of
  snacks' query with the `mermaid` pattern removed; `math` is kept).

## On-demand float (mmdflux)

- **`<leader>mm`** (defined in `nvim/.config/nvim/lua/plugins/markdown.lua`,
  render-markdown.nvim `keys` table): with the cursor inside (or on) a
  ```` ```mermaid ```` fence, runs `mmdflux` on that fence's body and pops the
  ASCII/Unicode output in a **borderless Snacks terminal float**.
  The float is a `:terminal` buffer so the terminal driver renders mmdflux's
  ANSI color (from `classDef`/`linkStyle`) natively. Close with `q` or `<esc>`.
- Helper: `nvim/.config/nvim/lua/helpers/mermaid_render.lua`. It reuses the
  treesitter fenced-code-block walk from `helpers/markdown_ansi.lua` (matching
  `mermaid` instead of `ansi`) and pipes the fence body to
  `vim.system({ "mmdflux" }, { stdin = body })`.

If `mmdflux` is not on `$PATH`, `<leader>mm` shows
`mmdflux not installed — see docs/neovim-mermaid-render.md` instead of erroring.
Nothing auto-installs.

## Natural width + horizontal scroll (no width cap)

mmdflux renders at the **graph's natural width** — it has no
`--width`/`--columns`/`--term-width` flag (`mmdflux --help` confirms) and
**ignores both `COLUMNS` env and tty winsize** when stdin is a pipe (which is
our case). Empirically, the 4 real vault fences render at 51–372 visible
columns (`flowchart LR` layouts run widest); 3 of 4 exceed 80.

Because there is no width flag, the helper does **not** pass `COLUMNS` (an
earlier `COLUMNS=80` env was a no-op and has been removed); only `TERM` is
preserved so color queries resolve:

```lua
vim.system({ "mmdflux" }, {
  stdin = body,
  env = { TERM = vim.env.TERM or "xterm-256color" },
})
```

The Snacks float is sized to the diagram's natural width (visible columns,
ANSI SGR stripped), capped at the editor width so the float never overflows
the screen. Narrow graphs get a narrow float; wide graphs fill the editor.
The float window is opened with `wrap = false`, so a diagram wider than the
window scrolls **left/right** (`zl`/`zh`, or the terminal's own scroll)
instead of wrapping at the edge. No output is truncated.

Note: because the float is a `:terminal` buffer, the pty column count tracks
the window width, so a diagram wider than the editor still wraps at the
editor edge inside the terminal. That is the inherent limit of the `:terminal`
path; for a true hard cap on ultra-wide `LR` layouts, the real fix is an
upstream `--width` flag on `kevinswiber/mmdflux` — a feature request the
captain can file if a hard cap is ever wanted. (A scratch-buffer path would
preserve unlimited horizontal scroll but loses mmdflux's native ANSI color,
which is the reason the v1 chose `:terminal`.)

## Install `mmdflux` (captain's step — not auto-installed by this config)

`mmdflux` reads mermaid from stdin and writes ASCII/Unicode (ANSI-colored) to
stdout. Covers flowchart, class, sequence, state — all of the vault's current
fences (4 flowcharts).

**macOS (Homebrew):**
```sh
brew tap kevinswiber/mmdflux
brew install mmdflux
```

**Linux (homelab) / macOS without Homebrew — prebuilt static binary from GitHub
releases** (covers `linux-x86_64` and `darwin-arm64`):
```sh
# Pick the matching tarball from https://github.com/kevinswiber/mmdflux/releases
ver=v2.6.1          # latest as of writing; check the releases page
curl -L "https://github.com/kevinswiber/mmdflux/releases/download/${ver}/mmdflux-${ver}-linux-x86_64.tar.gz" | tar xz
sudo install -m 0755 mmdflux /usr/local/bin/mmdflux
```

Verify:
```sh
echo 'flowchart TD\n  A --> B' | mmdflux
```

## Validation

After install, open any vault file with a ```` ```mermaid ```` fence (scout
report §2 lists 4, all flowcharts — `1_projects/.../lab01-cuda-mma/lesson.md`,
`.../plan.md`, `professor-lessons/h100-matmul-modal/session.md`,
`3_logs/2025-W50/solver_pool_architecture.md`), place the cursor on the fence,
and press `<leader>mm`. The float should show the rendered graph with ANSI
color. The `lesson.md` fence (10-node DAG, `<br/>` multi-line labels,
branching/joining edges) is the strongest shape test.

## Image path: tried and rejected

The deferred upgrade below was prototyped on `feat-nvim-mermaid` (snacks.image
inline render: `mmdc` + puppeteer `--no-sandbox` for Ubuntu 24.04 AppMag → PNG
via kitty graphics). The captain rejected it: the render looked bad even after
raising the mmdc scale to 4x and capping the inline size. The pivot to the
inline ASCII path replaced it. If the image path is ever retried:

1. `npm install -g @mermaid-js/mermaid-cli` + ImageMagick; on Ubuntu 24.04
   mmdc needs a puppeteer config with `--no-sandbox` (AppArmor blocks
   Chromium's user-namespace sandbox).
2. Enable the Snacks `image` module `doc` opts (Snacks is already installed
   for the pickers).
3. Remove the `mermaid`-pattern shadow from
   `nvim/.config/nvim/queries/markdown/images.scm` so snacks' own query is
   used again.

Known stains from the rejected prototype that may still be on the host:
`@mermaid-js/mermaid-cli` is installed globally under nvm (removable with
`npm rm -g @mermaid-js/mermaid-cli`), and `~/.cache/nvim/snacks/image` holds
PNGs from it.

This ASCII path remains the surface for copy-pasteable text art and for any
environment where the image path is unavailable.
