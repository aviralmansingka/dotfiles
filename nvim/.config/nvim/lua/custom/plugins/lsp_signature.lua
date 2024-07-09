return {
  'ray-x/lsp_signature.nvim',
  event = 'VeryLazy',
  opts = {},
  config = function()
    vim.api.nvim_create_autocmd('LspAttach', {
      callback = function(args)
        local bufnr = args.buf
        require('lsp_signature').on_attach({
          -- ... setup options here ...
        }, bufnr)
      end,
    })
  end,
}
