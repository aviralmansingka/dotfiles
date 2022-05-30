lua << EOF
require('dap-go').setup()

vim.fn.sign_define('DapBreakpoint', {text='🟥', texthl='', linehl='', numhl=''})
vim.fn.sign_define('DapBreakpointRejected', {text='🟦', texthl='', linehl='', numhl=''})
vim.fn.sign_define('DapStopped', {text='⭐️', texthl='', linehl='', numhl=''})

vim.keymap.set('n', '˙', function() require"dap".step_out() end)          -- <A-h>
vim.keymap.set('n', '∆', function() require"dap".step_over() end)         -- <A-j>
vim.keymap.set('n', '˚', function() require"dap".step_into() end)         -- <A-k>
vim.keymap.set('n', '¬', function() require"dap".continue() end)          -- <A-l>

vim.keymap.set('n', '∫', function() require"dap".toggle_breakpoint() end) -- <A-b>
vim.keymap.set('n', '≈', function() require"dap".terminate() end)         -- <A-x>
vim.keymap.set('n', '√', function() require"dap.ui.widgets".hover() end)  -- <A-v>
vim.keymap.set('n', 'å', function() local widgets=require"dap.ui.widgets";widgets.centered_float(widgets.scopes) end) -- <A-a>

require("nvim-dap-virtual-text").setup()
require("dapui").setup()
EOF

let g:dap_virtual_text = v:true
