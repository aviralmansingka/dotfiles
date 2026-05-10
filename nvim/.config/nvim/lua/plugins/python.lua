-- Python overrides on top of lazyvim.plugins.extras.lang.python.
-- Resolves project venv via upward search for .venv/bin/{python,ruff},
-- so basedpyright, ruff LSP, dap-python, neotest-python, and conform
-- all use the same uv-managed interpreter that workspace `.pth` files
-- target. Works for ~/modal and any future uv-workspace project; no
-- hardcoded paths.

local function find_upward(rel_path, start_dir)
  local found = vim.fs.find(rel_path, {
    upward = true,
    type = "file",
    limit = 1,
    path = start_dir or vim.fn.getcwd(),
  })
  return found[1]
end

local function find_venv_python(start_dir)
  return find_upward(".venv/bin/python", start_dir)
end

local function find_venv_ruff(start_dir)
  return find_upward(".venv/bin/ruff", start_dir)
end

-- Buffer-local keymaps for Python LSP buffers, mirroring go.lua's LspAttach
-- pattern (<leader>gr LspRestart, <leader>tT scoped to nearest go.mod).
-- Python equivalents: <leader>pr LspRestart, <leader>tT scoped to nearest
-- pyproject.toml. Buffer-local so the Python <leader>tT shadows Go's global
-- one only on *.py buffers.
local function attach_python_keymaps(bufnr)
  local function map(lhs, rhs, desc)
    vim.keymap.set("n", lhs, rhs, { buffer = bufnr, desc = desc })
  end
  map("<leader>pr", "<cmd>LspRestart<cr>", "Python: Restart LSP")
  map("<leader>tT", function()
    local buf = vim.api.nvim_buf_get_name(0)
    local from = (buf ~= "" and vim.fn.fnamemodify(buf, ":p:h")) or vim.uv.cwd()
    local root = vim.fs.root(from, "pyproject.toml") or from
    require("neotest").run.run(root)
  end, "Run All Tests in Python Project (Neotest)")
end

return {
  -- basedpyright + ruff LSP overrides.
  -- Both servers' venv binding is resolved once at plugin-load time using
  -- the cwd, then baked into static `settings` / `cmd`. on_new_config-based
  -- mutation does not reliably land for `cmd` (consumed before the hook)
  -- and was not landing for `settings.python.pythonPath` either in
  -- validation. Static resolution works because vim.g.root_spec = { "cwd" }
  -- is the user's project-root convention; switching projects = relaunch
  -- nvim or :LspRestart after :cd.
  {
    "neovim/nvim-lspconfig",
    init = function()
      vim.api.nvim_create_autocmd("LspAttach", {
        callback = function(args)
          local client = vim.lsp.get_client_by_id(args.data.client_id)
          if not client then
            return
          end
          if client.name ~= "basedpyright" and client.name ~= "ruff" then
            return
          end
          attach_python_keymaps(args.buf)
        end,
      })
    end,
    opts = function(_, opts)
      opts.servers = opts.servers or {}

      local venv_py = find_venv_python()
      local venv_ruff = find_venv_ruff()

      opts.servers.basedpyright = vim.tbl_deep_extend("force", opts.servers.basedpyright or {}, {
        settings = {
          basedpyright = {
            analysis = {
              typeCheckingMode = "standard",
              diagnosticMode = "openFilesOnly",
              useLibraryCodeForTypes = true,
              autoImportCompletions = true,
              autoSearchPaths = true,
            },
          },
          python = venv_py and { pythonPath = venv_py } or {},
        },
      })

      if venv_ruff and vim.fn.executable(venv_ruff) == 1 then
        opts.servers.ruff = vim.tbl_deep_extend("force", opts.servers.ruff or {}, {
          cmd = { venv_ruff, "server" },
        })
      end
    end,
  },

  -- nvim-dap-python: re-point at the project venv on first Python BufEnter.
  -- LazyVim's lang.python extra calls dap-python.setup("debugpy-adapter")
  -- in its config; we re-call setup() with the venv interpreter so debug
  -- sessions inherit workspace `.pth` editable installs.
  {
    "mfussenegger/nvim-dap-python",
    optional = true,
    init = function()
      local resolved_for = {}
      vim.api.nvim_create_autocmd("BufEnter", {
        pattern = "*.py",
        callback = function(args)
          local root = vim.fs.root(args.buf, { ".venv", "pyproject.toml" })
          if not root or resolved_for[root] then
            return
          end
          local venv_py = root .. "/.venv/bin/python"
          if vim.fn.executable(venv_py) == 1 then
            local ok, dap_python = pcall(require, "dap-python")
            if ok then
              dap_python.setup(venv_py)
              resolved_for[root] = true
            end
          end
        end,
      })
    end,
  },

  -- neotest-python: pin to project venv so pytest sees workspace packages
  -- and pytest plugins (asyncio, timeout, markdown-docs).
  {
    "nvim-neotest/neotest",
    optional = true,
    opts = {
      adapters = {
        ["neotest-python"] = {
          runner = "pytest",
          python = function()
            return find_venv_python() or "python"
          end,
          args = { "--no-header" },
        },
      },
    },
  },
}
