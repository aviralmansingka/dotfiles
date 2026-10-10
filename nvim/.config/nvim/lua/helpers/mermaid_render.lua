-- Mermaid → ASCII/Unicode rendering via the `mmdflux` binary.
--
-- Reuses the treesitter fenced-code-block walk from helpers/markdown_ansi.lua
-- (content_node / language / visit pattern) but matches `mermaid` fences and
-- pipes the fence body to `mmdflux` (reads mermaid from stdin). The v1 surface
-- is an on-demand Snacks float bound to `<leader>mm` (see plugins/markdown.lua).
--
-- Why a `:terminal` float instead of parsing ANSI into nvim highlights:
-- mmdflux emits ANSI color for `classDef`/`linkStyle` (SGR, 256-color, possibly
-- truecolor). A :terminal buffer is a real terminal emulator that renders all
-- of that natively for free; reusing markdown_ansi.lua's SGR→highlight parser
-- would mean coupling to its mark-generation shape for a one-off float. The
-- terminal is the cleaner, higher-fidelity choice for the float surface.
--
-- The deferred image upgrade (Herdr `kitty_graphics=true` + Snacks Image +
-- mmdc + ImageMagick) is documented in docs/neovim-mermaid-render.md and is
-- out of scope here.

local M = {}

-- Mirror of helpers/markdown_ansi.lua content_node / language helpers (kept
-- local so this helper stands alone without requiring markdown_ansi to load).

local function language(node, buf)
  for child in node:iter_children() do
    if child:type() == "info_string" then
      return vim.trim(vim.treesitter.get_node_text(child, buf))
    end
  end
end

local function content_node(node)
  for child in node:iter_children() do
    if child:type() == "code_fence_content" then
      return child
    end
  end
end

---Find the `mermaid` fenced_code_block node containing 0-indexed buffer row `row`.
---@param buf integer
---@param row integer
---@return TSNode|nil
local function mermaid_fence_at(buf, row)
  local parser = vim.treesitter.get_parser(buf, "markdown")
  local trees = parser:parse()
  local root = trees[1] and trees[1]:root()
  if not root then
    return nil
  end

  local function walk(node)
    if node:type() == "fenced_code_block" and language(node, buf) == "mermaid" then
      local start_row, _, end_row = node:range()
      if row >= start_row and row <= end_row then
        return node
      end
    end
    for child in node:iter_children() do
      local found = walk(child)
      if found then
        return found
      end
    end
    return nil
  end

  return walk(root)
end

---Extract the body text of a fenced_code_block (between the info string and the
---closing fence), mirroring markdown_ansi.lua's line-slice logic.
---@param buf integer
---@param node TSNode
---@return string|nil
local function fence_body(buf, node)
  local content = content_node(node)
  if not content then
    return nil
  end
  local start_row, _, end_row, end_col = content:range()
  local lines = vim.api.nvim_buf_get_lines(buf, start_row, end_row + (end_col > 0 and 1 or 0), false)
  return table.concat(lines, "\n")
end

