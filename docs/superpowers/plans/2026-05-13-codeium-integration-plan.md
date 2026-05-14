# Codeium (windsurf.nvim) Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace sidekick.nvim's Copilot-LSP Next Edit Suggestions with a standalone Codeium (windsurf.nvim) virtual-text completion flow, with smart-tab/cycle/reject handlers in blink.cmp, gruvbox theming, and lualine status segment.

**Architecture:** windsurf.nvim runs virtual-text-only (no chat, no nvim-cmp source). blink.cmp owns every Tab/Ctrl interaction via custom keymap functions that branch on Codeium ghost-text visibility. Sidekick.nvim's CLI session machinery stays untouched; only its NES tab binding and the Copilot LSP attachment are removed.

**Tech Stack:** Neovim 0.11+, LazyVim, lazy.nvim, blink.cmp, windsurf.nvim (`Exafunction/windsurf.nvim`, lua module remains `require("codeium")`), lualine, gruvbox-material colorscheme.

**Spec reference:** `docs/superpowers/specs/2026-05-13-codeium-integration-design.md`

**Note on verification model:** Neovim config is not unit-testable in a meaningful sense. Each task's verification is one or more of:
- `luac -p <file>` (Lua syntax)
- `nvim --headless ... -c qall` (Lazy spec validation)
- Interactive nvim test (Codeium auth, ghost text, smart-tab behavior)

Interactive tests live in Task 6 so that all code is in place when the user runs them.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `nvim/.config/nvim/lua/plugins/codeium.lua` | New plugin spec for windsurf.nvim — `setup()` opts, lazy `keys`, autocmd for per-buffer suppression, statusbar refresh wiring | Create |
| `nvim/.config/nvim/lua/plugins/blink-cmp.lua` | Smart-tab/cycle/reject handlers + disable blink ghost text | Modify |
| `nvim/.config/nvim/lua/plugins/lsp.lua` | Remove Copilot LSP attachment | Modify |
| `nvim/.config/nvim/lua/plugins/mason.lua` | Remove `copilot-language-server` from `ensure_installed` | Modify |
| `nvim/.config/nvim/lua/plugins/sidekick.lua` | Remove `<Tab>` NES keymap (keep all CLI session keymaps) | Modify |
| `nvim/.config/nvim/lua/plugins/colorscheme.lua` | Add `CodeiumSuggestion` highlight | Modify |
| `nvim/.config/nvim/lua/plugins/lualine.lua` | Add Codeium status segment to `lualine_x` | Modify |

Each file has a single responsibility; no shared state across files except via Lua module imports at runtime.

---

## Task 1: Create the windsurf.nvim plugin spec

**Files:**
- Create: `nvim/.config/nvim/lua/plugins/codeium.lua`

**Why:** This is the entry point — `lazy.nvim` discovers it, installs the plugin, runs `setup()`, registers keys, and wires the per-buffer-toggle autocmd. Until this exists, nothing else has a `codeium.virtual_text` module to call into.

- [ ] **Step 1: Create the file with the complete plugin spec**

Create `nvim/.config/nvim/lua/plugins/codeium.lua`:

