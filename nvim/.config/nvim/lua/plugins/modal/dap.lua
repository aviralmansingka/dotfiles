-- DAP launch configurations for Modal projects.
-- Registers a User LazyLoad autocmd in init() so the entries are appended after
-- nvim-dap is fully loaded. Merging via `opts` is unreliable here because the
-- existing dap.lua spec has its own `config = function()` and Lazy's spec merge
-- doesn't always run sibling `opts` functions when another spec defines `config`.
-- The autocmd path is robust regardless of merge order.
--
-- Add new entries to `configs` as you onboard more services.

local home = vim.fn.expand("~")

local configs = {
  -- machine-manager: HTTP/gRPC service for bare-metal lifecycle.
  -- Stop `inv machine-manager` first to free ports 9910-9912.
  -- `-tags=ui` embeds the built SPA; run <leader>mb first to populate ui/dist.
  {
    type = "go",
    name = "machine-manager",
    request = "launch",
    mode = "debug",
    program = home .. "/modal/go/machine-manager",
    cwd = home .. "/modal",
    args = { "9910", "9911", "9912" },
    buildFlags = "-tags=ui",
    --- Logs land in ~/.cache/nvim/dap-go-stdout.log (and -stderr.log); see <leader>dl
    --- for live tailing. delve does not forward debuggee output via DAP events for
    --- mode="debug", and `console = "integratedTerminal"` is silently ignored.
  },
}

return {
  "mfussenegger/nvim-dap",
  optional = true,
  init = function()
    vim.api.nvim_create_autocmd("User", {
      pattern = "LazyLoad",
      callback = function(args)
        if args.data ~= "nvim-dap" then
          return
        end
        local ok, dap = pcall(require, "dap")
        if not ok then
          return
        end
        dap.configurations.go = dap.configurations.go or {}
        for _, cfg in ipairs(configs) do
          table.insert(dap.configurations.go, cfg)
        end
      end,
    })
  end,
}
