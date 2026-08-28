# Neovim Mermaid rendering (mmdflux ASCII path)

Mermaid ```` ```mermaid ```` fences render to **ASCII/Unicode art** inside Neovim
via the [`mmdflux`](https://github.com/kevinswiber/mmdflux) binary — a single
static Rust binary, **no Node, no headless Chromium, no ImageMagick**. This is
the v1 surface; the inline-image upgrade is deferred (see
[Deferred image upgrade](#deferred-image-upgrade) below).

## Surface

- **`<leader>mm`** (defined in `nvim/.config/nvim/lua/plugins/markdown.lua`,
  render-markdown.nvim `keys` table): with the cursor inside (or on) a
  ```` ```mermaid ```` fence, runs `mmdflux` on that fence's body and pops the
  ASCII/Unicode output in a **Snacks terminal float** titled `mermaid render`.
  The float is a `:terminal` buffer so the terminal driver renders mmdflux's
  ANSI color (from `classDef`/`linkStyle`) natively. Close with `q` or `<esc>`.
- Helper: `nvim/.config/nvim/lua/helpers/mermaid_render.lua`. It reuses the
  treesitter fenced-code-block walk from `helpers/markdown_ansi.lua` (matching
  `mermaid` instead of `ansi`) and pipes the fence body to
  `vim.system({ "mmdflux" }, { stdin = body })`.

If `mmdflux` is not on `$PATH`, `<leader>mm` shows
`mmdflux not installed — see docs/neovim-mermaid-render.md` instead of erroring.
Nothing auto-installs.

## 80-column width cap

The rendered ASCII/Unicode grid is capped at **80 columns**. mmdflux has no
documented `--width`/`--columns`/`--term-width` flag; it auto-detects width
(via `COLUMNS` env or tty size, falling back to a default when stdin is a
pipe — which is our case). The helper enforces the cap by spawning mmdflux
with `COLUMNS=80` (and `TERM` preserved) in the `vim.system` env:

```lua
vim.system({ "mmdflux" }, {
  stdin = body,
  env = { COLUMNS = "80", TERM = vim.env.TERM or "xterm-256color" },
})
```

The Snacks float width is also clamped to 80 columns so the terminal doesn't
widen past the rendered art. The cap applies to the v1 on-demand float; any
future v2 inline render must apply the same `COLUMNS=80` env when spawning
mmdflux.

**Captain action after install:** run `mmdflux --help` and check for an
explicit `--width`/`--columns`/`--term-width` flag. If one exists, prefer it
over the `COLUMNS` env var and update `helpers/mermaid_render.lua` + this doc.
If mmdflux ignores `COLUMNS` and queries the tty instead (stdin is a pipe, so
it likely falls back to `COLUMNS` or a default), report that here and switch to
the flag or a pty wrapper.

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

## Deferred image upgrade (later, out of scope for v1)

A higher-fidelity inline-image path exists and is the intended eventual upgrade,
**gated on Herdr's `kitty_graphics` flag graduating from experimental**. It is
deliberately NOT shipped here. When the flag graduates, the upgrade is:

1. **Herdr config:** `[experimental] kitty_graphics = true` in
   `~/.config/herdr/config.toml`, then `herdr server reload-config` (or restart).
   Today this flag is "experimental and disabled by default … enable it only
   when testing terminal image behavior" (`herdr.dev/docs/configuration`).
2. **Homelab deps:** `npm install -g @mermaid-js/mermaid-cli` (Node already
   present) + ImageMagick. `mmdc` emits SVG; ImageMagick converts SVG→PNG for
   the kitty graphics protocol.
3. **nvim:** enable the Snacks `image` module in the existing Snacks lazy spec
   — an `opts` change only (Snacks is already on disk as a dependency for the
   pickers). Snacks Image has a built-in `convert.mermaid` handler that renders
   ```` ```mermaid ```` fences inline via `mmdc`→SVG→ImageMagick→PNG, overlaid
   with a kitty-graphics `U+10EEEE` Unicode placeholder. Covers **all** diagram
   types (flowchart, sequence, state, ER, gantt, …) pixel-perfect.
4. **Validate:** `:checkhealth snacks` → `ghostty ✓`, `mmdc ✓`, `magick ✓`,
   kitty graphics ✓. Ripcord for pivoting back to the ASCII path: escapes never
   reach Ghostty with the flag on and all deps green; degraded modes
   (stale-on-reattach, slow cold start) are livable, not pivot triggers.

This ASCII path remains the fallback for copy-pasteable text art and for any
environment where the image path is unavailable.
