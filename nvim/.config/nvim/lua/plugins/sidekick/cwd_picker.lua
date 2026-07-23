-- nvim/.config/nvim/lua/plugins/sidekick/cwd_picker.lua
-- Cwd-scoped peek picker for sidekick named sessions.
-- Bound to <c-.> in plugins/sidekick.lua.
local internal = require("plugins.sidekick.internal")
local registry = require("plugins.sidekick.registry")
local branding = require("plugins.sidekick.branding")
local herdr = require("plugins.sidekick.herdr")

local M = {}
local status_rank = { blocked = 1, done = 2, working = 3, idle = 4 }
local status_display = {
  blocked = { "!", "DiagnosticError" },
  done = { "●", "DiagnosticWarn" },
  working = { "›", "DiagnosticInfo" },
  idle = { "·", "Comment" },
}

---@param p string
---@return string
local function normalize(p)
  if not p or p == "" then
    return ""
  end
  return vim.fs.normalize(vim.fn.fnamemodify(p, ":p")):gsub("/$", "")
end

---@param entry_cwd string|nil
---@param root string  already normalized
---@return boolean
local function in_cwd_subtree(entry_cwd, root)
  -- root == "" only when getcwd() was "/" (normalize strips its only slash).
  -- Treat as "match nothing" — a degenerate scenario, opt for safe empty state.
  if not entry_cwd or entry_cwd == "" or root == "" then
    return false
  end
  local n = normalize(entry_cwd)
  if n == root then
    return true
  end
  return n:sub(1, #root + 1) == root .. "/" or root:sub(1, #n + 1) == n .. "/"
end

local function strip_ansi(line)
  return line:gsub("\27%[[%d;:]*m", "")
end

local function scrub_codex_prompt(output)
  local lines = vim.split(output, "\r\n", { plain = true })
  for i = #lines, math.max(1, #lines - 8), -1 do
    if lines[i]:find("›", 1, true) and lines[i]:find("\27[48;", 1, true) then
      local first = i
      local previous = lines[first - 1]
      if previous
        and previous:find("\27[48;", 1, true)
        and strip_ansi(previous):match("^%s*$")
      then
        first = first - 1
      end
      while first > 1 and lines[first - 1] == "" do
        first = first - 1
      end
      return table.concat(lines, "\r\n", 1, first - 1) .. "\27[0m"
    end
  end
  return output
end

local function scrub_pi_prompt(output)
  local lines = vim.split(output, "\r\n", { plain = true })
  local footer
  for i = #lines, math.max(1, #lines - 8), -1 do
    if strip_ansi(lines[i]):match("^MCP:%s") then
      footer = i
      break
    end
  end
  if not footer then
    return output
  end

  local first
  local separators = 0
  for i = footer - 1, math.max(1, footer - 50), -1 do
    local text = strip_ansi(lines[i])
    if text ~= "" and text:gsub("─", "") == "" then
      first = i
      separators = separators + 1
      if separators == 2 then
        break
      end
    end
  end
  if separators < 2 then
    return output
  end

  while first > 1 do
    local previous = lines[first - 1]
    local text = strip_ansi(previous)
    if text:match("^%s*$") or (previous:find("\27[", 1, true) and text:match("^%s*.*Working%.%.%.%s*$")) then
      first = first - 1
    else
      break
    end
  end
  return table.concat(lines, "\r\n", 1, first - 1) .. "\27[0m"
end

local function preview_text(item)
  if not item or item._empty or not item.agent_name then
    return nil, "(no session)"
  end
  local output = herdr.read(item.agent_name, "recent-unwrapped", 120, true)
  if output and item.tool == "codex" then
    output = scrub_codex_prompt(output)
  elseif output and item.tool == "pi" then
    output = scrub_pi_prompt(output)
  end
  return output, "(agent read failed)"
end

---@return snacks.picker.finder.Item[]
function M.list_items()
  local root = normalize(vim.fn.getcwd())
  local home = normalize(vim.fn.expand("~"))
  local items = {}
  for label, entry in pairs(registry.discover()) do
    if in_cwd_subtree(entry.cwd, root) then
      local cwd_display = entry.cwd or ""
      if home ~= "" and cwd_display:sub(1, #home) == home then
        cwd_display = "~" .. cwd_display:sub(#home + 1)
      end
      items[#items + 1] = {
        text = string.format("%s  [%s]  %s", label, entry.status, cwd_display),
        label = label,
        tool = entry.tool,
        slug = entry.slug,
        pane_id = entry.pane_id,
        workspace_id = entry.workspace_id,
        terminal_id = entry.terminal_id,
        agent_name = entry.agent_name,
        status = entry.status,
        cwd = entry.cwd,
        cwd_display = cwd_display,
      }
    end
  end
  table.sort(items, function(a, b)
    local ar = status_rank[a.status] or math.huge
    local br = status_rank[b.status] or math.huge
    if ar ~= br then
      return ar < br
    end
    if a.tool ~= b.tool then
      return internal.compare_agents(a.tool, b.tool)
    end
    return a.label < b.label
  end)
  return items
end

-- A transparent highlight so the picker windows let the terminal bg show
-- through instead of painting Normal/NormalFloat over it.
local function ensure_transparent_hl()
  vim.api.nvim_set_hl(0, "SidekickPickerTransparent", { bg = "NONE", default = false })
end

function M.open()
  registry.rehydrate()
  ensure_transparent_hl()
  local items = M.list_items()
  local empty = #items == 0
  if empty then
    items = { {
      text = "(no named sessions in cwd)",
      _empty = true,
    } }
  end
  local has_working = vim.iter(items):any(function(item)
    return item.status == "working"
  end)
  local spinner_timer

  local function stop_spinner()
    local timer = spinner_timer
    spinner_timer = nil
    if timer and not timer:is_closing() then
      timer:stop()
      timer:close()
    end
  end

  local winhl = "Normal:SidekickPickerTransparent"
    .. ",NormalFloat:SidekickPickerTransparent"
    .. ",NormalNC:SidekickPickerTransparent"

  local function format_item(item)
    if item._empty then
      return { { item.text or "", "Comment" } }
    end
    local hl = branding.hl_groups(branding.tool_of(item.tool))
    local status = status_display[item.status] or { "?", "Comment" }
    local chunks = {
      { (item.status == "working" and Snacks.util.spinner() or status[1]) .. " ", status[2] },
      { item.label or "", hl.title },
    }
    if item.status ~= "idle" and item.status ~= "working" then
      vim.list_extend(chunks, {
        { "  " },
        { "[" .. (item.status or "unknown") .. "]", "Comment" },
      })
    end
    vim.list_extend(chunks, {
      { "  " },
      { item.cwd_display or "", "Directory" },
    })
    return chunks
  end

  Snacks.picker.pick({
    source = "sidekick_cwd_peek",
    title = "Sidekick Sessions in Cwd",
    items = items,
    format = format_item,
    on_show = function(picker)
      if not has_working or spinner_timer then
        return
      end
      spinner_timer = vim.uv.new_timer()
      spinner_timer:start(80, 80, vim.schedule_wrap(function()
        if picker.closed then
          stop_spinner()
        else
          picker.list:update({ force = true })
        end
      end))
    end,
    on_close = stop_spinner,
    layout = {
      preset = "default",
      layout = {
        box = "vertical",
        width = 0.8,
        height = 0.8,
        border = "none",
        backdrop = false,
        { win = "preview", border = "rounded" },
        { win = "list", height = 5, border = "rounded" },
        { win = "input", height = 1, border = "rounded" },
      },
    },
    preview = function(ctx)
      local buf = ctx.preview:scratch()
      local output, err = preview_text(ctx.item)
      if output then
        vim.api.nvim_chan_send(vim.api.nvim_open_term(buf, {}), output)
      else
        vim.api.nvim_buf_set_lines(buf, 0, -1, false, { err })
      end
      return true
    end,
    confirm = function(picker, item)
      picker:close()
      if not item or item._empty then
        return
      end
      if item.label then
        require("plugins.sidekick.last_session").record(item.label)
        internal.toggle_tool_session(item.label, true)
      end
    end,
    win = {
      input = {
        wo = { winhighlight = winhl },
        keys = {
          ["<c-x>"] = { "sidekick_kill_session", mode = { "n", "i" } },
        },
      },
      list = {
        wo = { cursorline = false, winhighlight = winhl },
        keys = {
          ["<c-x>"] = { "sidekick_kill_session", mode = { "n" } },
        },
      },
      preview = {
        wo = { winhighlight = winhl, wrap = true, linebreak = true },
      },
    },
    actions = {
      sidekick_kill_session = function(picker, item)
        if not item or item._empty or not item.pane_id then
          return
        end
        if herdr.close(item.pane_id) then
          picker:close()
          vim.schedule(function()
            M.open()
          end)
        end
      end,
    },
  })
end

return M
