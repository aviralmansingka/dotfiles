-- Neovim UI-and-bootstrap shape sweep (CI test-surface cluster 4, B-only).
--
-- Offline, headless, deterministic: every plugin spec is dofile'd as a plain
-- table under `nvim --headless -u NONE` and its opts keys are asserted
-- against the invariant list below. No plugin bootstrap, no network, no
-- live tmux/herdr, no GUI.
--
-- Regression classes this suite pins:
--   * treesitter.lua: the file's own `tbl_deep_extend` note — table opts
--     overwrite lists, so the second fragment's opts function extends the
--     first fragment's list. Before this suite, the effective merged
--     `ensure_installed` carried tsx/typescript twice (fixed alongside).
--   * config/lazy.lua: the bootstrap git-clone branch must never execute
--     offline, and `rocks.enabled == false` must hold (luarocks checkhealth
--     fix — no plugin uses luarocks, so checkhealth must not try to install
--     hererocks).
--   * config/keymaps.lua: exactly one insert-mode map exists.
--   * after/ftplugin/markdown.lua: the real FileType trigger sets tw=80,
--     colorcolumn=80, wrap.
--   * luasnippets/groovy.lua: snippet trigger/table shape through stubbed
--     LuaSnip (no LuaSnip execution).

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
local root = H.setup()

-- H.run with per-check wall-clock timing (ms) appended to the PASS line.
local function run(name, fn)
  local t0 = os.clock()
  local ok, err = xpcall(fn, debug.traceback)
  if not ok then
    io.stderr:write("FAIL ", name, "\n", tostring(err), "\n")
    os.exit(1)
  end
  print(string.format("PASS %s (%.1f ms)", name, (os.clock() - t0) * 1000))
end

-- ── colorizer.lua ─────────────────────────────────────────────────────────
run("colorizer shape", function()
  local spec = dofile(root .. "/lua/plugins/colorizer.lua")
  H.eq(spec.event, "BufReadPre", "colorizer loads before buffer read")
  H.truthy(type(spec.config) == "function", "colorizer has a config function")
  local fts = spec.opts.filetypes
  H.truthy(vim.tbl_contains(fts, "*"), "colorizer runs on all filetypes")
  H.truthy(vim.tbl_contains(fts, "!lazy"), "colorizer skips the lazy UI buffer")
  H.eq(fts.lua, { rgb_fn = true }, "lua buffers get rgb_fn detection")
  H.eq(fts.css, { rgb_fn = true }, "css buffers get rgb_fn detection")
  H.eq(fts.html, { names = false }, "html buffers do not expand color names")
  local u = spec.opts.user_default_options
  H.eq(u.RGB, true, "RGB is on")
  H.eq(u.RRGGBB, true, "RRGGBB is on")
  H.eq(u.names, true, "name swatches are on")
  H.eq(u.RRGGBBAA, true, "RRGGBBAA is on")
  H.eq(u.AARRGGBB, false, "AARRGGBB is off")
  H.eq(u.rgb_fn, false, "rgb() functions are off by default")
  H.eq(u.hsl_fn, false, "hsl() functions are off by default")
  H.eq(u.css, false, "css color vars are off by default")
  H.eq(u.css_fn, false, "css functions are off by default")
  H.eq(u.mode, "background", "colorizer paints the background")
  H.eq(u.tailwind, false, "tailwind classes are off")
  H.eq(u.sass, { enable = false }, "sass parsing is off")
  H.eq(u.virtualtext, "■", "virtual text uses the square marker")
  H.eq(u.always_update, false, "swatches update only on change")
end)

