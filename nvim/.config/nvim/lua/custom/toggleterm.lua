local colors = require("gruvbox.colors")
local toggleterm = require("toggleterm")
toggleterm.setup({
	size = 20,
	open_mapping = [[<c-\>]],
	hide_numbers = true,
	shade_filetypes = {},
	shade_terminals = false,
	start_in_insert = true,
	insert_mappings = true,
	persist_size = true,
	direction = "float",
	close_on_exit = true,
	shell = vim.o.shell,
	float_opts = {
		border = "curved",
		winblend = 0,
		highlights = {
			border = "Normal",
			background = "Normal",
		},
	},
})

function _G.set_terminal_keymaps()
	local opts = { noremap = true }
	vim.keymap.set("t", "<C-]>", [[<C-\><C-n>]], opts)
	vim.keymap.set("t", "<C-h>", [[<C-\><C-n><C-w>h]], opts)
	vim.keymap.set("t", "<C-j>", [[<C-\><C-n><C-w>j]], opts)
	vim.keymap.set("t", "<C-k>", [[<C-\><C-n><C-w>k]], opts)
	vim.keymap.set("t", "<C-l>", [[<C-\><C-n><C-w>l]], opts)
end

vim.cmd("autocmd! TermOpen term://* lua set_terminal_keymaps()")

local Terminal = require("toggleterm.terminal").Terminal
local shell = Terminal:new({
	hidden = true,
})
local columns = vim.o.columns * 0.33
function _SHELL_TOGGLE()
	shell:toggle(columns, "vertical")
end
vim.keymap.set("n", "gt", "<cmd>lua _SHELL_TOGGLE()<CR>")

local lazygit = Terminal:new({
	cmd = "lazygit",
	direction = "vertical",
	hidden = true,
})
function _LAZYGIT_TOGGLE()
	lazygit:toggle(columns, "vertical")
end

vim.keymap.set("n", "gg", "<cmd>lua _LAZYGIT_TOGGLE()<CR>")

local k9s = Terminal:new({
	cmd = "k9s",
	direction = "vertical",
	hidden = true,
})
function _K9S_TOGGLE()
	k9s:toggle(columns, "vertical")
end
k9s:toggle(columns, "vertical")
k9s:toggle(columns, "vertical")

vim.keymap.set("n", "gk", "<cmd>lua _K9S_TOGGLE()<CR>")
