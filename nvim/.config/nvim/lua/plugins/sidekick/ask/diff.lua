-- nvim/.config/nvim/lua/plugins/sidekick/ask/diff.lua
-- Parse a single-hunk unified git diff returned by the model. The prompt
-- contract is: one file, ONE `@@` hunk that covers the highlighted scope
-- in full (every original line as `-`, new content as `+`). We extract just
-- the `+` lines as the replacement to substitute into the buffer over the
-- known scope range — the `@@` line numbers are sanity-only since we drive
-- application off the live extmark span, not the model's coordinates.
-- A standalone `NOOP` token is accepted and parsed as an empty list (no edit).
local M = {}

local function strip_fences(text)
  text = text:gsub('^```[%w_-]*\n', '')
  text = text:gsub('\n```%s*$', '')
  return text
end

---@param text string
---@return string[]?, string? error
---  Returns `{}, nil` for `NOOP`, `string[], nil` for the `+` lines of the
---  single hunk, or `nil, err` if the reply is unparseable.
function M.parse(text)
  text = (text or ''):gsub('^%s+', ''):gsub('%s+$', '')
  if text == '' then return nil, 'empty reply' end
  text = strip_fences(text)

  local raw_lines = {}
  for line in (text .. '\n'):gmatch('([^\n]*)\n') do
    raw_lines[#raw_lines + 1] = line
  end

  -- Scan for the start of the diff content; everything before is preamble.
  local diff_start
  for i, line in ipairs(raw_lines) do
    if line:match('^%-%-%-%s') or line:match('^%+%+%+%s') or line:match('^@@') then
      diff_start = i
      break
    end
  end
  if not diff_start then
    for _, line in ipairs(raw_lines) do
      if line:gsub('%s+$', '') == 'NOOP' then return {}, nil end
    end
    return nil, 'no diff or NOOP found'
  end

  local saw_hunk = false
  local added = {}
  for i = diff_start, #raw_lines do
    local line = raw_lines[i]
    if line:match('^%-%-%-%s') or line:match('^%+%+%+%s') then
      -- file headers, ignore
    elseif line:match('^@@') then
      if saw_hunk then
        return nil, 'multiple hunks not allowed (one hunk covers the whole highlighted range)'
      end
      if not line:match('^@@%s*%-(%d+),?(%d*)%s+%+(%d+),?(%d*)%s*@@') then
        return nil, 'malformed hunk header: ' .. line
      end
      saw_hunk = true
    elseif saw_hunk then
      local prefix = line:sub(1, 1)
      if prefix == '+' then
        added[#added + 1] = line:sub(2)
      end
      -- '-' lines, ' ' context lines, and any other junk are ignored —
      -- we replace the known scope wholesale with the `+` lines.
    end
  end

  if not saw_hunk then return nil, 'no hunk found in diff' end
  return added, nil
end

return M
