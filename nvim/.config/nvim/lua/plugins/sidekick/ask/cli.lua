-- nvim/.config/nvim/lua/plugins/sidekick/ask/cli.lua
-- Spawn cursor-agent -p --mode ask --output-format json.
local M = {}

---@param prompt string
---@param on_done fun(result: { ok: boolean, result: string?, err: string?, duration_ms: integer?, tokens: { input: integer, output: integer }? })
---@param opts { mode: string? }?  `opts.mode` is forwarded as `--mode <m>`; omit the table or pass `{ mode = nil }` to skip the `--mode` flag entirely (used by the edit path so cursor-agent can produce diffs).
---@return vim.SystemObj
function M.spawn(prompt, on_done, opts)
  local cmd = { 'cursor-agent', '-p' }
  local mode = opts and opts.mode or nil
  if mode then
    cmd[#cmd + 1] = '--mode'
    cmd[#cmd + 1] = mode
  end
  cmd[#cmd + 1] = '--output-format'
  cmd[#cmd + 1] = 'json'
  cmd[#cmd + 1] = prompt
  return vim.system(cmd, {
    cwd = vim.fn.getcwd(),
    text = true,
  }, function(obj)
    vim.schedule(function()
      if obj.code ~= 0 then
        local err = (obj.stderr or ''):gsub('%s+$', '')
        if err == '' then err = 'cursor-agent exited with code ' .. tostring(obj.code) end
        on_done({ ok = false, err = err })
        return
      end
      local raw = obj.stdout or ''
      local ok, decoded = pcall(vim.json.decode, raw)
      if not ok or type(decoded) ~= 'table' then
        on_done({ ok = false, err = 'cursor-agent: unexpected output' })
        return
      end
      if decoded.is_error then
        on_done({ ok = false, err = tostring(decoded.result or 'cursor-agent reported error') })
        return
      end
      if type(decoded.result) ~= 'string' or decoded.result == '' then
        on_done({ ok = false, err = 'cursor-agent: empty result' })
        return
      end
      on_done({
        ok = true,
        result = decoded.result,
        duration_ms = decoded.duration_ms or 0,
        tokens = {
          input = (decoded.usage and decoded.usage.inputTokens) or 0,
          output = (decoded.usage and decoded.usage.outputTokens) or 0,
        },
      })
    end)
  end)
end

return M
