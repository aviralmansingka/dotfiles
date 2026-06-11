-- nvim/.config/nvim/lua/plugins/sidekick.lua
-- LazyVim spec for sidekick.nvim. Helpers and feature modules live in
-- ./sidekick/ (internal, registry, picker, search).
local float_toggle = require("plugins.sidekick.float_toggle")
local internal = require("plugins.sidekick.internal")

return {
  "folke/sidekick.nvim",
  dependencies = {
    "coder/claudecode.nvim",
  },
  opts = {
    cli = {
      win = {
        config = function(terminal)
          -- cursor-agent gets a right-side split; other tools use the
          -- default float layout. Override before branding.apply so the
          -- float opts only get themed when they'll actually be used.
          local tool_name = terminal.tool and terminal.tool.name or nil
          if tool_name == "cursor" then
            terminal.opts.layout = "right"
          end
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
        backend = "tmux",
        enabled = true,
      },
      tools = {
        claude = internal.base_tool_config("claude"),
        cursor = internal.base_tool_config("cursor"),
        opencode = internal.base_tool_config("opencode"),
        codex = internal.base_tool_config("codex"),
      },
    },
  },
  config = function(_, opts)
    require("plugins.sidekick.tmux_tool_match").apply()
    require("sidekick").setup(opts)
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
      "<c-;>",
      function()
        internal.toggle_tool_session("claude", true)
      end,
      desc = "Sidekick Toggle Claude",
      mode = { "n", "x" },
    },
    {
      "<c-.>",
      function()
        require("plugins.sidekick.last_session").open()
      end,
      desc = "Sidekick Open Last Session",
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
      "<localleader>e",
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
    {
      "<leader>as",
      function()
        require("plugins.sidekick.cwd_picker").open()
      end,
      desc = "Select CLI",
    },
    {
      "<leader>ad",
      function()
        require("sidekick.cli").close()
      end,
      desc = "Detach a CLI Session",
    },
    {
      "<leader>at",
      function()
        require("sidekick.cli").send({ msg = "{this}" })
      end,
      mode = { "n", "x" },
      desc = "Send This",
    },
    {
      "<leader>af",
      function()
        require("sidekick.cli").send({ msg = "{file}" })
      end,
      desc = "Send File",
    },
    {
      "<leader>av",
      function()
        float_toggle.toggle()
      end,
      desc = "Sidekick CLI: float ↔ split",
    },
    {
      "<leader>aV",
      function()
        require("sidekick.cli").send({ msg = "{selection}" })
      end,
      mode = { "x" },
      desc = "Send Visual Selection",
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
      "<leader>ag",
      function()
        internal.toggle_tool_session("codex", true)
      end,
      desc = "Sidekick Toggle Codex (G)PT",
    },
    {
      "<leader>ao",
      function()
        internal.toggle_tool_session("opencode", true)
      end,
      desc = "Sidekick Toggle OpenCode",
    },
    {
      "<leader>au",
      function()
        internal.toggle_tool_session("cursor", true)
      end,
      desc = "Sidekick Toggle Cursor Agent",
    },
    {
      "<leader>al",
      function()
        require("plugins.sidekick.cwd_picker").open()
      end,
      desc = "Sidekick List Named Sessions",
    },
    {
      "<leader>ar",
      function()
        require("plugins.sidekick.resume").open()
      end,
      desc = "Sidekick Resume Agent Session",
    },
    {
      "<leader>a/",
      function()
        require("plugins.sidekick.search").grep()
      end,
      desc = "Sidekick Search Named Sessions",
    },
    {
      "<leader>an",
      function()
        local tools = { "claude", "cursor", "opencode", "codex" }
        vim.ui.select(tools, { prompt = "Select CLI tool:" }, function(tool)
          if not tool then
            return
          end
          internal.prompt_named_session(tool)
        end)
      end,
      desc = "Sidekick New Named Session",
    },
  },
}
