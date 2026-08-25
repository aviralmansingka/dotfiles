-- nvim/.config/nvim/lua/plugins/sidekick.lua
-- LazyVim spec for sidekick.nvim. Helpers and feature modules live in
-- ./sidekick/ (internal, registry, picker, search).
local float_toggle = require("plugins.sidekick.float_toggle")
local internal = require("plugins.sidekick.internal")

return {
  "folke/sidekick.nvim",
  opts = {
    cli = {
      win = {
        config = function(terminal)
          require("plugins.sidekick.branding").apply(terminal)
        end,
        layout = "float",
        float = {
          width = 0.8,
          height = 0.8,
        },
        split = {
          width = 0.4,
          height = 20,
        },
      },
      mux = {
        backend = "herdr",
        enabled = true,
      },
      tools = {
        codex = internal.base_tool_config("codex"),
        pi = internal.base_tool_config("pi"),
      },
    },
  },
  config = function(_, opts)
    require("plugins.sidekick.herdr_backend").apply()
    require("sidekick").setup(opts)
    local config = require("sidekick.config")
    for tool in pairs(config.cli.tools) do
      if not internal.tool_commands[tool] then
        config.cli.tools[tool] = nil
      end
    end
    require("plugins.sidekick.select_patch").apply()
    require("plugins.sidekick.registry").rehydrate()
    require("plugins.sidekick.branding").ensure_highlights()
    vim.api.nvim_create_autocmd("ColorScheme", {
      group = vim.api.nvim_create_augroup("plugins.sidekick.branding", { clear = true }),
      callback = function()
        require("plugins.sidekick.branding").ensure_highlights()
      end,
    })
    vim.api.nvim_create_autocmd("VimLeavePre", {
      group = vim.api.nvim_create_augroup("plugins.sidekick.search", { clear = true }),
      callback = function()
        pcall(function()
          require("plugins.sidekick.search").cleanup()
        end)
      end,
    })
  end,
  keys = {
    {
      "<c-.>",
      function()
        require("plugins.sidekick.last_session").open()
      end,
      desc = "Sidekick Open Last Session (fallback: cwd sessions)",
      mode = { "n", "t", "i", "x" },
    },
    {
      "<c-;>",
      function()
        require("plugins.sidekick.session_switch").open()
      end,
      desc = "Sidekick Switch Agent Session",
      mode = { "n", "t", "i", "x" },
    },
    {
      "<leader>aa",
      function()
        require("plugins.sidekick.ask").ask()
      end,
      mode = { "n", "x" },
      desc = "Ask Codex Spark about this code",
    },
    {
      "<leader>ae",
      function()
        require("plugins.sidekick.ask").edit()
      end,
      mode = { "n", "x" },
      desc = "Edit: ask Codex Spark for a diff (hover to preview)",
    },
    {
      "<leader>aA",
      function()
        require("plugins.sidekick.ask").apply_line()
      end,
      desc = "Edit: apply diff on current line",
    },
    {
      "<leader>aR",
      function()
        require("plugins.sidekick.ask").reject_line()
      end,
      desc = "Edit: reject diff on current line",
    },
    {
      "<Tab>",
      function()
        local bufnr = vim.api.nvim_get_current_buf()
        local line0 = vim.api.nvim_win_get_cursor(0)[1] - 1
        local state = require("plugins.sidekick.ask.state")
        local signs = require("plugins.sidekick.ask.signs")
        local _, entry = state.find_at(bufnr, line0, signs.ns)
        if entry and entry.mode == "edit" and entry.status == "done" then
          require("plugins.sidekick.ask").apply_line()
        else
          vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes("<C-i>", true, false, true), "n", false)
        end
      end,
      desc = "Edit: accept diff on current line (else jump forward)",
    },
    {
      "<S-Tab>",
      function()
        local bufnr = vim.api.nvim_get_current_buf()
        local line0 = vim.api.nvim_win_get_cursor(0)[1] - 1
        local state = require("plugins.sidekick.ask.state")
        local signs = require("plugins.sidekick.ask.signs")
        local _, entry = state.find_at(bufnr, line0, signs.ns)
        if entry then
          if entry.mode == "edit" then
            require("plugins.sidekick.ask").reject_line()
          else
            require("plugins.sidekick.ask").clear_line()
          end
        else
          vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes("<S-Tab>", true, false, true), "n", false)
        end
      end,
      desc = "Sidekick: remove diff/answer on current line",
    },
    {
      "<leader>ay",
      function()
        require("plugins.sidekick.ask").yank_line()
      end,
      desc = "Ask: yank answer on current line",
    },
    -- <leader>at and <leader>tt are intentionally NOT bound here: they are
    -- overridden in plugins/herdr-agent.lua. <leader>at sends to the agent pane
    -- in the same Herdr tab, falling back to sidekick's "Send This" stack
    -- (require("sidekick.cli").send({ msg = "{this}" })) when no agent pane
    -- shares the tab. <leader>tt sends to the terminal pane in the same tab.
    {
      "<leader>av",
      function()
        float_toggle.toggle()
      end,
      desc = "Sidekick CLI: float ↔ split",
    },
    {
      "<leader>ap",
      function()
        require("sidekick.cli").prompt()
      end,
      mode = { "n", "x" },
      desc = "Sidekick Select Prompt",
    },
    {
      "<leader>an",
      function()
        internal.prompt_named_session("codex")
      end,
      desc = "Sidekick New Codex Named Session",
    },
    {
      "<leader>aN",
      function()
        internal.prompt_named_session("pi")
      end,
      desc = "Sidekick New Pi Named Session",
    },
  },
}
