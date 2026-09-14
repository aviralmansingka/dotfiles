local M = {}
local ns = vim.api.nvim_create_namespace("HerdrScrollbackAnsi")

local function trim_padding(line)
  local suffix = ""
  while true do
    line = line:gsub("[ \t]+$", "")
    local start = line:find("\27%[[%d;]*m$")
    if not start then
      return line .. suffix
    end
    suffix = line:sub(start) .. suffix
    line = line:sub(1, start - 1)
  end
end

local function tree_row(line, in_tree)
  local body = vim.trim(line)
  local rail = false
  while vim.startswith(body, "│") do
    rail = true
    body = vim.trim(body:sub(#"│" + 1))
  end
  for _, glyph in ipairs({ "├─", "└─", "▸ ", "▹ ", "◆ ", "◇ " }) do
    if vim.startswith(body, glyph) then
      return true
    end
  end
  return rail and (in_tree or body:match("^%d+ steps? ·") ~= nil)
end

function M.document(text)
  local ansi = require("helpers.markdown_ansi")
  local lines = vim.split(text:gsub("\r\n", "\n"), "\n", { plain = true, trimempty = false })
  for i, line in ipairs(lines) do
    lines[i] = trim_padding(line)
  end
  if lines[#lines] == "" then
    table.remove(lines)
  end
  local plain, marks = ansi.decode(lines)
  -- Make each colored line self-contained, even if SGR began in preceding prose.
  local colored = ansi.encode(plain, marks)
  local document, tree = {}, {}
  local function flush_tree()
    if #tree == 0 then
      return
    end
    local length = 3
    for _, line in ipairs(tree) do
      for ticks in line:gmatch("`+") do
        length = math.max(length, #ticks + 1)
      end
    end
    local fence = string.rep("`", length)
    if #document > 0 and document[#document] ~= "" then
      document[#document + 1] = ""
    end
    document[#document + 1] = fence .. "ansi"
    vim.list_extend(document, tree)
    document[#document + 1] = fence
    document[#document + 1] = ""
    tree = {}
  end
  local source_fence
  for i, line in ipairs(plain) do
    -- Unsupported SGR may stay visible in the ANSI viewer, never in prose.
    line = line:gsub("\27%[[%d;:]*m", "")
    -- Don't nest a new fence inside a code block already present in the output.
    local fence, rest = line:match("^ ? ? ?(```+)(.*)$")
    if not fence then
      fence, rest = line:match("^ ? ? ?(~~~+)(.*)$")
    end
    if source_fence then
      document[#document + 1] = line
      if fence and fence:sub(1, 1) == source_fence:sub(1, 1) and #fence >= #source_fence and vim.trim(rest) == "" then
        source_fence = nil
      end
    elseif fence then
      flush_tree()
      source_fence = fence
      document[#document + 1] = line
    elseif tree_row(line, #tree > 0) then
      tree[#tree + 1] = colored[i]
    else
      local was_tree = #tree > 0
      flush_tree()
      if not (was_tree and line == "") then
        document[#document + 1] = line
      end
    end
  end
  flush_tree()
  return document
end

function M.directory()
  local base = vim.env.XDG_DATA_HOME
  if not base or base == "" then
    base = vim.fn.expand("~/.local/share")
  end
  return vim.fn.resolve(vim.fn.fnamemodify(base, ":p")):gsub("/$", "") .. "/herdr/captures"
end

function M.path(session)
  assert(type(session) == "table", "Herdr has not reported a conversation identity")
  for _, key in ipairs({ "source", "kind", "value" }) do
    assert(type(session[key]) == "string" and session[key] ~= "", "Herdr conversation identity is incomplete")
  end
  local identity = vim.json.encode({ session.source, session.kind, session.value })
  return M.directory() .. "/conversation-" .. vim.fn.sha256(identity) .. ".md"
end

local function digest(lines)
  return vim.fn.sha256(table.concat(lines, "\n"))
end

local function write_file(path, lines)
  -- Private staging + rename: a failed write never truncates the last capture.
  local fd, temporary = vim.uv.fs_mkstemp(vim.fs.dirname(path) .. "/.capture-XXXXXX")
  assert(fd, temporary)
  vim.uv.fs_close(fd)
  local ok, err = pcall(function()
    assert(vim.fn.writefile(lines, temporary) == 0, "could not write capture")
    assert(vim.uv.fs_rename(temporary, path))
  end)
  if not ok then
    vim.uv.fs_unlink(temporary)
    error(err)
  end
end

function M.save(buf, path)
  buf = buf == 0 and vim.api.nvim_get_current_buf() or buf
  path = vim.fn.fnamemodify(path, ":p")
  if vim.fn.filereadable(path) == 1 and vim.v.cmdbang == 0 then
    assert(path == vim.b[buf].herdr_capture_path, "File exists; use :write! to overwrite it")
    assert(
      digest(vim.fn.readfile(path)) == vim.b[buf].herdr_capture_hash,
      "Capture changed on disk; reload or use :write!"
    )
  end
  local marks = {}
  for _, mark in ipairs(vim.api.nvim_buf_get_extmarks(buf, ns, 0, -1, { details = true })) do
    if not mark[4].invalid then
      marks[#marks + 1] = { start_row = mark[2], start_col = mark[3], opts = mark[4] }
    end
  end
  local lines = require("helpers.markdown_ansi").encode(vim.api.nvim_buf_get_lines(buf, 0, -1, false), marks)
  write_file(path, lines)
  if path == vim.api.nvim_buf_get_name(buf) then
    vim.b[buf].herdr_capture_hash = digest(lines)
    vim.b[buf].herdr_capture_path = path
    vim.bo[buf].modified = false
  end
end

local function window_options(buf)
  for _, win in ipairs(vim.fn.win_findbuf(buf)) do
    local opts = vim.wo[win]
    opts.wrap, opts.linebreak, opts.breakindent = true, true, true
    opts.showbreak = "↳ "
    opts.number, opts.relativenumber = false, false
    opts.signcolumn, opts.foldcolumn, opts.statuscolumn = "no", "0", ""
    opts.list = false
    opts.conceallevel, opts.concealcursor = 3, "nvic"
  end
end

function M.load(buf, document)
  buf = buf == 0 and vim.api.nvim_get_current_buf() or buf
  document = document or vim.api.nvim_buf_get_lines(buf, 0, -1, false)
  local lines, highlights = require("helpers.markdown_ansi").decode(document)
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.bo[buf].modeline, vim.bo[buf].swapfile = false, false
  vim.b[buf].herdr_scrollback, vim.b[buf].snacks_indent, vim.b[buf].autoformat = true, false, false
  vim.bo[buf].filetype = "markdown"
  -- The editable view has clean text columns; :write puts ANSI back on disk.
  vim.bo[buf].buftype = "acwrite"
  vim.b[buf].herdr_capture_hash = digest(document)
  vim.b[buf].herdr_capture_path = vim.api.nvim_buf_get_name(buf)
  vim.bo[buf].modified = false
  vim.diagnostic.enable(false, { bufnr = buf })
  vim.diagnostic.reset(nil, buf)
  vim.api.nvim_buf_clear_namespace(buf, ns, 0, -1)
  for _, mark in ipairs(highlights) do
    vim.api.nvim_buf_set_extmark(buf, ns, mark.start_row, mark.start_col, mark.opts)
  end
  window_options(buf)
  if not vim.b[buf].herdr_capture_hooks then
    vim.b[buf].herdr_capture_hooks = true
    vim.api.nvim_create_autocmd("BufWriteCmd", {
      buffer = buf,
      callback = function(event)
        M.save(buf, event.match)
      end,
    })
    vim.api.nvim_create_autocmd("BufWinEnter", {
      buffer = buf,
      callback = function()
        vim.schedule(function()
          if vim.api.nvim_buf_is_valid(buf) then
            window_options(buf)
          end
        end)
      end,
    })
  end
end

function M.render(buf)
  buf = buf == 0 and vim.api.nvim_get_current_buf() or buf
  local pane = vim.env.HERDR_ACTIVE_PANE_ID
  if vim.env.HERDR_ENV ~= "1" or not pane or pane == "" then
    return false
  end
  local function request(args)
    local result = vim.system(args, { text = true }):wait(10000)
    assert(result.code == 0, result.stderr or "Herdr capture failed")
    return result.stdout
  end
  local ok, err = pcall(function()
    local function conversation_path()
      local info = vim.json.decode(request({ "herdr", "pane", "get", pane }))
      return M.path(info.result.pane.agent_session)
    end
    local path = conversation_path()
    -- HERDR_PANE_ID is the editor overlay, not the source terminal.
    local text = request({
      "herdr",
      "pane",
      "read",
      pane,
      "--source",
      "recent-unwrapped",
      "--lines",
      "2147483647",
      "--format",
      "ansi",
    })
    assert(conversation_path() == path, "Conversation changed during capture; try again")
    local existing = vim.fn.bufnr(path)
    assert(existing == -1 or existing == buf, "This conversation capture is already open in another buffer")
    local document = M.document(text)
    vim.fn.mkdir(M.directory(), "p", 448)
    assert(vim.uv.fs_chmod(M.directory(), 448))
    write_file(path, document)
    vim.api.nvim_buf_set_name(buf, path)
    M.load(buf, document)
  end)
  if not ok then
    vim.notify("Herdr capture failed: " .. tostring(err), vim.log.levels.WARN)
  end
  return ok
end

function M.setup()
  local group = vim.api.nvim_create_augroup("HerdrScrollback", { clear = true })
  local patterns = { "herdr-scrollback-*.txt", M.directory() .. "/conversation-*.md" }
  vim.api.nvim_create_autocmd("BufReadPre", {
    group = group,
    pattern = patterns,
    callback = function(event)
      vim.bo[event.buf].modeline = false
    end,
  })
  vim.api.nvim_create_autocmd("BufReadPost", {
    group = group,
    pattern = patterns,
    callback = function(event)
      if event.file:match("%.md$") then
        M.load(event.buf)
      else
        M.render(event.buf)
      end
    end,
  })
end

return M
