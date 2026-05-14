# Codeium (windsurf.nvim) Integration — Design

**Status:** Approved (pending user spec-review)
**Date:** 2026-05-13
**Repo target:** `Exafunction/windsurf.nvim` (lua module remains `require("codeium")`; `Exafunction/codeium.nvim` redirects)

## 1. Goal

Replace the Copilot-LSP-driven Next Edit Suggestions (NES) integration in
`sidekick.nvim` with a standalone Codeium (Windsurf) virtual-text completion
flow that:

- Renders inline AI ghost text as the user types, themed for gruvbox-material.
- Plays nicely with the existing `blink.cmp` menu (LSP/snippets/buffer/etc.)
  via deterministic smart-tab and smart-cycle handlers.
- Surfaces status in the existing custom lualine bar.
- Uses no `<M-*>` bindings (Aerospace claims Meta) and no `<C-]>` (toggleterm
  reserves it). All bindings audited against the current config before
  assignment.
- Disables suggestions in prose, picker, terminal, and tree filetypes.
- Lets sidekick.nvim's CLI-session machinery (claude/codex/cursor/opencode)
  continue unchanged.

## 2. Non-goals

- No nvim-cmp source. We use blink.cmp; `enable_cmp_source = false`.
- No Codeium chat. `enable_chat = false`. Chat is covered by sidekick's CLI
  agents.
- No retention of the Copilot language server. NES is gone entirely — there
  is no fallback Copilot path.
- No enterprise/self-hosted Codeium endpoint (free-tier defaults only).

## 3. Architecture

Four concerns, separated by file:

1. **Plugin spec** — new `nvim/.config/nvim/lua/plugins/codeium.lua`.
   windsurf.nvim install, `setup()` options, lazy `keys =` for toggle bindings,
   `config = function()` wires statusline refresh.

2. **Smart-tab / cycle / dismiss / trigger** — edits to
   `nvim/.config/nvim/lua/plugins/blink-cmp.lua`. blink owns every Tab and
   `<C-*>` interaction; the windsurf plugin's `accept`, `next`, `prev`, and
   `clear` bindings are explicitly disabled so blink is the single dispatch
   point. blink's own `completion.ghost_text.enabled` flips to `false` to
   avoid stacking grey text with Codeium's virt_text.

3. **NES removal** — three small edits:
   - `nvim/.config/nvim/lua/plugins/lsp.lua` — delete the `opts.servers.copilot = {}` line.
   - `nvim/.config/nvim/lua/plugins/mason.lua` — delete the `"copilot-language-server"` entry.
   - `nvim/.config/nvim/lua/plugins/sidekick.lua` — delete the `<tab>` keymap block.

4. **Theming + statusline** —
   - `nvim/.config/nvim/lua/plugins/colorscheme.lua` defines `CodeiumSuggestion`
     highlight inside the existing `ColorScheme` autocmd, matching the
     `BlinkGhostText` family.
   - `nvim/.config/nvim/lua/plugins/lualine.lua` adds a Codeium segment to
     `lualine_x`, reading `require("codeium.virtual_text").status_string()`.

No new directories. No extension of sidekick's CLI surface.

## 4. File-by-file changes

### 4.1 `nvim/.config/nvim/lua/plugins/codeium.lua` (new file)

