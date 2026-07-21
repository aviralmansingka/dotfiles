-- Render `starship prompt` output into the sidekick float's winbar.
-- Subshells starship per pane cwd, parses SGR escape sequences into nvim
-- highlight groups, caches the resulting winbar string with a short TTL.
local M = {}

local TTL_NS = 5 * 1e9 -- 5 seconds
local STRIPPED_NON_SGR = "\27%[[?]?[%d;]*[A-LN-Za-ln-z]"
local OSC_BEL = "\27%].-\7"

-- gruvbox-aligned standard 16 colors so basic ANSI (30-37 / 90-97) renders
-- consistently with the rest of the editor.
local ANSI_BASIC = {
  [30] = "#3c3836",
  [31] = "#cc241d",
  [32] = "#98971a",
  [33] = "#d79921",
  [34] = "#458588",
  [35] = "#b16286",
  [36] = "#689d6a",
  [37] = "#a89984",
  [90] = "#928374",
  [91] = "#fb4934",
  [92] = "#b8bb26",
  [93] = "#fabd2f",
  [94] = "#83a598",
  [95] = "#d3869b",
  [96] = "#8ec07c",
  [97] = "#ebdbb2",
}

local XTERM_LEVELS = { [0] = 0, [1] = 95, [2] = 135, [3] = 175, [4] = 215, [5] = 255 }
local XTERM_LOW16 = { 30, 31, 32, 33, 34, 35, 36, 37, 90, 91, 92, 93, 94, 95, 96, 97 }

local function xterm256_to_hex(n)
  if n < 16 then
    return ANSI_BASIC[XTERM_LOW16[n + 1]]
  elseif n < 232 then
    local c = n - 16
    local r = XTERM_LEVELS[math.floor(c / 36)]
    local g = XTERM_LEVELS[math.floor((c % 36) / 6)]
    local b = XTERM_LEVELS[c % 6]
    return string.format("#%02x%02x%02x", r, g, b)
  else
    local v = 8 + (n - 232) * 10
    return string.format("#%02x%02x%02x", v, v, v)
  end
end

--- Idempotently define SidekickStarship<RRGGBB> for `hex` (#RRGGBB) and
--- return the group name.
---@param hex string
---@return string
local function ensure_hl(hex)
  local name = "SidekickStarship" .. hex:sub(2):upper()
  vim.api.nvim_set_hl(0, name, { fg = hex, default = false })
  return name
end

---@param params number[]
---@param state { fg: string|nil }
local function apply_sgr(params, state)
  if #params == 0 then
    state.fg = nil
    return
  end
  local i = 1
  while i <= #params do
    local p = params[i]
    if p == 0 or p == 39 then
      state.fg = nil
    elseif (p >= 30 and p <= 37) or (p >= 90 and p <= 97) then
      state.fg = ANSI_BASIC[p]
    elseif p == 38 then
      local mode = params[i + 1]
      if mode == 5 then
        local n = params[i + 2]
        if n then
          state.fg = xterm256_to_hex(n)
        end
        i = i + 2
      elseif mode == 2 then
        local r, g, b = params[i + 2], params[i + 3], params[i + 4]
        if r and g and b then
          state.fg = string.format("#%02x%02x%02x", r, g, b)
        end
        i = i + 4
      end
    end
    i = i + 1
  end
end

local function escape_winbar(text)
  return (text:gsub("%%", "%%%%"))
end

--- Emit `%#Hl#text%*` segments by walking SGR escape sequences. Non-SGR
--- escape sequences are stripped before parsing.
---@param input string raw starship output
---@return string winbar-formatted statusline text
function M.parse(input)
  if not input or input == "" then
    return ""
  end
  -- Drop OSC + non-SGR CSI sequences (cursor moves, mode switches, etc.).
  input = input:gsub(OSC_BEL, ""):gsub(STRIPPED_NON_SGR, "")
  -- Starship prefixes a leading newline and may emit a trailing one; pick the
  -- first non-empty line so we don't lose the prompt to a leading "\n".
  input = input:match("[^\n]+") or ""

  local out, state, pos = {}, { fg = nil }, 1
  local function flush(text)
    if text == "" then
      return
    end
    if state.fg then
      out[#out + 1] = "%#" .. ensure_hl(state.fg) .. "#"
    end
    out[#out + 1] = escape_winbar(text)
    if state.fg then
      out[#out + 1] = "%*"
    end
  end

  while pos <= #input do
    local start, finish, params_str = input:find("\27%[([%d;]*)m", pos)
    if not start then
      flush(input:sub(pos))
      break
    end
    if start > pos then
      flush(input:sub(pos, start - 1))
    end
    local params = {}
    if params_str ~= "" then
      for n in params_str:gmatch("(%d+)") do
        params[#params + 1] = tonumber(n)
      end
    end
    apply_sgr(params, state)
    pos = finish + 1
  end
  return table.concat(out)
end

local cache = {}

function M.invalidate(cwd)
  if cwd then
    cache[cwd] = nil
  else
    cache = {}
  end
end

--- Render starship for `cwd` with TTL caching. Returns "" if starship is
--- unavailable or fails.
---@param cwd string|nil
---@return string
function M.render(cwd)
  if not cwd or cwd == "" then
    return ""
  end
  if vim.fn.executable("starship") ~= 1 then
    return ""
  end
  local stat = vim.uv.fs_stat(cwd)
  if not stat or stat.type ~= "directory" then
    return ""
  end
  local now = vim.uv.hrtime()
  local entry = cache[cwd]
  if entry and (now - entry.rendered_at) < TTL_NS then
    return entry.winbar
  end
  -- Override STARSHIP_SHELL so starship doesn't wrap output in zsh prompt
  -- escapes (`%{...%}`). Also override PWD — starship reads it for its
  -- directory and git modules even when the subprocess's cwd is set.
  local env = vim.fn.environ()
  env.STARSHIP_SHELL = ""
  env.PWD = cwd
  local result = vim.system(
    { "starship", "prompt", "--path", cwd, "--terminal-width", "200" },
    { env = env, cwd = cwd }
  ):wait()
  if result.code ~= 0 then
    return ""
  end
  local wb = M.parse(result.stdout or "")
  cache[cwd] = { rendered_at = now, winbar = wb }
  return wb
end

---@param terminal table|nil
---@return string|nil
function M.cwd_for_terminal(terminal)
  if not terminal then
    return nil
  end
  local session = terminal.session or {}
  return terminal.cwd or session.cwd or (session.parent and session.parent.cwd)
end

--- Winbar expression entry point. Resolves the current Sidekick terminal to
--- its Herdr session cwd and renders starship for that cwd. Cheap on cache hit.
---@return string
function M.winbar_for_current_win()
  local win = vim.api.nvim_get_current_win()
  local sid = vim.w[win].sidekick_session_id
  if not sid then
    return ""
  end
  local term_ok, terminal_mod = pcall(require, "sidekick.cli.terminal")
  if not term_ok then
    return ""
  end
  local term = terminal_mod.get(sid)
  return M.render(M.cwd_for_terminal(term))
end

return M
