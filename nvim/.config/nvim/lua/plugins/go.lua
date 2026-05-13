-- Imports LazyVim's lang.go (gopls, conform, dap-go, neotest-golang, nvim-lint) and
-- none-ls for gomodifytags / impl. Buffer keymaps + Bazel wiring mirror java.lua / jdtls.lua.
--
-- Project root for :cd / file paths: use project.nvim + BUILD.bazel (see project.lua) when you
-- launch under rules_go dirs. For gopls: nvim-lspconfig defaults prefer go.work before go.mod; Modal
-- has go.work at the monorepo root (~/modal) but the Go module lives in ~/modal/go. Without fixing
-- root_dir, gopls attaches at ~/modal and type-check can miss sibling files under the jobs package.
--
-- GOPACKAGESDRIVER contract (default: OFF — plain `go list` is much faster, and we accept manual
-- proto regen as the trade-off):
--   unset / "" / "off"  → no driver injected (gopls + neotest both use plain `go list`)
--   "auto"              → auto-discover Bazel driver; on Modal-named workspaces this resolves
--                          to ~/.config/nvim/scripts/modal/gopackagesdriver.sh
--   "/path/to/driver"   → mirror the explicit path into settings.gopls.env
-- Flip to "auto" for a session when you need Bazel-resolved metadata (codegen-heavy packages,
-- dep-version divergence vs CI). Note: this only affects gopls; neotest's subprocesses inherit
-- vim.env, so `GOPACKAGESDRIVER=auto nvim` would NOT propagate to neotest — that's intentional.

local M = {}

local BAZEL_ROOT_MARKERS = { "MODULE.bazel", "WORKSPACE", "WORKSPACE.bazel" }

--- Walk parents from `start` for a rules_go-ish Bazel repo root.
---@param start string absolute directory
---@return string?
function M.bazel_workspace_root(start)
  if not start or start == "" then
    return nil
  end
  local dir = vim.fn.fnamemodify(start, ":p")
  dir = dir:gsub("/$", "")
  if dir == "" then
    return nil
  end
  for _ = 1, 64 do
    for _, marker in ipairs(BAZEL_ROOT_MARKERS) do
      if vim.fn.filereadable(dir .. "/" .. marker) == 1 then
        return dir
      end
    end
    local parent = vim.fs.dirname(dir)
    if parent == dir then
      break
    end
    dir = parent
  end
  return nil
end

--- Relative paths repo owners commonly use for GOPACKAGESDRIVER (rules_go wiki).
local DRIVER_REL_PATHS = {
  "tools/gopackagesdriver.sh",
  "tools/gopackagesdriver.bash",
  "tools/gopackagesdriver",
  "hack/gopackagesdriver.sh",
  "scripts/gopackagesdriver.sh",
}

--- Prefer an executable path; fallback to readable script (shell will need +x externally).
---@param monorepo string absolute workspace root containing MODULE.bazel / WORKSPACE
---@return string?
function M.gopackages_driver_path(monorepo)
  if not monorepo or monorepo == "" then
    return nil
  end
  for _, rel in ipairs(DRIVER_REL_PATHS) do
    local p = monorepo .. "/" .. rel
    if vim.fn.executable(p) == 1 then
      return vim.fn.fnamemodify(p, ":p")
    end
  end
  for _, rel in ipairs(DRIVER_REL_PATHS) do
    local p = monorepo .. "/" .. rel
    if vim.fn.filereadable(p) == 1 then
      return vim.fn.fnamemodify(p, ":p")
    end
  end
  return nil
end

--- True if ws is contained in (or walks up/down to) some go.mod/go.work subtree.
--- (gopls root may be ~/modal while go.work lives under ~/modal/go.)
---@param ws string absolute path (typically gopls workspace folder)
---@return boolean
function M.workspace_has_go_module(ws)
  if not ws or ws == "" then
    return false
  end
  return vim.fs.root(ws, "go.mod") ~= nil or vim.fs.root(ws, "go.work") ~= nil
end

local MODAL_WS_FILE_GLOBS = {
  "**/BUILD",
  "**/BUILD.bazel",
  "**/MODULE.bazel",
  "**/WORKSPACE",
  "**/WORKSPACE.bazel",
  "**/*.bzl",
}

