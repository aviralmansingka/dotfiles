if !exists('g:loaded_nvim_treesitter') | finish | end

lua << EOF
require 'nvim-treesitter.configs'.setup {
    highlight = {
        enable = true,
        additional_vim_regex_highlighting = false,
        disable = {}
    },
    indent = {
        enable = true,
        disable = {'java', 'yaml', 'go'}
    },
    incremental_selection = {
        enable = true,
        keymaps = {
            init_selection = "gnn",
            node_incremental = "grn",
            scope_incremental = "grc",
            node_decremental = "grm",
        }
    },
    ensure_installed = {
        "bash",
        "dockerfile",
        "go",
        "hcl",
        "java",
        "json",
        "lua",
        "proto",
        "python",
        "vim",
        "yaml",
    }
}
EOF
set foldmethod=expr
set foldexpr=nvim_treesitter#foldexpr()
