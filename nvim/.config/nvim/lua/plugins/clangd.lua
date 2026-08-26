local cuda_lsp = require("helpers.cuda_lsp")

return {
  {
    "neovim/nvim-lspconfig",
    -- On macOS Apple Silicon there is no NVIDIA CUDA Toolkit, so .cu files
    -- get local-symbol LSP only and clangd reports CUDA-API symbols as
    -- errors. Notify once per session and route to homelab/Linux for full
    -- CUDA LSP. See docs/neovim-cuda-lsp.md. Does not silence diagnostics.
    init = function()
      vim.api.nvim_create_autocmd("LspAttach", {
        callback = function(args)
          local client = vim.lsp.get_client_by_id(args.data.client_id)
          if not client or client.name ~= "clangd" then
            return
          end
          if vim.bo[args.buf].filetype == "cuda" then
            cuda_lsp.notify_if_unsupported(args.buf)
          end
        end,
      })
    end,
    opts = {
      servers = {
        clangd = {
          cmd = {
            "clangd",
            "--background-index",
            "--clang-tidy",
            "--header-insertion=iwyu",
            "--completion-style=detailed",
            "--function-arg-placeholders=true",
            "--fallback-style=llvm",
          },
        },
      },
    },
  },
}
