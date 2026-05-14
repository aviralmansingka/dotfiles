# Inline "Ask Cursor-Agent" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `<leader>aa/<leader>ac/<leader>ay/<leader>at` keybindings that ask cursor-agent a focused question about the current treesitter scope (or visual selection), enriched with LSP hover for each identifier; show progress in the gutter and the answer in a `CursorHold` hover.

**Architecture:** Six Lua modules under `nvim/.config/nvim/lua/plugins/sidekick/ask/`. `state` keeps an in-memory entry table keyed by `bufnr`. `signs` manages an extmark namespace + spinner timer. `context` is a pure builder that walks treesitter + LSP. `cli` spawns `cursor-agent -p --mode ask --output-format json` via `vim.system`. `ui` opens prompt and hover floats. `init` is the orchestrator: wires autocmds and exposes `ask/clear_line/yank_line/send_to_session`. Keymaps live in `nvim/.config/nvim/lua/plugins/sidekick.lua`.

**Tech Stack:** Neovim 0.10+ Lua API, `vim.system`, `vim.lsp.buf_request_sync`, `vim.treesitter.query`, extmarks with `sign_text` + `invalidate=true`, `vim.uv.new_timer`.

**No automated tests.** This is UI-heavy and the repo has no Lua test harness. Each task ends with a headless `require()` smoke check + a small `nvim --headless` exec where useful; full end-to-end verification happens in Task 9.

---

## File Structure

```
nvim/.config/nvim/lua/plugins/sidekick/ask/
  state.lua      -- entry table; new/find_at/clear/cleanup; ~80 lines
  signs.lua      -- namespace; render; spinner timer; ~100 lines
  context.lua    -- pure: build({mode, bufnr, range}) -> {code, scope_kind, symbols}; ~150 lines
  cli.lua        -- pure: spawn(prompt, on_done); JSON parse; ~60 lines
  ui.lua         -- open_prompt, open_hover, close_hover; ~140 lines
  init.lua       -- ask/clear_line/yank_line/send_to_session + autocmds; ~150 lines

nvim/.config/nvim/lua/plugins/sidekick.lua  -- modify keys table (replace aa, ac, at; add ay)
```

---

## Task 1: state module

**Files:**
- Create: `nvim/.config/nvim/lua/plugins/sidekick/ask/state.lua`

- [ ] **Step 1: Create the state module**

```lua
-- nvim/.config/nvim/lua/plugins/sidekick/ask/state.lua
-- In-memory anchor table. Keyed by bufnr; anchor_id is monotonic.
local M = {}

M.state = {}          -- { [bufnr] = { [anchor_id] = entry } }
M.by_extmark = {}     -- { [bufnr] = { [extmark_id] = anchor_id } }
M.next_anchor_id = 1

---@class AskEntry
---@field kind 'line'|'range'
---@field extmark_id integer
---@field range_extmarks integer[]
---@field question string
---@field answer string?
---@field err string?
---@field status 'pending'|'done'|'error'
---@field started_at integer
---@field duration_ms integer?
---@field tokens { input: integer, output: integer }?
---@field sysobj table?
---@field spinner_frame integer

---@param bufnr integer
---@param entry AskEntry
---@return integer anchor_id
function M.add(bufnr, entry)
  local id = M.next_anchor_id
  M.next_anchor_id = id + 1
  M.state[bufnr] = M.state[bufnr] or {}
  M.state[bufnr][id] = entry
  M.by_extmark[bufnr] = M.by_extmark[bufnr] or {}
  M.by_extmark[bufnr][entry.extmark_id] = id
  return id
end

---@param bufnr integer
---@return table<integer, AskEntry>
function M.entries(bufnr)
  return M.state[bufnr] or {}
end

---@param bufnr integer
---@param anchor_id integer
function M.remove(bufnr, anchor_id)
  local buf = M.state[bufnr]
  if not buf then return end
  local entry = buf[anchor_id]
  if entry and M.by_extmark[bufnr] then
    M.by_extmark[bufnr][entry.extmark_id] = nil
  end
  buf[anchor_id] = nil
  if next(buf) == nil then
    M.state[bufnr] = nil
    M.by_extmark[bufnr] = nil
  end
end

---Find an entry whose anchor (or range) covers `line` (0-indexed).
---Drops entries whose extmarks have become invalid.
---@param bufnr integer
---@param line integer
---@param ns integer
---@return integer? anchor_id, AskEntry? entry
function M.find_at(bufnr, line, ns)
  local buf = M.state[bufnr]
  if not buf then return nil, nil end
  for id, entry in pairs(buf) do
    local pos = vim.api.nvim_buf_get_extmark_by_id(bufnr, ns, entry.extmark_id, {})
    if not pos or not pos[1] then
      M.remove(bufnr, id)
    else
      local start_line = pos[1]
      local end_line = start_line
      if entry.kind == 'range' and #entry.range_extmarks > 0 then
        local last = entry.range_extmarks[#entry.range_extmarks]
        local lpos = vim.api.nvim_buf_get_extmark_by_id(bufnr, ns, last, {})
        if lpos and lpos[1] then end_line = lpos[1] end
      end
      if line >= start_line and line <= end_line then
        return id, entry
      end
    end
  end
  return nil, nil
end

---@param bufnr integer
function M.cleanup_buffer(bufnr)
  local buf = M.state[bufnr]
  if not buf then return end
  for _, entry in pairs(buf) do
    if entry.sysobj then
      pcall(function() entry.sysobj:kill('sigterm') end)
    end
  end
  M.state[bufnr] = nil
  M.by_extmark[bufnr] = nil
end

function M.cleanup_all()
  for bufnr in pairs(M.state) do
    M.cleanup_buffer(bufnr)
  end
end

return M
```

