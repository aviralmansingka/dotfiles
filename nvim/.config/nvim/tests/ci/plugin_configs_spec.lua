-- Plugin CONFIG contract spec (CI row: small plugin-config contracts).
--
-- Every assert runs on the spec TABLES and pure config functions dofile'd
-- from lua/plugins/ — no plugin is ever booted, no LSP starts, no network,
-- no Mason/Lazy bootstrap. Silent-drop regression classes covered:
--   * java.lua Path monkey-patch (#29): upstream neotest-java returns
--     Path("bin") (a table) where a string is annotated; Path.new crashes
--     on `raw_path:sub` and Path:append crashes on table concat. The real
--     wrap must coerce both — and stay idempotent across a double patch.
--   * noice.lua: <C-b> deletion; signature help disabled (blink.cmp
--     owns it — the BUGS.md #3 fix).
--   * mason.lua pins (#25): basedpyright in, pyright out.
--   * conform.lua (#31): no format_on_save key (LazyVim owns the handler);
--     prettier prepend_args discovery shape; ruff venv discovery.
--   * lsp.lua: signatureHelp border wrap; lua_ls settings shape.
--   * c.lua (#187-era): clangd args, clang-format on save, pure build
--     helpers, DAP build+launch config, FileType keymap wiring.
--   * build-files.lua: server opts shape; macOS-absolute JDK path is a
--     presence-check only (host-only, never executed here).
--   * jdtls.lua: root-marker list; check_bazel_bsp warn-once-per-root.
--   * obsidian.lua (the PLUGIN spec): note_id_func kebab-case ids; shape.
--   * blink-cmp.lua: enabled()/should_show_items() pure; no phantom "git"
--     source (a nonexistent git source once broke :checkhealth).
--   * spring-boot.lua: shape.

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or ""
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
local root = H.setup()

local function plugin(name)
  return dofile(root .. "/lua/plugins/" .. name .. ".lua")
end

--- Exact-membership check for a string list.
local function has(list, item)
  for _, v in ipairs(list) do
    if v == item then
      return true
    end
  end
  return false
end

--- True when a mapping for `lhs` exists in `mode` (optional desc match).
local function has_map(mode, lhs, desc)
  for _, m in ipairs(vim.api.nvim_get_keymap(mode)) do
    if m.lhs == lhs then
      if desc ~= nil then
        H.eq(m.desc, desc, "map " .. lhs .. " in " .. mode .. " desc")
      end
      return true
    end
  end
  return false
end

-- ── java.lua: Path monkey-patch against a FAKE neotest-java.model.path ────
H.run("plugin_configs/java path coerce (#29)", function()
  -- Fake the upstream module: Path.new indexes raw_path like a string (the
  -- crash site) and Path:append concatenates `other` directly (the second
  -- crash site). The REAL config function from java.lua must wrap both.
  package.preload["neotest-java.model.path"] = function()
    local Path = {}
    local methods = {}
    local mt = { __index = methods }
    function methods.to_string(self)
      return self.raw_path
    end
    function methods.append(self, other)
      return Path.new(self.raw_path .. "/" .. other, nil)
    end
    Path.new = function(raw_path, opts)
      local _ = string.sub(raw_path, 1, 1) -- crash site: table has no :sub
      return setmetatable({ raw_path = raw_path, sep = (opts and opts.separator) and "/" or "/" }, mt)
    end
    return Path
  end

  local Path = require("neotest-java.model.path")

  -- The fake models the upstream bug: unpatched calls crash.
  local ok1 = pcall(Path.new, Path.new("bin"))
  H.eq(ok1, false, "unpatched Path.new(Path) must fail (fake models the #29 crash)")
  local ok2 = pcall(function()
    return Path.new("root"):append(Path.new("bin"))
  end)
  H.eq(ok2, false, "unpatched Path:append(Path) must fail (fake models the concat crash)")

  local java = plugin("java")
  H.eq(java[1].import, "lazyvim.plugins.extras.lang.java", "java spec imports the LazyVim extra")

  local cfg
  for _, e in ipairs(java) do
    if e[1] == "rcasia/neotest-java" then
      cfg = e.config
    end
  end
  H.truthy(cfg, "neotest-java entry exposes its config function")

  cfg() -- the real patch

  -- Path.new(Path(...)) coerces the table arg back to a string.
  H.eq(Path.new(Path.new("bin")).raw_path, "bin", "patched Path.new coerces table args")
  -- Path:append(Path(...)) coerces too (the spring-filepaths crash site).
  H.eq(Path.new("root"):append(Path.new("bin")).raw_path, "root/bin", "patched Path:append coerces table args")
  -- Plain strings still pass through.
  H.eq(Path.new("plain").raw_path, "plain", "patched Path.new keeps string args")

  -- Double-patch is idempotent: a second config run must NOT stack another
  -- wrapper layer (a :Lazy reload runs config again).
  local new_after_1 = Path.new
  local append_after_1 = getmetatable(Path.new("x")).__index.append
  cfg()
  H.eq(Path.new, new_after_1, "second patch leaves Path.new unwrapped again (idempotent)")
  H.eq(
    getmetatable(Path.new("x")).__index.append,
    append_after_1,
    "second patch leaves Path:append unwrapped again (idempotent)"
  )
  -- And behavior survives the second run.
  H.eq(Path.new(Path.new("bin")).raw_path, "bin", "coercion intact after double patch")
  H.eq(Path.new("root"):append(Path.new("bin")).raw_path, "root/bin", "append coercion intact after double patch")

  -- neotest adapter opts shape.
  for _, e in ipairs(java) do
    if e[1] == "nvim-neotest/neotest" then
      H.eq(e.opts.adapters["neotest-java"], {}, "neotest-java adapter opts are the empty default table")
    end
  end
end)

-- ── noice.lua: <C-b> deletion + signature-help fix ────────────────────────
H.run("plugin_configs/noice (BUGS.md #3 fix)", function()
  local spec = plugin("noice")
  H.eq(#spec, 1, "noice spec returns exactly one entry")
  local noice = spec[1]
  H.eq(noice[1], "folke/noice.nvim", "noice plugin name")

  -- <C-b> deletion entry for the noice scroll-map conflict.
  H.eq(#noice.keys, 1, "noice keys hold exactly the <C-b> deletion")
  local cb = noice.keys[1]
  H.eq(cb[1], "<C-b>", "deleted lhs is <C-b>")
  H.eq(cb[2], false, "<C-b> entry is a deletion (false)")
  H.eq(cb.mode, { "n", "i", "s" }, "<C-b> deletion covers n/i/s")

  -- opts: disable noice signature help (blink.cmp owns it; BUGS.md #3).
  local o = {}
  local ret = noice.opts(nil, o)
  H.eq(ret, o, "noice opts returns the same table")
  H.eq(o.lsp.signature.enabled, false, "noice signature help disabled (blink.cmp owns it)")
  H.eq(o.routes, nil, "no font-error route (Neovide removed)")
end)

-- ── mason.lua: pinned tools ───────────────────────────────────────────────
H.run("plugin_configs/mason pins (#25)", function()
  local spec = plugin("mason")
  H.eq(spec[1], "mason-org/mason.nvim", "mason plugin name")
  local list = spec.opts.ensure_installed
  H.truthy(type(list) == "table" and #list > 0, "ensure_installed is a non-empty list")
  for _, v in ipairs(list) do
    H.eq(type(v), "string", "every ensure_installed entry is a string")
  end
  H.truthy(has(list, "basedpyright"), "basedpyright pinned")
  H.truthy(has(list, "debugpy"), "debugpy pinned")
  H.truthy(has(list, "clang-format"), "clang-format pinned (c/cpp formatter)")
  H.truthy(has(list, "jdtls"), "jdtls pinned")
  H.eq(has(list, "pyright"), false, "pyright must NOT be pinned (basedpyright replaced it)")
end)

-- ── conform.lua: format_on_save gate + discovery shapes ───────────────────
H.run("plugin_configs/conform (#31)", function()
  local spec = plugin("conform")
  H.eq(spec[1], "stevearc/conform.nvim", "conform plugin name")
  local opts = spec.opts

  -- LazyVim's handler owns format_on_save; our opts must not carry the key
  -- (a stray key here silently changes format-on-save behavior).
  H.eq(opts.format_on_save, nil, "opts carry NO format_on_save key (LazyVim handler owns it)")
  H.eq(
    opts.default_format_opts,
    { timeout_ms = 2000, lsp_format = "never" },
    "default_format_opts shape"
  )

  -- prettier prepend_args discovery, exercised against a fixture tree.
  local pre = opts.formatters.prettier.prepend_args
  H.eq(type(pre), "function", "prettier prepend_args is the discovery function")
  local tmp = vim.fn.tempname() .. "-plugin-configs"
  vim.fn.mkdir(tmp, "p")
  local function mksub(name)
    local d = tmp .. "/" .. name
    vim.fn.mkdir(d, "p")
    return d
  end
  local clean = mksub("clean")
  local rc = mksub("rc")
  vim.fn.writefile({ "" }, rc .. "/.prettierrc")
  local pkgp = mksub("pkgp")
  vim.fn.writefile({ '{"prettier": {}}' }, pkgp .. "/package.json")
  local pkgn = mksub("pkgn")
  vim.fn.writefile({ '{"name": "no-prettier-key"}' }, pkgn .. "/package.json")

  H.eq(
    pre(nil, { dirname = clean }),
    { "--prose-wrap", "never" },
    "no prettier config found → unwrap prose"
  )
  H.eq(pre(nil, { dirname = rc }), {}, ".prettierrc found → project config drives wrapping")
  H.eq(
    pre(nil, { dirname = pkgp }),
    {},
    "package.json prettier key found → project config drives wrapping"
  )
  H.eq(
    pre(nil, { dirname = pkgn }),
    { "--prose-wrap", "never" },
    "package.json without prettier key → unwrap prose"
  )

  -- markdownlint-cli2 prepend_args shape (config path, host-only file).
  local ml = opts.formatters["markdownlint-cli2"].prepend_args
  H.eq(ml[1], "--config", "markdownlint-cli2 passes --config")
  H.eq(type(ml[2]), "string", "markdownlint-cli2 config path is a string")

  -- ruff venv discovery: project .venv wins, plain "ruff" otherwise.
  local vdir = mksub("venvproj")
  vim.fn.mkdir(vdir .. "/.venv/bin", "p")
  vim.fn.writefile({ "" }, vdir .. "/.venv/bin/ruff")
  for _, fmt in ipairs({ "ruff_fix", "ruff_format" }) do
    local cmd = opts.formatters[fmt].command
    H.eq(type(cmd), "function", fmt .. " command is the discovery function")
    H.eq(cmd(nil, { dirname = vdir }), vdir .. "/.venv/bin/ruff", fmt .. " finds the project venv ruff")
    H.eq(cmd(nil, { dirname = clean }), "ruff", fmt .. " falls back to Mason ruff")
  end

  -- Filetype gates: listed types get their formatter chain; non-listed
  -- types return nil (no formatter sneaks in).
  local fbf = opts.formatters_by_ft
  H.eq(fbf.markdown, { "prettier", "markdownlint-cli2" }, "markdown chain")
  H.eq(fbf.lua, { "stylua" }, "lua chain")
  H.eq(fbf.java, { "google-java-format" }, "java chain")
  H.eq(fbf.go, { "goimports", "gofumpt" }, "go chain")
  H.eq(fbf.bzl, { "buildifier" }, "bzl chain")
  H.eq(fbf.python, { "ruff_fix", "ruff_format" }, "python mirrors inv lint --fix")
  H.eq(fbf.text, nil, "text is not a listed filetype (gate returns nil)")
  H.eq(fbf.rust, nil, "rust is not a listed filetype (gate returns nil)")
end)

-- ── lsp.lua: signatureHelp border + lua_ls settings ───────────────────────
H.run("plugin_configs/lsp", function()
  local spec = plugin("lsp")
  H.eq(spec[1], "neovim/nvim-lspconfig", "lspconfig plugin name")
  H.eq(type(spec.opts), "function", "lsp opts is a function")

  -- The handler wrap: call the real assigned handler with a stubbed
  -- signature_help sink and assert the merged config shape.
  local recorded
  local restore_sh = H.replace(
    vim.lsp.handlers,
    "signature_help",
    function(_, _, _, config)
      recorded = config
    end
  )
  local o = {}
  local ret = spec.opts(nil, o)
  H.eq(ret, o, "lsp opts returns the same table")
  H.eq(
    type(vim.lsp.handlers["textDocument/signatureHelp"]),
    "function",
    "signatureHelp handler assigned"
  )
  vim.lsp.handlers["textDocument/signatureHelp"](nil, nil, nil, nil)
  H.eq(recorded, { border = "rounded" }, "nil config gets border rounded")
  vim.lsp.handlers["textDocument/signatureHelp"](nil, nil, nil, { border = "single" })
  H.eq(recorded, { border = "rounded" }, "force merge: our border wins over caller config")
  restore_sh()

  -- lua_ls settings table shape (dofile only — no LSP starts).
  local ls = o.servers.lua_ls
  H.truthy(ls, "lua_ls server configured")
  H.eq(ls.filetypes, { "lua" }, "lua_ls filetypes")
  local L = ls.settings.Lua
  H.eq(L.runtime.version, "LuaJIT", "lua_ls runtime version")
  H.eq(L.diagnostics.globals, { "vim" }, "vim is a known global")
  H.eq(L.workspace.checkThirdParty, false, "third-party check off")
  H.eq(L.codeLens.enable, true, "code lens on")
  H.eq(L.completion.callSnippet, "Replace", "call snippet replaces")
  H.eq(L.doc.privateName, { "^_" }, "private-name pattern")
  H.eq(L.hint.enable, true, "inlay hints on")
  H.eq(L.hint.setType, false, "setType hint off")
  H.eq(L.hint.paramType, true, "paramType hint on")
  H.eq(L.hint.paramName, false, "paramName hint off")
  H.eq(L.hint.semicolon, false, "semicolon hint off")
  H.eq(L.hint.arrayIndex, false, "arrayIndex hint off")
  H.eq(L.telemetry.enable, false, "telemetry off")
end)

-- ── c.lua: clangd args, formatters, pure helpers, DAP, FileType wiring ────
H.run("plugin_configs/c (#187-era)", function()
  local spec = plugin("c")
  H.eq(spec[1].import, "lazyvim.plugins.extras.lang.clangd", "c spec imports the clangd extra")
  H.eq(#spec, 5, "c spec holds 5 entries")

  -- clangd cmd override shape.
  local lsp_entry = spec[2]
  H.eq(lsp_entry[1], "neovim/nvim-lspconfig", "c lspconfig entry")
  H.eq(
    lsp_entry.opts.servers.clangd.cmd,
    {
      "clangd",
      "--background-index",
      "--clang-tidy",
      "--header-insertion=iwyu",
      "--completion-style=detailed",
      "--function-arg-placeholders=true",
      "--fallback-style=llvm",
    },
    "clangd extra args shape"
  )

  -- clang-format on save: c-family filetypes map to clang-format.
  local conf_entry = spec[3]
  H.eq(conf_entry[1], "stevearc/conform.nvim", "c conform entry")
  local fbf = conf_entry.opts.formatters_by_ft
  for _, ft in ipairs({ "c", "cpp", "objc", "objcpp" }) do
    H.eq(fbf[ft], { "clang-format" }, ft .. " formats with clang-format on save")
  end

  -- treesitter: c parser ensured via function opts (extend, not replace).
  local ts_entry = spec[4]
  local tso = {}
  ts_entry.opts(nil, tso)
  H.eq(tso.ensure_installed, { "c", "cpp" }, "treesitter ensures c and cpp")

  -- DAP entry + the build+launch config reached through the real closure.
  local dap_entry = spec[5]
  H.eq(dap_entry[1], "mfussenegger/nvim-dap", "c dap entry")
  H.eq(dap_entry.optional, true, "dap entry is optional")
  local BUILD_LAUNCH_CFG = H.upvalue(dap_entry.opts, "BUILD_LAUNCH_CFG")
  H.eq(BUILD_LAUNCH_CFG.type, "codelldb", "build+launch uses codelldb")
  H.eq(BUILD_LAUNCH_CFG.request, "launch", "build+launch is a launch request")
  H.eq(BUILD_LAUNCH_CFG.name, "C: Build & Launch current file", "build+launch config name")
  H.eq(BUILD_LAUNCH_CFG.cwd, "${workspaceFolder}", "build+launch cwd")
  H.eq(BUILD_LAUNCH_CFG.stopOnEntry, false, "build+launch does not stop on entry")
  H.eq(type(BUILD_LAUNCH_CFG.program), "function", "program resolved lazily by c_build_sync")

  -- Pure build helpers, reached through the same closure graph.
  local c_build_sync = BUILD_LAUNCH_CFG.program
  local c_compile_args = H.upvalue(c_build_sync, "c_compile_args")
  H.eq(
    c_compile_args("src.c", "out"),
    { "cc", "-g", "-O0", "-Wall", "-Wextra", "src.c", "-o", "out" },
    "compile args: debug symbols, no optimization, warnings"
  )

  -- c_source_and_binary: bufname + stdpath + mkdir stubbed (no $HOME write).
  local c_source_and_binary = H.upvalue(c_build_sync, "c_source_and_binary")
  local made = {}
  local r_mkdir = H.replace(vim.fn, "mkdir", function(dir, flags)
    made[#made + 1] = { dir, flags }
  end)
  local r_stdpath = H.replace(vim.fn, "stdpath", function(_)
    return "/tmp/fake-nvim-cache"
  end)
  local r_bufname = H.replace(vim.api, "nvim_buf_get_name", function(_)
    return "/proj/main.c"
  end)
  local src, out = c_source_and_binary()
  H.eq(src, "/proj/main.c", "source path from the buffer name")
  H.eq(out, "/tmp/fake-nvim-cache/c-build/main", "binary under cache c-build/<stem>")
  H.eq(made, { { "/tmp/fake-nvim-cache/c-build", "p" } }, "cache build dir created with mkdir p")
  r_bufname()
  local r_empty = H.replace(vim.api, "nvim_buf_get_name", function(_)
    return ""
  end)
  H.eq({ c_source_and_binary() }, { nil, nil }, "empty buffer name → nil, nil")
  r_empty()
  r_stdpath()
  r_mkdir()

  -- show_build_errors: synthetic gcc stderr → quickfix entries.
  local show_build_errors = H.upvalue(c_build_sync, "show_build_errors")
  local qf_arg, qf_mode, cmd_arg
  local r_setqf = H.replace(vim.fn, "setqflist", function(list, mode)
    qf_arg, qf_mode = list, mode
  end)
  local r_cmd = H.replace(vim, "cmd", function(x)
    cmd_arg = x
  end)
  show_build_errors("/src/main.c:12:5: error: use of undeclared identifier 'foo'\n"
    .. "plain noise line\n"
    .. "/src/main.c:13:1: warning: control reaches end of non-void function\n")
  H.eq(qf_mode, "r", "quickfix list replaced")
  H.eq(cmd_arg, "copen", "quickfix window opened")
  H.eq(qf_arg, {
    { filename = "/src/main.c", lnum = 12, col = 5, text = "error: use of undeclared identifier 'foo'" },
    { filename = "/src/main.c", lnum = 13, col = 1, text = "warning: control reaches end of non-void function" },
  }, "gcc stderr parsed; noise line dropped")
  qf_arg, qf_mode, cmd_arg = nil, nil, nil
  show_build_errors("no diagnostics here\n")
  H.eq(qf_arg, nil, "no quickfix write when nothing parses")
  H.eq(cmd_arg, nil, "no copen when nothing parses")
  r_cmd()
  r_setqf()

  -- FileType wiring: the c_lang autocmd registered at file scope binds the
  -- buffer-local <leader>C* maps and :Cbuild/:Crun/:Cdebug commands.
  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_set_current_buf(buf)
  vim.bo[buf].filetype = "c"
  local bufmaps = {}
  for _, m in ipairs(vim.api.nvim_buf_get_keymap(buf, "n")) do
    bufmaps[m.lhs] = m
  end
  -- Under -u NONE mapleader is the default "\", so <leader>Cb lands as
  -- "\Cb". Resolve the leader the same way vim.keymap.set does.
  local leader = vim.g.mapleader or "\\"
  for _, suffix in ipairs({ "Cb", "Cr", "Cd", "Ca", "Ct" }) do
    local lhs = leader .. suffix
    H.truthy(bufmaps[lhs] ~= nil, "<leader>" .. suffix .. " bound on c buffers")
    if bufmaps[lhs] then
      H.truthy(bufmaps[lhs].desc ~= "", lhs .. " carries a description")
    end
  end
  -- Buffer-local user commands: exists(':name') is 2 while the buffer is
  -- current and 0 outside it (nvim_get_commands lost its buffer filter in
  -- 0.13-dev).
  for _, name in ipairs({ "Cbuild", "Crun", "Cdebug" }) do
    H.eq(vim.fn.exists(":" .. name), 2, ":" .. name .. " registered on c buffers")
  end
  local other = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_set_current_buf(other)
  H.eq(vim.fn.exists(":Cbuild"), 0, ":Cbuild stays buffer-local (absent elsewhere)")
  vim.api.nvim_set_current_buf(buf)
end)

-- ── build-files.lua: server opts shape + host-only JDK presence ───────────
H.run("plugin_configs/build-files", function()
  local spec = plugin("build-files")
  H.eq(spec[1], "neovim/nvim-lspconfig", "build-files lspconfig entry")
  H.eq(type(spec.opts), "function", "build-files opts is a function")

  -- Host-only constants: PRESENCE-CHECK ONLY. The macOS-absolute JDK path
  -- is never executed in CI; we assert it exists in the source as written.
  local GROOVY_JAR = H.upvalue(spec.opts, "GROOVY_JAR")
  local JDK = H.upvalue(spec.opts, "JDK")
  H.eq(JDK, "/opt/homebrew/opt/openjdk@25/bin/java", "JDK path pinned (host-only, presence check)")
  H.truthy(
    GROOVY_JAR:match("/mason/packages/groovy%-language%-server/build/libs/groovy%-language%-server%-all%.jar$") ~= nil,
    "groovy jar pinned to the Mason layout"
  )

  -- Fake lspconfig.util so the groovyls branch can register offline. The
  -- resolver answers per pattern-list, so the gradle-skip gate is real.
  local by_patterns = {
    ["settings.gradle,settings.gradle.kts,build.gradle,build.gradle.kts"] = { ["/w/Foo.java"] = "/w/gradle-root" },
    ["Jenkinsfile,.git"] = { ["/w/Foo.java"] = "/w/jenkins-root" },
  }
  package.preload["lspconfig.util"] = function()
    return {
      root_pattern = function(...)
        local pats = table.concat({ ... }, ",")
        return function(fname)
          local m = by_patterns[pats]
          return m and m[fname]
        end
      end,
    }
  end

  local o = {}
  local ret = spec.opts(nil, o)
  H.eq(ret, o, "build-files opts returns the same table")

  -- gradle_ls shape.
  H.eq(o.servers.gradle_ls.init_options.settings.gradleWrapperEnabled, true, "gradle wrapper enabled")

  -- starpls shape.
  H.eq(o.servers.starpls.filetypes, { "bzl" }, "starpls owns bzl")
  H.eq(
    o.servers.starpls.root_markers,
    { "MODULE.bazel", "WORKSPACE", "WORKSPACE.bazel", ".git" },
    "starpls root markers"
  )

  -- groovyls: current truth — registered only when the Mason jar is on
  -- this host, else deliberately absent.
  if vim.fn.filereadable(GROOVY_JAR) == 1 then
    H.truthy(o.servers.groovyls, "groovyls registered when the jar is readable")
    H.eq(o.servers.groovyls.cmd, { JDK, "-jar", GROOVY_JAR }, "groovyls runs the pinned JDK + jar")
    H.eq(o.servers.groovyls.filetypes, { "groovy" }, "groovyls owns groovy only")
    H.eq(type(o.servers.groovyls.root_dir), "function", "groovyls root_dir is the gradle-skip gate")
    -- gradle project → gradle_ls owns it, groovyls declines (nil root).
    H.eq(o.servers.groovyls.root_dir("/w/Foo.java"), nil, "gradle project: groovyls declines")
    -- plain groovy/Jenkinsfile context → groovyls takes the jenkins root.
    by_patterns["settings.gradle,settings.gradle.kts,build.gradle,build.gradle.kts"] = {}
    H.eq(o.servers.groovyls.root_dir("/w/Foo.java"), "/w/jenkins-root", "Jenkinsfile context: groovyls attaches")
  else
    H.eq(o.servers.groovyls, nil, "groovyls absent when the jar is missing (host-only gate)")
  end
end)

-- ── jdtls.lua: root markers + check_bazel_bsp warn-once ───────────────────
H.run("plugin_configs/jdtls", function()
  local spec = plugin("jdtls")
  H.eq(spec[1], "mfussenegger/nvim-jdtls", "jdtls plugin name")

  -- opts against a FAKE jdtls.setup (records the marker list + fname).
  local recorded
  package.preload["jdtls.setup"] = function()
    return {
      find_root = function(markers, fname)
        recorded = { markers = markers, fname = fname }
        return "/fake/proj"
      end,
    }
  end
  local o = {}
  local ret = spec.opts(nil, o)
  H.eq(ret, o, "jdtls opts returns the same table")

  -- Root-marker list: bazel markers rank ahead of gradle/maven/git.
  local root = o.root_dir("/fake/proj/src/Main.java")
  H.eq(
    recorded.markers,
    {
      "MODULE.bazel",
      "WORKSPACE",
      "WORKSPACE.bazel",
      "build.gradle",
      "build.gradle.kts",
      "pom.xml",
      ".git",
    },
    "jdtls root-marker list"
  )
  H.eq(recorded.fname, "/fake/proj/src/Main.java", "root_dir forwards the filename")
  H.eq(root, "/fake/proj", "root_dir returns the found root")

  -- project_name / cache dirs.
  H.eq(o.project_name("/a/b/proj"), "proj", "project name is the root basename")
  H.eq(o.project_name(nil), nil, "no root → no project name")
  local cache = vim.fn.stdpath("cache")
  H.eq(o.jdtls_config_dir("proj"), cache .. "/jdtls/proj/config", "per-project config dir")
  H.eq(o.jdtls_workspace_dir("proj"), cache .. "/jdtls/proj/workspace", "per-project workspace dir")

  -- settings shape (bsp auto; both gradle+maven enabled; JDK 25 runtime).
  local java = o.settings.java
  H.eq(java.import.bsp.enabled, "auto", "bsp import auto")
  H.eq(java.import.gradle.enabled, true, "gradle import on")
  H.eq(java.import.maven.enabled, true, "maven import on")
  H.eq(java.configuration.runtimes[1].name, "JavaSE-25", "runtime name")
  H.eq(
    java.configuration.runtimes[1].path,
    "/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home",
    "runtime path (host-only, presence check)"
  )
  H.eq(java.configuration.runtimes[1].default, true, "runtime is default")
  H.eq(java.completion.guessMethodArguments, true, "guess method arguments")
  -- Both inlayhint casings + both code-lens casings are sent (jdtls docs
  -- disagree across versions; jdtls ignores the keys it does not know).
  H.eq(java.inlayhints.parameterNames.enabled, "all", "lowercase inlayhints form")
  H.eq(java.inlayHints.parameterNames.enabled, "all", "camelCase inlayHints form")
  H.eq(java.referencesCodeLens.enabled, true, "references code lens")
  H.eq(java.implementationCodeLens.enabled, true, "singular implementation code lens")
  H.eq(java.implementationsCodeLens.enabled, true, "plural implementations code lens")

  -- cmd_env: pinned JAVA_HOME + PATH prepend.
  H.eq(o.cmd_env.JAVA_HOME, "/opt/homebrew/opt/openjdk@25", "JAVA_HOME pinned")
  H.eq(
    vim.startswith(o.cmd_env.PATH, "/opt/homebrew/opt/openjdk@25/bin:"),
    true,
    "JDK bin prepended to PATH"
  )

  -- java-debug bundle appended; spring_boot pcall fails cleanly offline.
  H.eq(type(o.jdtls.init_options.bundles), "table", "debug bundle list present")

  -- check_bazel_bsp (pure, vim.fn stubbed): warn once per bazel root.
  local check = H.upvalue(spec.opts, "check_bazel_bsp")
  local calls, restore_notify = H.capture_notify()
  local readable = { ["/br-a/MODULE.bazel"] = 1, ["/br-b/WORKSPACE"] = 1 }
  local r_fr = H.replace(vim.fn, "filereadable", function(p)
    return readable[p] or 0
  end)
  local r_id = H.replace(vim.fn, "isdirectory", function(p)
    return p == "/br-d/.bsp" and 1 or 0
  end)
  local function warns_for(root_dir)
    local n = #calls
    for _, c in ipairs(calls) do
      if c.msg:find(root_dir, 1, true) then
        n = n - 1
      end
    end
    return #calls - n
  end

  check("/br-a") -- bazel root, no .bsp → warn
  H.eq(#calls, 1, "bazel root without .bsp warns once")
  H.eq(calls[1].level, vim.log.levels.WARN, "bsp warning is WARN level")
  H.truthy(calls[1].msg:find("bazel-bsp", 1, true), "warning tells how to install bazel-bsp")
  check("/br-a") -- same root again → silent (once per root)
  H.eq(#calls, 1, "second check on the same root stays silent")
  check("/br-b") -- second bazel root → its own single warning
  H.eq(warns_for("/br-b"), 1, "a different bazel root warns too")
  check("/plain") -- no bazel marker → silent
  H.eq(#calls, 2, "non-bazel root stays silent")
  -- /br-d: marker readable (add) + .bsp present → silent.
  readable["/br-d/MODULE.bazel"] = 1
  check("/br-d")
  H.eq(#calls, 2, "bazel root with .bsp stays silent")
  check(nil)
  H.eq(#calls, 2, "nil root stays silent")
  r_id()
  r_fr()
  restore_notify()

  -- init registers the reload-safe LspAttach augroup.
  spec.init()
  local autocs = vim.api.nvim_get_autocmds({ group = "jdtls_lspattach_keymaps" })
  H.eq(#autocs, 1, "exactly one jdtls LspAttach autocmd")
  H.eq(autocs[1].event, "LspAttach", "autocmd listens for LspAttach")
end)

-- ── obsidian.lua (PLUGIN spec): ids, paths, shape ─────────────────────────
H.run("plugin_configs/obsidian", function()
  local spec = plugin("obsidian")
  H.eq(spec[1], "epwalsh/obsidian.nvim", "obsidian plugin name")
  H.eq(spec.lazy, true, "obsidian is lazy")
  H.eq(spec.ft, "markdown", "obsidian loads on markdown")
  H.eq(spec.version, "*", "obsidian tracks releases")
  H.eq(spec.dependencies, { "nvim-lua/plenary.nvim" }, "plenary dependency")

  local opts = spec.opts
  H.eq(opts.workspaces[1], { name = "personal", path = "~/vault" }, "personal workspace")
  H.eq(opts.preferred_link_style, "wiki", "wiki link style")
  H.eq(opts.completion, { nvim_cmp = true, min_chars = 2 }, "completion shape")
  H.eq(opts.picker, nil, "picker disabled (snacks not supported)")
  H.eq(opts.ui.enable, false, "obsidian UI off (render-markdown owns it)")
  H.eq(opts.daily_notes.folder, "journal", "daily notes folder")
  H.eq(opts.daily_notes.template, "daily.md", "daily notes template")
  H.eq(opts.templates.folder, "templates", "templates folder")
  H.eq(opts.mappings.gf.opts, { noremap = false, expr = true, buffer = true }, "gf mapping opts")
  H.eq(opts.mappings["<cr>"].opts, { buffer = true, expr = true }, "<cr> mapping opts")

  -- note_id_func: kebab-case ids from titles.
  H.eq(opts.note_id_func("Weekly Work Log"), "weekly-work-log", "title → kebab-case id")
  H.eq(opts.note_id_func("Foo: Bar!"), "foo-bar", "punctuation stripped, spaces dashed")
  H.eq(opts.note_id_func("Étude Notes"), "tude-notes", "non-ascii letters stripped")
  local notitled = opts.note_id_func(nil)
  H.truthy(notitled:match("^%d+$") ~= nil, "no title → timestamp id")

  -- note_path_func: dir / id with an .md suffix (pathlib-style division).
  local mt = {}
  local function mk(v)
    return setmetatable({ v = v }, mt)
  end
  mt.__div = function(a, b)
    return mk(a.v .. "/" .. tostring(b))
  end
  mt.__index = function(_, k)
    if k == "with_suffix" then
      return function(self, s)
        return mk(self.v .. s)
      end
    end
  end
  local p = opts.note_path_func({ dir = mk("/vault/notes"), id = "weekly-work-log" })
  H.eq(p.v, "/vault/notes/weekly-work-log.md", "note path = dir/id.md")

  -- Keymap entries: find/grep/inbox/new/template/backlog/rename/open.
  local by_lhs = {}
  for _, k in ipairs(spec.keys) do
    by_lhs[k[1]] = k
  end
  for _, lhs in ipairs({
    "<leader>of",
    "<leader>og",
    "<leader>oi",
    "<leader>on",
    "<leader>oT",
    "<leader>vb",
    "<leader>od",
    "<leader>oy",
    "<leader>om",
    "<leader>or",
    "<leader>oo",
  }) do
    H.truthy(by_lhs[lhs] ~= nil, "obsidian key " .. lhs .. " present")
    if by_lhs[lhs] then
      H.truthy(by_lhs[lhs].desc ~= nil and by_lhs[lhs].desc ~= "", lhs .. " carries a description")
      H.truthy(by_lhs[lhs][2] ~= nil, lhs .. " carries a handler")
    end
  end
end)

-- ── blink-cmp.lua: pure gates + no phantom git source ─────────────────────
H.run("plugin_configs/blink-cmp", function()
  local spec = plugin("blink-cmp")
  H.eq(#spec, 2, "blink spec holds compat + cmp entries")
  H.eq(spec[1][1], "saghen/blink.compat", "blink.compat name")
  H.eq(spec[1].version, "2.*", "blink.compat major pin")
  H.eq(spec[1].lazy, true, "blink.compat lazy")
  H.eq(spec[1].opts, {}, "blink.compat default opts")

  local cmp = spec[2]
  H.eq(cmp[1], "saghen/blink.cmp", "blink.cmp name")
  H.eq(cmp.event, { "InsertEnter", "CmdlineEnter" }, "blink loads on insert/cmdline enter")

  -- enabled(): pure gate over vim.bo.buftype + vim.b.completion. A real
  -- terminal buftype cannot be set by user code in 0.13-dev (E474), so the
  -- gate runs against fake vim.bo / vim.b tables instead.
  local enabled = cmp.opts.enabled
  local function fake_ctx(bt, comp)
    return setmetatable({}, {
      __index = function(_, k)
        if k == "buftype" then
          return bt
        end
        if k == "completion" then
          return comp
        end
        return nil
      end,
    })
  end
  local r_bo = H.replace(vim, "bo", fake_ctx("", nil))
  local r_b = H.replace(vim, "b", fake_ctx("", nil))
  H.eq(enabled(), true, "normal buffer: completion enabled")
  H.replace(vim, "bo", fake_ctx("terminal", nil))
  H.eq(enabled(), false, "terminal buffer: completion disabled")
  H.replace(vim, "bo", fake_ctx("", nil))
  H.replace(vim, "b", fake_ctx("", false))
  H.eq(enabled(), false, "vim.b.completion = false opts out (sidekick ask prompt)")
  H.replace(vim, "b", fake_ctx("", nil))
  H.eq(enabled(), true, "opt-out is per buffer")
  r_b()
  r_bo()

  -- keymap shape.
  local km = cmp.opts.keymap
  H.eq(km.preset, "default", "default preset")
  H.eq(km["<C-b>"], false, "<C-b> freed for noice")
  H.eq(km["<C-l>"], { "snippet_forward", "fallback" }, "<C-l> snippet forward")
  H.eq(km["<C-h>"], { "snippet_backward", "fallback" }, "<C-h> snippet backward")
  H.eq(km["<Tab>"], { "select_and_accept", "fallback" }, "Tab selects and accepts")
  H.eq(km["<S-Tab>"], { "hide", "fallback" }, "Shift-Tab hides")

  -- Sources: defaults present, and NO phantom "git" provider — a
  -- nonexistent blink.cmp.sources.git module once shipped and broke
  -- :checkhealth blink.cmp.
  local srcs = cmp.opts.sources
  for _, s in ipairs({ "lsp", "path", "snippets", "buffer", "emoji", "obsidian", "obsidian_new", "obsidian_tags" }) do
    H.truthy(has(srcs.default, s), "default source " .. s .. " listed")
  end
  H.eq(srcs.providers.git, nil, "NO git provider (module does not exist; broke checkhealth)")
  H.eq(srcs.providers.emoji.module, "blink-emoji", "emoji provider module")
  H.eq(srcs.providers.emoji.score_offset, 15, "emoji score")
  for _, s in ipairs({ "obsidian", "obsidian_new", "obsidian_tags" }) do
    H.eq(srcs.providers[s].module, "blink.compat.source", s .. " runs through blink.compat")
  end

  -- should_show_items(): pure filetype gates.
  local function set_ft(ft)
    vim.o.filetype = ft
  end
  local emoji_show = srcs.providers.emoji.should_show_items
  for _, ft in ipairs({ "gitcommit", "markdown", "text" }) do
    set_ft(ft)
    H.eq(emoji_show(), true, "emoji items show for " .. ft)
  end
  set_ft("lua")
  H.eq(emoji_show(), false, "emoji items hidden for lua")
  local obs_show = srcs.providers.obsidian.should_show_items
  set_ft("markdown")
  H.eq(obs_show(), true, "obsidian items show for markdown")
  set_ft("java")
  H.eq(obs_show(), false, "obsidian items hidden for java")
  set_ft("")

  -- completion / signature shape.
  H.eq(cmp.opts.appearance.nerd_font_variant, "mono", "mono nerd font variant")
  H.eq(cmp.opts.completion.accept.auto_brackets.enabled, true, "auto brackets on")
  H.eq(cmp.opts.completion.menu.border, "rounded", "menu border")
  H.eq(cmp.opts.completion.ghost_text.enabled, false, "ghost text off")
  H.eq(cmp.opts.signature.enabled, true, "blink owns signature help (noice's is off)")
  H.eq(cmp.opts.signature.window.border, "rounded", "signature border")
  H.eq(cmp.opts.signature.window.treesitter_highlighting, true, "signature treesitter highlight")

  -- LuaSnip dependency: history + autosnippets; build string is
  -- environment-dependent (make presence), so only its type is pinned.
  local luasnip
  for _, d in ipairs(cmp.dependencies) do
    if type(d) == "table" and d[1] == "L3MON4D3/LuaSnip" then
      luasnip = d
    end
  end
  H.truthy(luasnip, "LuaSnip dependency present")
  H.eq(luasnip.opts.history, true, "LuaSnip history on")
  H.eq(luasnip.opts.enable_autosnippets, true, "LuaSnip autosnippets on")
  H.truthy(luasnip.build == nil or type(luasnip.build) == "string", "LuaSnip build is nil or a command")
end)

-- ── spring-boot.lua: shape ────────────────────────────────────────────────
H.run("plugin_configs/spring-boot", function()
  local spec = plugin("spring-boot")
  H.eq(spec[1], "JavaHello/spring-boot.nvim", "spring-boot plugin name")
  H.eq(spec.ft, { "java", "yaml", "jproperties" }, "loads on java/yaml/jproperties")
  H.eq(
    spec.dependencies,
    { "mfussenegger/nvim-jdtls", "neovim/nvim-lspconfig" },
    "depends on jdtls + lspconfig"
  )
  H.eq(spec.opts, {}, "default opts only")
end)
