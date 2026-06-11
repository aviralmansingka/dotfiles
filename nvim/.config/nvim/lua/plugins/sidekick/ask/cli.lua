-- nvim/.config/nvim/lua/plugins/sidekick/ask/cli.lua
-- Spawn Codex for inline ask/edit prompts and read its final answer.
local M = {}

local CODEX_MODEL = "gpt-5.3-codex-spark"

local function read_output(path)
  local ok, lines = pcall(vim.fn.readfile, path)
  if not ok or type(lines) ~= "table" then
    return ""
  end
  return table.concat(lines, "\n"):gsub("%s+$", "")
end

---@param prompt string
---@param on_done fun(result: { ok: boolean, result: string?, err: string?, duration_ms: integer?, tokens: { input: integer, output: integer }? })
---@param _opts { mode: string? }?  Retained for call-site compatibility.
---@return vim.SystemObj
function M.spawn(prompt, on_done, _opts)
  local output_path = vim.fn.tempname()
  local start = vim.uv.hrtime()
  local cmd = {
    "codex",
    "--model",
    CODEX_MODEL,
    "--sandbox",
    "read-only",
    "-a",
    "never",
    "exec",
    "--output-last-message",
    output_path,
  }
  cmd[#cmd + 1] = prompt
  return vim.system(cmd, {
    cwd = vim.fn.getcwd(),
    text = true,
  }, function(obj)
    vim.schedule(function()
      local result = read_output(output_path)
      pcall(vim.fn.delete, output_path)

      if obj.code ~= 0 and result == "" then
        local err = (obj.stderr or ""):gsub("%s+$", "")
        if err == "" then
          err = "codex exited with code " .. tostring(obj.code)
        end
        on_done({ ok = false, err = err })
        return
      end
      if result == "" then
        on_done({ ok = false, err = "codex: empty result" })
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
