-- nvim/.config/nvim/lua/plugins/sidekick/resume.lua
-- Resume previously-stored agent sessions. Backend-first selection, then
-- per-backend behavior: claude shows a custom snacks picker over its
-- ~/.claude/projects/<cwd>/*.jsonl files; cursor delegates to its own TUI.

local M = {}

local CLAUDE_SCAN_LINES = 50  -- how many lines to read at the top of each .jsonl
local PREVIEW_MAX = 80

---@return string e.g. "/Users/aviral/dotfiles" -> "-Users-aviral-dotfiles"
local function encode_cwd(cwd)
  return (cwd or vim.fn.getcwd()):gsub("/", "-")
end

---@param path string
---@return string[]
local function read_head_lines(path, n)
  local out = {}
  local fh = io.open(path, "r")
  if not fh then
    return out
  end
  for _ = 1, n do
    local line = fh:read("*l")
    if not line then
      break
    end
    out[#out + 1] = line
  end
  fh:close()
  return out
end

--- Decode JSON safely; return nil on error so callers can skip the line.
local function safe_decode(line)
  local ok, obj = pcall(vim.json.decode, line)
  if ok then
    return obj
  end
  return nil
end

--- Pull the first plain-text user-message snippet out of an event.
--- Claude's user events have shape: { message = { role = "user", content = "..." } }
--- or content = { { type = "text", text = "..." }, ... }.
local function extract_user_text(obj)
  if type(obj) ~= "table" then
    return nil
  end
  local msg = obj.message
  if type(msg) ~= "table" or msg.role ~= "user" then
    return nil
  end
  local content = msg.content
  if type(content) == "string" then
    return content
  end
  if type(content) == "table" then
    for _, part in ipairs(content) do
      if type(part) == "table" and part.type == "text" and type(part.text) == "string" then
        return part.text
      end
    end
  end
  return nil
end

--- Pull a session display name out of an event.
--- Per Task 1's discovery, claude persists --name as the very first two
--- lines of the .jsonl, as two distinct event types:
---   {"type":"custom-title","customTitle":"<name>","sessionId":"..."}
---   {"type":"agent-name","agentName":"<name>","sessionId":"..."}
--- Either is sufficient; we accept whichever appears first.
local function extract_session_name(obj)
  if type(obj) ~= "table" then
    return nil
  end
  if obj.type == "custom-title" and type(obj.customTitle) == "string" and obj.customTitle ~= "" then
    return obj.customTitle
  end
  if obj.type == "agent-name" and type(obj.agentName) == "string" and obj.agentName ~= "" then
    return obj.agentName
  end
  return nil
end

local function shorten(s, n)
  if not s then
    return ""
  end
  s = s:gsub("%s+", " "):gsub("^%s+", ""):gsub("%s+$", "")
  if #s <= n then
    return s
  end
  return s:sub(1, n - 1) .. "…"
end

---@param path string Absolute path to a .jsonl session file
---@return { id: string, name: string|nil, preview: string, mtime: integer }|nil
function M.parse_session(path)
  local id = vim.fn.fnamemodify(path, ":t:r")
  if id == "" then
    return nil
  end
  local mtime = vim.fn.getftime(path)
  if mtime < 0 then
    return nil
  end
  local lines = read_head_lines(path, CLAUDE_SCAN_LINES)
  local name, preview
  for _, line in ipairs(lines) do
    local obj = safe_decode(line)
    if obj then
      if not name then
        name = extract_session_name(obj)
      end
      if not preview then
        preview = extract_user_text(obj)
      end
      if name and preview then
        break
      end
    end
  end
  return {
    id = id,
    name = name,
    preview = shorten(preview or "(no preview)", PREVIEW_MAX),
    mtime = mtime,
  }
end

---@return { id, name, preview, mtime, path }[]
function M.list_claude_sessions()
  local dir = vim.fn.expand("~/.claude/projects/" .. encode_cwd())
  if vim.fn.isdirectory(dir) ~= 1 then
    return {}
  end
  local out = {}
  for _, path in ipairs(vim.fn.globpath(dir, "*.jsonl", false, true)) do
    local item = M.parse_session(path)
    if item then
      item.path = path
      out[#out + 1] = item
    end
  end
  table.sort(out, function(a, b)
    return a.mtime > b.mtime
  end)
  return out
end

return M
