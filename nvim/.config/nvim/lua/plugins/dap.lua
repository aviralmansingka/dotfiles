return {
  "mfussenegger/nvim-dap",
  dependencies = {
    "rcarriga/nvim-dap-ui",
    "nvim-neotest/nvim-nio",
    "mason-org/mason.nvim",
    "jay-babu/mason-nvim-dap.nvim",
    "mfussenegger/nvim-dap-python",
    {
      "theHamsta/nvim-dap-virtual-text",
      enabled = false,
    },
  },
  keys = {
    {
      "<localleader>b",
      function()
        require("dap").toggle_breakpoint()
      end,
      desc = "Debug: Toggle Breakpoint",
    },
    {
      "<localleader>c",
      function()
        require("dap").continue({})
      end,
      desc = "Debug: (C)ontinue",
    },
    {
      "<localleader>s",
      function()
        require("dap").step_into()
      end,
      desc = "Debug: (S)tep Into",
    },
    {
      "<localleader>d",
      function()
        require("dap").step_over()
      end,
      desc = "Debug: Step (D)own (Next)",
    },
    {
      "<localleader>b",
      function()
        require("dap").step_back()
      end,
      desc = "Debug: Step (b)ack",
    },
    {
      "<localleader>a",
      function()
        require("dap").step_out()
      end,
      desc = "Debug: Step out",
    },
    {
      "<localleader>q",
      function()
        require("dap").close()
      end,
      desc = "Debug: (Q)uit",
    },
    {
      "<leader>dt",
      function()
        require("dapui").toggle()
      end,
      desc = "Debug: Toggle UI",
    },
  },
  config = function()
    local dap = require("dap")
    local dapui = require("dapui")

    dapui.setup({
      icons = { expanded = "▾", collapsed = "▸", current_frame = "*" },
      controls = {
        icons = {
          pause = "⏸",
          play = "▶",
          step_into = "⏎",
          step_over = "⏭",
          step_out = "⏮",
          step_back = "b",
          run_last = "▶▶",
          terminate = "⏹",
          disconnect = "⏏",
        },
      },
    })

    -- Automatically open/close DAP UI
    dap.listeners.after.event_initialized["dapui_config"] = dapui.open
    dap.listeners.before.event_terminated["dapui_config"] = dapui.close
    dap.listeners.before.event_exited["dapui_config"] = dapui.close

    -- Setup virtual text to show variable values inline
    require("nvim-dap-virtual-text").setup({})

    -- Enhanced DAP signs with better debugging visibility
    vim.fn.sign_define(
      "DapBreakpoint",
      { text = "●", texthl = "DapBreakpoint", linehl = "DapBreakpointLine", numhl = "DapBreakpointNum" }
    )
    vim.fn.sign_define(
      "DapBreakpointCondition",
      { text = "◐", texthl = "DapBreakpointCondition", linehl = "DapBreakpointLine", numhl = "DapBreakpointNum" }
    )
    vim.fn.sign_define("DapLogPoint", { text = "◆", texthl = "DapLogPoint", linehl = "", numhl = "" })
    vim.fn.sign_define(
      "DapStopped",
      { text = "→", texthl = "DapStopped", linehl = "DapStoppedLine", numhl = "DapStoppedNum" }
    )
    vim.fn.sign_define(
      "DapBreakpointRejected",
      { text = "○", texthl = "DapBreakpointRejected", linehl = "", numhl = "" }
    )
    vim.fn.sign_define(
      "DapException",
      { text = "❌", texthl = "DapException", linehl = "DapExceptionLine", numhl = "DapExceptionNum" }
    )

    -- Define custom highlight groups for debugging
    vim.api.nvim_set_hl(0, "DapBreakpoint", { fg = "#d8a657" }) -- Gruvbox yellow
    vim.api.nvim_set_hl(0, "DapBreakpointLine", { bg = "#3c3110" }) -- Subtle yellow background
    vim.api.nvim_set_hl(0, "DapBreakpointNum", { fg = "#d8a657" })
    vim.api.nvim_set_hl(0, "DapBreakpointCondition", { fg = "#fabd2f" }) -- Brighter yellow for conditions
    vim.api.nvim_set_hl(0, "DapStopped", { fg = "#7daea3" }) -- Gruvbox blue
    vim.api.nvim_set_hl(0, "DapStoppedLine", { bg = "#1f2c2e" }) -- Blue background for current line
    vim.api.nvim_set_hl(0, "DapStoppedNum", { fg = "#7daea3", bold = true })
    vim.api.nvim_set_hl(0, "DapLogPoint", { fg = "#89b482" }) -- Gruvbox teal
    vim.api.nvim_set_hl(0, "DapBreakpointRejected", { fg = "#928374" }) -- Gruvbox gray
    vim.api.nvim_set_hl(0, "DapException", { fg = "#ea6962" }) -- Gruvbox red
    vim.api.nvim_set_hl(0, "DapExceptionLine", { bg = "#3d1f1f" }) -- Red background for exceptions
    vim.api.nvim_set_hl(0, "DapExceptionNum", { fg = "#ea6962", bold = true })
  end,
}