```lua
return {
  "Exafunction/windsurf.nvim",
  dependencies = { "nvim-lua/plenary.nvim" },
  event = "InsertEnter",
  cmd = { "Codeium" },
  build = ":Codeium Auth",
  keys = {
    {
      "<leader>ai",
      function()
        local current = vim.b.codeium_enabled
        if current == nil then
          current = true
        end
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
        map_keys = false,
        default_filetype_enabled = true,
        filetypes = {
          markdown = false,
          gitcommit = false,
          gitrebase = false,
          text = false,
          help = false,
          oil = false,
          ["neo-tree"] = false,
          snacks_picker = false,
          snacks_dashboard = false,
          TelescopePrompt = false,
          ["mini-files"] = false,
          ["mini.files"] = false,
          NvimTree = false,
          codecompanion = false,
          sidekick_terminal = false,
          lazy = false,
          mason = false,
          toggleterm = false,
          terminal = false,
        },
        key_bindings = {
          accept = false,
          accept_word = false,
          accept_line = false,
          clear = false,
          next = false,
          prev = false,
        },
      },
    })

    pcall(function()
      require("codeium.virtual_text").set_statusbar_refresh(function()
        require("lualine").refresh()
      end)
    end)

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

- [ ] **Step 2: Verify Lua syntax**

Run: `luac -p nvim/.config/nvim/lua/plugins/codeium.lua`
Expected: exits 0 with no output.

- [ ] **Step 3: Commit**

```bash
git add nvim/.config/nvim/lua/plugins/codeium.lua
git commit -m "feat(nvim): add codeium plugin spec (windsurf.nvim)"
```

---

## Task 2: Wire smart-tab / cycle / reject handlers into blink.cmp

**Files:**
- Modify: `nvim/.config/nvim/lua/plugins/blink-cmp.lua`

**Why:** blink.cmp owns the keymap surface for completion. We need `<Tab>` to branch on Codeium ghost visibility, falling through to blink's `select_and_accept`, then to literal Tab. Same pattern for `<S-Tab>` (reject), `<C-n>`/`<C-p>` (cycle), and `<C-Space>` (manual-trigger overlay). We also disable blink's own `ghost_text` so it doesn't compete with Codeium's virt_text.

- [ ] **Step 1: Add the `codeium_visible` helper at module scope**

In `nvim/.config/nvim/lua/plugins/blink-cmp.lua`, insert at the very top of the file (before `return {`):

```lua
-- Helper used by smart-tab/cycle/dismiss handlers below. Returns true when
-- Codeium has a ghost-text suggestion currently rendered.
local function codeium_visible()
  local ok, vt = pcall(require, "codeium.virtual_text")
  if not ok then
    return false
  end
  local s = vt.status()
  return s and s.state == "completions" and (s.total or 0) > 0
end

```

- [ ] **Step 2: Extend the keymap table with five smart-handler entries**

Find the existing keymap block:

```lua
      keymap = {
        preset = "default",
        ["<C-b>"] = false,
        ["<C-l>"] = { "snippet_forward", "fallback" },
        ["<C-h>"] = { "snippet_backward", "fallback" },
      },
```

Replace it with:

```lua
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
            return false
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
            if ok then
              pcall(vt.complete)
            end
            return false
          end,
          "show",
          "fallback",
        },
      },
```

- [ ] **Step 3: Disable blink's ghost text**

Find:
```lua
        ghost_text = {
          enabled = true,
        },
```

Change to:
```lua
        ghost_text = {
          enabled = false,
        },
```

- [ ] **Step 4: Verify Lua syntax**

Run: `luac -p nvim/.config/nvim/lua/plugins/blink-cmp.lua`
Expected: exits 0 with no output.

- [ ] **Step 5: Commit**

```bash
git add nvim/.config/nvim/lua/plugins/blink-cmp.lua
git commit -m "feat(nvim): smart-tab/cycle/reject Codeium handlers in blink.cmp"
```

---

## Task 3: Remove NES providers (Copilot LSP + sidekick Tab + mason entry)

**Files:**
- Modify: `nvim/.config/nvim/lua/plugins/lsp.lua` (delete 2 lines)
- Modify: `nvim/.config/nvim/lua/plugins/mason.lua` (delete 1 line)
- Modify: `nvim/.config/nvim/lua/plugins/sidekick.lua` (delete 10 lines)

**Why:** With Codeium owning AI completions, the Copilot LSP has no consumers. Removing the mason entry stops it from being installed; removing the lspconfig entry stops it from attaching. Sidekick's `<Tab>` NES binding is no longer needed and would conflict with blink's new Tab handler.

- [ ] **Step 1: Remove Copilot LSP attachment**

In `nvim/.config/nvim/lua/plugins/lsp.lua`, find:

```lua
    -- Copilot language server for Sidekick NES
    opts.servers.copilot = {}
    return opts
```

Change to:

```lua
    return opts
