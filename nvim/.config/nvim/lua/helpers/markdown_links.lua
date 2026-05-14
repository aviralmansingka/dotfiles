local M = {}

local SUPPORTED_FILETYPES = { markdown = true, octo = true }

local function is_supported(buf)
  return SUPPORTED_FILETYPES[vim.bo[buf].filetype] == true
end

local function find_inline_link(node)
  while node do
    if node:type() == "inline_link" then
      return node
    end
    node = node:parent()
  end
  return nil
end

local function inline_link_at_cursor()
  local buf = vim.api.nvim_get_current_buf()
  local row, col = unpack(vim.api.nvim_win_get_cursor(0))
  local ok, parser = pcall(vim.treesitter.get_parser, buf, "markdown_inline")
  if not ok or not parser then
    return nil
  end
  local tree = parser:parse()[1]
  if not tree then
    return nil
  end
  local node = tree:root():named_descendant_for_range(row - 1, col, row - 1, col)
  return find_inline_link(node)
end

function M.select_url(around)
  local link = inline_link_at_cursor()
  if not link then
    vim.notify("No inline link under cursor", vim.log.levels.WARN)
    return
  end

  local dest
  for child in link:iter_children() do
    if child:type() == "link_destination" then
      dest = child
    end
  end
  if not dest then
    return
  end

  local sr, sc, er, ec = dest:range()
  if around then
    sc = sc - 1
    ec = ec + 1
  end

  vim.api.nvim_win_set_cursor(0, { sr + 1, sc })
  vim.cmd("normal! v")
  vim.api.nvim_win_set_cursor(0, { er + 1, ec - 1 })
end

local function looks_like_url(s)
  local trimmed = s:gsub("^%s+", ""):gsub("%s+$", "")
  if trimmed:match("^https?://%S+$") then
    return true, trimmed
  end
  return false, trimmed
end

local function get_visual_selection()
  local s = vim.fn.getpos("'<")
  local e = vim.fn.getpos("'>")
  local sr, sc = s[2] - 1, s[3] - 1
  local er, ec = e[2] - 1, e[3]
  local last_line = vim.api.nvim_buf_get_lines(0, er, er + 1, true)[1] or ""
  if ec > #last_line then
    ec = #last_line
  end
  local lines = vim.api.nvim_buf_get_text(0, sr, sc, er, ec, {})
  return table.concat(lines, "\n"), sr, sc, er, ec
end

function M.edit_url()
  local link = inline_link_at_cursor()
  if not link then
    vim.notify("No inline link under cursor", vim.log.levels.WARN)
    return
  end

  local dest
  for child in link:iter_children() do
    if child:type() == "link_destination" then
      dest = child
    end
  end
  if not dest then
    return
  end

  local sr, sc, er, ec = dest:range()
  local current_url = vim.api.nvim_buf_get_text(0, sr, sc, er, ec, {})[1] or ""

  vim.ui.input({ prompt = "URL: ", default = current_url }, function(input)
    if input == nil then
      return
    end
    vim.api.nvim_buf_set_text(0, sr, sc, er, ec, { input })
  end)
end

function M.paste_as_link(mode)
  local raw = vim.fn.getreg('"')
  if raw == nil or raw == "" then
    raw = vim.fn.getreg("+")
  end
  local is_url, url = looks_like_url(raw or "")

  vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes("<Esc>", true, false, true), "x", false)

  local selection, sr, sc, er, ec = get_visual_selection()

  if not is_url or selection == "" or selection:find("\n") then
    vim.schedule(function()
      vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes("gv" .. mode, true, false, true), "n", false)
    end)
    return
  end

  local replacement = "[" .. selection .. "](" .. url .. ")"
  vim.api.nvim_buf_set_text(0, sr, sc, er, ec, { replacement })
  vim.api.nvim_win_set_cursor(0, { sr + 1, sc + #replacement })
end

function M.setup()
  local buf = vim.api.nvim_get_current_buf()
  if not is_supported(buf) then
    return
  end

  vim.opt_local.conceallevel = 3
  vim.opt_local.concealcursor = "nvic"

  vim.keymap.set("n", "<leader>mu", M.edit_url, { buffer = buf, desc = "Edit URL under cursor" })

  vim.keymap.set({ "o", "x" }, "iu", function()
    M.select_url(false)
  end, { buffer = buf, desc = "Inside URL" })
  vim.keymap.set({ "o", "x" }, "au", function()
    M.select_url(true)
  end, { buffer = buf, desc = "Around URL" })

  vim.keymap.set("x", "p", function()
    M.paste_as_link("p")
  end, { buffer = buf, desc = "Paste (URL-aware)" })
  vim.keymap.set("x", "P", function()
    M.paste_as_link("P")
  end, { buffer = buf, desc = "Paste before (URL-aware)" })
end

return M
