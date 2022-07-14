vim.cmd [[
let g:ultest_deprecation_notice = 0
]]

require("ultest").setup({
	builders = {
		["go#gotest"] = function(cmd)
			local args = {}
			for i = 3, #cmd - 1, 1 do
				local arg = cmd[i]
				if vim.startswith(arg, "-") then
					-- Delve requires test flags be prefix with 'test.'
					arg = "-test." .. string.sub(arg, 2)
				end
				args[#args + 1] = arg
			end
			return {
				dap = {
					type = "go",
					request = "launch",
					mode = "test",
					program = "./${relativeFileDirname}",
					dlvToolPath = vim.fn.exepath("dlv"),
					args = args,
				},
			}
		end,
	},
})
vim.keymap.set("n", "∂", function()
	vim.api.nvim_command(":UltestDebugNearest")
end) -- <A-d>
vim.keymap.set("n", "†", function()
	vim.api.nvim_command(":Ultest")
end) -- <A-t>
vim.keymap.set("n", "ß", function()
	vim.api.nvim_command(":UltestSummary")
end) -- <A-s>
vim.keymap.set("n", "ø", function()
	vim.api.nvim_command(":UltestOutput")
end) -- <A-o>
