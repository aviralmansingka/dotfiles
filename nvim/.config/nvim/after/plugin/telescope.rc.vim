" Navigate files and grep
nnoremap <leader>ff <cmd>Telescope find_files find_command=rg,--ignore,--hidden,--files prompt_prefix=🔍 <cr>
nnoremap <leader>fg <cmd>Telescope live_grep find_command=rg,--ignore,--hidden,--files prompt_prefix=🔍 <cr>
nnoremap <leader>fb <cmd>Telescope buffers<cr>
nnoremap <leader>fh <cmd>Telescope help_tags<cr>

lua << EOF
require('telescope').load_extension('lsp_handlers')
require('telescope').setup({
  pickers = {
    find_files = {
      hidden = true
    }
  },
  extensions = {
    lsp_handlers = {
      code_action = {
        telescope = require('telescope.themes').get_dropdown({}),
      },
    },
  },
})
EOF