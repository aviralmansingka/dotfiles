-- <leader>mb dispatches a build command keyed off the current buffer's subpath
-- under ~/modal. Used to populate prereqs (e.g. ui/dist) before launching a service
-- under delve via the entries in modal/dap.lua.
--
-- To add a service: append an entry to `builds` keyed by the subpath under ~/modal.
-- Longest matching prefix wins, so nested entries (e.g. go/machine-manager/cmd/foo)
-- take precedence over their parents (e.g. go/machine-manager) when both exist.

local M = {}

local home = vim.fn.expand("~")
local MODAL_ROOT = home .. "/modal/"

---@class ModalBuild
---@field cwd string Path under ~/modal/ where the command runs.
---@field cmd string[] Argv to execute via vim.system.
---@field desc string Human-readable description shown in the start notification.

---@type table<string, ModalBuild>
local builds = {
  --- machine-manager: populate ui/dist for -tags=ui (required by //go:embed all:ui/dist
  --- in ui_embed.go, which is itself //go:build ui-gated).
  ---
  --- The repo's `make generate-ui` runs `go generate ./machine-manager/` without -tags=ui,
  --- which silently skips the //go:generate directives in ui_embed.go (they're build-tag-gated)
  --- — i.e., it emits zero commands and never builds the UI. Calling go generate -tags=ui
  --- directly works around that until the upstream makefile is fixed.
  ["go/machine-manager"] = {
    cwd = "go",
    cmd = { "go", "generate", "-tags=ui", "./machine-manager/" },
    desc = "machine-manager: build ui/dist (npm ci + vite build via go generate -tags=ui)",
  },
}

---@return string? key, ModalBuild? build
local function detect()
  local buf = vim.api.nvim_buf_get_name(0)
  if buf == "" or not vim.startswith(buf, MODAL_ROOT) then
    return nil, nil
  end
  local rel = buf:sub(#MODAL_ROOT + 1)
  local best_key, best_len = nil, -1
  for key in pairs(builds) do
    if rel == key or vim.startswith(rel, key .. "/") then
      if #key > best_len then
        best_key, best_len = key, #key
      end
    end
  end
  if not best_key then
    return nil, nil
  end
  return best_key, builds[best_key]
end

function M.run()
  local key, build = detect()
  if not build then
    vim.notify(
      "modal build: no entry registered for the current buffer (add one in plugins/modal/build.lua)",
      vim.log.levels.WARN
    )
    return
  end
  local cwd = MODAL_ROOT .. build.cwd
  vim.notify("modal build: " .. build.desc .. " (running)", vim.log.levels.INFO)
  vim.system(
    build.cmd,
    { cwd = cwd, text = true },
    vim.schedule_wrap(function(out)
      if out.code == 0 then
        vim.notify("modal build OK: " .. key, vim.log.levels.INFO)
        return
      end
      local err = (out.stderr or ""):gsub("%s+$", "")
      if err == "" then
        err = (out.stdout or ""):sub(-2000)
      end
      vim.notify("modal build FAIL: " .. key .. " (exit " .. out.code .. ")\n" .. err, vim.log.levels.ERROR)
    end)
  )
end

-- Piggyback on an already-loaded plugin so Lazy registers the keymap without
-- declaring a fresh plugin source. LazyVim is loaded at startup so this is a no-op
-- on the plugin lifecycle.
return {
  "LazyVim/LazyVim",
  keys = {
    {
      "<leader>mb",
      function()
        M.run()
      end,
      desc = "Modal: Build (make-build)",
    },
  },
}
