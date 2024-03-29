require("nvim-tree").setup({
	disable_netrw = false,
	hijack_netrw = true,
	auto_reload_on_write = true,
	open_on_tab = false,
	hijack_cursor = false,
	update_cwd = false,
	hijack_unnamed_buffer_when_opening = false,
	create_in_closed_folder = true,
	renderer = {
		group_empty = true,
		highlight_git = true,
		highlight_opened_files = "all",
	},
	hijack_directories = {
		enable = true,
		auto_open = false,
	},
	diagnostics = {
		enable = true,
		icons = {
			hint = "",
			info = "",
			warning = "",
			error = "",
		},
	},
	update_focused_file = {
		enable = true,
		update_cwd = false,
		ignore_list = { "node_modules", ".cache", ".dist", ".settings", ".git" },
	},
	system_open = {
		cmd = nil,
		args = {},
	},
	filters = {
		dotfiles = false,
		custom = {},
	},
	git = {
		enable = true,
		ignore = false,
		timeout = 500,
	},
	view = {
		width = 40,
		hide_root_folder = false,
		side = "left",
		preserve_window_proportions = false,
		mappings = {
			custom_only = false,
			list = {},
		},
		number = false,
		relativenumber = false,
		signcolumn = "yes",
	},
	trash = {
		cmd = "trash",
		require_confirm = true,
	},
	actions = {
		change_dir = {
			enable = true,
			global = false,
		},
		open_file = {
			quit_on_open = false,
			resize_window = true,
			window_picker = {
				enable = true,
				chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890",
				exclude = {
					filetype = { "notify", "packer", "qf", "diff", "fugitive", "fugitiveblame" },
					buftype = { "nofile", "terminal", "help" },
				},
			},
		},
	},
	log = {
		enable = false,
		truncate = false,
		types = {
			all = false,
			config = false,
			git = false,
		},
	},
})
vim.cmd([[
highlight NvimTreeFolderIcon guifg=yellow
nnoremap <leader>n :NvimTreeToggle<CR>
]])