---On-demand: run mmdflux on the mermaid fence under the cursor and pop the
---ANSI/Unicode output in a Snacks terminal float (`<leader>mm`).
function M.render_float()
  if vim.bo.filetype ~= "markdown" and vim.bo.filetype ~= "octo" then
    vim.notify("mermaid render: not a markdown buffer", vim.log.levels.INFO)
    return
  end

  if vim.fn.executable("mmdflux") == 0 then
    vim.notify("mmdflux not installed — see docs/neovim-mermaid-render.md", vim.log.levels.WARN)
    return
  end

  local buf = vim.api.nvim_get_current_buf()
  local row = vim.api.nvim_win_get_cursor(0)[1] - 1
  local node = mermaid_fence_at(buf, row)
  if not node then
    vim.notify("cursor is not inside a ```mermaid fence", vim.log.levels.INFO)
    return
  end

  local body = fence_body(buf, node)
  if not body or body == "" then
    vim.notify("mermaid fence is empty", vim.log.levels.INFO)
    return
  end

  -- mmdflux renders at the graph's natural width: it has no --width flag
  -- (`mmdflux --help` confirms) and ignores both COLUMNS env and tty winsize
  -- when stdin is a pipe. So we do NOT pass COLUMNS (it was a no-op); only
  -- TERM is preserved so color queries resolve. The float is sized to fit the
  -- output up to the editor width, and `wrap = false` lets the user scroll
  -- left/right (zl/zh) for diagrams wider than the window instead of wrapping
  -- (see docs/neovim-mermaid-render.md).
  local result = vim.system(
    { "mmdflux" },
    { stdin = body, text = true, env = { TERM = vim.env.TERM or "xterm-256color" } }
  ):wait()
  if result.code ~= 0 then
    vim.notify("mmdflux failed (exit " .. result.code .. "): " .. (result.stderr or ""), vim.log.levels.ERROR)
    return
  end

  local out = result.stdout or ""
  if out == "" then
    vim.notify("mmdflux produced no output", vim.log.levels.WARN)
    return
  end

  -- Hand the captured ANSI to a :terminal float so the terminal driver renders
  -- SGR/256-color natively. vim.system already captured stdout; we re-emit it
  -- through `cat` so the pty interprets the escapes (writing ANSI text directly
  -- into a buffer does NOT get interpreted by the terminal emulator).
  local tmp = vim.fn.tempname()
  vim.fn.writefile(vim.split(out, "\n", { plain = true }), tmp)

  -- Size the float to the diagram's natural width (strip ANSI SGR to measure
  -- visible columns), capped at the editor width minus border room. Narrow
  -- graphs get a narrow float; wide ones fill the editor and scroll via
  -- `wrap = false` rather than being clamped/wrapped at a fixed 80.
  local visual = out:gsub("\x1b%[[0-9;]*m", "")
  local max_w = 1
  for line in visual:gmatch("[^\n]*") do
    max_w = math.max(max_w, vim.fn.strdisplaywidth(line))
  end
  local width = math.min(math.max(1, vim.o.columns - 2), max_w)

  -- No border: a borderless Snacks float shows no title (Snacks clears
  -- title/footer when border is falsy), so none is passed.
  local win = Snacks.win({
    width = width,
    height = 0.8,
    bo = { bufhidden = "wipe" },
    wo = {
      number = false,
      relativenumber = false,
      signcolumn = "no",
      -- Show the full natural-width art; long lines scroll left/right
      -- (zl/zh) instead of wrapping at the window edge.
      wrap = false,
    },
  })

  vim.fn.termopen({ "cat", tmp }, {
    on_exit = function(_, code)
      vim.fn.delete(tmp)
      if code ~= 0 then
        vim.schedule(function()
          win:close()
          vim.notify("mermaid render: display failed", vim.log.levels.ERROR)
        end)
      end
    end,
  })

  local function close()
    win:close()
  end
  vim.keymap.set("n", "q", close, { buffer = win.buf, nowait = true, silent = true })
  vim.keymap.set("n", "<esc>", close, { buffer = win.buf, nowait = true, silent = true })
  vim.keymap.set("t", "q", close, { buffer = win.buf, nowait = true, silent = true })
  vim.keymap.set("t", "<esc>", close, { buffer = win.buf, nowait = true, silent = true })

  vim.cmd("startinsert")
end

