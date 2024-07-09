return {
  'ahmedkhalf/project.nvim',
  opts = {
    sync_root_with_cwd = true,
    respect_buf_cwd = true,
    update_focused_file = {
      enable = true,
      update_root = true,
    },
  },
  config = function()
    require('project_nvim').setup {
      patterns = { 'init.lua', 'build.gradle', '.git' },
      silent_chdir = true,
    }
    require('telescope').load_extension 'projects'
    local telescope = require 'telescope'
    vim.keymap.set('n', '<leader>fp', telescope.extensions.projects.projects, { desc = '[S]earch [P]rojects' })
  end,
}
