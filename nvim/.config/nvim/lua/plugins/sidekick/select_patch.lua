-- Override sidekick.cli.ui.select.format so the cwd column is right-aligned
-- against the picker's right edge instead of left-aligned at a fixed column.
-- Implemented by emitting the cwd chunks as a virt_text extmark with
-- virt_text_pos = "right_align" (the same mechanism snacks' own formatters
-- use for right-aligned severity/git fields).

local M = {}

local function build_left_chunks(state, picker, sw, Config)
  local ret = {}
  local status = state.attached and "attached"
    or state.started and "started"
    or state.installed and "installed"
    or "missing"
  local status_hl = "SidekickCli" .. status:gsub("^%l", string.upper)

  if picker then
    local count = picker:count()
    local idx = tostring(state.idx)
    idx = (" "):rep(#tostring(count) - #idx) .. idx
    ret[#ret + 1] = { idx .. ".", "SnacksPickerIdx" }
    ret[#ret + 1] = { " " }
  end
  ret[#ret + 1] = { Config.ui.icons[status], status_hl }
  ret[#ret + 1] = { " " }
  ret[#ret + 1] = { state.tool.name }

  if not state.session then
    return ret
  end

  local len = sw(state.tool.name) + 2
  ret[#ret + 1] = { string.rep(" ", math.max(1, 12 - len)) }
  if state.external then
    ret[#ret + 1] = { Config.ui.icons["external_" .. status], status_hl }
  else
    ret[#ret + 1] = { Config.ui.icons["terminal_" .. status], status_hl }
  end

  local backends = {}
  backends[#backends + 1] = state.session.mux_backend or state.session.backend
  if state.external then
    backends[#backends + 1] = state.session.mux_session
  end
  ret[#ret + 1] = { ("[%s]"):format(table.concat(backends, ":")), "Special" }
  return ret
end

local function build_right_virt(state, picker)
  local Snacks = require("snacks")
  local item = setmetatable({}, state) --[[@as snacks.picker.Item]]
  item.file = state.session.cwd
  item.dir = true
  local chunks = Snacks.picker.format.filename(item, picker)
  local virt = {}
  for _, c in ipairs(chunks) do
    if c.resolve then
      for _, r in ipairs(c.resolve(60)) do
        if type(r[1]) == "string" and r[1] ~= "" then
          virt[#virt + 1] = { r[1], r[2] }
        end
      end
    elseif type(c[1]) == "string" and c[1] ~= "" then
      virt[#virt + 1] = { c[1], c[2] }
    end
  end
  return virt
end

function M.apply()
  local ok, select_ui = pcall(require, "sidekick.cli.ui.select")
  if not ok then
    return
  end
  local Config = require("sidekick.config")
  local sw = vim.api.nvim_strwidth

  select_ui.format = function(state, picker)
    local ret = build_left_chunks(state, picker, sw, Config)
    if not state.session then
      return ret
    end
    if picker then
      ret[#ret + 1] = {
        col = 0,
        virt_text = build_right_virt(state, picker),
        virt_text_pos = "right_align",
        hl_mode = "combine",
      }
    else
      ret[#ret + 1] = { " " }
      ret[#ret + 1] = { vim.fn.fnamemodify(state.session.cwd, ":p:~"), "Directory" }
    end
    return ret
  end
end

return M