```lua
return {
  "Exafunction/windsurf.nvim",
  dependencies = { "nvim-lua/plenary.nvim" },
  event = "InsertEnter",
  cmd = { "Codeium" },
  build = ":Codeium Auth",  -- one-time prompt after first install
  keys = {
    {
      "<leader>ai",
      function()
        -- Default state is "enabled"; explicit false suppresses ghost text.
        local current = vim.b.codeium_enabled
        if current == nil then current = true end
        vim.b.codeium_enabled = not current
        if not vim.b.codeium_enabled then
          pcall(require("codeium.virtual_text").clear)
        end
        vim.notify("Codeium " .. (vim.b.codeium_enabled and "enabled" or "disabled") .. " (buffer)")
      end,
      desc = "Codeium: toggle buffer",
    },
    {
      "<leader>aI",
      "<cmd>Codeium Toggle<cr>",
      desc = "Codeium: toggle global",
    },
  },
  config = function()
    require("codeium").setup({
      enable_chat = false,
      enable_cmp_source = false,
      virtual_text = {
        enabled = true,
        manual = false,
        idle_delay = 75,
        map_keys = false,             -- blink owns Tab / C-n / C-p / S-Tab
        default_filetype_enabled = true,
        filetypes = {
          -- prose / commit messages
          markdown = false,
          gitcommit = false,
          gitrebase = false,
          text = false,
          help = false,
          -- pickers / file explorers / dashboards
          oil = false,
          ["neo-tree"] = false,
          snacks_picker = false,
          snacks_dashboard = false,
          TelescopePrompt = false,
          ["mini-files"] = false,
          ["mini.files"] = false,
          NvimTree = false,
          -- chat / agent surfaces
          codecompanion = false,
          sidekick_terminal = false,
          -- meta UIs
          lazy = false,
          mason = false,
          toggleterm = false,
          terminal = false,
        },
        key_bindings = {
          accept = false,             -- blink Tab handler
          accept_word = false,
          accept_line = false,
          clear = false,              -- blink S-Tab handler
          next = false,                -- blink C-n handler
          prev = false,                -- blink C-p handler
        },
      },
    })
    -- Refresh lualine on completion state changes.
    pcall(function()
      require("codeium.virtual_text").set_statusbar_refresh(function()
        require("lualine").refresh()
      end)
    end)

    -- Per-buffer disable enforcement: windsurf has no documented
    -- :CodeiumDisableBuffer command. Ghost text is suppressed by clearing
    -- it on every text/cursor change when vim.b.codeium_enabled is false.
    -- Requests still fire (negligible cost) but never render.
    local aug = vim.api.nvim_create_augroup("codeium_buffer_toggle", { clear = true })
    vim.api.nvim_create_autocmd({ "TextChangedI", "InsertEnter", "BufEnter" }, {
      group = aug,
      callback = function(args)
        if vim.b[args.buf].codeium_enabled == false then
          pcall(require("codeium.virtual_text").clear)
        end
      end,
    })
  end,
}
```

Notes on choices:

- `map_keys = false` and individual `key_bindings.* = false` are both set
  because the upstream code path checks `map_keys` first, but defense-in-depth
  is cheap.
- `event = "InsertEnter"` loads the plugin only when the user starts typing —
  faster startup, since auth/completion-request setup is non-trivial.
- `build = ":Codeium Auth"` triggers the auth prompt the first time the
  plugin is installed by lazy.nvim. Re-runs do nothing if already authed.

### 4.2 `nvim/.config/nvim/lua/plugins/blink-cmp.lua` (edit)

Three changes:

1. Flip `completion.ghost_text.enabled` from `true` → `false`.
2. Add four entries to `keymap`: `<Tab>`, `<S-Tab>`, `<C-n>`, `<C-p>`, `<C-Space>`.
3. No change to `<C-l>` / `<C-h>` (snippet fwd/back), `<C-b>` (still false).

```lua
-- helper used by all smart handlers
local function codeium_visible()
  local ok, vt = pcall(require, "codeium.virtual_text")
  if not ok then return false end
  local s = vt.status()
  return s and s.state == "completions" and (s.total or 0) > 0
end

keymap = {
  preset = "default",
  ["<C-b>"] = false,
  ["<C-l>"] = { "snippet_forward", "fallback" },
  ["<C-h>"] = { "snippet_backward", "fallback" },

  ["<Tab>"] = {
    function()
      if codeium_visible() then
        require("codeium.virtual_text").accept()
        return true
      end
      return false  -- fall through to next handler
    end,
    "select_and_accept",
    "fallback",
  },

  ["<S-Tab>"] = {
    function()
      if codeium_visible() then
        require("codeium.virtual_text").clear()
        return true
      end
      return false
    end,
    "hide",
    "fallback",
  },

  ["<C-n>"] = {
    function()
      if codeium_visible() then
        require("codeium.virtual_text").cycle_completions(1)
        return true
      end
      return false
    end,
    "select_next",
    "fallback",
  },

  ["<C-p>"] = {
    function()
      if codeium_visible() then
        require("codeium.virtual_text").cycle_completions(-1)
        return true
      end
      return false
    end,
    "select_prev",
    "fallback",
  },

  ["<C-Space>"] = {
    function()
      local ok, vt = pcall(require, "codeium.virtual_text")
      if ok then pcall(vt.complete) end
      return false  -- always still let blink "show"
    end,
    "show",
    "fallback",
  },
},

completion = {
  -- ...existing fields unchanged...
  ghost_text = { enabled = false },  -- was true; Codeium owns inline preview now
},
```

