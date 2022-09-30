vim.cmd([[

set guifont=FiraCode\ Nerd\ Font\ Mono:h16
set laststatus=3
let g:python3_host_prog = '/usr/bin/python3'

colorscheme gruvbox

set jumpoptions+=stack
set mouse=a
set nu rnu numberwidth=4
set hidden
set lazyredraw
set scrolloff=3
set termguicolors
set foldlevelstart=1
set foldminlines=10

set wildmode=longest:full,full
set wildignore+=*.pyc,.git,.idea,*.o,*.class
set suffixes+=.pyc,.tmp,.class

" Tabs vs spaces
set expandtab
set shiftwidth=2
set softtabstop=2
set tabstop=2
set shiftround

" better search
set ignorecase
set smartcase
set hlsearch

" Use system clipboard in vim
set clipboard=unnamedplus

" pairs for % command
set matchpairs+=<:>

" no backup files
set nobackup
set noswapfile

" Move cursor to correct location on new line
set smartindent

set diffopt=filler,internal,hiddenoff,algorithm:patience,indent-heuristic

" Set characters for listing
let &showbreak = '↪ '
let &listchars = 'tab:▸ ,extends:❯,precedes:❮,nbsp:±,trail:⣿'
set list

augroup nvim_opts
  au!
  " When term opens, keep it clean
  au TermOpen * setlocal nonumber norelativenumber signcolumn=no

  " Auto-create parent directories. But not for URIs (paths containing "://").
  au BufWritePre,FileWritePre * if @% !~# '\(://\)' | call mkdir(expand('<afile>:p:h'), 'p') | endif
augroup end

set cpoptions-=a

hi! def link LspReferenceText IncSearch
hi! def link LspReferenceRead IncSearch
hi! def link LspReferenceWrite IncSearch
hi! def link LspCodeLens Include
hi! def link LspSignatureActiveParameter WarningMsg
hi! def link NormalFloat Normal

set signcolumn=auto
sign define LspDiagnosticsSignError text= texthl= linehl= numhl=ErrorMsg
sign define LspDiagnosticsSignWarning text= texthl= linehl= numhl=WarningMsg
sign define LspDiagnosticsSignInformation text= texthl= linehl= numhl=Underlined
sign define LspDiagnosticsSignHint text= texthl= linehl= numhl=Underlined

]])
