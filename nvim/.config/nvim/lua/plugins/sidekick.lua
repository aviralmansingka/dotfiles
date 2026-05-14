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
          terminal.opts.float.border = float_toggle.float_border()
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
    require("plugins.sidekick.registry").rehydrate()
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
      "<tab>",
      function()
        if not require("sidekick").nes_jump_or_apply() then
          return "<Tab>"
        end
      end,
      expr = true,
      desc = "Goto/Apply Next Edit Suggestion",
    },
    {
      "<c-.>",
      function()
        require("plugins.sidekick.cwd_picker").open()
      end,
      desc = "Sidekick Peek Sessions in Cwd",
      mode = { "n", "t", "i", "x" },
    },
    {
      "<leader>aa",
      function()
        require("sidekick.cli").toggle()
      end,
      desc = "Sidekick Toggle CLI",
    },
    {
      "<leader>as",
      function()
        require("sidekick.cli").select({
          focus = true,
          cb = function(state)
            if not state then
              return
            end
            local tool_name = state.tool and state.tool.name or nil
            if internal.is_claude_tool(tool_name) and not internal.ensure_claude_bridge() then
              return
            end
            require("sidekick.cli.state").attach(state, { show = true, focus = true })
          end,
        })
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
      mode = { "x", "n" },
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
      "<leader>ac",
      function()
        internal.toggle_tool_session("claude", true)
      end,
      desc = "Sidekick Toggle Claude",
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
        require("sidekick.cli").toggle({ name = "opencode", focus = true })
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
        require("plugins.sidekick.picker").open()
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