-- ── Inline auto-render (pi-agent style) ─────────────────────────────────────
--
-- Every ```mermaid fence in a markdown buffer renders automatically as Unicode
-- box-drawing art in virtual lines — the same engine and look as the pi agent
-- TUI (npm package `grok-mermaid`). The engine returns `styled` spans tagged
-- with semantic classes (border/text/edge/edgeLabel/title); those map to
-- MermaidAscii* highlight groups below, so the art is colored, not one dim
-- gray. The fence itself folds to one dim line (foldmethod=expr, one fold per
-- fence) and opens while the cursor is inside it — art above, source hidden
-- until you step into it. PNG rendering of mermaid via snacks.image is
-- disabled by the query shadow in queries/markdown/images.scm (math rendering
-- is kept). Wired up in plugins/markdown.lua next to markdown_ansi.

local ns = vim.api.nvim_create_namespace("mermaid-ascii")
local ascii_cache = {} -- sha256(fence body) -> { styled = Span[][] } | { error = string }
local pending = {}
local grok_dist

-- Semantic class -> highlight group. Gruvbox hexes matching
-- ghostty/.config/ghostty/config so the art matches the terminal palette.
local CLS_HL = {
  border = "MermaidAsciiBorder",     -- gray: box frames, dim like pi-agent
  text = "MermaidAsciiText",         -- fg: node/participant labels
  edge = "MermaidAsciiEdge",         -- aqua: connectors and arrowheads
  edgeLabel = "MermaidAsciiEdgeLabel", -- yellow: text sitting on an edge
  title = "MermaidAsciiTitle",       -- pink: source-box headers
}
local CLS_FG = {
  border = "#7c6f64",
  text = "#d4be98",
  edge = "#7daea3",
  edgeLabel = "#d8a657",
  title = "#d3869b",
}

local NODE_SCRIPT = [==[
import { pathToFileURL } from "node:url";
let src = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) src += chunk;
const { render } = await import(pathToFileURL(process.env.GROK_DIST + "/dist/index.js").href);
const art = render(src);
process.stdout.write(JSON.stringify(art
  ? { styled: art.styled, warnings: art.warnings }
  : { error: "unsupported diagram type" }));
]==]

---Locate the grok-mermaid install: global npm first, then pi's bundled copy.
local function find_grok_dist()
  if grok_dist then
    return grok_dist
  end
  local ok, roots = pcall(vim.fn.systemlist, { "npm", "root", "-g" })
  if ok and roots and roots[1] and vim.fn.isdirectory(roots[1] .. "/grok-mermaid") == 1 then
    grok_dist = roots[1] .. "/grok-mermaid"
  else
    local hits = vim.fn.glob(vim.env.HOME .. "/.pi/agent/install/releases/*/node_modules/grok-mermaid", false, true)
    if #hits > 0 then
      grok_dist = hits[#hits]
    end
  end
  return grok_dist
end

---All `mermaid` fenced_code_block nodes in the buffer.
local function mermaid_fences(buf)
  local fences = {}
  local ok, parser = pcall(vim.treesitter.get_parser, buf, "markdown")
  if not ok or not parser then
    return fences
  end
  for _, tree in ipairs(parser:parse()) do
    local root = tree:root()
    local function walk(node)
      if node:type() == "fenced_code_block" and language(node, buf) == "mermaid" then
        fences[#fences + 1] = node
      else
        for child in node:iter_children() do
          walk(child)
        end
      end
    end
    walk(root)
  end
  return fences
end

local function place_inline(buf, node, cached)
  local start_row, _, end_row, end_col = node:range()
  if end_col == 0 and end_row > start_row then
    end_row = end_row - 1
  end
  -- anchor outside the fence fold: virt_lines on a folded line are hidden,
  -- so the art anchors to the line ABOVE the fence (below it when the fence
  -- starts the buffer or the line above sits inside another fence's fold;
  -- inside as a last resort)
  local anchor = start_row
  local above = start_row - 1
  local above_folded = false
  local fences = vim.b[buf].mermaid_fences
  if start_row > 0 and fences then
    for _, f in ipairs(fences) do
      if above >= f[1] and above <= f[2] then
        above_folded = true
        break
      end
    end
  end
  if start_row > 0 and not above_folded then
    anchor = above
  elseif end_row + 1 < vim.api.nvim_buf_line_count(buf) then
    anchor = end_row + 1
  end
  local virt = { { { "", "Comment" } } } -- one spacing line
  if cached.styled then
    for _, spans in ipairs(cached.styled) do
      local chunk = {}
      for _, span in ipairs(spans) do
        -- every span's text is kept: "none" spans hold the blank filler that
        -- positions boxes/edges — dropping them misaligns the art
        chunk[#chunk + 1] = { span.text, CLS_HL[span.cls] }
      end
      virt[#virt + 1] = #chunk > 0 and chunk or { { "" } }
    end
  else
    virt[#virt + 1] = { { "⚠ mermaid: " .. (cached.error or "render failed"), "Comment" } }
  end
  vim.api.nvim_buf_set_extmark(buf, ns, anchor, 0, { virt_lines = virt })
end

---Open the fence fold when the cursor steps into the fence (the fold line
---counts); close it when the cursor leaves. Idempotent per fence.
local function update_folds(buf)
  local fences = vim.b[buf] and vim.b[buf].mermaid_fences
  if not fences then
    return
  end
  for _, win in ipairs(vim.fn.win_findbuf(buf)) do
    local row = vim.api.nvim_win_get_cursor(win)[1] - 1
    for _, f in ipairs(fences) do
      local start_l, end_l = f[1] + 1, f[2] + 1
      local inside = row >= f[1] and row <= f[2]
      vim.api.nvim_win_call(win, function()
        if inside then
          if vim.fn.foldclosed(start_l) ~= -1 then
            vim.cmd(start_l .. "foldopen")
          end
        elseif vim.fn.foldclosed(start_l) == -1 and vim.fn.foldlevel(start_l) > 0 then
          -- foldlevel guards against closing an unrelated fold that merely
          -- contains this line
          vim.cmd(start_l .. "," .. end_l .. "foldclose")
        end
      end)
    end
  end
end

---foldmethod=expr: one fold per mermaid fence, fence lines included.
function M.foldexpr()
  local fences = vim.b.mermaid_fences
  if not fences then
    return "0"
  end
  local lnum = vim.v.lnum
  for _, f in ipairs(fences) do
    if lnum >= f[1] + 1 and lnum <= f[2] + 1 then
      return lnum == f[1] + 1 and ">1" or "1"
    end
  end
  return "0"
end

---Closed fence folds show one dim line instead of the raw ```mermaid fence.
function M.foldtext()
  local n = vim.v.foldend - vim.v.foldstart + 1
  return { { ("  ▸ mermaid source (%d lines) — cursor here to edit"):format(n), "Comment" } }