**Caveat on `M.accept()`:** upstream defines it with `expr = true`. Calling it
as a plain function from inside blink's keymap handler runs its side effects
(consume `current_completion`, render the inserted text via
`nvim_buf_set_text`) — verified by reading
`lua/codeium/virtual_text.lua`. The expr-return-string path is bypassed,
which is fine because blink already handles cursor-position and key consumption.

Verification step in §11 will exercise this end-to-end.

### 4.3 `nvim/.config/nvim/lua/plugins/lsp.lua` (edit)

Delete lines 51-52:
```lua
    -- Copilot language server for Sidekick NES
    opts.servers.copilot = {}
```

### 4.4 `nvim/.config/nvim/lua/plugins/mason.lua` (edit)

Delete line 6:
```lua
      "copilot-language-server",
```

### 4.5 `nvim/.config/nvim/lua/plugins/sidekick.lua` (edit)

Delete lines 62-71 (the `<tab>` keymap block). All other sidekick bindings
(`<c-;>`, `<c-.>`, `<leader>a*`) and the `config = function()` body remain
unchanged.

### 4.6 `nvim/.config/nvim/lua/plugins/colorscheme.lua` (edit)

Add inside the existing `ColorScheme` autocmd `callback`, adjacent to
`BlinkGhostText`:

```lua
-- Codeium AI ghost text — matches BlinkGhostText family, italic to distinguish
-- AI suggestions from snippet/menu previews.
vim.api.nvim_set_hl(0, "CodeiumSuggestion", {
  fg = "#665c54",  -- gruvbox grey, identical to BlinkGhostText
  bg = "#282828",  -- matched float bg
  italic = true,
})
```

### 4.7 `nvim/.config/nvim/lua/plugins/lualine.lua` (edit)

Insert a new Codeium component at the head of `lualine_x` (before `filetype`),
using existing `colors` palette:

```lua
{
  function()
    local ok, vt = pcall(require, "codeium.virtual_text")
    if not ok then return "" end
    local s = vt.status_string()
    if s == "" or s == "0" then return "" end
    return "󰚩 " .. s   -- nf-md-robot + "3/8" or "*"
  end,
  cond = function()
    return package.loaded["codeium"] ~= nil
  end,
  color = { fg = colors.green },
},
```

The `cond` ensures the segment renders nothing before the plugin lazy-loads.
The `pcall` guards against `set_statusbar_refresh` firing before the module
is fully initialized.

## 5. Keymap surface (final)

All bindings are insert mode unless noted. Conflict-audit results in the
"Audit" column.

| Key | Action | Where bound | Audit |
|---|---|---|---|
| `<Tab>` | smart-accept: Codeium ghost > blink item > literal | blink-cmp `keymap` fn | reclaims sidekick NES Tab (being removed) |
| `<S-Tab>` | smart-reject: Codeium dismiss > blink hide > literal | blink-cmp `keymap` fn | autolist `<S-Tab>` is markdown-only; Codeium disabled in markdown — no overlap |
| `<C-n>` | smart-cycle next: Codeium alt > blink next | blink-cmp `keymap` fn | vim native completion next (overridden by blink today already) |
| `<C-p>` | smart-cycle prev: Codeium alt > blink prev | blink-cmp `keymap` fn | vim native completion prev (overridden by blink today already) |
| `<C-Space>` | trigger Codeium + show blink | blink-cmp `keymap` fn | blink default `show`; we extend |
| `<leader>ai` | toggle Codeium for current buffer | windsurf plugin `keys =` | free in `<leader>a*` namespace |
| `<leader>aI` | global enable/disable | windsurf plugin `keys =` | free |
| `:Codeium Auth` | first-time auth | upstream command | n/a |
| `:Codeium Toggle` | global toggle | upstream command | wrapped by `<leader>aI` |

