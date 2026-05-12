-- Neovide-specific configuration.
-- Applied both when Neovide launches nvim directly (vim.g.neovide is set
-- before init.lua runs) and when Neovide attaches to a headless nvim later
-- via --server (mvim flow — vim.g.neovide flips to true on UIEnter).
local function apply()
  -- Set guifont in addition to ~/.config/neovide/config.toml — Neovide
  -- re-reads &guifont on later font-update events (e.g. scale_factor changes),
  -- and an unset guifont sends it back to its hardcoded SF Mono cascade.
  vim.o.guifont = "JetBrainsMono Nerd Font Mono,Symbols Nerd Font Mono:h13"

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

return {}
