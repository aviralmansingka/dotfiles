local M = {}

local groups = {}
local definitions = {}
local group_count = 0

local basic_colors = {
  "#000000",
  "#800000",
  "#008000",
  "#808000",
  "#000080",
  "#800080",
  "#008080",
  "#c0c0c0",
  "#808080",
  "#ff0000",
  "#00ff00",
  "#ffff00",
  "#0000ff",
  "#ff00ff",
  "#00ffff",
  "#ffffff",
}

local function indexed_color(index)
  if index < 16 then
    return vim.g["terminal_color_" .. index] or basic_colors[index + 1]
  end
  if index < 232 then
    local value = index - 16
    local levels = { 0, 95, 135, 175, 215, 255 }
    local red = math.floor(value / 36)
    local green = math.floor(value % 36 / 6)
    local blue = value % 6
    return ("#%02x%02x%02x"):format(levels[red + 1], levels[green + 1], levels[blue + 1])
  end
  local gray = 8 + (index - 232) * 10
  return ("#%02x%02x%02x"):format(gray, gray, gray)
end

local function color(index)
  return index and { index = index } or nil
end

local function copy(state)
  return vim.deepcopy(state)
end

local function reset(state)
  for key in pairs(state) do
    state[key] = nil
  end
end

local function apply_sgr(state, params)
  local next_state = copy(state)
  local values = {}
  if params == "" then
    values[1] = 0
  else
    if
      not params:match("^[%d;]+$")
      or params:sub(1, 1) == ";"
      or params:sub(-1) == ";"
      or params:find(";;", 1, true)
    then
      return false
    end
    for value in params:gmatch("[^;]+") do
      values[#values + 1] = tonumber(value)
    end
    if #values == 0 then
      return false
    end
  end

  local i = 1
  while i <= #values do
    local value = values[i]
    if value == 0 then
      reset(next_state)
    elseif value == 1 then
      next_state.bold = true
    elseif value == 3 then
      next_state.italic = true
    elseif value == 4 then
      next_state.underline = true
    elseif value == 7 then
      next_state.reverse = true
    elseif value == 9 then
      next_state.strikethrough = true
    elseif value == 22 then
      next_state.bold = nil
    elseif value == 23 then
      next_state.italic = nil
    elseif value == 24 then
      next_state.underline = nil
    elseif value == 27 then
      next_state.reverse = nil
    elseif value == 29 then
      next_state.strikethrough = nil
    elseif value >= 30 and value <= 37 then
      next_state.fg = color(value - 30)
    elseif value >= 40 and value <= 47 then
      next_state.bg = color(value - 40)
    elseif value >= 90 and value <= 97 then
      next_state.fg = color(value - 90 + 8)
    elseif value >= 100 and value <= 107 then
      next_state.bg = color(value - 100 + 8)
    elseif value == 39 then
      next_state.fg = nil
    elseif value == 49 then
      next_state.bg = nil
    elseif value == 38 or value == 48 then
      local target = value == 38 and "fg" or "bg"
      local mode = values[i + 1]
      if mode == 5 and values[i + 2] and values[i + 2] >= 0 and values[i + 2] <= 255 then
        next_state[target] = color(values[i + 2])
        i = i + 2
      elseif
        mode == 2
        and values[i + 2]
        and values[i + 3]
        and values[i + 4]
        and values[i + 2] >= 0
        and values[i + 2] <= 255
        and values[i + 3] >= 0
        and values[i + 3] <= 255
        and values[i + 4] >= 0
        and values[i + 4] <= 255
      then
        next_state[target] = {
          gui = ("#%02x%02x%02x"):format(values[i + 2], values[i + 3], values[i + 4]),
        }
        i = i + 4
      else
        return false
      end
    else
      return false
    end
    i = i + 1
  end

  reset(state)
  for key, value in pairs(next_state) do
    state[key] = value
  end
  return true
end

local function highlight_attributes(state)
  local attrs = {
    bold = state.bold,
    italic = state.italic,
    underline = state.underline,
    reverse = state.reverse,
    strikethrough = state.strikethrough,
  }
  if state.fg then
    attrs.fg = state.fg.gui or indexed_color(state.fg.index)
    attrs.ctermfg = state.fg.index
  end
  if state.bg then
    attrs.bg = state.bg.gui or indexed_color(state.bg.index)
    attrs.ctermbg = state.bg.index
  end
  return attrs
end

local function group_for(state)
  if not next(state) then
    return nil
  end

  local key = vim.inspect(state)
  if groups[key] then
    return groups[key]
  end

  group_count = group_count + 1
  local name = "RenderMarkdownAnsi" .. group_count
  local attrs = highlight_attributes(state)
  vim.api.nvim_set_hl(0, name, attrs)
  groups[key] = name
  definitions[name] = copy(state)
  return name
end

local function add_highlight(marks, row, start_col, end_col, state)
  local group = group_for(state)
  if group and start_col < end_col then
    marks[#marks + 1] = {
      conceal = false,
      start_row = row,
      start_col = start_col,
      opts = {
        end_col = end_col,
        hl_group = group,
        hl_mode = "combine",
        priority = 200,
      },
    }
  end
end

local function parse_line(marks, row, line, start_col, end_col, state)
  local cursor = start_col + 1
  local limit = end_col or #line
  while cursor <= limit do
    local sgr_start, sgr_end, params = line:find("\27%[([0-9;]*)m", cursor)
    if not sgr_start or sgr_start > limit then
      break
    end
    add_highlight(marks, row, cursor - 1, sgr_start - 1, state)
    if apply_sgr(state, params) then
      marks[#marks + 1] = {
        conceal = false,
        start_row = row,
        start_col = sgr_start - 1,
        opts = {
          end_col = sgr_end,
          conceal = "",
          priority = 201,
        },
      }
    else
      add_highlight(marks, row, sgr_start - 1, sgr_end, state)
    end
    cursor = sgr_end + 1
  end
  add_highlight(marks, row, cursor - 1, limit, state)
end

local function content_node(node)
  for child in node:iter_children() do
    if child:type() == "code_fence_content" then
      return child
    end
  end
end

local function language(node, buf)
  for child in node:iter_children() do
    if child:type() == "info_string" then
      return vim.trim(vim.treesitter.get_node_text(child, buf))
    end
  end
end

local function visit(node, buf, marks)
  if node:type() == "fenced_code_block" and language(node, buf) == "ansi" then
    local content = content_node(node)
    if not content then
      return
    end
    local start_row, start_col, end_row, end_col = content:range()
    local lines = vim.api.nvim_buf_get_lines(buf, start_row, end_row + (end_col > 0 and 1 or 0), false)
    local state = {}
    for offset, line in ipairs(lines) do
      local row = start_row + offset - 1
      local first_col = row == start_row and start_col or 0
      local last_col = row == end_row and end_col or #line
      parse_line(marks, row, line, first_col, last_col, state)
    end
    return
  end

  for child in node:iter_children() do
    visit(child, buf, marks)
  end
end

function M.parse(ctx)
  if vim.bo[ctx.buf].filetype ~= "markdown" then
    return {}
  end
  local marks = {}
  visit(ctx.root, ctx.buf, marks)
  return marks
end

function M.setup()
  vim.api.nvim_create_autocmd("ColorScheme", {
    group = vim.api.nvim_create_augroup("RenderMarkdownAnsiColors", { clear = true }),
    callback = function()
      for name, state in pairs(definitions) do
        vim.api.nvim_set_hl(0, name, highlight_attributes(state))
      end
    end,
  })
end

return M
