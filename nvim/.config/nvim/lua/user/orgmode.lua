require("orgmode").setup({})
require("orgmode").setup_ts_grammar()

require("orgmode").setup({
	org_agenda_files = { "~/Desktop/org/*", "~/my-orgs/**/*" },
	org_default_notes_file = "~/Desktop/org/refile.org",
})

require("headlines").setup({
	org = {
		headline_highlights = { "Headline1", "Headline2" },
	},
})
vim.cmd([[highlight Headline1 guibg=#1e2718]])
vim.cmd([[highlight Headline2 guibg=#21262d]])
vim.cmd([[highlight CodeBlock guibg=#1c1c1c]])
vim.cmd([[highlight Dash guibg=#D19A66 gui=bold]])
