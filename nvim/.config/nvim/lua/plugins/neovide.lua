-- Neovide-specific configuration.
-- Applied both when Neovide launches nvim directly (vim.g.neovide is set
-- before init.lua runs) and when Neovide attaches to a headless nvim later
-- via --server (mvim flow — vim.g.neovide flips to true on UIEnter).
local function apply()
  -- Overrides nvim's macOS-built-in DFLT_GFN ("SF Mono,Menlo,Monaco,Courier
  -- New,monospace" from src/nvim/option_vars.h:39) which Neovide receives via
  -- an unconditional option_set event at ui_attach time, before nvim has
  -- processed --cmd or init.lua. The default's CSS-generic "monospace" family
  -- is unresolvable in CoreText (Skia macOS backend, no fontconfig alias) and
  -- triggers an error from caching_shaper.rs. Setting guifont here causes a
  -- second option_set event that supersedes the default; the noice route
  -- below suppresses the transient error message.
  -- Single-font chain (matches Ghostty), at Medium weight to approximate
  -- Ghostty's font-thicken=true. The guifont parser only accepts :b/:i for
  -- styles, so we use the weight-specific Family Name "JetBrainsMono NFM
  -- Medium" (nameID 1 of the Medium TTF) instead of the preferred family
  -- "JetBrainsMono Nerd Font Mono" + style="Medium" (which the TOML uses).
  vim.o.guifont = "JetBrainsMono NFM Medium:h13"

  vim.g.neovide_input_use_logo = true
  vim.g.neovide_input_macos_option_key_is_meta = "only_left"

  vim.o.errorbells = false
  vim.o.visualbell = true
  vim.o.belloff = "all"

  vim.keymap.set({ "n", "v" }, "<D-c>", '"+y', { noremap = true, desc = "Copy" })
  vim.keymap.set({ "n", "v", "i", "c" }, "<D-v>", function()
    vim.api.nvim_paste(vim.fn.getreg("+"), true, -1)
  end, { noremap = true, desc = "Paste" })
  vim.keymap.set("t", "<D-v>", function()
    vim.api.nvim_paste(vim.fn.getreg("+"), true, -1)
  end, { noremap = true, desc = "Paste in terminal" })

  vim.keymap.set({ "n", "v", "i" }, "<D-a>", "<Esc>ggVG", { noremap = true, desc = "Select all" })
  vim.keymap.set({ "n", "v", "i" }, "<D-s>", "<Cmd>w<CR>", { noremap = true, desc = "Save" })

  vim.g.neovide_scale_factor = 1.0
  vim.keymap.set({ "n", "v", "i" }, "<D-=>", function()
    vim.g.neovide_scale_factor = vim.g.neovide_scale_factor * 1.1
  end, { noremap = true, desc = "Increase font size" })
  vim.keymap.set({ "n", "v", "i" }, "<D-->", function()
    vim.g.neovide_scale_factor = vim.g.neovide_scale_factor / 1.1
  end, { noremap = true, desc = "Decrease font size" })
  vim.keymap.set({ "n", "v", "i" }, "<D-0>", function()
    vim.g.neovide_scale_factor = 1.0
  end, { noremap = true, desc = "Reset font size" })

  vim.g.neovide_floating_shadow = false
end

if vim.g.neovide then
  apply()
else
  vim.api.nvim_create_autocmd("UIEnter", {
    once = true,
    callback = function()
      if vim.g.neovide then
        apply()
      end
    end,
  })
end

-- Suppress the transient "Font can't be updated to" error Neovide emits at
-- ui_attach when it tries to load nvim's macOS DFLT_GFN cascade (containing
-- the CSS-generic "monospace" family which CoreText cannot resolve). The
-- error is unavoidable from user config — --cmd and TOML [font] both lose
-- the race against nvim's initial option_set redraw event in --embed mode.
return {
  {
    "folke/noice.nvim",
    --- LazyVim's noice spec binds <C-b> to "Scroll Backward" (for scrolling LSP hover /
    --- signature popups) across n/i/s, with a fallback to vanilla <C-b> when noice isn't
    --- intercepting. Disable entirely — interferes with terminal-style usage.
    keys = {
      { "<C-b>", false, mode = { "n", "i", "s" } },
    },
    opts = function(_, opts)
      opts.routes = opts.routes or {}
      table.insert(opts.routes, {
        filter = {
          event = "msg_show",
          kind = "echomsg",
          find = "Font can't be updated to",
        },
        opts = { skip = true },
      })
      return opts
    end,
  },
}
