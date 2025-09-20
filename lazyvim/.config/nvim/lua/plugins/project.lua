return {
  "ahmedkhalf/project.nvim",
  opts = {
    sync_root_with_cwd = true,
    respect_buf_cwd = true,
    update_focused_file = {
      enable = true,
      update_root = true,
    },
  },
  config = function()
    require("project_nvim").setup({
      patterns = { "init.lua", "build.gradle", ".git", "pyproject.toml", "requirements.txt" },
      silent_chdir = true,
    })
  end,
}
