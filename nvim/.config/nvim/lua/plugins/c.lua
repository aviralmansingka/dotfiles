-- C/C++ language overrides on top of LazyVim's lang.clangd extra.
--
-- Owns the `lazyvim.plugins.extras.lang.clangd` import (moved here from
-- lua/config/lazy.lua so C config lives in one place, matching the
-- go.lua / java.lua / python.lua pattern). The extra already wires:
--   * clangd_extensions.nvim — :ClangdSwitchSourceHeader (<leader>ch),
--     :ClangdAST, :ClangdTypeHierarchy, :ClangdSymbolInfo, :ClangdMemoryUsage.
--     (This clangd_extensions build has no inlay-hints feature; LazyVim's
--     NATIVE vim.lsp.inlay_hint handles clangd inlay hints, toggled by
--     <leader>uh — so there is no double-hint conflict.)
--   * clangd LSP — root_markers (compile_commands.json, Makefile, .git, …),
--     offsetEncoding utf-16, init_options, and a default cmd. Our spec below
--     overrides `cmd` with the captain's tuning; the rest is inherited.
--   * codelldb DAP adapter + "Launch file" / "Attach to process" configs.
--   * treesitter `cpp` parser.
-- This file adds the pieces the extra does NOT cover:
--   * clang-format on save for c/cpp (conform), respecting a project
--     .clang-format when present (no global style is imposed).
--   * the `c` treesitter parser (extra only ensures `cpp`).
--   * a "Build & Launch current file" DAP config + one-key build / run /
--     debug ergonomics under the free <leader>C namespace.
--
-- clang-tidy linting is already active via clangd's `--clang-tidy` flag
-- (built into the Mason clangd binary — no separate clang-tidy install
-- needed). It runs the checks listed in the nearest .clang-tidy; without
-- one, clangd's built-in default checks apply. We deliberately do NOT add
-- a second clang-tidy source (nvim-lint) — that would double-report.
--
-- Host prerequisites (Mason-managed, NOT system packages):
--   clangd, codelldb  — installed by the extra (mason ensure_installed).
--   clang-format      — added to mason ensure_installed in lua/plugins/mason.lua.
-- A standalone `.c` file analyzes cleanly with no compile_commands.json:
-- the Mason clangd's built-in fallback driver already resolves glibc
-- headers (/usr/include) on Linux (verified: `#include <stdio.h>` → 0
-- errors). For multi-file projects, drop a compile_commands.json (CMake
-- -DCMAKE_EXPORT_COMPILE_COMMANDS=1, or `bear -- make`) at the root —
-- clangd's root_markers pick it up automatically.

local cuda_lsp = require("helpers.cuda_lsp")

-- --- build helpers (single-file quick-iteration flow) ---------------------

--- Resolve the current buffer's source path and a cache-local binary path.
--- @return string? src, string? out
local function c_source_and_binary()
  local src = vim.api.nvim_buf_get_name(0)
  if src == "" then
    return nil, nil
  end
  local stem = vim.fn.fnamemodify(src, ":t:r")
  local out = vim.fn.stdpath("cache") .. "/c-build/" .. stem
  vim.fn.mkdir(vim.fn.fnamemodify(out, ":h"), "p")
  return src, out
end

--- Default single-file compile command. Intentionally minimal: -g for debug
--- symbols (so codelldb works), -O0 for a faithful debugging experience.
--- Multi-file / library projects should use their own build system and the
--- extra's "Launch file" DAP config (which prompts for the built executable).
local function c_compile_args(src, out)
  return { "cc", "-g", "-O0", "-Wall", "-Wextra", src, "-o", out }
end

--- Parse gcc/clang stderr into a quickfix list and populate :copen on error.
local function show_build_errors(errs)
  local qf = {}
  for line in (errs or ""):gmatch("[^\r\n]+") do
    local f, l, c, m = line:match("^([^:]+):(%d+):(%d+):%s*(.*)$")
    if f and l then
      table.insert(qf, {
        filename = f,
        lnum = tonumber(l),
        col = tonumber(c),
        text = m,
      })
    end
  end
  if #qf > 0 then
    vim.fn.setqflist(qf, "r")
    vim.cmd("copen")
  end
end

