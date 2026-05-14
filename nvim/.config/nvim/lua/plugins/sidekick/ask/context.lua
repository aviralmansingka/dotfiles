-- nvim/.config/nvim/lua/plugins/sidekick/ask/context.lua
-- Pure builder: assemble {code, scope_kind, symbols} from the buffer.
local M = {}

local IDENT_NODE_TYPES = {
  identifier = true,
  property_identifier = true,
  type_identifier = true,
  field_identifier = true,
}

local fallback_notified = {}

local function notify_fallback_once(bufnr, msg)
  if fallback_notified[bufnr] then return end
  fallback_notified[bufnr] = true
  vim.notify(msg, vim.log.levels.WARN)
end

local function get_root(bufnr)
  local ok, parser = pcall(vim.treesitter.get_parser, bufnr)
  if not ok or not parser then return nil, nil end
  local tree = parser:parse()[1]
  if not tree then return nil, nil end
  return tree:root(), parser
end

local function find_scope_node(bufnr, line, col)
  local root, parser = get_root(bufnr)
  if not root or not parser then return nil, nil end
  local lang = parser:lang()
  local ok, query = pcall(vim.treesitter.query.get, lang, 'textobjects')
  if not ok or not query then return nil, nil end

  local best_function, best_class
  for id, node in query:iter_captures(root, bufnr, 0, -1) do
    local cap = query.captures[id]
    if cap == 'function.outer' or cap == 'class.outer' then
      local sr, sc, er, ec = node:range()
      local contains =
        (line > sr or (line == sr and col >= sc))
        and (line < er or (line == er and col <= ec))
      if contains then
        if cap == 'function.outer' then
          if not best_function or node:byte_length() < best_function:byte_length() then
            best_function = node
          end
        else
          if not best_class or node:byte_length() < best_class:byte_length() then
            best_class = node
          end
        end
      end
    end
  end
  if best_function then return best_function, 'function' end
  if best_class then return best_class, 'class' end
  return nil, nil
end