end

local FOLD_EXPR = "v:lua.require('helpers.mermaid_render').foldexpr()"
local FOLD_TEXT = "v:lua.require('helpers.mermaid_render').foldtext()"

---Take over a window's fold options for mermaid fence folding, saving the
---prior values once so they can be restored when the fences go away.
local function apply_fold_opts(win)
  local wo = vim.wo[win]
  -- Save the pre-mermaid values once per window. Never save when the window
  -- already runs our foldexpr: nvim remembers window options per displayed
  -- buffer, so on re-entry it can hand our own values back as "prior" ones.
  if not vim.w[win].mermaid_fold_saved and wo.foldexpr ~= FOLD_EXPR then
    vim.w[win].mermaid_fold_saved = {
      foldmethod = wo.foldmethod,
      foldexpr = wo.foldexpr,
      foldtext = wo.foldtext,
      foldenable = wo.foldenable,
    }
  end
  wo.foldmethod = "expr"
  wo.foldexpr = FOLD_EXPR
  wo.foldtext = FOLD_TEXT
  wo.foldenable = true
end

---Return a window's fold options to the values saved by apply_fold_opts.
--Only windows still running our foldexpr are restored, so user-made changes
--survive; the saved values stay (sticky) for later re-entry.
local function restore_fold_opts(win)
  local saved = vim.w[win].mermaid_fold_saved
  if not saved or vim.wo[win].foldexpr ~= FOLD_EXPR then
    return
  end
  local wo = vim.wo[win]
  wo.foldmethod = saved.foldmethod
  wo.foldexpr = saved.foldexpr
  wo.foldtext = saved.foldtext
  wo.foldenable = saved.foldenable