-- ── fidget.lua ────────────────────────────────────────────────────────────
run("fidget shape", function()
  local spec = dofile(root .. "/lua/plugins/fidget.lua")[1]
  H.eq(spec.event, "LspAttach", "fidget loads on LspAttach")
  local o = spec.opts
  local p = o.progress
  H.eq(p.poll_rate, 0, "progress polling is immediate")
  H.eq(p.suppress_on_insert, false, "messages show in insert mode")
  H.eq(p.ignore_done_already, false, "already-done tasks still show")
  H.eq(p.ignore_empty_message, false, "empty messages still show")
  local d = p.display
  H.eq(d.render_limit, 16, "at most 16 messages render")
  H.eq(d.done_ttl, 3, "completed messages persist 3 s")
  H.eq(d.done_icon, "✔", "completed icon is the check mark")
  H.eq(d.done_style, "Constant", "completed highlight is Constant")
  H.eq(d.progress_ttl, math.huge, "in-progress messages never expire")
  H.eq(d.progress_icon, { "dots" }, "in-progress icon animates as dots")
  H.eq(d.progress_style, "WarningMsg", "in-progress highlight is WarningMsg")
  H.eq(d.group_style, "Title", "server names render as Title")
  H.eq(d.icon_style, "Question", "icons render as Question")
  H.eq(d.priority, 30, "display priority is 30")
  H.eq(d.skip_history, true, "progress skips notification history")
  H.eq(p.lsp.progress_ringbuf_size, 0, "lsp progress ringbuffer is off")
  local n = o.notification
  H.eq(n.poll_rate, 10, "notifications update every 100 ms")
  H.eq(n.filter, vim.log.levels.INFO, "notifications start at INFO level")
  H.eq(n.history_size, 128, "history keeps 128 entries")
  H.eq(n.override_vim_notify, false, "fidget does not hijack vim.notify")
  local w = n.window
  H.eq(w.normal_hl, "Comment", "window base highlight is Comment")
  H.eq(w.winblend, 100, "window is fully transparent")
  H.eq(w.border, "none", "window has no border")
  H.eq(w.zindex, 45, "window stacks at zindex 45")
  H.eq(w.max_width, 0, "window width is auto")
  H.eq(w.max_height, 0, "window height is auto")
  H.eq(w.x_padding, 1, "one column of horizontal padding")
  H.eq(w.y_padding, 0, "no vertical padding")
  H.eq(w.align, "bottom", "window aligns to the bottom")
  H.eq(w.relative, "editor", "window is relative to the editor")
end)

-- ── trouble.lua ───────────────────────────────────────────────────────────
run("trouble shape", function()
  local spec = dofile(root .. "/lua/plugins/trouble.lua")[1]
  H.eq(spec.cmd, "Trouble", "trouble loads on the Trouble command")
  local by_lhs = {}
  for _, key in ipairs(spec.keys) do
    by_lhs[key[1]] = key
    H.truthy(key.desc and key.desc ~= "", "trouble key " .. key[1] .. " has a desc")
  end
  for _, lhs in ipairs({ "<leader>xx", "<leader>xX", "<leader>cs", "<leader>cl",
    "<leader>xL", "<leader>xQ" }) do
    H.truthy(by_lhs[lhs] ~= nil, "trouble key " .. lhs .. " is present")
  end
  local o = spec.opts
  H.eq(o.auto_close, false, "trouble does not auto-close")
  H.eq(o.auto_open, false, "trouble does not auto-open")
  H.eq(o.auto_preview, true, "trouble auto-previews items")
  H.eq(o.auto_refresh, true, "trouble auto-refreshes")
  H.eq(o.auto_jump, false, "trouble does not jump to single items")
  H.eq(o.focus, false, "trouble does not steal focus")
  H.eq(o.restore, true, "trouble restores the cursor")
  H.eq(o.follow, true, "trouble follows the cursor")
  H.eq(o.indent_guides, true, "trouble shows indent guides")
  H.eq(o.max_items, 200, "at most 200 items per section")
  H.eq(o.multiline, true, "trouble supports multi-line messages")
  H.eq(o.pinned, false, "trouble does not pin buffers")
  H.eq(o.warn_no_results, true, "trouble warns when empty")
  H.eq(o.open_no_results, false, "trouble does not open when empty")
  H.eq(o.preview.type, "main", "preview renders in the main window")
  H.eq(o.preview.scratch, true, "preview uses a scratch buffer")
  local sym = o.modes.symbols
  H.eq(sym.desc, "document symbols", "symbols mode is documented")
  H.eq(sym.mode, "lsp_document_symbols", "symbols mode reads lsp_document_symbols")
  H.eq(sym.focus, false, "symbols mode does not steal focus")
  H.eq(sym.win.position, "right", "symbols window sits right")
  H.eq(sym.win.size, 50, "symbols window is 50 wide")
  H.eq(sym.filter["not"], { ft = "lua", kind = "Package" }, "lua Package symbols are hidden")
  local ind = o.icons.indent
  H.eq(ind.top, "│ ", "indent guide: top")
  H.eq(ind.middle, "├╴", "indent guide: middle")
  H.eq(ind.last, "└╴", "indent guide: last")
  -- Private-use glyphs stay pinned as UTF-8 byte escapes so no editor or
  -- transport round trip can silently strip them.
  H.eq(ind.fold_open, "\xEF\x91\xBC ", "indent guide: fold open (U+F47C)")
  H.eq(ind.fold_closed, "\xEF\x91\xA0 ", "indent guide: fold closed (U+F460)")
  H.eq(ind.ws, "  ", "indent guide: whitespace")
  H.eq(o.icons.folder_closed, "\xEE\x97\xBF ", "folder icon: closed (U+E7DF)")
  H.eq(o.icons.folder_open, "\xEE\x97\xBE ", "folder icon: open (U+E7DE)")
  H.truthy(o.icons.kinds.Class, "kind icons table is populated")
end)