--- Build the current file synchronously, returning the binary path or nil.
--- Used by the DAP `program` resolver (dap calls it inline while launching).
--- @return string?
local function c_build_sync()
  local src, out = c_source_and_binary()
  if not src then
    vim.notify("C: save the buffer first", vim.log.levels.WARN)
    return nil
  end
  local res = vim.system(c_compile_args(src, out), { text = true }):wait()
  if res.code ~= 0 then
    vim.notify("C: build failed (exit " .. res.code .. ")", vim.log.levels.ERROR)
    show_build_errors((res.stderr or "") .. (res.stdout or ""))
    return nil
  end
  return out
end

--- Build the current file asynchronously; on success call on_success(out).
--- UI stays responsive during the compile. On error, notify + fill quickfix.
--- @param on_success? function(string)
local function c_build_async(on_success)
  local src, out = c_source_and_binary()
  if not src then
    vim.notify("C: save the buffer first", vim.log.levels.WARN)
    return
  end
  local stem = vim.fn.fnamemodify(src, ":t:r")
  vim.notify("C: building " .. stem .. " …")
  vim.system(c_compile_args(src, out), { text = true }, function(obj)
    vim.schedule(function()
      if obj.code == 0 then
        vim.notify("C: built " .. stem, vim.log.levels.INFO)
        if on_success then
          on_success(out, stem)
        end
      else
        vim.notify("C: build failed (exit " .. obj.code .. ")", vim.log.levels.ERROR)
        show_build_errors((obj.stderr or "") .. (obj.stdout or ""))
      end
    end)
  end)
end

--- The DAP config handed to nvim-dap for the build+launch flow. `program` is
--- resolved (and the file compiled) lazily by c_build_sync when dap launches.
local BUILD_LAUNCH_CFG = {
  type = "codelldb",
  request = "launch",
  name = "C: Build & Launch current file",
  program = c_build_sync,
  cwd = "${workspaceFolder}",
  stopOnEntry = false,
}

--- Run the build+launch config directly (one-step <leader>Cd). Falls back to
--- an async-build + inline launch if the config isn't registered yet (e.g.
--- before nvim-dap has been loaded by the dap core extra).
local function c_debug()
  local ok, dap = pcall(require, "dap")
  if not ok then
    vim.notify("C: nvim-dap not loaded", vim.log.levels.ERROR)
    return
  end
  for _, cfg in ipairs(dap.configurations.c or {}) do
    if cfg.name == BUILD_LAUNCH_CFG.name then
      dap.run(cfg)
      return
    end
  end
  c_build_async(function(out)
    local inline = vim.deepcopy(BUILD_LAUNCH_CFG)
    inline.program = out
    dap.run(inline)
  end)
end

--- Buffer-local commands + keymaps for c/cpp buffers. Under <leader>C, a
--- namespace free in both LazyVim and this repo (verified: no <leader>C*
--- mappings exist), so it never shadows LazyVim's <leader>c "code" prefix
--- (rename <leader>cr, diagnostics <leader>cd, header switch <leader>ch, …).
local function setup_c_buffer(bufnr)
  local function cmd(name, fn, desc)
    vim.api.nvim_buf_create_user_command(bufnr, name, fn, { desc = desc, force = true })
  end
  local function map(lhs, fn, desc)
    vim.keymap.set("n", lhs, fn, { buffer = bufnr, desc = desc, silent = true })
  end

  cmd("Cbuild", function() c_build_async() end, "C: build current file")
  cmd("Crun", function()
    c_build_async(function(out)
      vim.cmd("botright 15split | terminal " .. vim.fn.shellescape(out))
    end)
  end, "C: build + run current file in a terminal split")
  cmd("Cdebug", c_debug, "C: build + debug current file (codelldb)")

  map("<leader>Cb", function() c_build_async() end, "C: Build current file")
  map("<leader>Cr", function()
    c_build_async(function(out)
      vim.cmd("botright 15split | terminal " .. vim.fn.shellescape(out))
    end)
  end, "C: Run current file (build + terminal)")
  map("<leader>Cd", c_debug, "C: Build & Debug current file (codelldb)")
  -- Zero-cost clangd_extensions ergonomics (plugin already loaded by the extra).
  map("<leader>Ca", "<cmd>ClangdAST<cr>", "C: clangd AST view")
  map("<leader>Ct", "<cmd>ClangdTypeHierarchy<cr>", "C: clangd type hierarchy")
end