```

- [ ] **Step 2: Remove copilot-language-server from mason**

In `nvim/.config/nvim/lua/plugins/mason.lua`, find:

```lua
      "copilot-language-server",
      "lua-language-server",
```

Change to:

```lua
      "lua-language-server",
```

- [ ] **Step 3: Remove sidekick's NES Tab binding**

In `nvim/.config/nvim/lua/plugins/sidekick.lua`, find:

```lua
    {
      "<tab>",
      function()
        if not require("sidekick").nes_jump_or_apply() then
          return "<Tab>"
        end
      end,
      expr = true,
      desc = "Goto/Apply Next Edit Suggestion",
    },
    {
      "<c-.>",
```

Change to:

```lua
    {
      "<c-.>",
```

(Keep every other keymap and the `config = function() ... end` body untouched.)

- [ ] **Step 4: Verify Lua syntax on all three files**

Run:
```bash
luac -p nvim/.config/nvim/lua/plugins/lsp.lua \
        nvim/.config/nvim/lua/plugins/mason.lua \
        nvim/.config/nvim/lua/plugins/sidekick.lua
```
Expected: exits 0 with no output.

- [ ] **Step 5: Commit**

```bash
git add nvim/.config/nvim/lua/plugins/lsp.lua \
        nvim/.config/nvim/lua/plugins/mason.lua \
        nvim/.config/nvim/lua/plugins/sidekick.lua
git commit -m "refactor(nvim): remove Copilot LSP + sidekick NES Tab binding"
```

---

## Task 4: Theme `CodeiumSuggestion` for gruvbox-material

**Files:**
- Modify: `nvim/.config/nvim/lua/plugins/colorscheme.lua`

**Why:** windsurf.nvim ships `CodeiumSuggestion` with `default = true` (generic grey `#808080`). That clashes with the gruvbox palette. We define it to match the existing `BlinkGhostText` family — same grey but italic so AI suggestions are visually distinct from any other inline preview.

- [ ] **Step 1: Add the highlight inside the existing `ColorScheme` autocmd**

In `nvim/.config/nvim/lua/plugins/colorscheme.lua`, find:

```lua
      -- Blink.cmp ghost text highlight to match gruvbox material
      vim.api.nvim_set_hl(0, "BlinkGhostText", { fg = "#665c54", bg = "#282828" }) -- Match gruvbox background

      -- Blink.cmp completion window highlights to match gruvbox material
```

Change to:

```lua
      -- Blink.cmp ghost text highlight to match gruvbox material
      vim.api.nvim_set_hl(0, "BlinkGhostText", { fg = "#665c54", bg = "#282828" }) -- Match gruvbox background

      -- Codeium AI ghost text — matches BlinkGhostText family, italic to
      -- distinguish AI suggestions from other inline previews.
      vim.api.nvim_set_hl(0, "CodeiumSuggestion", { fg = "#665c54", bg = "#282828", italic = true })

      -- Blink.cmp completion window highlights to match gruvbox material
```

- [ ] **Step 2: Verify Lua syntax**

Run: `luac -p nvim/.config/nvim/lua/plugins/colorscheme.lua`
Expected: exits 0 with no output.

- [ ] **Step 3: Commit**

```bash
git add nvim/.config/nvim/lua/plugins/colorscheme.lua
git commit -m "feat(nvim): theme CodeiumSuggestion for gruvbox-material"
```

---

## Task 5: Add Codeium status segment to lualine

**Files:**
- Modify: `nvim/.config/nvim/lua/plugins/lualine.lua`

**Why:** The user needs visible feedback on Codeium state — idle, fetching (`*`), or showing `N/M` alternatives. The segment goes in `lualine_x` (right side, before filetype) using `colors.green` from the existing palette. It hides itself entirely when Codeium is idle or unloaded, keeping the statusline clean.

- [ ] **Step 1: Insert the Codeium component at the head of `lualine_x`**

In `nvim/.config/nvim/lua/plugins/lualine.lua`, find:

```lua
        lualine_x = {
          {
            "filetype",
            colored = true,
            icon_only = false,
            color = { fg = colors.purple },
          },
```

Change to:

```lua
        lualine_x = {
          {
            function()
              local ok, vt = pcall(require, "codeium.virtual_text")
              if not ok then
                return ""
              end
              local s = vt.status_string()
              if s == "" or s == "0" then
                return ""
              end
              return "󰚩 " .. s
            end,
            cond = function()
              return package.loaded["codeium"] ~= nil
            end,
            color = { fg = colors.green },
          },
          {
            "filetype",
            colored = true,
            icon_only = false,
            color = { fg = colors.purple },
          },
```

- [ ] **Step 2: Verify Lua syntax**

Run: `luac -p nvim/.config/nvim/lua/plugins/lualine.lua`
Expected: exits 0 with no output.

- [ ] **Step 3: Headless full-config smoke test**

Run: `nvim --headless -c 'lua print("STARTUP_OK")' -c 'qall' 2>&1`
Expected: prints `STARTUP_OK` and exits 0. Any plugin spec error from Lazy will surface here.

- [ ] **Step 4: Commit**

```bash
git add nvim/.config/nvim/lua/plugins/lualine.lua
git commit -m "feat(nvim): Codeium status segment in lualine"
```

---

## Task 6: Interactive verification (spec §11 checklist)

**Files:** none modified. This task exercises the integration end-to-end in a real nvim session.

**Why:** Lua syntax and Lazy parse are necessary but not sufficient. Smart-tab branching, ghost-text rendering, auth, filetype gating, and the buffer-toggle autocmd can only be verified interactively. This task should be run by the human user, not a subagent.

- [ ] **Step 1: Sync plugins**

In nvim:
```vim
:Lazy sync
```
Expected: `Exafunction/windsurf.nvim` installs. `copilot-language-server` is removed by mason on next `:Mason` open (or run `:MasonUninstall copilot-language-server` manually).

- [ ] **Step 2: Confirm NES gone**

Open a `.go` file. Run:
```vim
:LspInfo
```
Expected: `copilot` does NOT appear in attached-clients list. Only the actual language LSP (e.g. `gopls`) is attached.

- [ ] **Step 3: Authenticate Codeium**

```vim
:Codeium Auth
```
Expected: opens browser → sign in (free tier) → paste token back into nvim prompt → success message. Token persists to `~/.codeium/config.json`.

- [ ] **Step 4: Ghost text renders in `.go`**

Open a `.go` file. Type a partial function body, e.g.:
```go
package main

import "fmt"

func main() {
    fmt.
```
Wait ~75ms after the dot. Expected: grey italic ghost text appears suggesting an `fmt.Println(...)` line (or similar). Highlight should match `CodeiumSuggestion` — `#665c54` italic.

- [ ] **Step 5: Smart-tab branching**

While ghost text is visible:
- Press `<Tab>` → ghost text becomes real text. Cursor lands at end of inserted text.

Type more to trigger a fresh ghost. Then trigger blink menu too (e.g., type a partial identifier that has LSP completions). Both UIs visible:
- Press `<Tab>` → Codeium accepts (ghost wins).

Trigger ghost again. Press `<S-Tab>`:
- Expected: ghost cleared immediately. blink menu (if open) is also hidden.

- [ ] **Step 6: Cycle alternatives**

Trigger a ghost suggestion. Check lualine right side — should show `󰚩 1/N` in green (only if N > 1).

- Press `<C-n>` → ghost text changes to next alternative; lualine increments.
- Press `<C-p>` → reverts.

- [ ] **Step 7: Manual trigger**

In middle of a line with no ghost text yet, press `<C-Space>`.
Expected: blink menu opens; ~200ms later Codeium ghost text also appears.

- [ ] **Step 8: Filetype gating**

Open a markdown file. Type prose for a few sentences.
Expected: NO Codeium ghost text appears at any point.

Open `:Oil` or `:Neotree`. Cursor in the picker buffer.
Expected: no ghost text.

- [ ] **Step 9: Buffer toggle**

In a `.go` file with ghost text working:
- Press `<leader>ai` → notify message "Codeium disabled (buffer)".
- Keep typing — no ghost text appears.
- Press `<leader>ai` → notify "Codeium enabled (buffer)" — ghost resumes on next idle pause.

- [ ] **Step 10: Global toggle**

- Press `<leader>aI` → equivalent of `:Codeium Toggle`. Ghost text suppressed globally.
- Press `<leader>aI` again → restored.

- [ ] **Step 11: Terminal escape regression check**

Open `:ToggleTerm`. In the terminal buffer, press `<C-]>`.
Expected: drops to terminal-normal mode (no Codeium interaction, no regression).

- [ ] **Step 12: Lualine segment behavior**

- Idle in `.go`: lualine right side should show nothing for Codeium (status_string returns `"0"` or `""`).
- Trigger a request (type or `<C-Space>`): segment briefly shows `󰚩 *` in green during fetch, then `󰚩 1/N` once result lands.

- [ ] **Step 13: Known risk — `M.accept()` direct call**

This is the verification for spec §13.1. If Step 5 succeeded (ghost text became real text on `<Tab>`), this risk is resolved.

If Step 5 fails (ghost clears but no text is inserted): fall back to `<Plug>` wrapper. Specifically, in `plugins/codeium.lua`, change `virtual_text.key_bindings.accept = false` to `virtual_text.key_bindings.accept = "<Plug>(CodeiumAccept)"`, and in the blink `<Tab>` handler replace `require("codeium.virtual_text").accept()` with `vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes("<Plug>(CodeiumAccept)", true, false, true), "i", false)`.

- [ ] **Step 14: Final commit (working tree was already committed task-by-task)**

If Tasks 1-5 were committed individually, no further commit needed. If batched, commit now:

```bash
git status nvim/.config/nvim/lua/plugins/
git diff --stat nvim/.config/nvim/lua/plugins/
```

Verify only the 7 expected files (codeium.lua new + 6 modified) show up. Any unrelated dirty files in the working tree should NOT be staged.

---

## Spec coverage check

Mapping each spec section to a task:

| Spec § | Coverage |
|---|---|
| §1 Goal, §2 Non-goals | Task 1 sets `enable_chat = false`, `enable_cmp_source = false`. Tasks 2-3 remove NES providers. |
| §3 Architecture | Tasks 1-5 implement the four-concern split. |
| §4.1 codeium.lua | Task 1 |
| §4.2 blink-cmp.lua | Task 2 |
| §4.3 lsp.lua | Task 3 step 1 |
| §4.4 mason.lua | Task 3 step 2 |
| §4.5 sidekick.lua | Task 3 step 3 |
| §4.6 colorscheme.lua | Task 4 |
| §4.7 lualine.lua | Task 5 |
| §5 Keymap surface | Tasks 1-2 (windsurf key_bindings + blink keymap) |
| §6 Filetype scope | Task 1 `virtual_text.filetypes` table |
| §7 Theming | Task 4 |
| §8 Lualine status segment | Task 5 |
| §9 Common action flows | Task 6 steps 4-12 exercise each flow |
| §10 First-run / auth | Task 6 step 3 |
| §11 Verification plan | Task 6 (entire) |
| §12 Rollback plan | Not implemented (no rollback step needed; `git revert` against the implementation commits restores prior state) |
| §13 Open questions / risks | Task 6 step 13 addresses risk §13.1 explicitly |

No gaps.

---

## Risks and rollback

1. **`M.accept()` as direct call** — Task 6 Step 13 contains the fallback recipe (`<Plug>` wrapper) if the smart-tab Codeium-accept path doesn't insert text. The fallback adds ~3 lines.

2. **`:Codeium Auth` over corporate proxy** — windsurf defaults `detect_proxy = true`; the override is `tools.curl` in `setup()`. Not in this plan because the user's environment is standard.

3. **Status-string `"*"` on offline** — visual only, not blocking. Resolved by reconnecting or `<S-Tab>` / `<leader>ai`.

Rollback: `git revert <implementation commits>` restores the prior NES state. The auth token at `~/.codeium/config.json` remains on disk (harmless without the plugin).