-- ── treesitter-context.lua ────────────────────────────────────────────────
run("treesitter-context shape", function()
  local spec = dofile(root .. "/lua/plugins/treesitter-context.lua")
  H.eq(spec.event, "BufReadPost", "treesitter-context loads after buffer read")
  H.eq(spec.opts.max_lines, 3, "context shows at most 3 lines")
end)

-- ── which-key.lua ─────────────────────────────────────────────────────────
run("which-key shape", function()
  local spec = dofile(root .. "/lua/plugins/which-key.lua")
  H.eq(spec.opts.spec, { { "<leader>v", group = "vault" } },
    "which-key declares exactly the vault group")
end)

-- ── snacks-picker.lua ─────────────────────────────────────────────────────
run("snacks-picker shape", function()
  local spec = dofile(root .. "/lua/plugins/snacks-picker.lua")
  local p = spec.opts.picker
  H.eq(p.enabled, true, "the snacks picker is enabled")
  H.eq(p.sources.files.hidden, true, "file search sees hidden files")
  H.eq(p.sources.files.follow, true, "file search follows symlinks")
  H.eq(p.sources.files.exclude, { ".git", "node_modules", ".DS_Store" },
    "file search excludes .git, node_modules, .DS_Store")
  H.eq(p.sources.grep.hidden, true, "grep sees hidden files")
  H.eq(p.sources.grep.follow, true, "grep follows symlinks")
  H.eq(p.formatters.file.filename_first, true, "file rows lead with the filename")
  H.eq(p.layout.preset, "telescope", "layout preset is telescope")
  H.eq(p.layout.cycle, true, "layout cycles")
  H.eq(p.layout.reverse, true, "layout is reversed")
  H.eq(p.layout.border, "rounded", "layout border is rounded")
  H.eq(p.win.input.keys["<C-b>"], false, "<C-b> is unmapped in the input window")
  H.eq(p.win.list.keys["<C-b>"], false, "<C-b> is unmapped in the list window")
  local fp = nil
  for _, key in ipairs(spec.keys) do
    if key[1] == "<leader>fp" then
      fp = key
    end
  end
  H.truthy(fp ~= nil, "the <leader>fp project key exists")
  H.eq(fp.desc, "Find Project", "the project key is documented")
end)

-- ── extend-mini-files.lua ─────────────────────────────────────────────────
run("extend-mini-files shape", function()
  local spec = dofile(root .. "/lua/plugins/extend-mini-files.lua")[1]
  H.eq(spec.opts.windows.width_preview, 60, "preview window is 60 wide")
  local key = spec.keys[1]
  H.eq(key[1], "<leader>e", "mini.files opens on <leader>e")
  H.eq(key.desc, "Open mini.files (directory of current file)", "the key is documented")
  H.truthy(type(key[2]) == "function", "the key has a handler")
end)

