return {
  "ahmedkhalf/project.nvim",
  config = function()
    require("project_nvim").setup({
      detection_methods = { "pattern" },
      -- No BUILD.bazel anchor (dropped in 11f7d93): rooting rules_go packages at the
      -- sub-package level fought the monorepo git root that gopls/ripgrep work better
      -- from, so detection stops at these roots only.
      patterns = { "init.lua", "build.gradle", ".git" },
      scope_chdir = "tab",
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
