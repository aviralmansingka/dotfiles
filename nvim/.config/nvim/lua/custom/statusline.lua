require("lualine").setup({})
require("bufferline").setup({
	options = {
		numbers = "both",
		diagnostics = "nvim_lsp",
		offsets = { { filetype = "NvimTree", text = "File Explorer", text_align = "left" } },
		separator_style = "slant",
		diagnostics_indicator = function(count, level, diagnostics_dict, context)
			local icon = level:match("error") and " " or " "
			return " " .. icon .. count
		end,
	},
	groups = {
		options = {
			toggle_hidden_on_enter = true, -- when you re-enter a hidden group this options re-opens that group so the buffer is visible
		},
		items = {
			{
				name = "Tests", -- Mandatory
				highlight = { gui = "underline", guisp = "blue" }, -- Optional
				priority = 2, -- determines where it will appear relative to other groups (Optional)
				icon = "", -- Optional
				matcher = function(buf) -- Mandatory
					return buf.name:match("%_test") or buf.name:match("%_spec")
				end,
			},
			{
				name = "Docs",
				highlight = { gui = "undercurl", guisp = "green" },
				auto_close = false, -- whether or not close this group if it doesn't contain the current buffer
				matcher = function(buf)
					return buf.name:match("%.md") or buf.name:match("%.txt")
				end,
				separator = { -- Optional
					style = require("bufferline.groups").separator.tab,
				},
			},
		},
	},
})

vim.cmd([[
" These commands will navigate through buffers in order regardless of which mode you are using
" e.g. if you change the order of buffers :bnext and :bprevious will not respect the custom ordering
nnoremap <silent>[b :BufferLineCycleNext<CR>
nnoremap <silent>b] :BufferLineCyclePrev<CR>

" These commands will move the current buffer backwards or forwards in the bufferline
nnoremap <silent>b> :BufferLineMoveNext<CR>
nnoremap <silent>b< :BufferLineMovePrev<CR>

" These commands will sort buffers by directory, language, or a custom criteria
nnoremap <silent>be :BufferLineSortByExtension<CR>
nnoremap <silent>bd :BufferLineSortByDirectory<CR>
]])
