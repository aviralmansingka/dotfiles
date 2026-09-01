-- Keep visual mode active after yanking so the selection stays usable for
-- further operations. The LazyVim `coding.yanky` extra maps `y` to
-- `<Plug>(YankyYank)` (recording every yank in its ring) in both normal and
-- visual mode; appending `gv` reselects the same visual region after the yank.
--
-- The override must run after yanky loads: lazy.nvim applies the extra's own
-- `keys` spec (which maps `x y` to `<Plug>(YankyYank)`) on load, which would
-- clobber a plain config/keymaps.lua entry. Setting the visual-mode map inside
-- the plugin's `config` runs after those keymaps and wins. yanky's merged
-- `opts` from the extra are forwarded unchanged, so yank history, paste
-- cycling ([y/]y, p/P, <leader>p), and the ring are untouched.
return {
  "gbprod/yanky.nvim",
  config = function(_, opts)
    require("yanky").setup(opts)
    vim.keymap.set("x", "y", "<Plug>(YankyYank)gv", { desc = "Yank Text (keep selection)" })
  end,
}
