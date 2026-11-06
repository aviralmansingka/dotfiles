-- Reflow Markdown prose at a visible width. Link destinations stay out of the
-- width, so a long URL never leaves blank space in a wrapped line.
--
-- The formatter leaves structure alone: frontmatter, headings, tables, HTML,
-- and fenced code pass through unchanged. It reflows plain paragraphs, list
-- items, and blockquotes, and keeps hard line breaks.
local text = require("helpers.markdown_text")

local M = {}

local function is_blank(line)
  return line:match("^%s*$") ~= nil
end

local function is_heading(line)
  return line:match("^%s*#+%s") ~= nil
end

local function is_table(line)
  return line:match("^%s*|") ~= nil
end

local function is_html(line)
  return line:match("^%s*<") ~= nil
end

local function is_fence(line)
  return line:match("^%s*```") ~= nil or line:match("^%s*~~~") ~= nil
end

local function hard_break(line)
  return line:match("%s%s$") ~= nil or line:match("\\$") ~= nil
end

--- Split a line into its quote/list prefix, continuation prefix, content, and kind.
local function prefix_of(line)
  local quote = ""
  local rest = line
  while rest:match("^>%s?") do
    quote = quote .. "> "
    rest = rest:gsub("^>%s?", "", 1)
  end

  local indent, marker = rest:match("^(%s*)([-*+])%s+")
  if not marker then
    indent, marker = rest:match("^(%s*)(%d+[.)])%s+")
  end
  if marker then
    return quote .. indent .. marker .. " ",
      quote .. string.rep(" ", #indent + #marker + 1),
      rest:sub(#indent + #marker + 2),
      "list"
  end

  if quote ~= "" then
    return quote, quote, rest, "quote"
  end
  return "", "", line, "prose"
end

local function wrap(content, budget)
  local out = {}
  local line = ""
  for word in content:gmatch("%S+") do
    if line == "" then
      line = word
    elseif text.width(line .. " " .. word) <= budget then
      line = line .. " " .. word
    else
      out[#out + 1] = line
      line = word
    end
  end
  if line ~= "" then
    out[#out + 1] = line
  end
  return out
end

--- Reflow `lines` at `width` visible columns.
function M.format(lines, width)
  width = width or 99
  local out = {}
  local i, n = 1, #lines

  if n > 0 and lines[1] == "---" then
    out[#out + 1] = lines[1]
    i = 2
    while i <= n do
      out[#out + 1] = lines[i]
      local closed = lines[i] == "---"
      i = i + 1
      if closed then
        break
      end
    end
  end

  while i <= n do
    local line = lines[i]
    if is_blank(line) or is_heading(line) or is_table(line) or is_html(line) then
      out[#out + 1] = line
      i = i + 1
    elseif is_fence(line) then
      local fence = line:match("^%s*(```+)") or line:match("^%s*(~~~+)")
      local close = fence:sub(1, 3)
      repeat
        out[#out + 1] = lines[i]
        i = i + 1
      until i > n or (lines[i]:match("^%s*" .. close))
    else
      local prefix, cont, content, kind = prefix_of(line)
      local chunks, words = {}, { content }
      local br = hard_break(line)
      i = i + 1
      if br then
        chunks[#chunks + 1] = { words = words, br = true }
        words = {}
      end

      while i <= n and not br do
        local current = lines[i]
        if is_blank(current) or is_heading(current) or is_table(current) or is_html(current) or is_fence(current) then
          break
        end

        local _, _, body, current_kind = prefix_of(current)
        if current_kind == kind and kind == "list" then
          break -- a new list item starts its own paragraph
        elseif current_kind ~= kind then
          -- an indented continuation of a list item
          if kind == "list" and current:match("^%s+%S") and not current:match("^%s*[-*+]%s") then
            body = current:match("^%s+(.*)$")
          else
            break
          end
        end

        words[#words + 1] = body
        br = hard_break(current)
        i = i + 1
        if br then
          chunks[#chunks + 1] = { words = words, br = true }
          words = {}
        end
      end
      if #words > 0 then
        chunks[#chunks + 1] = { words = words }
      end

      local budget = width - #prefix
      for _, chunk in ipairs(chunks) do
        local emitted = 0
        for _, wrapped in ipairs(wrap(table.concat(chunk.words, " "), budget)) do
          out[#out + 1] = (emitted == 0 and prefix or cont) .. wrapped
          emitted = emitted + 1
        end
        if chunk.br and emitted > 0 then
          out[#out] = out[#out] .. "  "
        end
      end
    end
  end

  return out
end

--- Reflow a whole document string.
function M.format_string(input, width)
  local lines = {}
  for line in (input .. "\n"):gmatch("([^\n]*)\n") do
    lines[#lines + 1] = line
  end
  if lines[#lines] == "" then
    lines[#lines] = nil
  end
  return table.concat(M.format(lines, width), "\n") .. "\n"
end

--- Format the operator range for 'formatexpr'.
function M.formatexpr()
  local first = vim.v.lnum
  local last = math.min(first + vim.v.count - 1, vim.api.nvim_buf_line_count(0))
  local width = vim.bo.textwidth
  if width <= 0 then
    width = 99
  end
  local lines = vim.api.nvim_buf_get_lines(0, first - 1, last, false)
  vim.api.nvim_buf_set_lines(0, first - 1, last, false, M.format(lines, width))
  return 0
end

return M