- [ ] **Step 2: Headless load check**

```bash
nvim --headless +'lua require("plugins.sidekick.ask.state")' +qa 2>&1
```

Expected: no output (clean load). Any stack trace = bug.

- [ ] **Step 3: Commit**

```bash
git -C /Users/aviral/dotfiles add nvim/.config/nvim/lua/plugins/sidekick/ask/state.lua
git -C /Users/aviral/dotfiles commit -m "$(cat <<'EOF'
ask: add state module for anchor entries

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: signs module (namespace + render + spinner)

**Files:**
- Create: `nvim/.config/nvim/lua/plugins/sidekick/ask/signs.lua`

- [ ] **Step 1: Create the signs module**

```lua
-- nvim/.config/nvim/lua/plugins/sidekick/ask/signs.lua
-- Owns the extmark namespace + spinner timer.
local state = require('plugins.sidekick.ask.state')

local M = {}

M.ns = vim.api.nvim_create_namespace('sidekick.ask')

local SPINNER_FRAMES = { '⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏' }
local DONE_ICON = '🤖'
local RANGE_BAR = '│'

local timer = nil

---Define default highlight; safe to call repeatedly.
function M.setup_highlights()
  vim.api.nvim_set_hl(0, 'SidekickAskRange', { link = 'DiagnosticInfo', default = true })
end

---Create anchor extmark on line (0-indexed). Returns extmark id.
---@param bufnr integer
---@param line integer
---@return integer
function M.create_anchor(bufnr, line)
  return vim.api.nvim_buf_set_extmark(bufnr, M.ns, line, 0, {
    sign_text = SPINNER_FRAMES[1],
    sign_hl_group = 'DiagnosticInfo',
    invalidate = true,
  })
end

---Create per-line range-bar extmarks on lines [start_line, end_line] inclusive (0-indexed).
---Returns list of extmark ids.
---@param bufnr integer
---@param start_line integer
---@param end_line integer
---@return integer[]
function M.create_range_bar(bufnr, start_line, end_line)
  local ids = {}
  for line = start_line, end_line do
    ids[#ids + 1] = vim.api.nvim_buf_set_extmark(bufnr, M.ns, line, 0, {
      sign_text = RANGE_BAR,
      sign_hl_group = 'SidekickAskRange',
      invalidate = true,
    })
  end
  return ids
end

---Update anchor extmark to a new sign_text/highlight (keeps line tracking).
---@param bufnr integer
---@param extmark_id integer
---@param sign_text string
---@param sign_hl_group string
local function set_anchor_sign(bufnr, extmark_id, sign_text, sign_hl_group)
  local pos = vim.api.nvim_buf_get_extmark_by_id(bufnr, M.ns, extmark_id, {})
  if not pos or not pos[1] then return end
  vim.api.nvim_buf_set_extmark(bufnr, M.ns, pos[1], 0, {
    id = extmark_id,
    sign_text = sign_text,
    sign_hl_group = sign_hl_group,
    invalidate = true,
  })
end

---@param bufnr integer
---@param entry AskEntry
function M.mark_done(bufnr, entry)
  set_anchor_sign(bufnr, entry.extmark_id, DONE_ICON, 'DiagnosticInfo')
end

---@param bufnr integer
---@param entry AskEntry
function M.clear(bufnr, entry)
  pcall(vim.api.nvim_buf_del_extmark, bufnr, M.ns, entry.extmark_id)
  for _, id in ipairs(entry.range_extmarks or {}) do
    pcall(vim.api.nvim_buf_del_extmark, bufnr, M.ns, id)
  end
end

local function has_pending()
  for _, buf in pairs(state.state) do
    for _, entry in pairs(buf) do
      if entry.status == 'pending' then return true end
    end
  end
  return false
end

