-- noice.nvim overrides. Moved out of the removed neovide.lua with the
-- dead-code cleanup; the signature-help disable is the BUGS.md #3 fix.
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
      -- Disable noice's signature help. blink.cmp provides the sole
      -- signature-help popup (tree-sitter highlighted, active-parameter
      -- highlight). Without this, both noice and blink.cmp auto-trigger
      -- on LSP trigger characters and render stacked duplicate floats.
      opts.lsp = opts.lsp or {}
      opts.lsp.signature = vim.tbl_deep_extend("force", opts.lsp.signature or {}, { enabled = false })
      return opts
    end,
  },
}
