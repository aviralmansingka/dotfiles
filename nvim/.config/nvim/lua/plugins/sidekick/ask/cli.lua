-- nvim/.config/nvim/lua/plugins/sidekick/ask/cli.lua
-- Spawn the pi agent for inline ask/edit prompts and read its final answer.
local M = {}

local PI_PROVIDER = "fireworks"
local PI_MODEL = "accounts/fireworks/routers/glm-5p3-fast"

local function read_output(obj)
  return (obj.stdout or ""):gsub("%s+$", "")
end

---@param prompt string
---@param on_done fun(result: { ok: boolean, result: string?, err: string?, duration_ms: integer?, tokens: { input: integer, output: integer }? })
---@param _opts { mode: string? }?  Retained for call-site compatibility.
---@return vim.SystemObj
function M.spawn(prompt, on_done, _opts)
  local start = vim.uv.hrtime()
  local cmd = {
    "pi",
    "--provider",
    PI_PROVIDER,
    "--model",
    PI_MODEL,
    "--no-tools",
    "--no-session",
    "--print",
    "--",
    prompt,
  }
  return vim.system(cmd, {
    cwd = vim.fn.getcwd(),
    text = true,
  }, function(obj)
    vim.schedule(function()
      local result = read_output(obj)

      if obj.code ~= 0 and result == "" then
        local err = (obj.stderr or ""):gsub("%s+$", "")
        if err == "" then
          err = "pi exited with code " .. tostring(obj.code)
        end
        on_done({ ok = false, err = err })
        return
      end
      if result == "" then
        on_done({ ok = false, err = "pi: empty result" })
        return
      end
      on_done({
        ok = true,
        result = result,
        duration_ms = math.floor((vim.uv.hrtime() - start) / 1000000),
        tokens = {
          input = 0,
          output = 0,
        },
      })
    end)
  end)
end

return M