Explicitly **not** bound (per Aerospace / toggleterm / tmux constraints):

- `<M-]>`, `<M-[>`, `<M-\>` — Aerospace claims all Meta.
- `<C-]>` — toggleterm normal mode.
- `<C-\>` — vim-tmux-navigator (previous pane).
- `<C-h/j/k/l>` — vim-tmux-navigator (directional panes); `<C-l>` / `<C-h>`
  ALSO blink snippet fwd/back inside completion menu only.
- `<C-/>` — Esc in insert (`keymaps.lua:6`).

## 6. Filetype scope

Enabled by default (`default_filetype_enabled = true`). Explicit `false`
overrides for:

| Category | Filetypes |
|---|---|
| Prose | `markdown`, `gitcommit`, `gitrebase`, `text`, `help` |
| Pickers | `snacks_picker`, `snacks_dashboard`, `TelescopePrompt` |
| Trees / browsers | `oil`, `neo-tree`, `mini-files`, `mini.files`, `NvimTree` |
| Agent surfaces | `codecompanion`, `sidekick_terminal` |
| Meta UIs | `lazy`, `mason`, `toggleterm`, `terminal` |

Rationale: markdown disabled per user instruction (avoids collisions with
obsidian completion sources and the prose-rewrap workflow). Pickers /
browsers / terminals disabled because virtual_text in those buffers is
visual noise and the underlying buffer is not user-edited prose-or-code.

## 7. Theming

Single highlight group defined by upstream: `CodeiumSuggestion` (set with
`default = true`, so any explicit `:hi` wins).

```lua
vim.api.nvim_set_hl(0, "CodeiumSuggestion", {
  fg = "#665c54",
  bg = "#282828",
  italic = true,
})
```

- `#665c54` is the existing `BlinkGhostText` foreground (matches gruvbox
  grey4). Same visual family as snippet/menu preview, so the user has one
  consistent "subtle grey" for any inline preview.
- `italic = true` distinguishes AI suggestions from snippet previews. Subtle
  but present.
- No new float windows — windsurf is pure virt_text; no `FloatBorder`
  variants needed.

## 8. Lualine status segment

Component reads `require("codeium.virtual_text").status_string()`, which
returns:

| Return | Meaning | Rendered as |
|---|---|---|
| `""` or `"0"` | idle, no completions | (hidden) |
| `"*"` | request in flight | `󰚩 *` (orange) |
| `"3/8"` | suggestion 3 of 8 | `󰚩 3/8` (green) |

Refresh hook wired via `set_statusbar_refresh(function() lualine.refresh() end)`
inside the plugin's `config`. Without this, the status string is stale until
the next mode/cursor event.

Color uses `colors.green` from the existing palette (matches diff-add and
H3 markdown headings — already in heavy use, visually familiar).

## 9. Common action flows

### Flow 1 — Accept Codeium suggestion

```
1. user types         def parse_config(path):
2. user types             with open(path) as f:
3. (idle 75ms)        Codeium fetches in background
4. ghost text         data = json.load(f)
                      return Config(**data)
5. <Tab>              blink Tab handler: codeium_visible() → vt.accept()
6.                    suggestion inserted, ghost cleared
```

### Flow 2 — Reject Codeium

```
1. ghost text visible
2. <S-Tab>            blink S-Tab handler: codeium_visible() → vt.clear()
3.                    ghost text disappears immediately
4. (continue typing)  blink menu shows LSP/snippet/buffer
5. <CR> or <C-y>      accept blink item (unchanged from today)
```

