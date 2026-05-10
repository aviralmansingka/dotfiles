return {
  "ahmedkhalf/project.nvim",
  config = function()
    require("project_nvim").setup({
      detection_methods = { "pattern" },
      -- BUILD.bazel before .git: rules_go packages (e.g. modal/go/machine-manager) stay rooted
      -- there instead of the monorepo git root when you :cd into the service directory.
      patterns = { "init.lua", "build.gradle", "BUILD.bazel", ".git" },
      silent_chdir = true,
      sync_root_with_cwd = true,
      respect_buf_cwd = true,
      update_focused_file = {
        enable = true,
        update_root = true,
      },
    })
  end,
}
