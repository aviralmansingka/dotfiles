-- lua/plugins/markdown.lua, dofile'd as a plain spec table (no lazy, no
-- bootstrap). Guards the markdown-layer wiring:
--   * the pure path helpers (starts_with / relative_to_vault /
--     is_active_todo_file) reached through the real keymap closures;
--   * the todo scan over a mktemp fixture tree (never ~/vault): legacy-log
--     and hidden prefixes stay excluded, habit-tracking sections stay
--     skipped, section labels land in the picker items;
--   * PencilSoft (#159): the FileType callback must leave wrap OFF even
--     when pencil itself forces wrap on, plus the number/format/keymap
--     state it owns;
--   * the keys table (incl. <leader>mm) and the render-markdown wiring that
--     performs fence detection for auto-render.
--
-- Every scan runs against a tempdir vault (vim.fn.expand is stubbed before
-- dofile), every picker call hits a stubbed Snacks, and mmdflux absence is
-- forced through a stubbed executable — nothing touches $HOME or the
-- network.

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
local root = H.setup()

-- ── fixture tree under a tempdir home ──────────────────────────────────────
local tmp = vim.fn.tempname() .. "-markdown-plugin"
local fake_home = tmp .. "/home"
local fake_vault = fake_home .. "/vault"
vim.fn.mkdir(fake_vault .. "/journal", "p")
vim.fn.mkdir(fake_vault .. "/3_log", "p")
vim.fn.mkdir(fake_vault .. "/5_modal/logs", "p")
vim.fn.mkdir(fake_vault .. "/templates", "p")
vim.fn.mkdir(fake_vault .. "/.obsidian", "p")
vim.fn.mkdir(fake_vault .. "/notes", "p")

local active_lines = {
  "# Daily",
  "",
  "## Work",
  "- [ ] buy milk #errand",
  "- [x] done thing",
  "",
  "## Habit Tracking",
  "- [ ] meditate",
  "",
  "## Later",
  "- [ ] ship feature",
}
vim.fn.writefile(active_lines, fake_vault .. "/active.md")
vim.fn.writefile({ "- [ ] journal todo" }, fake_vault .. "/journal/day.md")
vim.fn.writefile({ "- [ ] log todo" }, fake_vault .. "/3_log/a.md")
vim.fn.writefile({ "- [ ] modal todo" }, fake_vault .. "/5_modal/logs/a.md")
vim.fn.writefile({ "- [ ] template todo" }, fake_vault .. "/templates/t.md")
vim.fn.writefile({ "- [ ] obsidian todo" }, fake_vault .. "/.obsidian/c.md")
local other_lines = {
  "## Work",
  "- [ ] second file todo",
}
vim.fn.writefile(other_lines, fake_vault .. "/notes/other.md")

local function line_of(lines, needle)
  for i, l in ipairs(lines) do
    if l == needle then
      return i
    end
  end
  error("fixture line not found: " .. needle, 0)
end

-- ── load the spec table with ~/ expansion pinned to the tempdir ────────────
local real_expand = vim.fn.expand
local restore_expand = H.replace(vim.fn, "expand", function(spec)
  if spec == "~/vault/" then
    return fake_vault .. "/"
  end
  if type(spec) == "string" and spec:sub(1, 2) == "~/" then
    return fake_home .. "/" .. spec:sub(3)
  end
  return real_expand(spec)
end)

local plugin = dofile(root .. "/lua/plugins/markdown.lua")
restore_expand()

local function entry(name)
  return vim.tbl_filter(function(spec)
    return spec[1] == name
  end, plugin)[1]
end

local function key_entry(lhs)
  local rm = entry("MeanderingProgrammer/render-markdown.nvim")
  for _, k in ipairs(rm.keys) do
    if k[1] == lhs then
      return k
    end
  end
  return nil
end

local captured_picker
local restore_snacks = H.replace(_G, "Snacks", {
  picker = { pick = function(opts)
    captured_picker = opts
  end },
})

H.run("markdown_plugin_spec", function()
  -- ── the spec table shape ────────────────────────────────────────────────
  local rm = entry("MeanderingProgrammer/render-markdown.nvim")
  H.truthy(rm, "the render-markdown entry exists")
  H.truthy(entry("preservim/vim-pencil"), "the vim-pencil entry exists")
  H.truthy(entry("mfussenegger/nvim-lint"), "the nvim-lint entry exists")

  -- ── pure path helpers through the real <leader>ft closure ───────────────
  local ft = key_entry("<leader>ft")
  H.truthy(ft, "<leader>ft exists")
  local starts_with = H.upvalue(ft[2], "starts_with")
  local is_active = H.upvalue(ft[2], "is_active_todo_file")
  local relative = H.upvalue(ft[2], "relative_to_vault")
  local get_active = H.upvalue(ft[2], "get_active_markdown_files")
  local vault = H.upvalue(ft[2], "VAULT_DIR")
  H.eq(vault, fake_vault .. "/", "the vault root is the tempdir fixture")

  H.eq(starts_with("vault/journal/x.md", "vault/journal/"), true, "starts_with: a true prefix")
  H.eq(starts_with("vault/journalx.md", "vault/journal/"), false,
    "starts_with: a longer string with the same head is not a match")
  H.eq(starts_with("a", "ab"), false, "starts_with: a shorter value never matches")
  H.eq(starts_with("same", "same"), true, "starts_with: equal strings match")

  H.eq(is_active(fake_vault .. "/active.md"), true, "an active note is scanned")
  H.eq(is_active(fake_vault .. "/journal/day.md"), false, "journal/ is legacy and skipped")
  H.eq(is_active(fake_vault .. "/3_log/a.md"), false, "3_log/ is legacy and skipped")
  H.eq(is_active(fake_vault .. "/5_modal/logs/a.md"), false, "5_modal/logs/ is legacy and skipped")
  H.eq(is_active(fake_vault .. "/.git/x.md"), false, ".git/ is excluded")
  H.eq(is_active(fake_vault .. "/.obsidian/c.md"), false, ".obsidian/ is excluded")
  H.eq(is_active(fake_vault .. "/templates/t.md"), false, "templates/ is excluded")

  H.eq(relative(fake_vault .. "/active.md"), "active.md",
    "vault files display relative to the vault root")
  H.eq(relative(fake_vault .. "/notes/other.md"), "notes/other.md",
    "nested vault files keep their subpath")
  H.eq(relative("/etc/hosts"), "/etc/hosts",
    "files outside home (and the vault) display as-is")

  -- ── the todo scan over the fixture tree ─────────────────────────────────
  local files = get_active()
  local names = {}
  for _, f in ipairs(files) do
    names[#names + 1] = vim.fn.fnamemodify(f, ":t")
  end
  H.truthy(vim.tbl_contains(names, "active.md"), "the scan collects the active note")
  H.truthy(vim.tbl_contains(names, "other.md"), "the scan collects nested notes")
  for _, banned in ipairs({ "day.md", "a.md", "t.md", "c.md" }) do
    H.eq(vim.tbl_contains(names, banned), false,
      "excluded prefixes never reach the scan: " .. banned)
  end

  -- <leader>ft: picker items carry file:line [section] text
  captured_picker = nil
  ft[2]()
  H.truthy(captured_picker, "<leader>ft opens the Snacks picker")
  H.eq(captured_picker.source, "active-vault-todos", "the picker source is the todo scan")
  local texts = {}
  for _, item in ipairs(captured_picker.items) do
    texts[item.text] = item
  end
  local milk_line = line_of(active_lines, "- [ ] buy milk #errand")
  local ship_line = line_of(active_lines, "- [ ] ship feature")
  local other_line = line_of(other_lines, "- [ ] second file todo")
  H.eq(texts[("active.md:%d [Work] buy milk #errand"):format(milk_line)] ~= nil, true,
    "the Work section label is captured with file and line")
  H.eq(texts[("active.md:%d [Later] ship feature"):format(ship_line)] ~= nil, true,
    "a section after Habit Tracking is scanned again with its label")
  H.eq(texts[("notes/other.md:%d [Work] second file todo"):format(other_line)] ~= nil, true,
    "a second file lands with its relative path and section")
  H.eq(texts[("active.md:%d [Habit Tracking] meditate"):format(line_of(active_lines, "- [ ] meditate"))] ~= nil,
    false, "habit-tracking todos are skipped")
  H.eq(texts[("active.md:%d [Work] done thing"):format(line_of(active_lines, "- [x] done thing"))] ~= nil,
    false, "checked items are not todos")
  for _, banned in ipairs({ "journal todo", "log todo", "modal todo", "template todo", "obsidian todo" }) do
    local found = false
    for t in pairs(texts) do
      if t:find(banned, 1, true) then
        found = true
      end
    end
    H.eq(found, false, "excluded trees never surface: " .. banned)
  end
  local milk_item = texts[("active.md:%d [Work] buy milk #errand"):format(milk_line)]
  H.eq(milk_item.pos, { milk_line, 0 }, "a todo item carries its jump position")
  H.eq(milk_item.file, fake_vault .. "/active.md", "a todo item carries the vault path")

  -- <leader>fT: the same scan with extracted tags
  local fT = key_entry("<leader>fT")
  captured_picker = nil
  fT[2]()
  H.eq(captured_picker.source, "active-vault-todos-tags", "the tag picker is the fT source")
  local tag_texts = {}
  for _, item in ipairs(captured_picker.items) do
    tag_texts[item.text] = item
  end
  local tagged = tag_texts[("active.md:%d [Work] buy milk #errand #errand"):format(milk_line)]
  H.truthy(tagged, "tagged todos list their tags in the display text")
  H.eq(tagged.tags, { "errand" }, "the tags field holds the extracted tag list")

  -- ── PencilSoft must not re-enable wrap (#159) ────────────────────────────
  -- The fixture buffers get their filetype BEFORE the autocmds exist:
  -- assigning 'filetype' fires FileType itself, which would double-run
  -- the callback under test.
  local md = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_lines(md, 0, -1, false, { "# title", "", "[docs](https://x.example.com/y)" })
  vim.bo[md].filetype = "markdown"
  local octo = vim.api.nvim_create_buf(false, true)
  vim.bo[octo].filetype = "octo"

  local pencil = entry("preservim/vim-pencil")
  pencil.config()
  pencil.config() -- idempotency: clear=true augroup re-registers once
  local ft_autocmds = {}
  for _, a in ipairs(vim.api.nvim_get_autocmds({ group = "markdown_editing" })) do
    ft_autocmds[a.pattern] = ft_autocmds[a.pattern] or 0
    ft_autocmds[a.pattern] = ft_autocmds[a.pattern] + 1
  end
  H.eq(ft_autocmds, { markdown = 1, octo = 1 },
    "one FileType autocmd per supported filetype, reload-stable")

  -- simulate the #159 regression: PencilSoft itself forces wrap on
  local pencil_calls = 0
  local restore_cmd = H.replace(vim, "cmd", function(arg)
    if type(arg) == "string" and arg:find("PencilSoft", 1, true) then
      pencil_calls = pencil_calls + 1
      vim.wo.wrap = true -- what pencil did before the fix
    end
  end)

  vim.api.nvim_set_current_buf(md)
  vim.wo.wrap = true
  vim.wo.number = true
  vim.wo.relativenumber = true

  vim.api.nvim_exec_autocmds("FileType", { group = "markdown_editing", pattern = "markdown" })
  H.eq(pencil_calls, 1, "the FileType callback runs PencilSoft")
  H.eq(vim.wo.wrap, false, "#159: PencilSoft never leaves wrap enabled")
  H.eq(vim.wo.number, false, "line numbers stay off in markdown buffers")
  H.eq(vim.wo.relativenumber, false, "relative numbers stay off in markdown buffers")
  H.eq(vim.bo.formatexpr, "v:lua.require'conform'.formatexpr()",
    "conform stays the markdown formatter")
  local leader = vim.g.mapleader or "\\"
  local mapped = false
  for _, m in ipairs(vim.api.nvim_buf_get_keymap(md, "n")) do
    if m.lhs == leader .. "mu" then
      mapped = true
    end
  end
  H.eq(mapped, true, "the FileType callback wires the markdown_links keymaps")

  -- octo: no PencilSoft, its own width/wrap/format state
  vim.api.nvim_set_current_buf(octo)
  vim.wo.wrap = true
  vim.api.nvim_exec_autocmds("FileType", { group = "markdown_editing", pattern = "octo" })
  H.eq(pencil_calls, 1, "octo buffers never run PencilSoft")
  H.eq(vim.wo.wrap, false, "octo keeps wrap off (conceal/wrap phantom-space fix)")
  H.eq(vim.bo.textwidth, 120, "octo pins textwidth to 120")
  H.eq(vim.bo.formatexpr, "", "octo disables formatexpr")
  restore_cmd()

  -- ── keymap presence, incl. <leader>mm ────────────────────────────────────
  for _, lhs in ipairs({ "<leader>ft", "<leader>fT", "<leader>vf", "<leader>vt",
    "<leader>ot", "<leader>ob", "<leader>ol", "<leader>mm" }) do
    local k = key_entry(lhs)
    H.truthy(k, "key " .. lhs .. " is present")
    H.truthy(k.desc and k.desc ~= "", "key " .. lhs .. " carries a description")
  end
  H.eq(key_entry("<leader>mm").desc, "Render mermaid fence (mmdflux ASCII)",
    "<leader>mm keeps its mermaid description")

  -- <leader>mm routes to the real mermaid render_float (absent binary path)
  local mm_notify = {}
  local restore_notify = H.replace(vim, "notify", function(msg)
    mm_notify[#mm_notify + 1] = msg
  end)
  local restore_executable = H.replace(vim.fn, "executable", function(cmd)
    return cmd == "mmdflux" and 0 or 0
  end)
  key_entry("<leader>mm")[2]()
  H.eq(mm_notify, { "mmdflux not installed — see docs/neovim-mermaid-render.md" },
    "<leader>mm reaches the mermaid binary-absent guard")
  restore_executable()
  restore_notify()

  -- ── init(): fence detection for auto-render + parser wiring ──────────────
  -- herdr_scrollback is another cluster's module; stub it so this case owns
  -- only the markdown-layer wiring.
  package.loaded["helpers.herdr_scrollback"] = { setup = function() end }
  rm.init()

  H.eq(rm.opts.custom_handlers.markdown.parse, require("helpers.markdown_ansi").parse,
    "the ansi SGR parser is render-markdown's custom markdown parser")
  H.eq(rm.opts.win_options.concealcursor, { default = "nvic", rendered = "nvic" },
    "rendered links stay concealed under the cursor")

  local ansi_group = vim.api.nvim_get_autocmds({ group = "RenderMarkdownAnsiColors" })
  H.eq(#ansi_group, 1, "init() installs the ansi colorscheme autocmd")
  local mermaid_ids = {}
  for _, a in ipairs(vim.api.nvim_get_autocmds({ group = "mermaid_ascii" })) do
    mermaid_ids[a.id] = true
  end
  H.eq(vim.tbl_count(mermaid_ids), 3,
    "init() registers the three mermaid auto-render autocmds (fence detection)")

  -- ── nvim-lint markdownlint wiring ────────────────────────────────────────
  local lint = entry("mfussenegger/nvim-lint")
  local md_lint = lint.opts.linters["markdownlint-cli2"]
  H.eq(md_lint.args, { "--config", fake_home .. "/.markdownlint-cli2.yaml", "-" },
    "markdownlint runs with the user config against stdin")
  vim.b.herdr_scrollback = true
  H.eq(md_lint.condition(), false, "herdr scrollback buffers skip markdownlint")
  vim.b.herdr_scrollback = nil
  H.eq(md_lint.condition(), true, "ordinary buffers lint normally")
end)

restore_snacks()
