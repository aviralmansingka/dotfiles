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
---@return { code: string, scope_kind: 'function'|'class'|'selection'|'buffer', symbols: { name: string, hover: string }[] }
function M.build(opts)
  local bufnr = opts.bufnr
  local code, scope_kind
  local idents

  if opts.mode == 'visual' and opts.range then
    local s, e = opts.range.start_line, opts.range.end_line
    local lines = vim.api.nvim_buf_get_lines(bufnr, s, e + 1, false)
    code = table.concat(lines, '\n')
    scope_kind = 'selection'
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
      idents = collect_identifiers(node)
    else
      local lines = vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)
      code = table.concat(lines, '\n')
      scope_kind = 'buffer'
      if get_root(bufnr) then
        idents = collect_identifiers_in_range(bufnr, 0, #lines - 1)
      else
        idents = {}
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

  return { code = code, scope_kind = scope_kind, symbols = symbols }
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
