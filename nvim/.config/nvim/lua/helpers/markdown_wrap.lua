-- Conceal-aware markdown text wrapping.
-- Treats [text](url) as just "text" for line-width calculation,
-- so textwidth / gq / format-on-save wrap at the *visual* width.

local M = {}

--- Visual display width of a markdown line, collapsing [text](url) → text.
function M.visual_width(line)
  local visual = line:gsub("%[([^%]]+)%]%([^%)]+%)", "%1")
  return vim.fn.strdisplaywidth(visual)
end

---------------------------------------------------------------------------
-- Tokeniser: splits text into words while keeping markdown links as single
-- tokens (even when the link text contains spaces).
---------------------------------------------------------------------------

--- Return (token, next_pos) starting from pos, or (nil, pos) at end.
local function next_token(text, pos)
  -- skip whitespace
  while pos <= #text and text:sub(pos, pos):match("%s") do
    pos = pos + 1
  end
  if pos > #text then
    return nil, pos
  end

  -- markdown link [text](url)  or  ![alt](url)
  local link = text:match("^(!?%[[^%]]+%]%([^%)]+%))", pos)
  if link then
    return link, pos + #link
  end

  -- plain word – advance until whitespace or start of a markdown link
  local start = pos
  while pos <= #text do
    local c = text:sub(pos, pos)
    if c:match("%s") then
      break
    end
    -- stop before a `[` that begins a valid link (so the link stays whole)
    if (c == "[" or (c == "!" and pos + 1 <= #text and text:sub(pos + 1, pos + 1) == "[")) and pos > start then
      if text:match("^!?%[[^%]]+%]%([^%)]+%)", pos) then
        break
      end
    end
    pos = pos + 1
  end

  return text:sub(start, pos - 1), pos
end

--- Re-wrap a single paragraph string into lines at `tw` *visual* columns.
function M.rewrap(text, tw)
  local result = {}
  local cur = ""
  local pos = 1

  while true do
    local tok, npos = next_token(text, pos)
    if not tok then
      break
    end
    pos = npos

    local test = cur == "" and tok or (cur .. " " .. tok)
    if M.visual_width(test) > tw and cur ~= "" then
      table.insert(result, cur)
      cur = tok
    else
      cur = test
    end
  end
  if cur ~= "" then
    table.insert(result, cur)
  end
  return result
end

---------------------------------------------------------------------------
-- Full-file formatter: only touches prose paragraphs.
---------------------------------------------------------------------------

local function is_prose(line)
  if line:match("^%s*$") then return false end
  if line:match("^#+%s") then return false end
  if line:match("^%s*[-*+] ") then return false end
  if line:match("^%s*%d+[.)] ") then return false end
  if line:match("^```") then return false end
  if line:match("^>") then return false end
  if line:match("^|") then return false end
  if line:match("^---+%s*$") then return false end
  if line:match("^%*%*%*+%s*$") then return false end
  if line:match("^___+%s*$") then return false end
  return true
end

--- Process a list of buffer lines: re-wrap prose paragraphs using visual
--- width, pass everything else through unchanged.
function M.format_lines(lines, tw)
  local result = {}
  local in_code = false
  local in_front = false
  local para = {}

  local function flush()
    if #para > 0 then
      local text = table.concat(para, " ")
      for _, l in ipairs(M.rewrap(text, tw)) do
        table.insert(result, l)
      end
      para = {}
    end
  end

  for i, line in ipairs(lines) do
    -- YAML frontmatter
    if i == 1 and line:match("^---+%s*$") then
      flush()
      in_front = true
      table.insert(result, line)
    elseif in_front then
      table.insert(result, line)
      if line:match("^---+%s*$") then
        in_front = false
      end
    -- fenced code blocks
    elseif line:match("^```") then
      flush()
      in_code = not in_code
      table.insert(result, line)
    elseif in_code then
      table.insert(result, line)
    -- blank line = paragraph boundary
    elseif line:match("^%s*$") then
      flush()
      table.insert(result, line)
    -- prose → accumulate
    elseif is_prose(line) then
      table.insert(para, vim.trim(line))
    -- everything else (headings, lists, tables, …) → pass through
    else
      flush()
      table.insert(result, line)
    end
  end
  flush()
  return result
end

---------------------------------------------------------------------------
-- formatexpr  (for gq and auto-format)
---------------------------------------------------------------------------

function M.formatexpr()
  local lnum = vim.v.lnum
  local count = vim.v.count
  local tw = vim.bo.textwidth > 0 and vim.bo.textwidth or 120

  local lines = vim.api.nvim_buf_get_lines(0, lnum - 1, lnum - 1 + count, false)
  local formatted = M.format_lines(lines, tw)
  vim.api.nvim_buf_set_lines(0, lnum - 1, lnum - 1 + count, false, formatted)
  return 0
end

return M
