-- Version detection utilities
local nvim_version = {
  has_0_10 = vim.fn.has("nvim-0.10") == 1,
  has_0_10_0 = vim.fn.has("nvim-0.10.0") == 1,
}

-- Helper function for diagnostic icon setup
local function setup_diagnostic_icons(opts)
  if nvim_version.has_0_10_0 then
    return -- Modern Neovim handles this automatically
  end

  -- Legacy icon setup for older versions
  if type(opts.diagnostics.signs) ~= "boolean" then
    for severity, icon in pairs(opts.diagnostics.signs.text) do
      local name = vim.diagnostic.severity[severity]:lower():gsub("^%l", string.upper)
      name = "DiagnosticSign" .. name
      vim.fn.sign_define(name, { text = icon, texthl = name, numhl = "" })
    end
  end
end

-- Load language server configurations from separate files
local function load_server_configs()
  local servers = {}
  local lsp_path = vim.fn.stdpath("config") .. "/lua/plugins/lsp"

  -- Get all .lua files in the lsp directory
  local files = vim.fn.globpath(lsp_path, "*.lua", false, true)

  for _, file in ipairs(files) do
    local server_name = vim.fn.fnamemodify(file, ":t:r") -- Extract filename without extension
    if server_name ~= "init" then -- Skip init.lua files
      local ok, config = pcall(require, "plugins.lsp." .. server_name)
      if ok and type(config) == "table" then
        servers[server_name] = config
      end
    end
  end

  return servers
end

return {
  "neovim/nvim-lspconfig",
  event = "LazyFile",
  dependencies = {
    "mason.nvim",
    { "mason-org/mason-lspconfig.nvim", config = function() end },
  },
  opts = function()
    ---@class PluginLspOpts
    local ret = {
      -- options for vim.diagnostic.config()
      ---@type vim.diagnostic.Opts
      diagnostics = {
        underline = true,
        update_in_insert = false,
        virtual_text = {
          spacing = 4,
          source = "if_many",
          prefix = "●", -- Simple, consistent prefix
        },
        severity_sort = true,
        signs = {
          text = {
            [vim.diagnostic.severity.ERROR] = LazyVim.config.icons.diagnostics.Error,
            [vim.diagnostic.severity.WARN] = LazyVim.config.icons.diagnostics.Warn,
            [vim.diagnostic.severity.HINT] = LazyVim.config.icons.diagnostics.Hint,
            [vim.diagnostic.severity.INFO] = LazyVim.config.icons.diagnostics.Info,
          },
        },
      },
      inlay_hints = {
        enabled = nvim_version.has_0_10,
        exclude = { "vue" }, -- filetypes for which you don't want to enable inlay hints
      },
      codelens = {
        enabled = false, -- Set to true to enable code lenses
      },
      capabilities = {
        workspace = {
          fileOperations = {
            didRename = true,
            willRename = true,
          },
        },
      },
      format = {
        formatting_options = nil,
        timeout_ms = nil,
      },
      servers = vim.tbl_extend("force", load_server_configs(), {
        -- Disable pyright in favor of basedpyright
        pyright = false,
      }),
      -- Custom server setup functions
      ---@type table<string, fun(server:string, opts:_.lspconfig.options):boolean?>
      setup = {
        -- Rust-specific setup
        rust_analyzer = function(_, opts)
          -- Custom rust-analyzer setup can go here
          require("lspconfig").rust_analyzer.setup(opts)
          return true
        end,

        -- Python-specific setup
        basedpyright = function(_, opts)
          -- Custom basedpyright setup can go here
          require("lspconfig").basedpyright.setup(opts)
          return true
        end,

        -- Bash-specific setup
        bashls = function(_, opts)
          -- Custom bashls setup can go here
          require("lspconfig").bashls.setup(opts)
          return true
        end,

        -- JSON-specific setup
        jsonls = function(_, opts)
          -- Custom jsonls setup can go here
          require("lspconfig").jsonls.setup(opts)
          return true
        end,

        -- YAML-specific setup
        yamlls = function(_, opts)
          -- Custom yamlls setup can go here
          require("lspconfig").yamlls.setup(opts)
          return true
        end,

        -- Clangd-specific setup
        clangd = function(_, opts)
          -- Custom clangd setup can go here
          require("lspconfig").clangd.setup(opts)
          return true
        end,
      },
    }
    return ret
  end,
  ---@param opts PluginLspOpts
  config = function(_, opts)
    -- setup autoformat
    LazyVim.format.register(LazyVim.lsp.formatter())

    -- setup keymaps
    LazyVim.lsp.on_attach(function(client, buffer)
      require("lazyvim.plugins.lsp.keymaps").on_attach(client, buffer)
    end)

    LazyVim.lsp.setup()
    LazyVim.lsp.on_dynamic_capability(require("lazyvim.plugins.lsp.keymaps").on_attach)

    -- Setup diagnostic signs using our helper
    setup_diagnostic_icons(opts)

    if nvim_version.has_0_10 then
      -- inlay hints
      if opts.inlay_hints.enabled then
        LazyVim.lsp.on_supports_method("textDocument/inlayHint", function(client, buffer)
          if
            vim.api.nvim_buf_is_valid(buffer)
            and vim.bo[buffer].buftype == ""
            and not vim.tbl_contains(opts.inlay_hints.exclude, vim.bo[buffer].filetype)
          then
            vim.lsp.inlay_hint.enable(true, { bufnr = buffer })
          end
        end)
      end

      -- code lens
      if opts.codelens.enabled and vim.lsp.codelens then
        LazyVim.lsp.on_supports_method("textDocument/codeLens", function(client, buffer)
          vim.lsp.codelens.refresh()
          vim.api.nvim_create_autocmd({ "BufEnter", "CursorHold", "InsertLeave" }, {
            buffer = buffer,
            callback = vim.lsp.codelens.refresh,
          })
        end)
      end
    end

    vim.diagnostic.config(vim.deepcopy(opts.diagnostics))

    local servers = opts.servers
    local has_cmp, cmp_nvim_lsp = pcall(require, "cmp_nvim_lsp")
    local has_blink, blink = pcall(require, "blink.cmp")
    local capabilities = vim.tbl_deep_extend(
      "force",
      {},
      vim.lsp.protocol.make_client_capabilities(),
      has_cmp and cmp_nvim_lsp.default_capabilities() or {},
      has_blink and blink.get_lsp_capabilities() or {},
      opts.capabilities or {}
    )

    local function setup(server)
      local server_opts = vim.tbl_deep_extend("force", {
        capabilities = vim.deepcopy(capabilities),
      }, servers[server] or {})
      if server_opts.enabled == false then
        return
      end

      if opts.setup[server] then
        if opts.setup[server](server, server_opts) then
          return
        end
      elseif opts.setup["*"] then
        if opts.setup["*"](server, server_opts) then
          return
        end
      end
      require("lspconfig")[server].setup(server_opts)
    end

    for server, server_opts in pairs(servers) do
      if server_opts then
        server_opts = server_opts == true and {} or server_opts
        if server_opts.enabled ~= false then
          setup(server)
        end
      end
    end

    if have_mason then
      mlsp.setup({
        ensure_installed = vim.tbl_deep_extend(
          "force",
          ensure_installed,
          LazyVim.opts("mason-lspconfig.nvim").ensure_installed or {}
        ),
        handlers = { setup },
      })
    end
  end,
}
