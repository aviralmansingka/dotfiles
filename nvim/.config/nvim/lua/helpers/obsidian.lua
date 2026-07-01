-- Helper module for vault-specific Obsidian workflows.
local M = {}

local function target_time(offset_days)
  return os.time() + ((offset_days or 0) * 24 * 60 * 60)
end

local function date_info(offset_days)
  local time = target_time(offset_days)
  local week_id = string.format("%s-W%s", vim.fn.strftime("%G", time), vim.fn.strftime("%V", time))

  return {
    day_heading = vim.fn.strftime("%A, %Y-%m-%d", time),
    week_id = week_id,
  }
end

local function default_backlog_lines(info)
  return {
    "---",
    "id: backlog",
    "aliases: []",
    "tags: []",
    "---",
    "",
    "# " .. info.week_id .. ": Backlog",
    "",
    "## Log",
    "",
    "### " .. info.day_heading,
    "",
  }
end

local function ensure_backlog_file(path, info)
  local dir = vim.fn.fnamemodify(path, ":h")
  if vim.fn.isdirectory(dir) == 0 then
    vim.fn.mkdir(dir, "p")
  end

  if vim.fn.filereadable(path) == 0 then
    vim.fn.writefile(default_backlog_lines(info), path)
  end
end

local function ensure_day_heading(info)
  local lines = vim.api.nvim_buf_get_lines(0, 0, -1, false)
  local log_idx
  local day_idx
  local next_section_idx

  for i, line in ipairs(lines) do
    if line == "## Log" then
      log_idx = i
    elseif line == "### " .. info.day_heading then
      day_idx = i
    elseif log_idx and i > log_idx and line:match("^## ") then
      next_section_idx = i
      break
    end
  end

  if not log_idx then
    vim.api.nvim_buf_set_lines(0, -1, -1, false, { "", "## Log", "", "### " .. info.day_heading, "" })
    return #lines + 4
  end

  if day_idx then
    return day_idx
  end

  local insert_at = next_section_idx and (next_section_idx - 1) or #lines
  vim.api.nvim_buf_set_lines(0, insert_at, insert_at, false, { "", "### " .. info.day_heading, "" })
  return insert_at + 2
end

function M.open_weekly_backlog(offset_days)
  local info = date_info(offset_days)
  local backlog_file = vim.fn.expand("~/vault/3_logs/" .. info.week_id .. "/backlog.md")

  ensure_backlog_file(backlog_file, info)
  vim.cmd("edit " .. vim.fn.fnameescape(backlog_file))

  local was_modified = vim.bo.modified
  local heading_line = ensure_day_heading(info)
  if vim.bo.modified and not was_modified then
    vim.cmd("write")
  end

  local target_line = math.min(heading_line + 2, vim.api.nvim_buf_line_count(0))
  vim.api.nvim_win_set_cursor(0, { target_line, 0 })
end

-- Backward-compatible name for older local mappings.
function M.open_daily_note(offset_days)
  M.open_weekly_backlog(offset_days)
end

function M.today()
  M.open_weekly_backlog(0)
end

function M.yesterday()
  M.open_weekly_backlog(-1)
end

function M.tomorrow()
  M.open_weekly_backlog(1)
end

return M
