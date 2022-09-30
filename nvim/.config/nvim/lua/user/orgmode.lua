require("orgmode").setup({})
require("orgmode").setup_ts_grammar()

require("orgmode").setup({
	org_agenda_files = { "~/Desktop/org/*", "~/my-orgs/**/*" },
	org_default_notes_file = "~/Desktop/org/refile.org",
})