### Flow 3 — Cycle Codeium alternatives

```
1. ghost text visible, lualine shows "󰚩 1/5"
2. <C-n>              vt.cycle_completions(1) → suggestion #2
3. <C-n>              → #3
4. <C-p>              → back to #2
5. <Tab>              accept current
   - or -
   <S-Tab>            dismiss
```

### Flow 4 — Manual trigger

```
1. cursor mid-line, no ghost text (idle not elapsed, or filetype borderline)
2. <C-Space>          blink C-Space handler:
                      1. vt.complete()      ← request Codeium
                      2. fallback to "show" ← open blink menu
3. blink menu opens; ~200ms later Codeium ghost appears
4. <Tab> for Codeium, <CR> for blink item, <S-Tab> to dismiss Codeium
```

### Flow 5 — Both UIs visible simultaneously

```
blink menu open AND Codeium ghost text rendered:
  <Tab>    → Codeium accept (ghost wins)
  <S-Tab>  → Codeium dismiss (blink menu stays open)
  <CR>     → blink accept (unchanged)
  <C-y>    → blink accept (unchanged)
  <C-n>    → cycle Codeium alt (ghost wins over blink select_next)
  <C-p>    → cycle Codeium alt
  <C-e>    → blink hide (unchanged from default; doesn't touch Codeium)
```

### Flow 6 — Per-buffer disable

```
1. <leader>ai         flips vim.b.codeium_enabled, calls vt.clear() immediately
2. autocmd (TextChangedI/InsertEnter/BufEnter) re-clears on every keypress
   while vim.b.codeium_enabled == false — ghost text never visibly persists
3. lualine segment hides between renders (briefly shows "*" during fetches)
4. <leader>ai again   re-enables (next idle pause renders ghost normally)
```

Note: this is a soft-suppression. Codeium still issues completion requests
in the background — only the *rendering* is suppressed. Acceptable cost
since requests are cheap and the user gets instant re-enable.

### Flow 7 — First-time auth

```
1. lazy.nvim installs windsurf.nvim → triggers `build = ":Codeium Auth"`
2. :Codeium Auth prompts: opens URL in browser → sign in (free tier)
3. user pastes returned token into nvim prompt
4. token saved to ~/.codeium/config.json (persists across restarts)
5. lualine segment becomes live; ghost text starts rendering on next idle pause
```

### Flow 8 — Filetype gating

```
Open foo.md         → filetype check returns false → no requests, no ghost
Open foo.go         → enabled → ghost text on idle pause
Open oil:// buffer  → filetypes.oil = false → disabled
:terminal           → buftype check + filetypes.terminal → disabled
```

### Flow 9 — Removal flow (one-time, on first run after this change)

```
After applying spec:
1. nvim reload / restart
2. Lazy auto-removes copilot-language-server (no longer in mason ensure_installed)
   - or run :MasonUninstall copilot-language-server manually
3. nvim 0.11+ no longer attaches copilot LSP (lsp.lua entry deleted)
4. sidekick <tab> binding gone — Tab now wholly owned by blink/Codeium
5. ~/.config/github-copilot/* remains on disk; safe to delete by hand if desired
```

## 10. First-run / auth flow

`:Codeium Auth` is the only required setup step. It's hooked to lazy's
`build` field so it fires once after install. If the user skips or
dismisses, they can re-run `:Codeium Auth` any time.

Token is per-user, stored in `~/.codeium/config.json`. No git repo state.
No project-root config required (defaults find git root via upward search).

## 11. Verification plan

Run through these after applying changes. Each is a discrete check; if any
fails, stop and diagnose before continuing.

1. **Lazy load:**
   ```vim
   :Lazy reload codeium
   :Lazy reload blink.cmp
   ```
   No errors in `:messages` or `:LazyLog`.

