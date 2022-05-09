lua << EOF
require('dap-go').setup()

vim.fn.sign_define('DapBreakpoint', {text='🟥', texthl='', linehl='', numhl=''})
vim.fn.sign_define('DapBreakpointRejected', {text='🟦', texthl='', linehl='', numhl=''})
vim.fn.sign_define('DapStopped', {text='⭐️', texthl='', linehl='', numhl=''})

vim.keymap.set('n', '<leader>dh', function() require"dap".toggle_breakpoint() end)
vim.keymap.set('n', '<leader>do', function() require"dap".step_out() end)
vim.keymap.set('n', '<leader>ds', function() require"dap".step_into() end)
vim.keymap.set('n', '<leader>dn', function() require"dap".step_over() end)
vim.keymap.set('n', '<leader>dc', function() require"dap".continue() end)
vim.keymap.set('n', '<leader>dx', function() require"dap".terminate() end)

vim.keymap.set('n', '<leader>di', function() require"dap.ui.widgets".hover() end)
vim.keymap.set('n', '<leader>d?', function() local widgets=require"dap.ui.widgets";widgets.centered_float(widgets.scopes) end)

require("nvim-dap-virtual-text").setup()
require("dapui").setup()
EOF

let g:dap_virtual_text = v:true
