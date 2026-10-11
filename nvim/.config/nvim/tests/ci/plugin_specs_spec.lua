-- Plugin SPEC tables, dofile'd as plain tables (CI row X11).
--
-- These are the silent-drop regression classes:
--   * octo.lua keys: one malformed `group=` entry killed the whole
--     <leader>O namespace (#37) and `false` deletions vanished silently.
--   * project.lua patterns: BUILD.bazel stays excluded, .git included (#33).
--   * python.lua / mason.lua pins: basedpyright present, pyright absent.
--   * go.lua: GOPACKAGESDRIVER env respect and the idempotent post-merge
--     hook (call twice, assert unchanged) — reached through the real spec
--     closures via the shared harness.

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
local root = H.setup()

local tmp = vim.fn.tempname() .. "-plugin-specs"
vim.fn.mkdir(tmp, "p")
vim.fn.mkdir(tmp .. "/noservices", "p")

H.run("plugin_specs_spec", function()
  -- ── octo.lua keys table ─────────────────────────────────────────────────
  local octo = dofile(root .. "/lua/plugins/octo.lua")
  H.truthy(octo.keys, "octo spec exposes a keys table")

  local by_lhs = {}
  for _, key in ipairs(octo.keys) do
    H.truthy(type(key[1]) == "string", "every octo key entry starts with an lhs string")
    for field in pairs(key) do
      H.ne(field, "group", string.format("octo key %s must not use group= (the #37 silent-drop class)", key[1]))
    end
    by_lhs[key[1]] = key
  end

  for _, lhs in ipairs({ "<leader>O", "<leader>OO", "<leader>Op", "<leader>OP", "<leader>Om",
    "<leader>Or", "<leader>OA", "<leader>OT", "<leader>Oc", "<leader>OC", "<leader>Ob" }) do
    local entry = by_lhs[lhs]
    H.truthy(entry ~= nil, "octo key " .. lhs .. " is present")
    H.truthy(entry.desc and entry.desc ~= "", "octo key " .. lhs .. " carries a description")
    H.truthy(entry[2] ~= nil, "octo key " .. lhs .. " carries a handler")
  end

  -- LazyVim octo-extra keys must be deleted, not shadowed.
  for _, lhs in ipairs({ "<leader>gi", "<leader>gI", "<leader>gp", "<leader>gP", "<leader>gr", "<leader>gS" }) do
    H.eq(by_lhs[lhs], { lhs, false }, "octo key " .. lhs .. " is the false deletion entry")
  end

  for _, lhs in ipairs({ "<localleader>u", "<localleader>cn", "<localleader>cq", "<localleader>cb", "<localleader>c+" }) do
    H.truthy(by_lhs[lhs] ~= nil, "octo localleader key " .. lhs .. " is present")
  end

  -- Review-buffer contract pins (#38/#39 class).
  H.eq(octo.opts.default_to_projects_v2, false, "Projects v2 fields stay off (token lacks read:project)")
  H.eq(octo.opts.use_local_fs, true, "review diffs open the working-tree file on the right side")

  -- ── project.lua patterns ────────────────────────────────────────────────
  local captured = {}
  package.loaded["project_nvim"] = {
    setup = function(opts)
      captured = opts
    end,
  }
  local project = dofile(root .. "/lua/plugins/project.lua")
  project.config()
  H.truthy(vim.tbl_contains(captured.patterns, ".git"), "project patterns include .git")
  H.truthy(vim.tbl_contains(captured.patterns, "init.lua"), "project patterns include init.lua")
  H.truthy(vim.tbl_contains(captured.patterns, "build.gradle"), "project patterns include build.gradle")
  H.truthy(not vim.tbl_contains(captured.patterns, "BUILD.bazel"),
    "project patterns exclude BUILD.bazel (roots stay at the git root)")
  H.eq(captured.detection_methods, { "pattern" }, "project detection is pattern-based")
  H.eq(captured.scope_chdir, "tab", "project chdir scope is the tab")

  -- ── mason.lua ensure-installed pins ─────────────────────────────────────
  local mason = dofile(root .. "/lua/plugins/mason.lua")
  local ensure = mason.opts.ensure_installed
  H.truthy(vim.tbl_contains(ensure, "basedpyright"), "mason pins basedpyright")
  H.truthy(not vim.tbl_contains(ensure, "pyright"), "mason does not pin pyright")
  H.truthy(vim.tbl_contains(ensure, "stylua"), "mason pins stylua")
  H.truthy(vim.tbl_contains(ensure, "ruff"), "mason pins ruff")

  -- ── python.lua server overrides ─────────────────────────────────────────
  -- Run from a clean temp cwd so the venv discovery finds nothing.
  vim.cmd("tcd " .. vim.fn.fnameescape(tmp .. "/noservices"))
  local python = dofile(root .. "/lua/plugins/python.lua")
  local lsp_entry = vim.tbl_filter(function(spec)
    return spec[1] == "neovim/nvim-lspconfig"
  end, python)[1]
  H.truthy(lsp_entry and lsp_entry.opts, "python spec has an nvim-lspconfig entry with opts")

  local opts = {}
  lsp_entry.opts({}, opts)
  H.truthy(opts.servers.basedpyright ~= nil, "python registers basedpyright")
  H.eq(opts.servers.pyright, nil, "python never registers pyright")
  H.eq(opts.servers.basedpyright.settings.basedpyright.analysis.typeCheckingMode, "standard",
    "basedpyright runs in standard mode")
  H.eq(opts.servers.basedpyright.settings.basedpyright.analysis.diagnosticMode, "openFilesOnly",
    "basedpyright only diagnoses open files")
  H.truthy(opts.servers.basedpyright.handlers["textDocument/publishDiagnostics"] ~= nil,
    "basedpyright push diagnostics are suppressed by a handler")
  H.eq(opts.servers.basedpyright.settings.python, {}, "without a venv, no pythonPath is pinned")

  -- ── go.lua: env respect + idempotent post-merge hook ────────────────────
  local go = dofile(root .. "/lua/plugins/go.lua")
  local go_lsp = vim.tbl_filter(function(spec)
    return spec[1] == "neovim/nvim-lspconfig"
  end, go)[1]
  local M = H.upvalue(go_lsp.init, "M")
  H.truthy(type(M) == "table" and type(M.before_init_packages_driver) == "function",
    "go spec closures reach the real module table")

  -- bazel_workspace_root walks real directories.
  vim.fn.mkdir(tmp .. "/modal/go", "p")
  vim.fn.writefile({ "MODULE.bazel" }, tmp .. "/modal/MODULE.bazel")
  H.eq(M.bazel_workspace_root(tmp .. "/modal/go/svc"), tmp .. "/modal",
    "bazel_workspace_root walks up to the MODULE.bazel marker")
  H.eq(M.bazel_workspace_root(tmp), nil, "a tree without markers resolves no root")
  H.eq(M.bazel_workspace_root(nil), nil, "nil resolves no root")

  -- GOPACKAGESDRIVER contract: unset/off inject nothing; an explicit path is
  -- mirrored into settings.gopls.env; auto without a root URI stays off.
  local saved_gpd = vim.env.GOPACKAGESDRIVER
  local function config_after_set(value, params)
    vim.env.GOPACKAGESDRIVER = value
    local config = { settings = { gopls = { directoryFilters = { "-keep" } } } }
    M.before_init_packages_driver(params or {}, config)
    return config
  end
  local untouched = { settings = { gopls = { directoryFilters = { "-keep" } } } }
  H.eq(config_after_set(nil), untouched, "unset GOPACKAGESDRIVER injects nothing")
  H.eq(config_after_set(""), untouched, "empty GOPACKAGESDRIVER injects nothing")
  H.eq(config_after_set("off"), untouched, "GOPACKAGESDRIVER=off injects nothing")
  H.eq(config_after_set("auto"), untouched, "auto without a root URI injects nothing")
  local mirrored = config_after_set("/opt/driver.sh")
  H.eq(mirrored.settings.gopls.env.GOPACKAGESDRIVER, "/opt/driver.sh",
    "an explicit driver path is mirrored into settings.gopls.env")
  H.eq(mirrored.settings.gopls.directoryFilters, { "-keep" },
    "mirroring keeps the rest of the gopls settings")
  -- an existing non-empty setting is respected, never overwritten
  local existing = { settings = { gopls = { env = { GOPACKAGESDRIVER = "/mine.sh" } } } }
  vim.env.GOPACKAGESDRIVER = "/opt/driver.sh"
  M.before_init_packages_driver({}, existing)
  H.eq(existing.settings.gopls.env.GOPACKAGESDRIVER, "/mine.sh",
    "a driver already set in settings is never overwritten")
  if saved_gpd == nil then
    vim.env.GOPACKAGESDRIVER = nil
  else
    vim.env.GOPACKAGESDRIVER = saved_gpd
  end

  -- Idempotent post-merge hook: register the real autocmd, fire it twice.
  local config_calls = {}
  local base_filters = { "-lazyvim", "-node_modules" }
  local saved_lsp_config = vim.lsp.config
  vim.lsp.config = setmetatable({ gopls = { settings = { gopls = { directoryFilters = base_filters } } } }, {
    __call = function(self, name, cfg)
      config_calls[#config_calls + 1] = { name = name, cfg = cfg }
      self[name] = vim.tbl_deep_extend("force", self[name] or {}, cfg)
    end,
  })
  go_lsp.init()
  vim.api.nvim_exec_autocmds("BufReadPre", { pattern = "main.go" })
  H.eq(#config_calls, 1, "the first BufReadPre applies the post-merge overrides once")
  local first = config_calls[1].cfg
  H.eq(first.settings.gopls.directoryFilters,
    { "-lazyvim", "-node_modules", "-bazel-bin", "-bazel-out", "-bazel-testlogs" },
    "the merge appends the three rules_go artifact filters")
  vim.api.nvim_exec_autocmds("BufReadPre", { pattern = "main.go" })
  vim.api.nvim_exec_autocmds("BufReadPre", { pattern = "BUILD" })
  H.eq(#config_calls, 1, "firing the hook twice changes nothing (idempotent sentinel)")
  H.eq(vim.lsp.config.gopls.settings.gopls.directoryFilters,
    { "-lazyvim", "-node_modules", "-bazel-bin", "-bazel-out", "-bazel-testlogs" },
    "the applied settings stay stable across re-fires")
  H.eq(type(vim.lsp.config.gopls.before_init), "function", "the wrapper stays installed")
  vim.lsp.config = saved_lsp_config

  -- Repo-local driver discovery under "auto" (a non-modal-named root, so
  -- no dotfiles-stdpath path is involved).
  vim.fn.mkdir(tmp .. "/bazel-ws/go", "p")
  vim.fn.writefile({ "MODULE.bazel" }, tmp .. "/bazel-ws/MODULE.bazel")
  H.eq(M.workspace_has_go_module(tmp .. "/bazel-ws/go"), false, "no go.mod means no go module")
  vim.fn.writefile({ "module example.com/svc" }, tmp .. "/bazel-ws/go/go.mod")
  H.eq(M.workspace_has_go_module(tmp .. "/bazel-ws/go"), true, "a go.mod marks the module")
  vim.fn.mkdir(tmp .. "/bazel-ws/tools", "p")
  vim.fn.writefile({ "#!/bin/sh" }, tmp .. "/bazel-ws/tools/gopackagesdriver.sh")
  H.eq(M.resolve_gopackages_driver(tmp .. "/bazel-ws"), tmp .. "/bazel-ws/tools/gopackagesdriver.sh",
    "auto-discovery prefers the repo-local tools/gopackagesdriver.sh")
  H.eq(M.is_modal_named_bazel_workspace(tmp .. "/bazel-ws"), false, "this fixture is not modal-named")
  vim.fn.mkdir(tmp .. "/modal", "p")
  H.eq(M.is_modal_named_bazel_workspace(tmp .. "/modal"), true, "modal-named roots are recognized")
  H.eq(M.is_modal_named_bazel_workspace(nil), false, "nil is never modal-named")

  -- nvim-lint entry drops go from live diagnostics.
  local lint_entry = vim.tbl_filter(function(spec)
    return spec[1] == "mfussenegger/nvim-lint"
  end, go)[1]
  local lint_opts = { linters_by_ft = { go = { "golangcilint" } } }
  lint_entry.opts({}, lint_opts)
  H.eq(lint_opts.linters_by_ft.go, nil, "golangci-lint is not a live diagnostic source")
end)
