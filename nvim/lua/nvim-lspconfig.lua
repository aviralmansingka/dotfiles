local lspconfig = require('lspconfig')
local protocol = require('vim.lsp.protocol')

local jdtls_mappings = {
  {"code_action", "n", "<leader><CR>",  "<Cmd>lua require'jdtls'.code_action()<CR>"},
  {"code_action", "n", "<leader>r",     "<Cmd>lua require'jdtls'.code_action(false, 'refactor')<CR>"},
  {"code_action", "v", "<leader<CR>",   "<Esc><Cmd>lua require'jdtls'.code_action(true)<CR>"},
  {"code_action", "v", "<leader>r",     "<Esc><Cmd>lua require'jdtls'.code_action(true, 'refactor')<CR>"},
  {"code_action", "n", "crv",           "<Cmd>lua require'jdtls'.extract_variable()"},
  {"code_action", "v", "crv",           "<Esc><Cmd>lua require'jdtls'.extract_variable()"},
  {"code_action", "n", "crc",           "<Cmd>lua require'jdtls'.extract_constant()"},
  {"code_action", "v", "crc",           "<Esc><Cmd>lua require'jdtls'.extract_constant()"},
  {"code_action", "n", "crm",           "<Cmd>lua require'jdtls'.extract_method()"},
  {"code_action", "v", "crm",           "<Esc><Cmd>lua require'jdtls'.extract_method()"},
}

local capability_mappings = {
  {"document_formatting",       "n", "gq",            "<Cmd>lua vim.lsp.buf.formatting()<CR>"},
  {"document_range_formatting", "v", "gq",            "<Esc><Cmd>lua vim.lsp.buf.range_formatting()<CR>"},
  {"references",                "n", "gr",            "<Cmd>lua vim.lsp.buf.references()<CR>"},
  {"hover",                     "n", "K",             "<Cmd>lua vim.lsp.buf.hover()<CR>"},
  {"definition",                "n", "gd",            "<Cmd>lua vim.lsp.buf.definition()<CR>"},
  {"implementation",            "n", "gD",            "<Cmd>lua vim.lsp.buf.implementation()<CR>"},
  {"signature_help",            "i", "<c-space>",     "<Cmd>lua vim.lsp.buf.signature_help()<CR>"},
  {"workspace_symbol",          "n", "gW",            "<Cmd>lua vim.lsp.buf.workspace_symbol()<CR>"}
}

local diagnostic_mappings = {
  {"diagnostics",         "n", "<space>", "<Cmd>lua vim.lsp.diagnostic.show_line_diagnostics()<CR>"},
  {"diagnostics",         "n", "]w",      "<Cmd>lua vim.lsp.diagnostic.goto_next()<CR>"},
  {"diagnostics",         "n", "[w",      "<Cmd>lua vim.lsp.diagnostic.goto_prev()<CR>"},
}

local on_attach = function(client, bfrnr)
    local function buf_set_keymap(...) vim.api.nvim_buf_set_keymap(bufnr, ...) end
    local function buf_set_option(...) vim.api.nvim_buf_set_option(bufnr, ...) end

    local opts = { silent = true; }
    for _, mappings in pairs(capability_mappings) do
      local capability, mode, lhs, rhs = unpack(mappings)
      if client.resolved_capabilities[capability] then
        api.nvim_buf_set_keymap(bufnr, mode, lhs, rhs, opts)
      end
    end

    if client.resolved_capabilities.document_formatting then
        vim.api.nvim_command [[augroup Format]]
        vim.api.nvim_command [[autocmd! * <buffer>]]
        vim.api.nvim_command [[autocmd! BufWritePre <buffer> lua vim.lsp.buf.formatting_seq_sync()]]
        vim.api.nvim_command [[augroup End]]
    end
end

local function jdtls_on_attach()
end

local function start_jdtls()
  local root_markers = {'gradlew', '.git'}
  local root_dir = require('jdtls.setup').find_root(root_markers)
  local home = os.getenv('HOME')
  local workspace_folder = home .. "/.local/share/eclipse/" .. vim.fn.fnamemodify(root_dir, ":p:h:t")
  local config = mk_config()
  config.settings = {
    java = {
      signatureHelp = { enabled = true };
      contentProvider = { preferred = 'fernflower' };
      sources = {
        organizeImports = {
          starThreshold = 9999;
          staticStarThreshold = 9999;
        };
      };
      codeGeneration = {
        toString = {
          template = "${object.className}{${member.name()}=${member.value}, ${otherMembers}}"
        },
        useBlocks = true,
      };
      configuration = {
        runtimes = {
          {
            name = "applejdk8",
            path = "/Library/Java/JavaVirtualMachines/applejdk-8.jdk",
          },
          {
            name = "applejdk11",
            path = "/Library/Java/JavaVirtualMachines/applejdk-11.jdk",
          },
        }
      };
    };
  };
  config.cmd = {'java-lsp.sh', workspace_folder}
  config.on_attach = on_attach
end