-- ── toggleterm.lua (OPTS shape only; terminal key behavior is live-env) ───
run("toggleterm opts shape", function()
  local spec = dofile(root .. "/lua/plugins/toggleterm.lua")[1]
  local w = spec.opts.terminal.win
  H.eq(w.position, "float", "the terminal floats")
  H.eq(w.width, 0.9, "the terminal spans 90% width")
  H.eq(w.height, 0.9, "the terminal spans 90% height")
  H.eq(w.border, "rounded", "non-GUI hosts get the rounded border")
  H.eq(w.backdrop, false, "no backdrop behind the terminal")
  H.eq(w.keys.q, "hide", "q hides the terminal")
  H.eq(w.keys["<C-]>"], "term_normal", "<C-]> returns to term normal mode")
  H.eq(spec.opts.terminal.singleton, true, "the terminal is a singleton")
  local lhs = {}
  for _, key in ipairs(spec.keys) do
    lhs[#lhs + 1] = key[1] .. ":" .. table.concat(key.mode or { "n" }, ",")
    H.truthy(key.desc and key.desc ~= "", "toggleterm key " .. key[1] .. " has a desc")
  end
  H.eq(lhs, { "<C-]>:t", "gk:n", "gG:n" }, "terminal keys: <C-]> (t), gk, gG")
end)

-- ── treesitter.lua: dedup tripwire across the two fragments ───────────────
run("treesitter ensure_installed dedup", function()
  local frags = dofile(root .. "/lua/plugins/treesitter.lua")
  H.eq(#frags, 2, "treesitter.lua ships two fragments of the same plugin")
  for i = 1, 2 do
    H.eq(frags[i][1], "nvim-treesitter/nvim-treesitter", "fragment " .. i .. " targets treesitter")
  end
  -- Simulate lazy.nvim's opts merge: the table opts deep-extend (overwriting
  -- the list), then each function opts runs in order. This is the file's own
  -- documented `tbl_deep_extend` list-overwrite behavior.
  local merged = vim.deepcopy(frags[1].opts)
  frags[2].opts({}, merged)
  H.eq(merged.ensure_installed,
    { "bash", "json", "lua", "markdown", "markdown_inline", "python", "query",
      "regex", "vim", "yaml", "toml", "tsx", "typescript" },
    "the effective parser list is pinned")
  local seen = {}
  for _, parser in ipairs(merged.ensure_installed) do
    H.truthy(not seen[parser], "no duplicate parser entry: " .. parser)
    seen[parser] = true
  end
  H.truthy(seen.tsx and seen.typescript, "tsx and typescript each install exactly once")
  -- the base table itself must also be duplicate-free
  local base_seen = {}
  for _, parser in ipairs(frags[1].opts.ensure_installed) do
    H.truthy(not base_seen[parser], "base parser list has no duplicate: " .. parser)
    base_seen[parser] = true
  end
end)

-- ── gitsigns.lua: on_attach keymap table shape ────────────────────────────
run("gitsigns on_attach shape", function()
  local spec = dofile(root .. "/lua/plugins/gitsigns.lua")[1]
  local signs = spec.opts.signs
  H.eq(signs.add.text, "┃", "add sign is the thick bar")
  H.eq(signs.change.text, "┃", "change sign is the thick bar")
  H.eq(signs.delete.text, "━", "delete sign is the heavy bar")
  H.eq(signs.topdelete.text, "━", "topdelete sign is the heavy bar")
  H.eq(signs.changedelete.text, "┃", "changedelete sign is the thick bar")
  H.truthy(type(spec.opts.on_attach) == "function", "gitsigns has an on_attach function")

  -- Stub the gitsigns module, record every keymap.set the real closure makes.
  local gs = setmetatable({}, { __index = function() return function() end end })
  package.preload["gitsigns"] = function() return gs end
  local recorded = {}
  local restore_set = H.replace(vim.keymap, "set", function(mode, lhs, rhs, opts)
    recorded[#recorded + 1] = { mode = mode, lhs = lhs, rhs = rhs, opts = opts }
  end)
  spec.opts.on_attach(42)
  restore_set()

  local by = {}
  for _, m in ipairs(recorded) do
    H.truthy(m.opts and m.opts.buffer == 42,
      "gitsigns map " .. tostring(m.lhs) .. " stays buffer-local")
    H.truthy(m.opts.desc and m.opts.desc ~= "",
      "gitsigns map " .. tostring(m.lhs) .. " has a desc")
    by[m.lhs .. "|" .. (type(m.mode) == "table" and table.concat(m.mode, ",") or m.mode)] = m
  end
  H.truthy(by["]c|n"] ~= nil, "]c navigates to the next hunk")
  H.truthy(by["[c|n"] ~= nil, "[c navigates to the previous hunk")
  H.truthy(by["<leader>hs|v"] ~= nil, "<leader>hs stages a hunk in visual mode")
  H.truthy(by["<leader>hr|v"] ~= nil, "<leader>hr resets a hunk in visual mode")
  for _, lhs in ipairs({ "<leader>hs", "<leader>hr", "<leader>hS", "<leader>hu",
    "<leader>hR", "<leader>hp", "<leader>hb", "<leader>hd", "<leader>hD",
    "<localleader>g", "<leader>tb", "<leader>tD" }) do
    H.truthy(by[lhs .. "|n"] ~= nil, "normal-mode gitsigns map " .. lhs .. " is present")
  end
  H.eq(by["]c|n"].opts.desc, "Jump to next git [c]hange", "]c desc is pinned")
  H.eq(by["<localleader>g|n"].opts.desc, "git hunk inline preview (above line)",
    "inline preview desc is pinned")
end)

-- ── config/keymaps.lua: exactly one insert-mode map ───────────────────────
run("keymaps single insert-mode map", function()
  local before = vim.api.nvim_get_keymap("i")
  dofile(root .. "/lua/config/keymaps.lua")
  local after = vim.api.nvim_get_keymap("i")
  H.eq(#after - #before, 1, "keymaps.lua adds exactly one insert-mode map")
  local map = vim.tbl_filter(function(m)
    return m.lhs == "<C-/>"
  end, after)[1]
  H.truthy(map ~= nil, "the insert-mode map is <C-/>")
  H.eq(map.rhs, "<Esc>", "<C-/> escapes insert mode")
  H.eq(map.mode, "i", "the map is insert-mode only")
end)

-- ── config/autocmds.lua: the config.indent require chain ──────────────────
run("autocmds require chain", function()
  dofile(root .. "/lua/config/autocmds.lua")
  H.truthy(package.loaded["config.indent"] ~= nil,
    "autocmds.lua requires config.indent and it resolves under -u NONE")
  local ids = {}
  for _, au in ipairs(vim.api.nvim_get_autocmds({ group = "IndentStance" })) do
    ids[au.id] = true
  end
  H.eq(vim.tbl_count(ids), 1, "the require chain registers the IndentStance augroup")
end)

-- ── after/ftplugin/markdown.lua: the real FileType trigger ────────────────
run("markdown ftplugin settings", function()
  vim.cmd("filetype plugin on")
  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_set_current_buf(buf)
  -- start from the opposite values so the flip is proof of the trigger
  vim.bo[buf].textwidth = 0
  vim.wo.colorcolumn = ""
  vim.wo.wrap = false
  vim.bo[buf].filetype = "markdown" -- fires the real FileType autocmd
  H.eq(vim.bo[buf].textwidth, 80, "markdown wraps at column 80 (buffer-local)")
  H.eq(vim.wo.colorcolumn, "80", "markdown shows the guide at column 80 (window-local)")
  H.eq(vim.wo.wrap, true, "markdown wraps soft lines (window-local)")
end)

-- ── luasnippets/groovy.lua: snippet shape via stubbed LuaSnip ─────────────
run("groovy snippet shape", function()
  package.preload["luasnip"] = function()
    return {
      snippet = function(trigger, nodes)
        return { kind = "snippet", trig = trigger.trig, dscr = trigger.dscr, nodes = nodes }
      end,
      insert_node = function(pos, default)
        return { kind = "insert", pos = pos, default = default }
      end,
      text_node = function(text)
        return { kind = "text", text = text }
      end,
    }
  end
  package.preload["luasnip.extras.fmt"] = function()
    return {
      fmt = function(fmtstr, nodes)
        return { kind = "fmt", fmt = fmtstr, nodes = nodes }
      end,
    }
  end

  local snippets = dofile(root .. "/luasnippets/groovy.lua")
  H.eq(#snippets, 13, "groovy.lua ships 13 snippets")
  local by_trig = {}
  for _, snip in ipairs(snippets) do
    H.truthy(type(snip.trig) == "string" and snip.trig ~= "" and not snip.trig:find("%s"),
      "every snippet has a single-word trigger")
    H.truthy(type(snip.dscr) == "string" and snip.dscr ~= "",
      "snippet " .. tostring(snip.trig) .. " has a description")
    H.truthy(type(snip.nodes) == "table",
      "snippet " .. tostring(snip.trig) .. " has nodes")
    H.truthy(by_trig[snip.trig] == nil, "trigger " .. tostring(snip.trig) .. " is unique")
    by_trig[snip.trig] = snip
  end
  for _, trig in ipairs({ "implementation", "testImplementation", "runtimeOnly",
    "testRuntimeOnly", "compileOnly", "compileOnlyApi", "api", "annotationProcessor",
    "testAnnotationProcessor", "developmentOnly", "deps", "repos", "plugin" }) do
    H.truthy(by_trig[trig] ~= nil, "snippet trigger " .. trig .. " is present")
  end
  -- the ten dependency snippets expand to `trigger 'group:artifact:version'`
  for _, trig in ipairs({ "implementation", "testImplementation", "runtimeOnly",
    "testRuntimeOnly", "compileOnly", "compileOnlyApi", "api", "annotationProcessor",
    "testAnnotationProcessor", "developmentOnly" }) do
    local dep = by_trig[trig]
    H.eq(dep.nodes.fmt, trig .. " '{}'", "dep snippet " .. trig .. " keeps its template")
    H.eq(dep.nodes.nodes[1].default, "group:artifact:version",
      "dep snippet " .. trig .. " defaults to the coordinate placeholder")
  end
end)

-- ── config/lazy.lua: static parts only, bootstrap branch never runs ───────
run("lazy.lua static shape", function()
  -- Point stdpath at a temp dir and fake an installed lazy.nvim so the
  -- git-clone bootstrap branch stays dead on every host.
  local tmp = vim.fn.tempname() .. "-ui-shape"
  vim.fn.mkdir(tmp, "p")
  local captured = nil
  local r_stdpath = H.replace(vim.fn, "stdpath", function() return tmp end)
  local r_loop = H.replace(vim, "loop", {
    fs_stat = function() return { type = "directory" } end,
  })
  -- Tripwire: the bootstrap branch must never run offline.
  local r_system = H.replace(vim.fn, "system", function()
    error("lazy.lua executed the git-clone bootstrap branch (network is forbidden in CI)")
  end)
  package.preload["lazy"] = function()
    return { setup = function(spec) captured = spec end }
  end

  dofile(root .. "/lua/config/lazy.lua")

  r_stdpath()
  r_loop()
  r_system()
  package.preload["lazy"] = nil

  H.truthy(captured ~= nil, "lazy.setup ran against the stubbed lazy module")
  H.eq(captured.rocks.enabled, false,
    "rocks stay disabled (luarocks checkhealth must not install hererocks)")
  H.eq(captured.defaults.lazy, false, "custom plugins load during startup")
  H.eq(captured.defaults.version, false, "plugins track the latest commit")

  local imports = {}
  for _, entry in ipairs(captured.spec) do
    if type(entry) == "table" and entry.import then
      imports[#imports + 1] = entry.import
    end
  end
  H.eq(imports, {
    "lazyvim.plugins",
    "lazyvim.plugins.extras.coding.luasnip",
    "lazyvim.plugins.extras.coding.yanky",
    "lazyvim.plugins.extras.editor.mini-files",
    "lazyvim.plugins.extras.editor.snacks_explorer",
    "lazyvim.plugins.extras.editor.snacks_picker",
    "lazyvim.plugins.extras.lang.docker",
    "lazyvim.plugins.extras.lang.git",
    "lazyvim.plugins.extras.lang.json",
    "lazyvim.plugins.extras.lang.markdown",
    "lazyvim.plugins.extras.lang.python",
    "lazyvim.plugins.extras.lang.rust",
    "lazyvim.plugins.extras.lang.toml",
    "lazyvim.plugins.extras.lang.yaml",
    "lazyvim.plugins.extras.test.core",
    "lazyvim.plugins.extras.util.dot",
    "lazyvim.plugins.extras.util.mini-hipatterns",
    "lazyvim.plugins.extras.util.octo",
    "lazyvim.plugins.extras.util.startuptime",
    "plugins",
  }, "the extras import list is pinned")
  for _, imp in ipairs(imports) do
    if imp ~= "plugins" then
      H.truthy(imp == "lazyvim.plugins" or imp:match("^lazyvim%.plugins%.[%w%-_%.]+$") ~= nil,
        "import " .. imp .. " is a valid dotted module path")
    end
  end
  H.eq(vim.fn.isdirectory(root .. "/lua/plugins"), 1,
    "the repo-owned 'plugins' import resolves in this checkout")
end)

print("ui_shape_spec: all checks passed")