2. **NES removed:**
   ```vim
   :LspInfo       " or :checkhealth vim.lsp on 0.11+
   ```
   `copilot` should NOT be in the attached-servers list. Open a `.go` file
   and re-check.

3. **mason cleanup:**
   ```vim
   :Mason
   ```
   Confirm `copilot-language-server` is no longer in `ensure_installed`
   list. Optionally `:MasonUninstall copilot-language-server` to remove the
   binary.

4. **sidekick Tab gone:**
   In normal mode, press `<Tab>`. Should perform default nvim Tab behavior
   (jump to next of indent etc.), not trigger NES.

5. **Codeium auth:**
   ```vim
   :Codeium Auth
   ```
   Walk through browser flow. After paste-back, `:messages` shows success.

6. **Ghost text in .go:**
   - Open a `.go` file.
   - Type a partial function (e.g., `func main() {\n\tfmt.`).
   - Wait ~75ms. Ghost text should render in `CodeiumSuggestion` colour.
   - Press `<Tab>`. Ghost text becomes real text.

7. **Smart-tab branching:**
   - With ghost text visible, also trigger blink menu (e.g., type a partial
     identifier). Both should be visible.
   - `<Tab>` → Codeium accept (ghost wins).
   - Repeat. `<S-Tab>` → ghost cleared, menu stays.
   - `<CR>` → blink accept.

8. **Cycle:**
   - When ghost text is visible and lualine shows `n/m` with `m > 1`:
   - `<C-n>` → ghost text changes; lualine updates.
   - `<C-p>` → reverts.

9. **Manual trigger:**
   - `<C-Space>` opens blink menu AND triggers a Codeium request even
     mid-line, before idle delay.

10. **Filetype gating:**
    - Open a markdown file. Type prose. No Codeium ghost should appear.
    - Open `:Oil` / `:Neotree`. No ghost text in those buffers.

11. **No `<C-]>` regression:**
    - In a terminal buffer (toggleterm), `<C-]>` should still drop to
      normal mode.

12. **Lualine segment:**
    - Idle in a .go file: lualine right side has no Codeium segment (status
      returns "0").
    - Trigger via typing or `<C-Space>`: segment appears with `󰚩 *` then
      `󰚩 1/n` once results land.

13. **Toggle:**
    - `<leader>ai` → notify "Codeium disabled (buffer)".
    - Type same partial — no ghost text.
    - `<leader>ai` again → re-enabled.
    - `<leader>aI` → `:Codeium Toggle` runs (global flag flips).

## 12. Rollback plan

Single `git revert` against the implementing commit restores prior state.
No external state to roll back beyond the auth token (which is harmless to
keep — invisible without the plugin installed).

If only partial rollback is needed:

- To restore NES temporarily: revert edits in `lsp.lua`, `mason.lua`,
  `sidekick.lua`. Leave Codeium installed.
- To disable Codeium without uninstalling: `:Codeium Toggle` (global).

## 13. Open questions / risks

1. **`M.accept()` called as a function from blink:** verified the side
   effects fire (text insert via `nvim_buf_set_text`). Test #7 above
   exercises the path; if Tab visibly leaves the suggestion un-inserted,
   the fallback is to call `vim.api.nvim_feedkeys` on a `<Plug>` wrapper —
   see implementation plan.

2. **Codeium auth + corporate restrictions:** free-tier signup needs an
   email + GitHub account. If the user is behind a proxy, `detect_proxy =
   true` (windsurf default) usually handles it; the `tools.curl` override is
   the fallback.

3. **`status_string()` return when offline:** returns `"*"` indefinitely if
   the server is unreachable. Acceptable visual signal; user can `<S-Tab>` /
   `<leader>ai` to suppress.

4. **Plugin module name drift:** `require("codeium")` remains the canonical
   entry. If upstream renames to `require("windsurf")` in a future major,
   adjust `colorscheme.lua` and `lualine.lua` callers; the plugin spec
   already uses the new repo string.

5. **lualine `extensions`:** windsurf is virtual-text only; no lualine
   extension needed. The component is a plain function — no
   theme-specific lualine extension required.
