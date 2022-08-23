local lspkind = require("lspkind")
lspkind.init()

local types = require("cmp.types")
local str = require("cmp.utils.str")

local cmp = require("cmp")
cmp.setup({
	snippet = {
		expand = function(args)
			require("luasnip").lsp_expand(args.body)
		end,
	},
	window = {
		completion = cmp.config.window.bordered(),
		documentation = cmp.config.window.bordered(),
	},
	mapping = cmp.mapping.preset.insert({
		["c-b"] = cmp.mapping.scroll_docs(-4),
		["c-f"] = cmp.mapping.scroll_docs(4),
		["c-space"] = cmp.mapping.complete(),
		["c-e"] = cmp.mapping.abort(),
		["<CR>"] = cmp.mapping.confirm({ select = true }),
		["c-y"] = cmp.mapping.confirm({
			behavior = cmp.ConfirmBehavior.Insert,
			select = true,
		}),
	}),
	sources = {
		{ name = "orgmode" },
		{ name = "nvim_lua" },
		{ name = "nvim_lsp" },
		{ name = "path" },
		{ name = "luasnip" },
		{ name = "buffer", keyword_length = 5 },
	},
	query_linter = {
		enable = true,
		use_virtual_text = true,
		lint_events = { "BufWrite", "CursorHold" },
	},
	formatting = {
		format = lspkind.cmp_format({
			mode = "symbol_text",
			maxwidth = 60,
			before = function(entry, vim_item)
				vim_item.menu = ({
					nvim_lsp = "ﲳ",
					nvim_lua = "",
					treesitter = "",
					path = "ﱮ",
					buffer = "﬘",
					zsh = "",
					vsnip = "",
					spell = "暈",
				})[entry.source.name]

				-- Get the full snippet (and only keep first line)
				local word = entry:get_insert_text()
				if entry.completion_item.insertTextFormat == types.lsp.InsertTextFormat.Snippet then
					word = vim.lsp.util.parse_snippet(word)
				end
				word = str.oneline(word)
				if
					entry.completion_item.insertTextFormat == types.lsp.InsertTextFormat.Snippet
					and string.sub(vim_item.abbr, -1, -1) == "~"
				then
					word = word .. "~"
				end
				vim_item.abbr = word

				return vim_item
			end,
		}),
	},
	experimental = {
		native_menu = false,
		ghost_text = true,
	},
})
-- If you want insert `(` after select function or method item
local cmp_autopairs = require("nvim-autopairs.completion.cmp")
cmp.event:on("confirm_done", cmp_autopairs.on_confirm_done({ map_char = { tex = "" } }))

vim.cmd([[
augroup YamlLanguageServer
  au!
  autocmd FileType yaml lua require("cmp").setup.buffer({sources = {{ name = "nvim_lsp", keyword_length = 0 }}})
augroup END
]])
