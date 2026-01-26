-- Helper module for custom Obsidian daily note functionality with weekly folders
local M = {}

-- Calculate ISO week number and year for a given date
local function get_week_info(time)
  local year = tonumber(os.date("%Y", time))
  local month = tonumber(os.date("%m", time))
  local day = tonumber(os.date("%d", time))

  -- Calculate ISO week number (Monday as start of week)
  local jan1 = os.time({ year = year, month = 1, day = 1 })
  local jan1_wday = tonumber(os.date("%w", jan1)) -- 0=Sunday, 1=Monday, etc
  local jan1_monday = jan1 - ((jan1_wday == 0 and 6 or jan1_wday - 1) * 24 * 3600)

  local target_time = os.time({ year = year, month = month, day = day })
  local days_since_jan1_monday = math.floor((target_time - jan1_monday) / (24 * 3600))
  local week_num = math.floor(days_since_jan1_monday / 7) + 1

  -- Handle year boundary cases
  if week_num < 1 then
    year = year - 1
    week_num = 52
  elseif week_num > 52 then
    local dec31 = os.time({ year = year, month = 12, day = 31 })
    local dec31_wday = tonumber(os.date("%w", dec31))
    if dec31_wday < 4 then
      year = year + 1
      week_num = 1
    end
  end

  return year, week_num
end

-- Open daily note with weekly folder structure
-- @param offset_days: number of days from today (0 = today, -1 = yesterday, 1 = tomorrow)
function M.open_daily_note(offset_days)
  offset_days = offset_days or 0

  local journal_dir = vim.fn.expand("~/obsidian/personal/journal/")
  local template_dir = vim.fn.expand("~/obsidian/personal/templates/")

  -- Calculate target date
  local target_time = os.time() + (offset_days * 24 * 3600)
  local target_date = os.date("%Y-%m-%d", target_time)

  -- Get week info for target date
  local year, week_num = get_week_info(target_time)
  local week_folder = string.format("%s%d-W%02d", journal_dir, year, week_num)

  -- Create the weekly directory if it doesn't exist
  if vim.fn.isdirectory(week_folder) == 0 then
    vim.fn.mkdir(week_folder, "p")
  end

  local filename = week_folder .. "/" .. target_date .. ".md"

  -- Check if the file already exists
  if vim.fn.filereadable(filename) == 1 then
    vim.cmd("edit " .. filename)
  else
    -- Create a new file with template
    vim.cmd("edit " .. filename)

    -- Load template
    local template_path = template_dir .. "daily.md"
    local template
    if vim.fn.filereadable(template_path) == 1 then
      template = vim.fn.readfile(template_path)
      -- Replace date placeholder
      for i, line in ipairs(template) do
        template[i] = line:gsub("{{date}}", target_date)
      end
    else
      -- Fallback template
      template = {
        "# Daily Note: " .. target_date,
        "",
        "## Habit Tracking",
        "",
        "- [ ] Daily check-in",
        "",
        "## Journal",
        "",
      }
    end

    -- Insert the template content
    vim.api.nvim_buf_set_lines(0, 0, -1, false, template)

    -- Save the file
    vim.cmd("write")
  end
end

return M
