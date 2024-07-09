local jdtls_dir = vim.fn.stdpath 'data' .. '/mason/packages/jdtls'
local config_dir = jdtls_dir .. '/config_mac'
local plugins_dir = jdtls_dir .. '/plugins'
local path_to_jar = plugins_dir .. '/org.eclipse.equinox.launcher_1.6.900.v20240613-2009.jar'
local path_to_lombok = jdtls_dir .. '/lombok.jar'

local root_markers = { 'gradlew', '.git' }
local root_dir = require('jdtls.setup').find_root(root_markers)
if root_dir == '' then
  return
end

local project_name = vim.fn.fnamemodify(vim.fn.getcwd(), ':p:h:t')
local workspace_dir = vim.fn.stdpath 'data' .. '/site/java/workspace-root/' .. project_name

local on_attach = function(client, bufnr)
  require('lsp_signature').on_attach()

  client.server_capabilities.documentFormattingProvider = false
  client.server_capabilities.documentRangeFormattingProvider = false
end

local capabilities = require('cmp_nvim_lsp').default_capabilities(vim.lsp.protocol.make_client_capabilities())
capabilities.textDocument.completion.completionItem.snippetSupport = true

local config = {
  cmd = {
    'java',
    '-Declipse.application=org.eclipse.jdt.ls.core.id1',
    '-Dosgi.bundles.defaultStartLevel=4',
    '-Declipse.product=org.eclipse.jdt.ls.core.product',
    '-Dlog.protocol=true',
    '-Dlog.level=ALL',
    '-Xmx4g',
    '-javaagent:' .. path_to_lombok,
    '--add-modules=ALL-SYSTEM',
    '--add-opens',
    'java.base/java.util=ALL-UNNAMED',
    '--add-opens',
    'java.base/java.lang=ALL-UNNAMED',
    '-jar',
    path_to_jar,
    '-configuration',
    config_dir,
    '-data',
    workspace_dir,
  },
  on_attach = on_attach,
  capabilities = capabilities,
  root_dir = root_dir,
  settings = {
    java = {
      home = '/opt/homebrew/Cellar/openjdk@21/21.0.3/libexec/openjdk.jdk/Contents/Home',
    },
    eclipse = {
      downloadSources = true,
    },
    configuration = {
      updateBuildConfiguration = 'interactive',
      runtimes = {},
    },
    maven = {
      downloadSource = true,
    },
    implementationCodeLens = {
      enabled = true,
    },
    referencesCodeLens = {
      enabled = true,
    },
    references = {
      includeDecompiledSources = true,
    },
  },
  init_options = {
    bundles = {},
  },
  flags = {
    debounce_text_changes = 150,
  },
}

return {
  'mfussenegger/nvim-jdtls',
  ft = 'java',
  config = function(_, _)
    -- Setup function
    local function jdtls_setup(_)
      local jdtls = require 'jdtls'
      jdtls.start_or_attach(config)
    end

    -- Attach to Java files
    vim.api.nvim_create_autocmd('FileType', {
      pattern = 'java',
      callback = jdtls_setup,
    })
  end,
}