local function tick()
  local any = false
  for bufnr, buf in pairs(state.state) do
    if vim.api.nvim_buf_is_valid(bufnr) then
      for _, entry in pairs(buf) do
        if entry.status == 'pending' then
          any = true
          entry.spinner_frame = (entry.spinner_frame % #SPINNER_FRAMES) + 1
          set_anchor_sign(bufnr, entry.extmark_id, SPINNER_FRAMES[entry.spinner_frame], 'DiagnosticInfo')
        end
      end
    end
  end
  if not any then
    M.stop_spinner()
  end
end

function M.start_spinner()
  if timer then return end
  timer = vim.uv.new_timer()
  timer:start(0, 100, vim.schedule_wrap(tick))
end

function M.stop_spinner()
  if not timer then return end
  timer:stop()
  timer:close()
  timer = nil
end

---Kick the spinner if there is any pending entry. Idempotent.
function M.ensure_spinner_running()
  if has_pending() then M.start_spinner() end
end

return M
```

- [ ] **Step 2: Headless load check**

```bash
nvim --headless +'lua require("plugins.sidekick.ask.signs")' +qa 2>&1
```

Expected: no output.

- [ ] **Step 3: Live render smoke test**

```bash
nvim --headless +'lua \
  local s = require("plugins.sidekick.ask.signs"); \
  s.setup_highlights(); \
  vim.api.nvim_buf_set_lines(0, 0, -1, false, {"a","b","c","d"}); \
  local id = s.create_anchor(0, 1); \
  local bar = s.create_range_bar(0, 0, 3); \
  print("anchor:", id, "bars:", #bar) \
' +qa 2>&1
```

Expected output: `anchor: 1 bars: 4`.

- [ ] **Step 4: Commit**

```bash
git -C /Users/aviral/dotfiles add nvim/.config/nvim/lua/plugins/sidekick/ask/signs.lua
git -C /Users/aviral/dotfiles commit -m "$(cat <<'EOF'
ask: add signs module with spinner timer

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: context module (scope + symbols + LSP hover)

**Files:**
- Create: `nvim/.config/nvim/lua/plugins/sidekick/ask/context.lua`

- [ ] **Step 1: Create the context module**

```lua
-- nvim/.config/nvim/lua/plugins/sidekick/ask/context.lua
-- Pure builder: assemble {code, scope_kind, symbols} from the buffer.
local M = {}

local IDENT_NODE_TYPES = {
  identifier = true,
  property_identifier = true,
  type_identifier = true,
  field_identifier = true,
}

local fallback_notified = {} -- { [bufnr] = true }

local function notify_fallback_once(bufnr, msg)
  if fallback_notified[bufnr] then return end
  fallback_notified[bufnr] = true
  vim.notify(msg, vim.log.levels.WARN)
end

---Get treesitter root for a buffer, or nil.
---@param bufnr integer
---@return TSNode?, vim.treesitter.LanguageTree?
local function get_root(bufnr)
  local ok, parser = pcall(vim.treesitter.get_parser, bufnr)
  if not ok or not parser then return nil, nil end
  local tree = parser:parse()[1]
  if not tree then return nil, nil end
  return tree:root(), parser
end

---Find smallest @function.outer or @class.outer containing (line, col).
---Returns node + scope_kind, or nil if neither query matches.
---@param bufnr integer
---@param line integer
---@param col integer
---@return TSNode?, 'function'|'class'?
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

---Collect identifier nodes inside `region_node` in source order.
---@param region_node TSNode
---@return TSNode[]
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

---Like collect_identifiers but for a (start_line, end_line) byte range.
---Walks the root and filters by position.
---@param bufnr integer
---@param start_line integer
---@param end_line integer
---@return TSNode[]
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

---Pull markdown text out of a hover response.
---@param result any
---@return string?
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

---Resolve LSP hover for a node's start position. Returns text or nil.
---@param bufnr integer
---@param node TSNode
---@return string?
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

---Build a {code, scope_kind, symbols} table.
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

---Render the symbols block per spec format. Returns '' if empty.
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

---Render the full prompt from spec template.
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
```

- [ ] **Step 2: Headless load check**

```bash
nvim --headless +'lua require("plugins.sidekick.ask.context")' +qa 2>&1
```

Expected: no output.

- [ ] **Step 3: Render-prompt unit smoke**

```bash
nvim --headless +'lua \
  local c = require("plugins.sidekick.ask.context"); \
  local p = c.render_prompt("why?", {code = "foo()", symbols = {{name="foo", hover="fn foo()"}}}); \
  print(p) \
' +qa 2>&1
```

Expected output contains `answer the question: why?`, `with code:`, `foo()`, `symbols:`, `foo`, `foo:`, `fn foo()`, `Keep the answer to 2-4 sentences at most.`

- [ ] **Step 4: Commit**

```bash
git -C /Users/aviral/dotfiles add nvim/.config/nvim/lua/plugins/sidekick/ask/context.lua
git -C /Users/aviral/dotfiles commit -m "$(cat <<'EOF'
ask: add context builder (treesitter scope + LSP hover)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: cli module (spawn cursor-agent)

**Files:**
- Create: `nvim/.config/nvim/lua/plugins/sidekick/ask/cli.lua`

- [ ] **Step 1: Create the cli module**

```lua
-- nvim/.config/nvim/lua/plugins/sidekick/ask/cli.lua
-- Spawn cursor-agent -p --mode ask --output-format json.
local M = {}

---Result on success: { ok=true, result=<string>, duration_ms=<int>, tokens={input,output} }
---Result on failure: { ok=false, err=<string> }
---@param prompt string
---@param on_done fun(result: table)
---@return vim.SystemObj
function M.spawn(prompt, on_done)
  local cmd = { 'cursor-agent', '-p', '--mode', 'ask', '--output-format', 'json', prompt }
  return vim.system(cmd, {
    cwd = vim.fn.getcwd(),
    text = true,
  }, function(obj)
    vim.schedule(function()
      if obj.code ~= 0 then
        local err = (obj.stderr or ''):gsub('%s+$', '')
        if err == '' then err = 'cursor-agent exited with code ' .. tostring(obj.code) end
        on_done({ ok = false, err = err })
        return
      end
      local raw = obj.stdout or ''
      local ok, decoded = pcall(vim.json.decode, raw)
      if not ok or type(decoded) ~= 'table' then
        on_done({ ok = false, err = 'cursor-agent: unexpected output' })
        return
      end
      if decoded.is_error then
        on_done({ ok = false, err = tostring(decoded.result or 'cursor-agent reported error') })
        return
      end
      if type(decoded.result) ~= 'string' or decoded.result == '' then
        on_done({ ok = false, err = 'cursor-agent: empty result' })
        return
      end
      on_done({
        ok = true,
        result = decoded.result,
        duration_ms = decoded.duration_ms or 0,
        tokens = {
          input = (decoded.usage and decoded.usage.inputTokens) or 0,
          output = (decoded.usage and decoded.usage.outputTokens) or 0,
        },
      })
    end)
  end)
end

return M
```

- [ ] **Step 2: Headless load check**

```bash
nvim --headless +'lua require("plugins.sidekick.ask.cli")' +qa 2>&1
```

Expected: no output.

- [ ] **Step 3: Live smoke test (requires cursor-agent in PATH)**

```bash
nvim --headless +'lua \
  local cli = require("plugins.sidekick.ask.cli"); \
  cli.spawn("What is 2+2? Reply with one word.", function(r) \
    if r.ok then print("OK:", r.result, "ms:", r.duration_ms) \
    else print("ERR:", r.err) end; \
    vim.cmd("qa!") \
  end); \
  vim.wait(60000, function() return false end) \
' 2>&1
```

Expected: `OK: <some text> ms: <number>`. Skip if `cursor-agent` is not installed or not logged in.

- [ ] **Step 4: Commit**

```bash
git -C /Users/aviral/dotfiles add nvim/.config/nvim/lua/plugins/sidekick/ask/cli.lua
git -C /Users/aviral/dotfiles commit -m "$(cat <<'EOF'
ask: add cli wrapper around cursor-agent JSON output

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: ui module (prompt + hover)

**Files:**
- Create: `nvim/.config/nvim/lua/plugins/sidekick/ask/ui.lua`

- [ ] **Step 1: Create the ui module**

```lua
-- nvim/.config/nvim/lua/plugins/sidekick/ask/ui.lua
local M = {}

local active_hover = nil -- { winid, bufnr, anchor_id }

local function fmt_elapsed(ms)
  return string.format('%.1fs', ms / 1000)
end

---Open the prompt floating window above the cursor.
---@param opts { on_submit: fun(text: string), on_cancel: fun() }
function M.open_prompt(opts)
  local buf = vim.api.nvim_create_buf(false, true)
  vim.bo[buf].buftype = 'nofile'
  vim.bo[buf].bufhidden = 'wipe'
  vim.bo[buf].swapfile = false

  local screen_row = vim.fn.winline()
  local row = (screen_row <= 2) and 1 or -2

  local win = vim.api.nvim_open_win(buf, true, {
    relative = 'cursor',
    row = row,
    col = 0,
    width = 60,
    height = 1,
    style = 'minimal',
    border = 'rounded',
    title = ' ask cursor-agent ',
    title_pos = 'center',
  })

  local finished = false
  local function finish(text)
    if finished then return end
    finished = true
    if vim.api.nvim_win_is_valid(win) then
      vim.api.nvim_win_close(win, true)
    end
    if text and text ~= '' then opts.on_submit(text) else opts.on_cancel() end
  end

  vim.keymap.set({ 'n', 'i' }, '<CR>', function()
    local lines = vim.api.nvim_buf_get_lines(buf, 0, 1, false)
    finish((lines[1] or ''):gsub('^%s+', ''):gsub('%s+$', ''))
  end, { buffer = buf, nowait = true })

  vim.keymap.set({ 'n', 'i' }, '<Esc>', function()
    finish(nil)
  end, { buffer = buf, nowait = true })

  vim.api.nvim_create_autocmd('BufLeave', {
    buffer = buf,
    once = true,
    callback = function() finish(nil) end,
  })

  vim.cmd('startinsert')
end

---Compose hover markdown body.
---@param entry AskEntry
---@return string[]
local function hover_lines(entry)
  local lines = {
    '> **Q:** ' .. entry.question,
    '',
  }
  if entry.status == 'pending' then
    lines[#lines + 1] = '*working...*'
  else
    for _, l in ipairs(vim.split(entry.answer or '', '\n', { plain = true })) do
      lines[#lines + 1] = l
    end
  end
  lines[#lines + 1] = ''
  lines[#lines + 1] = '---'
  if entry.status == 'pending' then
    local elapsed = (vim.uv.hrtime() - entry.started_at) / 1e6
    lines[#lines + 1] = string.format('*working %s...*', fmt_elapsed(elapsed))
  else
    local tok = entry.tokens or { input = 0, output = 0 }
    lines[#lines + 1] = string.format('*%s · in:%d out:%d*', fmt_elapsed(entry.duration_ms or 0), tok.input, tok.output)
  end
  return lines
end

---Close the currently open hover, if any.
function M.close_hover()
  if not active_hover then return end
  if vim.api.nvim_win_is_valid(active_hover.winid) then
    vim.api.nvim_win_close(active_hover.winid, true)
  end
  active_hover = nil
end

---Open hover for an entry, positioned above or below based on window position.
---@param opts { entry: AskEntry, anchor_line: integer, end_line: integer, win: integer }
function M.open_hover(opts)
  M.close_hover()
  local entry = opts.entry
  local buf = vim.api.nvim_create_buf(false, true)
  vim.bo[buf].buftype = 'nofile'
  vim.bo[buf].bufhidden = 'wipe'
  local lines = hover_lines(entry)
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.bo[buf].filetype = 'markdown'
  vim.bo[buf].modifiable = false

  local view = vim.fn.winsaveview()
  local height_win = vim.api.nvim_win_get_height(opts.win)
  local screen_row_top = opts.anchor_line - view.topline
  local top_half = screen_row_top < math.floor(height_win / 2)

  local width = math.min(80, vim.o.columns - 4)
  local height = math.max(1, math.min(20, #lines))

  local row, anchor
  if top_half then
    row = opts.end_line + 1 - view.topline
    anchor = 'NW'
  else
    row = opts.anchor_line - view.topline
    anchor = 'SW'
  end

  local winid = vim.api.nvim_open_win(buf, false, {
    relative = 'win',
    win = opts.win,
    row = row,
    col = 0,
    width = width,
    height = height,
    style = 'minimal',
    border = 'rounded',
    focusable = false,
    anchor = anchor,
    noautocmd = true,
  })
  vim.wo[winid].wrap = true
  active_hover = { winid = winid, bufnr = buf }
end

return M
```

- [ ] **Step 2: Headless load check**

```bash
nvim --headless +'lua require("plugins.sidekick.ask.ui")' +qa 2>&1
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git -C /Users/aviral/dotfiles add nvim/.config/nvim/lua/plugins/sidekick/ask/ui.lua
git -C /Users/aviral/dotfiles commit -m "$(cat <<'EOF'
ask: add ui module (prompt + hover floats)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: init module (orchestrator + ask/clear/yank/send + autocmds)

**Files:**
- Create: `nvim/.config/nvim/lua/plugins/sidekick/ask/init.lua`

- [ ] **Step 1: Create the init module**

```lua
-- nvim/.config/nvim/lua/plugins/sidekick/ask/init.lua
local state = require('plugins.sidekick.ask.state')
local signs = require('plugins.sidekick.ask.signs')
local context = require('plugins.sidekick.ask.context')
local cli = require('plugins.sidekick.ask.cli')
local ui = require('plugins.sidekick.ask.ui')

local M = {}

local setup_done = false

---Resolve cursor line + range for the current mode.
---@return 'normal'|'visual' mode, integer line0, { start_line: integer, end_line: integer }? range
local function get_invocation_target()
  local mode = vim.fn.mode()
  if mode == 'v' or mode == 'V' or mode == '\22' then
    local s = vim.fn.getpos('v')
    local e = vim.fn.getpos('.')
    local s_line = math.min(s[2], e[2]) - 1
    local e_line = math.max(s[2], e[2]) - 1
    vim.api.nvim_input('<Esc>')
    if s_line == e_line then
      return 'normal', s_line, nil
    end
    return 'visual', s_line, { start_line = s_line, end_line = e_line }
  end
  local cursor = vim.api.nvim_win_get_cursor(0)
  return 'normal', cursor[1] - 1, nil
end

---Public: open the prompt; on submit, fire cursor-agent and anchor the result.
function M.ask()
  M.setup()
  local bufnr = vim.api.nvim_get_current_buf()
  local mode, line0, range = get_invocation_target()

  local existing_id, existing_entry = state.find_at(bufnr, line0, signs.ns)
  if existing_entry and existing_entry.status == 'pending' then
    vim.notify('ask: still working on this line', vim.log.levels.WARN)
    return
  end
  if existing_entry then
    signs.clear(bufnr, existing_entry)
    state.remove(bufnr, existing_id)
  end

  ui.open_prompt({
    on_cancel = function() end,
    on_submit = function(question)
      local ctx = context.build({ mode = mode, bufnr = bufnr, range = range })
      local prompt = context.render_prompt(question, ctx)

      local anchor_extmark = signs.create_anchor(bufnr, line0)
      local range_extmarks = {}
      if range then
        range_extmarks = signs.create_range_bar(bufnr, range.start_line, range.end_line)
      end

      local entry = {
        kind = range and 'range' or 'line',
        extmark_id = anchor_extmark,
        range_extmarks = range_extmarks,
        question = question,
        status = 'pending',
        started_at = vim.uv.hrtime(),
        spinner_frame = 1,
      }
      local anchor_id = state.add(bufnr, entry)

      entry.sysobj = cli.spawn(prompt, function(result)
        entry.sysobj = nil
        if not vim.api.nvim_buf_is_valid(bufnr) then return end
        local cur = state.entries(bufnr)[anchor_id]
        if not cur then return end
        if not result.ok then
          signs.clear(bufnr, cur)
          state.remove(bufnr, anchor_id)
          vim.notify('ask: ' .. result.err, vim.log.levels.ERROR)
          signs.ensure_spinner_running()
          return
        end
        cur.answer = result.result
        cur.duration_ms = result.duration_ms
        cur.tokens = result.tokens
        cur.status = 'done'
        signs.mark_done(bufnr, cur)
      end)

      signs.start_spinner()
    end,
  })
end

---Public: clear the completed/errored answer on the current line.
function M.clear_line()
  local bufnr = vim.api.nvim_get_current_buf()
  local line0 = vim.api.nvim_win_get_cursor(0)[1] - 1
  local id, entry = state.find_at(bufnr, line0, signs.ns)
  if not entry then return end
  if entry.status == 'pending' then return end
  signs.clear(bufnr, entry)
  state.remove(bufnr, id)
  ui.close_hover()
end

---Public: yank the answer on the current line to the system clipboard.
function M.yank_line()
  local bufnr = vim.api.nvim_get_current_buf()
  local line0 = vim.api.nvim_win_get_cursor(0)[1] - 1
  local _, entry = state.find_at(bufnr, line0, signs.ns)
  if not entry or entry.status ~= 'done' or not entry.answer then
    vim.notify('ask: no answer on this line', vim.log.levels.WARN)
    return
  end
  vim.fn.setreg('+', entry.answer)
  vim.notify('ask: answer yanked')
end

---Block-quote each line. Blank lines become '>'.
---@param text string
---@return string
local function blockquote(text)
  local out = {}
  for _, line in ipairs(vim.split(text, '\n', { plain = true })) do
    if line == '' then out[#out + 1] = '>'
    else out[#out + 1] = '> ' .. line end
  end
  return table.concat(out, '\n')
end

---Public: send blockquoted text to a named sidekick session via vim.ui.select.
function M.send_to_session()
  local bufnr = vim.api.nvim_get_current_buf()
  local mode = vim.fn.mode()
  local payload

  if mode == 'v' or mode == 'V' or mode == '\22' then
    local s = vim.fn.getpos('v')
    local e = vim.fn.getpos('.')
    local s_line = math.min(s[2], e[2]) - 1
    local e_line = math.max(s[2], e[2]) - 1
    vim.api.nvim_input('<Esc>')
    local lines = vim.api.nvim_buf_get_lines(bufnr, s_line, e_line + 1, false)
    payload = table.concat(lines, '\n')
  else
    local line0 = vim.api.nvim_win_get_cursor(0)[1] - 1
    local _, entry = state.find_at(bufnr, line0, signs.ns)
    if not entry or entry.status ~= 'done' or not entry.answer then
      vim.notify('ask: no answer to send', vim.log.levels.WARN)
      return
    end
    payload = entry.answer
  end

  local ok, registry = pcall(require, 'plugins.sidekick.registry')
  if not ok then
    vim.notify('ask: sidekick registry not available', vim.log.levels.ERROR)
    return
  end
  local sessions = registry.discover()
  local labels = vim.tbl_keys(sessions)
  if #labels == 0 then
    vim.notify('ask: no named sidekick sessions', vim.log.levels.WARN)
    return
  end
  table.sort(labels)

  vim.ui.select(labels, { prompt = 'Send to which session?' }, function(label)
    if not label then return end
    local quoted = blockquote(payload)
    require('sidekick.cli').send({ name = label, msg = quoted })
  end)
end

---Idempotent setup of autocmds + highlights.
function M.setup()
  if setup_done then return end
  setup_done = true
  signs.setup_highlights()

  local group = vim.api.nvim_create_augroup('sidekick.ask', { clear = true })

  vim.api.nvim_create_autocmd('CursorHold', {
    group = group,
    callback = function(args)
      local line0 = vim.api.nvim_win_get_cursor(0)[1] - 1
      local _, entry = state.find_at(args.buf, line0, signs.ns)
      if not entry or entry.status ~= 'done' then return end
      local pos_start = vim.api.nvim_buf_get_extmark_by_id(args.buf, signs.ns, entry.extmark_id, {})
      if not pos_start or not pos_start[1] then return end
      local end_line = pos_start[1]
      if entry.kind == 'range' and #entry.range_extmarks > 0 then
        local last = entry.range_extmarks[#entry.range_extmarks]
        local lpos = vim.api.nvim_buf_get_extmark_by_id(args.buf, signs.ns, last, {})
        if lpos and lpos[1] then end_line = lpos[1] end
      end
      ui.open_hover({
        entry = entry,
        anchor_line = pos_start[1],
        end_line = end_line,
        win = vim.api.nvim_get_current_win(),
      })
    end,
  })

  vim.api.nvim_create_autocmd({ 'CursorMoved', 'CursorMovedI', 'BufLeave', 'WinLeave', 'InsertEnter' }, {
    group = group,
    callback = function() ui.close_hover() end,
  })

  vim.api.nvim_create_autocmd({ 'BufDelete', 'BufWipeout' }, {
    group = group,
    callback = function(args) state.cleanup_buffer(args.buf) end,
  })

  vim.api.nvim_create_autocmd('VimLeavePre', {
    group = group,
    callback = function() state.cleanup_all() end,
  })
end

return M
```

- [ ] **Step 2: Headless load check**

```bash
nvim --headless +'lua require("plugins.sidekick.ask")' +qa 2>&1
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git -C /Users/aviral/dotfiles add nvim/.config/nvim/lua/plugins/sidekick/ask/init.lua
git -C /Users/aviral/dotfiles commit -m "$(cat <<'EOF'
ask: add init orchestrator with autocmds and public API

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Wire keymaps in sidekick.lua

**Files:**
- Modify: `nvim/.config/nvim/lua/plugins/sidekick.lua`

- [ ] **Step 1: Replace `<leader>aa` mapping**

Find the existing entry around line 80:

```lua
    {
      "<leader>aa",
      function()
        require("sidekick.cli").toggle()
      end,
      desc = "Sidekick Toggle CLI",
    },
```

Replace with:

```lua
    {
      "<leader>aa",
      function()
        require("plugins.sidekick.ask").ask()
      end,
      mode = { "n", "x" },
      desc = "Ask cursor-agent about this code",
    },
```

- [ ] **Step 2: Replace `<leader>ac` mapping**

Find the existing entry around line 151:

```lua
    {
      "<leader>ac",
      function()
        internal.toggle_tool_session("claude", true)
      end,
      desc = "Sidekick Toggle Claude",
    },
```

Replace with:

```lua
    {
      "<leader>ac",
      function()
        require("plugins.sidekick.ask").clear_line()
      end,
      desc = "Ask: clear answer on current line",
    },
```

- [ ] **Step 3: Add `<leader>ay` mapping**

Insert immediately after the new `<leader>ac` mapping:

```lua
    {
      "<leader>ay",
      function()
        require("plugins.sidekick.ask").yank_line()
      end,
      desc = "Ask: yank answer on current line",
    },
```

- [ ] **Step 4: Replace `<leader>at` mapping**

Find the existing entry around line 113:

```lua
    {
      "<leader>at",
      function()
        require("sidekick.cli").send({ msg = "{this}" })
      end,
      mode = { "x", "n" },
      desc = "Send This",
    },
```

Replace with:

```lua
    {
      "<leader>at",
      function()
        require("plugins.sidekick.ask").send_to_session()
      end,
      mode = { "n", "x" },
      desc = "Ask: send selection or answer to a named session",
    },
```

- [ ] **Step 5: Headless load check**

```bash
nvim --headless +'Lazy! load sidekick.nvim' +qa 2>&1 | tail -20
```

Expected: no error stack traces. (Some Lazy noise is fine.)

- [ ] **Step 6: Commit**

```bash
git -C /Users/aviral/dotfiles add nvim/.config/nvim/lua/plugins/sidekick.lua
git -C /Users/aviral/dotfiles commit -m "$(cat <<'EOF'
ask: wire <leader>aa/ac/ay/at to new ask module

Replaces existing aa (Sidekick Toggle CLI), ac (Sidekick Toggle Claude),
and at (Send This) mappings; adds ay (yank answer).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Live-session reload + smoke check

**Files:**
- None (interactive verification only)

- [ ] **Step 1: Reload running nvim sessions**

If a Neovim session is running:

```
:Lazy reload sidekick.nvim
```

Expected: no error popups. The four new keymaps appear in `:nmap <leader>a` listings.

- [ ] **Step 2: Spawn a fresh nvim, verify module loads**

```bash
nvim --headless +'lua require("plugins.sidekick.ask").setup()' +qa 2>&1
```

Expected: no output.

- [ ] **Step 3: Verify keymap registration**

```bash
nvim --headless +'lua \
  vim.cmd("doautocmd User VeryLazy"); \
  local nmap = vim.fn.execute("nmap <leader>aa"); \
  print(nmap) \
' +qa 2>&1
```

Expected output contains `Ask cursor-agent about this code`. (If `VeryLazy` isn't enough, a brief warning is fine — the live `:Lazy reload` is the real check.)

- [ ] **Step 4: Commit checkpoint (only if anything else changed)**

If no files changed, skip. Otherwise commit any leftover fixes from steps 1-3.

---

## Task 9: End-to-end manual verification

**Files:**
- None (interactive only)

Run each check on a fresh `nvim` instance with `cursor-agent` available in `$PATH`. Record pass/fail. Fix and re-run on failure.

- [ ] **Step 1: Smoke (normal mode)**

  - Open a Go file with at least one function (e.g., `nvim ops/packer/scripts/validate.sh` or any `.go` file in a Modal repo).
  - Place cursor inside a function body.
  - Press `<leader>aa`. Floating prompt appears above the cursor.
  - Type `what does this do?`, press `<CR>`.
  - **Expected:** Spinner glyph appears in the signcolumn within ~200ms. Within a few seconds, replaced by 🤖.
  - Sit still on the line. After `updatetime` (500ms), markdown hover float appears with the answer + footer.
  - Move cursor to a different line. Hover closes.

- [ ] **Step 2: Smoke (visual mode)**

  - Visually select 5+ consecutive lines.
  - Press `<leader>aa`. Prompt appears.
  - Type `summarize this`, `<CR>`.
  - **Expected:** Blue `│` bars appear in signcolumn on every selected line. 🤖 on the first line once cursor-agent returns. Hover triggers on `CursorHold` anywhere in the range.

- [ ] **Step 3: Hover position**

  - Ask a question on a line that's currently in the top quarter of the visible window. Verify hover renders **below** that line.
  - Scroll so the answered line moves into the bottom half. `:redraw`, sit on the line. Verify hover renders **above**.

- [ ] **Step 4: Concurrency**

  - Fire `<leader>aa` on 3 different lines within ~1 second. Cancel each prompt or ask a quick question.
  - **Expected:** All 3 spinners run simultaneously. Each resolves to 🤖 independently.

- [ ] **Step 5: Edit tracking**

  - Ask on line 20.
  - Press `O<Esc>` five times to insert 5 blank lines above.
  - Move cursor to where line 20's content now lives (line 25).
  - **Expected:** Hover triggers on `CursorHold`. The 🤖 sign moved with the code.

- [ ] **Step 6: Line delete**

  - Ask on line 20. Wait for 🤖.
  - `dd` on line 20.
  - **Expected:** Sign disappears. No errors. Subsequent operations on the buffer don't reference the dead anchor.

- [ ] **Step 7: Clear**

  - On a 🤖 line: `<leader>ac` → sign cleared.
  - On a spinning line: `<leader>ac` → no-op (spinner continues, sign stays).

- [ ] **Step 8: Yank**

  - On a 🤖 line: `<leader>ay` → `"+p` pastes the answer text.
  - On an unanswered line: `<leader>ay` → `ask: no answer on this line` notify.

- [ ] **Step 9: Send-to-session (visual)**

  - Start a named sidekick session via `<leader>an` (e.g., `claude-test`).
  - Select 3 lines, `<leader>at` → `vim.ui.select` shows `claude-test`. Choose it.
  - **Expected:** The tmux pane for `claude-test` shows the 3 lines as a `> ...` blockquote pasted into its input.

- [ ] **Step 10: Send-to-session (normal)**

  - On a 🤖 line, `<leader>at` → picker → choose session.
  - **Expected:** The answer text arrives blockquoted in the chosen session.

- [ ] **Step 11: Send with no answer**

  - On an unanswered line in normal mode, `<leader>at` → `ask: no answer to send` notify.

- [ ] **Step 12: Send with no sessions**

  - Kill any named tmux sessions (`tmux kill-session -t <name>`).
  - `<leader>at` (visual or normal) → `ask: no named sidekick sessions` notify.

- [ ] **Step 13: CLI error**

  - `mv ~/.local/bin/cursor-agent /tmp/_cursor_backup`.
  - `<leader>aa`, ask a question.
  - **Expected:** Sign cleared, error notify with stderr content.
  - Restore: `mv /tmp/_cursor_backup ~/.local/bin/cursor-agent`.

- [ ] **Step 14: No treesitter fallback**

  - `nvim /tmp/empty.txt`, write a few lines.
  - `<leader>aa`, ask something.
  - **Expected:** One-time `vim.notify` about fallback. Answer still arrives. The cursor-agent prompt (you can grep your shell history or add a temporary `vim.notify` in `cli.spawn` if needed) contains the whole buffer.

- [ ] **Step 15: No LSP**

  - `nvim some.lua`, run `:LspStop`.
  - `<leader>aa`, ask.
  - **Expected:** No `symbols:` section in the prompt (you can verify by temporarily adding a `vim.notify(prompt)` in `init.lua` before `cli.spawn`). Answer arrives.

- [ ] **Step 16: VimLeavePre cleanup**

  - Fire a question. Immediately `:qa!` before cursor-agent returns.
  - **Expected:** Neovim exits cleanly. `ps aux | grep cursor-agent` shows no leftover processes after a few seconds.

- [ ] **Step 17: Document any deviations**

  If any step revealed a bug or surprising behavior, file a follow-up task in `td` (`td add "ask: <issue>"`) and either fix inline (small) or note it in the spec's "Out of scope / future work" section.

- [ ] **Step 18: Final commit (only if fixes happened during verification)**

  If any code changes were needed during verification:

  ```bash
  git -C /Users/aviral/dotfiles add -p
  git -C /Users/aviral/dotfiles commit -m "$(cat <<'EOF'
ask: fixes from end-to-end verification

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
  )"
  ```

---

## Notes for the implementing engineer

- **No comments in code unless WHY is non-obvious.** Identifiers carry the WHAT.
- **vim.system handles** are cheap; one per question is fine.
- **vim.lsp.buf_request_sync** is intentionally synchronous to keep `context.build` a single function. If responsiveness becomes an issue, switch to `vim.lsp.buf_request` with a callback aggregator.
- **`invalidate=true`** on extmarks is the key to free state-cleanup when a line is deleted — don't omit it.
- **The spinner timer** is global; it walks all buffers on each tick. With <100 pending entries this is negligible.
- **`vim.api.nvim_input('<Esc>')`** in `get_invocation_target` is what lets us read `'<`/`'>` reliably after a visual-mode mapping. Modern alternative: read `vim.fn.getpos('v')` (current visual anchor) and the cursor position directly — that's what the code does, so the `<Esc>` is mostly for visual cleanup.
- **`require('plugins.sidekick.registry').discover()`** parses tmux pane names; verify tmux is running before relying on it.
- **`sidekick.cli.send({ name = label, msg = ... })`** is the public sidekick API; it queues the message into the named tool session.
