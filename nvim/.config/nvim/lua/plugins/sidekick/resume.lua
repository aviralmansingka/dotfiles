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
---@param n integer
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

local internal = require("plugins.sidekick.internal")
local registry = require("plugins.sidekick.registry")

---@param secs integer Unix mtime
---@return string e.g. "5m ago", "2h ago", "3d ago"
local function relative_time(secs)
  local delta = math.max(0, os.time() - secs)
  if delta < 60 then
    return delta .. "s ago"
  elseif delta < 3600 then
    return math.floor(delta / 60) .. "m ago"
  elseif delta < 86400 then
    return math.floor(delta / 3600) .. "h ago"
  else
    return math.floor(delta / 86400) .. "d ago"
  end
end

---@param item { id, name, preview, mtime, path }
---@return string The label used as the sidekick tool key + tmux session prefix
local function label_for(item)
  if item.name and item.name ~= "" then
    local slug = internal.normalize_label(item.name)
    if slug ~= "" then
      return "claude-" .. slug
    end
  end
  return "claude-r-" .. item.id:sub(1, 8)
end

---@param item { id, name, preview, mtime, path }
---@return string[]
local function preview_lines(item)
  if not item or not item.path then
    return { "(no session)" }
  end
  local out = vim.fn.systemlist({ "tail", "-n", "200", item.path })
  if vim.v.shell_error ~= 0 then
    return { "(failed to read " .. item.path .. ")" }
  end
  return out
end

--- Spawn or focus the resumed session as a sidekick tool entry.
local function resume_claude(item)
  local label = label_for(item)
  if registry.discover()[label] then
    internal.toggle_tool_session(label, true)
    return
  end
  local config = require("sidekick.config")
  local cmd = vim.deepcopy(internal.tool_commands.claude)
  table.insert(cmd, "--resume")
  table.insert(cmd, item.id)
  config.cli.tools[label] = internal.merged_tool_config(
    "claude",
    internal.make_tool(cmd, nil, internal.tool_urls.claude)
  )
  internal.toggle_tool_session(label, true)
end

function M.claude_picker()
  local items = M.list_claude_sessions()
  if #items == 0 then
    vim.notify("Sidekick: no claude sessions for this cwd", vim.log.levels.INFO)
    return
  end
  local picker_items = {}
  for _, item in ipairs(items) do
    local display_name = item.name or item.id:sub(1, 8)
    picker_items[#picker_items + 1] = vim.tbl_extend("force", item, {
      text = string.format("[claude] %-30s  %-10s  %s", display_name, relative_time(item.mtime), item.preview),
    })
  end
  Snacks.picker.pick({
    source = "sidekick_resume_claude",
    title = "Sidekick Resume Claude Session",
    items = picker_items,
    format = "text",
    preview = function(ctx)
      vim.api.nvim_buf_set_lines(ctx.buf, 0, -1, false, preview_lines(ctx.item))
      return true
    end,
    confirm = function(picker, item)
      picker:close()
      if item then
        resume_claude(item)
      end
    end,
  })
end

local CURSOR_RESUME_LABEL = "cursor-resume"

function M.cursor_resume()
  if registry.discover()[CURSOR_RESUME_LABEL] then
    internal.toggle_tool_session(CURSOR_RESUME_LABEL, true)
    return
  end
  local config = require("sidekick.config")
  local cmd = vim.deepcopy(internal.tool_commands.cursor)
  table.insert(cmd, "resume")
  config.cli.tools[CURSOR_RESUME_LABEL] = internal.merged_tool_config(
    "cursor",
    internal.make_tool(cmd, nil, internal.tool_urls.cursor)
  )
  internal.toggle_tool_session(CURSOR_RESUME_LABEL, true)
end

function M.open()
  vim.ui.select({ "claude", "cursor" }, { prompt = "Resume agent backend:" }, function(choice)
    if choice == "claude" then
      M.claude_picker()
    elseif choice == "cursor" then
      M.cursor_resume()
    end
  end)
end

return M
