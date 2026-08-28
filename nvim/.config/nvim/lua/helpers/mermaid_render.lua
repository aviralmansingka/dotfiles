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

  -- Cap the rendered grid at 80 columns: mmdflux has no documented --width
  -- flag and auto-detects width (COLUMNS env / tty size, falling back to a
  -- default when stdin is a pipe). Set COLUMNS=80 so the piped-stdin path
  -- targets an 80-column grid; keep TERM so color/width queries resolve. If a
  -- future mmdflux release adds an explicit --width/--columns/--term-width
  -- flag, prefer that over the env var (see docs/neovim-mermaid-render.md).
  local result = vim.system(
    { "mmdflux" },
    { stdin = body, text = true, env = { COLUMNS = "80", TERM = vim.env.TERM or "xterm-256color" } }
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

  local win = Snacks.win({
    title = " mermaid render ",
    -- Match the 80-column mmdflux grid (COLUMNS=80 above) so the terminal
    -- float doesn't widen past the rendered art.
    width = math.min(80, math.floor(vim.o.columns * 0.8)),
    height = 0.8,
    bo = { bufhidden = "wipe" },
    wo = { number = false, relativenumber = false, signcolumn = "no" },
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

return M