end

local function render_buf(buf)
  if not vim.api.nvim_buf_is_valid(buf) or vim.bo[buf].buftype ~= "" then
    return
  end
  local fences = mermaid_fences(buf)
  vim.api.nvim_buf_clear_namespace(buf, ns, 0, -1)

  -- fold ranges (0-based, inclusive) for foldexpr + cursor reveal.
  -- TSNode ranges are half-open: when end_col == 0, end_row is one past the
  -- last fence line — pull it back so the fold covers exactly the fence.
  local ranges = {}
  for _, node in ipairs(fences) do
    local sr, _, er, ec = node:range()
    if ec == 0 and er > sr then
      er = er - 1
    end
    ranges[#ranges + 1] = { sr, er }
  end
  vim.b[buf].mermaid_fences = ranges
  for _, win in ipairs(vim.fn.win_findbuf(buf)) do
    if #ranges > 0 then
      apply_fold_opts(win)
    else
      restore_fold_opts(win)
    end
  end
  update_folds(buf)

  for _, node in ipairs(fences) do
    local body = fence_body(buf, node)
    if body and body ~= "" then
      local key = vim.fn.sha256(body)
      local cached = ascii_cache[key]
      if cached ~= nil then
        place_inline(buf, node, cached)
      elseif not pending[key] then
        pending[key] = true
        local dist = find_grok_dist()
        if not dist then
          ascii_cache[key] = { error = "grok-mermaid not found (npm i -g grok-mermaid)" }
          pending[key] = nil
          place_inline(buf, node, ascii_cache[key])
        else
          vim.system(
            { "node", "--input-type=module", "-e", NODE_SCRIPT },
            { stdin = body, text = true, env = { GROK_DIST = dist } },
            function(res)
              vim.schedule(function()
                pending[key] = nil
                local art
                if res.code == 0 and res.stdout and res.stdout ~= "" then
                  art = vim.json.decode(res.stdout)
                end
                ascii_cache[key] = art or { error = "render failed" }
                if vim.api.nvim_buf_is_valid(buf) then
                  render_buf(buf) -- cache is warm now; re-place all extmarks
                end
              end)
            end
          )
        end
      end
    end
  end
end

---Enable auto-render of all ```mermaid fences in markdown buffers.
function M.setup_inline()
  for cls, hl in pairs(CLS_HL) do
    vim.api.nvim_set_hl(0, hl, { fg = CLS_FG[cls], default = true })
  end
  -- Re-apply after a colorscheme switch (set_hl clears user groups).
  vim.api.nvim_create_autocmd("ColorScheme", {
    group = vim.api.nvim_create_augroup("mermaid_ascii_hl", { clear = true }),
    callback = function()
      for cls, hl in pairs(CLS_HL) do
        vim.api.nvim_set_hl(0, hl, { fg = CLS_FG[cls], default = true })
      end
    end,
  })
  local group = vim.api.nvim_create_augroup("mermaid_ascii", { clear = true })
  vim.api.nvim_create_autocmd({ "BufWinEnter", "InsertLeave", "TextChanged" }, {
    group = group,
    pattern = { "*.md", "*.markdown" },
    callback = function(ev)
      render_buf(ev.buf)
    end,
  })
  vim.api.nvim_create_autocmd({ "CursorMoved", "CursorMovedI" }, {
    group = group,
    pattern = { "*.md", "*.markdown" },
    callback = function(ev)
      update_folds(ev.buf)
    end,
  })
  vim.api.nvim_create_autocmd("BufWinEnter", {
    group = group,
    callback = function()
      if not (vim.b.mermaid_fences and #vim.b.mermaid_fences > 0) then
        restore_fold_opts(0)
      end
    end,
  })
end

return M