-- Register C autocmds at file scope, NOT in the nvim-lspconfig spec's `init`.
-- Lazy keeps only one `init` per merged plugin, so an `init` on nvim-lspconfig
-- here would be clobbered by other nvim-lspconfig specs (LazyVim core, go.lua,
-- python.lua each define one) — that is why the old clangd.lua's cuda LspAttach
-- never actually fired. File-scope code runs once when Lazy loads this spec,
-- eagerly at startup and before the first buffer's FileType fires, so the
-- keymaps/commands land on the initial buffer too. The `c_lang` augroup makes
-- re-evaluation (e.g. :Lazy reload) idempotent.
local c_aug = vim.api.nvim_create_augroup("c_lang", { clear = true })
vim.api.nvim_create_autocmd("LspAttach", {
  group = c_aug,
  callback = function(args)
    local client = vim.lsp.get_client_by_id(args.data.client_id)
    if not client or client.name ~= "clangd" then
      return
    end
    if vim.bo[args.buf].filetype == "cuda" then
      cuda_lsp.notify_if_unsupported(args.buf)
    end
  end,
})
-- Buffer-local C commands + keymaps on c/cpp filetypes. FileType (not
-- LspAttach) because build / run don't need an LSP server attached.
vim.api.nvim_create_autocmd("FileType", {
  group = c_aug,
  pattern = { "c", "cpp", "objc", "objcpp" },
  callback = function(args)
    setup_c_buffer(args.buf)
  end,
})

return {
  -- Owns the LazyVim clangd extra (moved from lua/config/lazy.lua).
  { import = "lazyvim.plugins.extras.lang.clangd" },

  -- clangd `cmd` override (the extra's root_markers, offsetEncoding,
  -- init_options, and <leader>ch switch-source-header keymap are inherited).
  -- CUDA host routing + C buffer keymaps are registered at file scope above
  -- (see the c_lang augroup comment) — not in `init`, which Lazy would clobber.
  {
    "neovim/nvim-lspconfig",
    opts = {
      servers = {
        clangd = {
          cmd = {
            "clangd",
            "--background-index",
            "--clang-tidy",
            "--header-insertion=iwyu",
            "--completion-style=detailed",
            "--function-arg-placeholders=true",
            "--fallback-style=llvm",
          },
        },
      },
    },
  },

  -- clang-format on save for c/cpp. conform's clang-format automatically
  -- uses the nearest .clang-format (walking upward); with none present it
  -- falls back to clang-format's built-in default (LLVM), which matches
  -- clangd's --fallback-style=llvm. No global .clang-format is shipped —
  -- imposing a house style across every C project would be a product-
  -- shaping decision left to each project.
  {
    "stevearc/conform.nvim",
    opts = {
      formatters_by_ft = {
        c = { "clang-format" },
        cpp = { "clang-format" },
        objc = { "clang-format" },
        objcpp = { "clang-format" },
      },
    },
  },

  -- Ensure the `c` parser is installed (the extra only ensures `cpp`).
  -- Uses the function-opts form so ensure_installed is extended, not
  -- replaced — see the note in treesitter.lua about vim.tbl_deep_extend
  -- and list fields.
  {
    "nvim-treesitter/nvim-treesitter",
    opts = function(_, opts)
      opts.ensure_installed = opts.ensure_installed or {}
      vim.list_extend(opts.ensure_installed, { "c", "cpp" })
    end,
  },

  -- clang-format is Mason-installed via the central ensure_installed list in
  -- lua/plugins/mason.lua (clangd + codelldb are already ensured by the
  -- extra). Mason prepends its bin dir to PATH inside Neovim, so conform finds
  -- clang-format. This is NOT a system package install.

  -- Prepend "Build & Launch current file" to the c/cpp DAP configs the extra
  -- registered ("Launch file", "Attach to process"). Idempotent and order-
  -- safe: runs after the extra's dap opts (this spec follows the import) and
  -- guards by name, so a :Lazy reload or LspRestart won't stack duplicates.
  -- The codelldb adapter is re-ensured defensively in case the extra's dap
  -- opts haven't run yet.
  {
    "mfussenegger/nvim-dap",
    optional = true,
    opts = function()
      local dap = require("dap")
      if not dap.adapters.codelldb then
        dap.adapters.codelldb = {
          type = "server",
          host = "localhost",
          port = "${port}",
          executable = { command = "codelldb", args = { "--port", "${port}" } },
        }
      end
      for _, lang in ipairs({ "c", "cpp" }) do
        dap.configurations[lang] = dap.configurations[lang] or {}
        local present = false
        for _, cfg in ipairs(dap.configurations[lang]) do
          if cfg.name == BUILD_LAUNCH_CFG.name then
            present = true
            break
          end
        end
        if not present then
          table.insert(dap.configurations[lang], 1, BUILD_LAUNCH_CFG)
        end
      end
    end,
  },

}