local function collect_identifiers(region_node)
  local out = {}
  local function walk(n)
    if IDENT_NODE_TYPES[n:type()] then
      out[#out + 1] = n
    end
    for child in n:iter_children() do walk(child) end
  end
  walk(region_node)
  return out
end

local function collect_identifiers_in_range(bufnr, start_line, end_line)
  local root = get_root(bufnr)
  if not root then return {} end
  local out = {}
  local function walk(n)
    local sr, _, er = n:range()
    if er < start_line or sr > end_line then return end
    if IDENT_NODE_TYPES[n:type()] then
      if sr >= start_line and sr <= end_line then out[#out + 1] = n end
    end
    for child in n:iter_children() do walk(child) end
  end
  walk(root)
  return out
end

local function hover_text(result)
  if not result or not result.contents then return nil end
  local c = result.contents
  if type(c) == 'string' then return c ~= '' and c or nil end
  if type(c) == 'table' then
    if c.value then return c.value ~= '' and c.value or nil end
    local parts = {}
    for _, item in ipairs(c) do
      if type(item) == 'string' then parts[#parts + 1] = item
      elseif type(item) == 'table' and item.value then parts[#parts + 1] = item.value end
    end
    if #parts > 0 then return table.concat(parts, '\n') end
  end
  return nil
end

local function lsp_hover_for(bufnr, node)
  local sr, sc = node:range()
  local params = {
    textDocument = vim.lsp.util.make_text_document_params(bufnr),
    position = { line = sr, character = sc },
  }
  local ok, responses = pcall(vim.lsp.buf_request_sync, bufnr, 'textDocument/hover', params, 200)
  if not ok or not responses then return nil end
  for _, r in pairs(responses) do
    if r and r.result then
      local t = hover_text(r.result)
      if t then return t end
    end
  end
  return nil
end

---@param opts { mode: 'normal'|'visual', bufnr: integer, range: { start_line: integer, end_line: integer }? }
---@return { code: string, scope_kind: 'function'|'class'|'selection'|'buffer', symbols: { name: string, hover: string }[], start_line: integer, end_line: integer }
function M.build(opts)
  local bufnr = opts.bufnr
  local code, scope_kind
  local idents
  local start_line0 = 0
  local end_line0 = 0

  if opts.mode == 'visual' and opts.range then
    local s, e = opts.range.start_line, opts.range.end_line
    local lines = vim.api.nvim_buf_get_lines(bufnr, s, e + 1, false)
    code = table.concat(lines, '\n')
    scope_kind = 'selection'
    start_line0 = s
    end_line0 = e
    idents = collect_identifiers_in_range(bufnr, s, e)
  else
    local cursor = vim.api.nvim_win_get_cursor(0)
    local line0 = cursor[1] - 1
    local col = cursor[2]
    local node, kind = find_scope_node(bufnr, line0, col)
    if node then
      local sr, _, er = node:range()
      local lines = vim.api.nvim_buf_get_lines(bufnr, sr, er + 1, false)
      code = table.concat(lines, '\n')
      scope_kind = kind
      start_line0 = sr
      end_line0 = er
      idents = collect_identifiers(node)
    else
      local lines = vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)
      code = table.concat(lines, '\n')
      scope_kind = 'buffer'
      start_line0 = 0
      end_line0 = math.max(0, vim.api.nvim_buf_line_count(bufnr) - 1)
      idents = {}
      if get_root(bufnr) then
        notify_fallback_once(bufnr, 'ask: no treesitter scope match, sending whole buffer without symbol enrichment')
      else
        notify_fallback_once(bufnr, 'ask: no treesitter parser, sending whole buffer without symbol enrichment')
      end
    end
  end

  local seen = {}
  local symbols = {}
  for _, node in ipairs(idents) do
    local name = vim.treesitter.get_node_text(node, bufnr)
    if name and name ~= '' and not seen[name] then
      seen[name] = true
      local hover = lsp_hover_for(bufnr, node)
      if hover then
        symbols[#symbols + 1] = { name = name, hover = hover }
      end
    end
  end

  return {
    code = code,
    scope_kind = scope_kind,
    symbols = symbols,
    start_line = start_line0,
    end_line = end_line0,
  }
end

---@param symbols { name: string, hover: string }[]
---@return string
function M.render_symbols_block(symbols)
  if #symbols == 0 then return '' end
  local names = {}
  for _, s in ipairs(symbols) do names[#names + 1] = s.name end
  local out = { table.concat(names, ', '), '' }
  for _, s in ipairs(symbols) do
    out[#out + 1] = s.name .. ':'
    out[#out + 1] = s.hover
    out[#out + 1] = ''
  end
  return table.concat(out, '\n')
end

---Render the scope with right-aligned 1-based file line numbers and a
---`│` separator (non-whitespace, so the model can't confuse it with
---indentation). Content begins at the byte IMMEDIATELY after `│` — every
---leading whitespace byte after `│` belongs to the line content.
---@param code string
---@param start_line0 integer  0-based file line of the first snippet line
---@return string
local function line_numbered(code, start_line0)
  local lines = vim.split(code, '\n', { plain = true })
  local last = start_line0 + #lines
  local width = math.max(2, #tostring(last))
  local out = {}
  for i, line in ipairs(lines) do
    out[#out + 1] = string.format('%' .. width .. 'd │%s', start_line0 + i, line)
  end
  return table.concat(out, '\n')
end

---@param instruction string
---@param ctx { code: string, symbols: { name: string, hover: string }[], start_line: integer, end_line: integer }
---@param file_path string  Relative path used in the diff `--- a/<path>` header.
---@return string
function M.render_edit_prompt(instruction, ctx, file_path)
  local symbols_block = M.render_symbols_block(ctx.symbols)
  local start1 = ctx.start_line + 1
  local end1 = (ctx.end_line or ctx.start_line) + 1
  local old_count = end1 - start1 + 1
  local parts = {
    'edit this code to: ' .. instruction,
    '',
    'file: ' .. file_path,
    string.format('lines to edit: %d-%d  (%d lines — ONLY these lines may be touched)', start1, end1, old_count),
    '',
    'snippet format: each line is shown as `<line_number> │<line content>`. the `│` is a non-whitespace SEPARATOR; the line content begins at the very next byte after `│` (NO implicit space). every byte from immediately after `│` to end-of-line is the actual content, leading whitespace included.',
    '',
    'snippet (do NOT echo the line numbers or the `│` back in your diff):',
    line_numbered(ctx.code, ctx.start_line),
  }
  if symbols_block ~= '' then
    parts[#parts + 1] = ''
    parts[#parts + 1] = 'symbols (for reference, do not paste back):'
    parts[#parts + 1] = symbols_block
  end
  parts[#parts + 1] = ''
  parts[#parts + 1] = 'reply with a single valid unified git diff, and nothing else.'
  parts[#parts + 1] = 'your FIRST character must be `-` (start of `--- a/...`) or `N` (start of `NOOP`). do not begin with reasoning, fences, or any framing text.'
  parts[#parts + 1] = 'if the instruction is ambiguous, impossible, or no change is needed, reply with the single bare token `NOOP` on its own line.'
  parts[#parts + 1] = ''
  parts[#parts + 1] = 'strict format:'
  parts[#parts + 1] = '- line 1: `--- a/' .. file_path .. '`'
  parts[#parts + 1] = '- line 2: `+++ b/' .. file_path .. '`'
  parts[#parts + 1] = string.format('- line 3: exactly ONE hunk header `@@ -%d,%d +%d,M @@` where M is the number of `+` lines you emit (any positive integer; same as the number of replacement lines)', start1, old_count, start1)
  parts[#parts + 1] = string.format('- then exactly %d `-` lines (one per original line in the snippet above, in order, copying the content AFTER `│` byte-for-byte including all leading whitespace)', old_count)
  parts[#parts + 1] = '- then exactly M `+` lines containing the new replacement content, in order, with whatever indentation the new code needs'
  parts[#parts + 1] = '- no context (space-prefixed) lines anywhere'
  parts[#parts + 1] = '- no second `@@` hunk; no other files; no markdown; no code fences; no prose before, between, or after the diff'
  parts[#parts + 1] = ''
  parts[#parts + 1] = 'indentation rule: the `│` glyph in the snippet is the boundary. count the whitespace bytes between `│` and the first non-whitespace character — that count must appear verbatim between `-` (or `+`) and the first non-whitespace byte. tabs vs spaces must match exactly.'
  parts[#parts + 1] = string.format('counts rule: `<old_count>` in the `@@` header MUST equal %d (the number of `-` lines); `<new_count>` MUST equal the number of `+` lines. the applier checks this.', old_count)
  return table.concat(parts, '\n')
end

---@param question string
---@param ctx { code: string, symbols: { name: string, hover: string }[] }
---@return string
function M.render_prompt(question, ctx)
  local symbols_block = M.render_symbols_block(ctx.symbols)
  local parts = {
    'answer the question: ' .. question,
    '',
    'with code:',
    ctx.code,
  }
  if symbols_block ~= '' then
    parts[#parts + 1] = ''
    parts[#parts + 1] = 'symbols:'
    parts[#parts + 1] = symbols_block
  end
  parts[#parts + 1] = ''
  parts[#parts + 1] = 'Keep the answer to 2-4 sentences at most.'
  return table.concat(parts, '\n')
end

return M
