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

    -- Override LazyVim's automatic DAP UI opening
    -- Remove the automatic opening listener
    dap.listeners.after.event_initialized["dapui_config"] = nil
    dap.listeners.before.event_terminated["dapui_config"] = nil
    dap.listeners.before.event_exited["dapui_config"] = nil
  end,
}