local function modal_merge_gopls_build_settings(gps)
  local filters = vim.deepcopy(gps.directoryFilters or {})
  if not vim.tbl_contains(filters, "-bazel-modal") then
    filters[#filters + 1] = "-bazel-modal"
  end
  local wf = vim.deepcopy(gps.workspaceFiles or {})
  for _, pattern in ipairs(MODAL_WS_FILE_GLOBS) do
    if not vim.tbl_contains(wf, pattern) then
      wf[#wf + 1] = pattern
    end
  end
  return vim.tbl_deep_extend("force", gps, {
    directoryFilters = filters,
    workspaceFiles = wf,
  })
end

--- Bazel workspace directory basename is exactly `modal` (typical ~/…/modal clone).
---@param monorepo string?
---@return boolean
function M.is_modal_named_bazel_workspace(monorepo)
  if not monorepo or monorepo == "" then
    return false
  end
  return vim.fs.basename(monorepo) == "modal"
end

--- Dotfiles-hosted driver; resolves Bazel workspace at runtime (~/.config/nvim/scripts/modal/…).
---@return string?
function M.modal_dotfiles_gopackages_driver()
  local script = vim.fn.fnamemodify(vim.fs.joinpath(vim.fn.stdpath("config"), "scripts", "modal", "gopackagesdriver.sh"), ":p")
  if vim.fn.executable(script) == 1 then
    return script
  end
  return nil
end

--- Prefer the dotfiles driver when the workspace folder is literally `modal`; else repo-local paths.
---@param monorepo string?
---@return string?
function M.resolve_gopackages_driver(monorepo)
  if not monorepo then
    return nil
  end
  if M.is_modal_named_bazel_workspace(monorepo) then
    return M.modal_dotfiles_gopackages_driver()
  end
  return M.gopackages_driver_path(monorepo)
end

--- Inject GOPACKAGESDRIVER into settings.gopls.env (Go `build.env`: options embedded as `env`).
--- Default is OFF (plain `go list`). Opt in via GOPACKAGESDRIVER=auto for Bazel auto-discovery,
--- or set an explicit driver path. See the file header for the full contract.
--- See golang.org/x/tools gopls `UserOptions` / `BuildOptions.Env`.
---@param params lsp.InitializeParams
---@param config vim.lsp.ClientConfig
function M.before_init_packages_driver(params, config)
  local env_gpd = vim.env.GOPACKAGESDRIVER
  if not env_gpd or env_gpd == "" or env_gpd == "off" then
    return
  end

  local gps0 = config.settings and config.settings.gopls or {}
  local existing_top = gps0.env and gps0.env.GOPACKAGESDRIVER
  local nested_env = gps0.build and gps0.build.env
  local existing_nested = nested_env and nested_env.GOPACKAGESDRIVER
  if type(existing_top) == "string" and existing_top ~= "" then
    return
  end
  if type(existing_nested) == "string" and existing_nested ~= "" then
    return
  end

  config.settings = config.settings or {}
  config.settings.gopls = config.settings.gopls or {}

  if env_gpd ~= "auto" then
    --- Explicit path: mirror env value into settings so gopls' `go list` subprocess matches intent.
    local gps = vim.deepcopy(config.settings.gopls)
    local env = vim.deepcopy(gps.env or {})
    if env.GOPACKAGESDRIVER and env.GOPACKAGESDRIVER ~= "" then
      return
    end
    env.GOPACKAGESDRIVER = env_gpd
    config.settings.gopls = vim.tbl_deep_extend("force", gps, { env = env })
    return
  end

  local root_uri = params.rootUri ---@type string?
  if not root_uri or root_uri == vim.NIL then
    return
  end
  local ws = vim.uri_to_fname(root_uri)
  ws = vim.fn.fnamemodify(ws, ":p"):gsub("/$", "")
  if ws == "" then
    return
  end

  local monorepo = M.bazel_workspace_root(ws)
  if not monorepo or not M.workspace_has_go_module(ws) then
    return
  end

  --- Modal clone: enrich gopls Bazel knobs + GOPACKAGESDRIVER from dotfiles (before client init).
  if M.is_modal_named_bazel_workspace(monorepo) then
    config.settings.gopls = modal_merge_gopls_build_settings(vim.deepcopy(config.settings.gopls or {}))
  end

  local driver = M.resolve_gopackages_driver(monorepo)
  if not driver then
    return
  end

  local gps = vim.deepcopy(config.settings.gopls)
  local env = vim.deepcopy(gps.env or {})
  env.GOPACKAGESDRIVER = driver
  config.settings.gopls = vim.tbl_deep_extend("force", gps, { env = env })
end

--- rules_go-friendly directoryFilters added on top of LazyVim defaults; merged here so the
--- post-merge hook can re-apply if a later vim.lsp.config call wipes them.
local BAZEL_DIR_FILTERS = { "-bazel-bin", "-bazel-out", "-bazel-testlogs" }

--- Stash the wrapper we install via vim.lsp.config so a second call is a no-op
--- (BufReadPre fires per file; we don't want to grow a chain of wrappers).
M._modal_before_init_wrapper = nil

--- Idempotent post-merge hook (Approach B in the spec): wraps gopls.before_init via
--- vim.lsp.config so packagesdriver injection survives LazyVim's opts.setup.gopls chaining
--- being lost across spec merges, Lazy reload, and LspRestart cycles. Also re-extends
--- directoryFilters with rules_go artifact dirs.
function M.apply_post_merge_overrides()
  local current = vim.lsp.config["gopls"]
  if not current then
    return
  end

  local prev = current.before_init
  if prev and prev == M._modal_before_init_wrapper then
    --- Already wrapped on a prior call; bail.
    return
  end

  local function wrapper(params, config)
    if prev then
      prev(params, config)
    end
    M.before_init_packages_driver(params, config)
  end
  M._modal_before_init_wrapper = wrapper

  local cur_settings = current.settings or {}
  local cur_gopls = cur_settings.gopls or {}
  local filters = vim.deepcopy(cur_gopls.directoryFilters or {})
  for _, f in ipairs(BAZEL_DIR_FILTERS) do
    if not vim.tbl_contains(filters, f) then
      filters[#filters + 1] = f
    end
  end

  vim.lsp.config("gopls", {
    before_init = wrapper,
    settings = {
      gopls = {
        directoryFilters = filters,
      },
    },
  })
end

return {
  { import = "lazyvim.plugins.extras.lang.go" },
  { import = "lazyvim.plugins.extras.lsp.none-ls" },

  --- Drop golangci-lint as a live diagnostic source: its `typecheck` prerequisite produces
  --- false-positive "undefined" cascades on multi-module go.work workspaces (it runs from a
  --- single module root and can't see siblings). Gopls already covers in-editor type
  --- diagnostics; keep golangci-lint installed via mason for CLI / pre-commit use.
  {
    "mfussenegger/nvim-lint",
    optional = true,
    opts = function(_, opts)
      opts.linters_by_ft = opts.linters_by_ft or {}
      opts.linters_by_ft.go = nil
      return opts
    end,
  },

  {
    "neovim/nvim-lspconfig",
    init = function()
      local warned = {}

      --- When rules_go + no driver discovered and no GOPACKAGESDRIVER, nudge toward rules_go wiki.
      local function maybe_warn_bazel_go(workspace_root)
        if not workspace_root then
          return
        end
        local monorepo = M.bazel_workspace_root(workspace_root)
        if not monorepo then
          return
        end
        if not M.workspace_has_go_module(workspace_root) then
          return
        end

        --- Default is OFF; only nag when the user explicitly asked for auto-discovery
        --- but we couldn't resolve a driver to satisfy it.
        if vim.env.GOPACKAGESDRIVER ~= "auto" then
          return
        end

        if M.resolve_gopackages_driver(monorepo) then
          -- before_init will set settings.gopls.env; no editor-level warning needed.
          return
        end

        if warned[monorepo] then
          return
        end
        warned[monorepo] = true

        local hint
        if M.is_modal_named_bazel_workspace(monorepo) then
          hint =
            "Modal-named Bazel root: chmod +x the dotfiles launcher: "
              .. vim.fn.fnamemodify(vim.fs.joinpath(vim.fn.stdpath("config"), "scripts", "modal", "gopackagesdriver.sh"), ":p")
        else
          hint =
            "See https://github.com/bazelbuild/rules_go/wiki/Editor-setup#gopls — add GOPACKAGESDRIVER under the Bazel workspace."
        end
        vim.notify("Bazel + Go (" .. monorepo .. "): " .. hint, vim.log.levels.WARN)
      end

      vim.api.nvim_create_autocmd("LspAttach", {
        callback = function(args)
          local client = vim.lsp.get_client_by_id(args.data.client_id)
          if not (client and client.name == "gopls") then
            return
          end
          local root = client.root_dir
          if not root then
            root = vim.fs.dirname(vim.api.nvim_buf_get_name(args.buf))
          end
          maybe_warn_bazel_go(root)

          local map = function(lhs, rhs, desc)
            vim.keymap.set("n", lhs, rhs, { buffer = args.buf, desc = desc })
          end
          map("<leader>tg", function()
            require("neotest").run()
          end, "Go: Run nearest test (neotest)")
          map("<leader>gc", function()
            vim.cmd("!go build ./...")
          end, "Go: Build ./...")
          map("<leader>gr", "<cmd>LspRestart<cr>", "Go: Restart LSP")
        end,
      })

      --- Approach B (post-merge vim.lsp.config hook): apply our before_init wrapper *after*
      --- nvim-lspconfig (and LazyVim) have set vim.lsp.config["gopls"]. Lazy.nvim re-fires
      --- BufReadPre to other autocmd groups after loading plugins triggered by the same
      --- event, so a separate-augroup autocmd here observes the post-load state.
      local post_merge_group = vim.api.nvim_create_augroup("modal_gopls_post_merge", { clear = true })
      vim.api.nvim_create_autocmd({ "BufReadPre", "BufNewFile" }, {
        group = post_merge_group,
        pattern = { "*.go", "*.bzl", "BUILD", "BUILD.bazel" },
        callback = function()
          M.apply_post_merge_overrides()
        end,
      })
      --- :Lazy reload nvim-lspconfig recomputes vim.lsp.config["gopls"] without our wrapper;
      --- clear the sentinel and re-apply on next tick (after LazyVim's config() finishes).
      vim.api.nvim_create_autocmd("User", {
        group = post_merge_group,
        pattern = "LazyReload",
        callback = function(args)
          if args.data == "nvim-lspconfig" then
            vim.schedule(function()
              M._modal_before_init_wrapper = nil
              M.apply_post_merge_overrides()
            end)
          end
        end,
      })
    end,

    --- Prefer nearest **go.mod** over **go.work** so repos like ~/modal keep gopls at ~/modal/go
    --- when go.work wraps ./go from the parent directory. Wire `before_init` via `opts.setup.gopls`
    --- so it survives LazyVim's merge into vim.lsp.config (see docs: LazyVim lsp/configure).
    opts = function(_, opts)
      opts.servers = opts.servers or {}
      local laz = opts.servers.gopls or {}
      local laz_settings = laz.settings or {}
      local laz_gp = laz_settings.gopls or {}

      --- Keep LazyVim's directoryFilters; drop common rules_go artifact dirs inside the workspace.
      --- (tbl_deep_extend replaces list fields, so duplicate + extend manually.)
      local filters = vim.deepcopy(laz_gp.directoryFilters or {})
      vim.list_extend(filters, {
        "-bazel-bin",
        "-bazel-out",
        "-bazel-testlogs",
      })

      opts.setup = opts.setup or {}
      local prev_gopls_setup = opts.setup.gopls
      --- Stash chained before_init on the resolved vim.lsp.config entry (LazyVim calls setup(server, sopts)).
      opts.setup.gopls = function(_, sopts)
        if prev_gopls_setup then
          prev_gopls_setup(_, sopts)
        end
        local prev_bi = sopts.before_init
        sopts.before_init = function(params, config)
          if prev_bi then
            prev_bi(params, config)
          end
          M.before_init_packages_driver(params, config)
        end
      end

      opts.servers.gopls = vim.tbl_deep_extend("force", laz, {
        settings = vim.tbl_deep_extend("force", laz_settings, {
          gopls = vim.tbl_deep_extend("force", laz_gp, {
            directoryFilters = filters,
          }),
        }),
        root_dir = function(bufnr, on_dir)
          local fname = vim.api.nvim_buf_get_name(bufnr)
          fname = (fname ~= nil and fname ~= "") and vim.fn.fnamemodify(fname, ":p") or nil
          if not fname then
            on_dir(nil)
            return
          end
          local root =
            vim.fs.root(fname, "go.mod") or vim.fs.root(fname, "go.work") or vim.fs.root(fname, ".git")
          on_dir(root)
        end,
      })
      return opts
    end,
  },

  --- Drop -race from the inner TDD loop. Adapter default is { "-v", "-race", "-count=1" };
  --- -race is 2–10x slower and -count=1 disables Go's PASS cache. Use <leader>tR for
  --- a race-detect pass when you want it.
  ---
  --- Also pins neotest-golang's adapter root to the nearest go.mod (default matches
  --- go.work or go.mod and caches the first hit globally — so opening a Go file outside
  --- ~/modal/go/ once would scope the summary + run-all to the entire workspace forever).
  --- The override runs from a User LazyLoad autocmd: doing it directly via a `config`
  --- callback on neotest-golang triggered "loop or previous error loading module" because
  --- Lazy's plugin loader is mid-flight when our config fires; deferring to the post-load
  --- event sidesteps that.
  {
    "nvim-neotest/neotest",
    optional = true,
    init = function()
      vim.api.nvim_create_autocmd("User", {
        pattern = "LazyLoad",
        callback = function(args)
          if args.data ~= "neotest-golang" then
            return
          end
          local ok, ng = pcall(require, "neotest-golang")
          if ok and type(ng) == "table" then
            ng.root = function(dir)
              return vim.fs.root(dir, "go.mod")
            end
          end

          --- Scope neotest-golang's `go list` from "./..." to "." for single-file
          --- and single-test runspecs. Profile (May 2026) showed this discovery
          --- step dominates <leader>tt at 5-18s in the Modal monorepo: Go's
          --- module-graph load (go.work + sibling modules) is paid in full even
          --- when only one package's metadata is needed, and "./..." makes go list
          --- walk the whole subtree on top of that. `<leader>tT` (directory runs)
          --- keeps "./..." since it legitimately needs to enumerate sub-packages.
          ---
          --- Implementation: flip a module-local scope flag before each runspec's
          --- M.build call, restore it after. The wrapped golist_command consults
          --- the flag and rewrites the trailing "./..." arg to "." in single-
          --- package mode. Guarded by _modal_scope_patched so double-loads are
          --- a no-op.
          local cmd_ok, cmd = pcall(require, "neotest-golang.lib.cmd")
          if
            cmd_ok
            and type(cmd.golist_command) == "function"
            and not cmd._modal_scope_patched
          then
            cmd._modal_scope_patched = true
            cmd._modal_scope = "recursive"

            local original_golist_command = cmd.golist_command
            cmd.golist_command = function()
              local list = original_golist_command()
              if cmd._modal_scope == "single" and list[#list] == "./..." then
                list[#list] = "."
              end
              return list
            end

            local function require_resilient(modname)
              local ok, mod = pcall(require, modname)
              if ok then
                return true, mod
              end
              --- "loop or previous error" sticks until cleared; retry once.
              --- Defensive for long-lived nvim sessions that hit a transient
              --- init failure and cached it.
              package.loaded[modname] = nil
              return pcall(require, modname)
            end

            local function wrap_runspec(modname)
              local mod_ok, mod = require_resilient(modname)
              if not mod_ok or type(mod.build) ~= "function" then
                return
              end
              local previous_build = mod.build
              mod.build = function(...)
                local saved = cmd._modal_scope
                cmd._modal_scope = "single"
                local ok_call, a, b, c, d = pcall(previous_build, ...)
                cmd._modal_scope = saved
                if not ok_call then
                  error(a, 2)
                end
                return a, b, c, d
              end
            end

            wrap_runspec("neotest-golang.runspec.file")
            wrap_runspec("neotest-golang.runspec.test")
          end
        end,
      })
    end,
    opts = {
      adapters = {
        ["neotest-golang"] = {
          go_test_args = { "-v" },
        },
      },
      floating = { border = "rounded" },
    },
    keys = {
      {
        "<leader>tR",
        function()
          require("neotest").run.run({ extra_args = { "-race" } })
        end,
        desc = "Run Nearest with -race (Neotest)",
      },
      --- Override LazyVim's <leader>tT (vim.uv.cwd()) to resolve to the nearest go.mod
      --- from the current buffer, so "run all" works regardless of where nvim was launched.
      {
        "<leader>tT",
        function()
          local buf = vim.api.nvim_buf_get_name(0)
          local from = (buf ~= "" and vim.fn.fnamemodify(buf, ":p:h")) or vim.uv.cwd()
          local root = vim.fs.root(from, "go.mod") or from
          require("neotest").run.run(root)
        end,
        desc = "Run All Tests in Go Module (Neotest)",
      },
    },
  },
}
