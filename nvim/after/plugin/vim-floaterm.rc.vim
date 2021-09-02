let g:floaterm_keymap_new = '<Leader>ft'
let g:floaterm_keymap_toggle = '<Leader>t'

let g:floaterm_width = 0.82
let g:floaterm_height = 0.82

nnoremap <silent> <Leader>tt <Cmd>FloatermToggle<CR>
nnoremap <silent> <Leader>tx <Cmd>FloatermKill<CR>
nnoremap <silent> <Leader>tu <Cmd>FloatermUpdate<CR>
tnoremap <silent> <Leader>tq <C-\><C-n><Cmd>FloatermHide<CR>

nnoremap <silent> <Leader>tc <Cmd>FloatermNew<CR>
nnoremap <silent> <Leader>tn <Cmd>FloatermNext<CR>
nnoremap <silent> <Leader>tp <Cmd>FloatermPrev<CR>
tnoremap <silent> <C-n> <Cmd>FloatermNext<CR>
tnoremap <silent> <C-p> <Cmd>FloatermPrev<CR>
tnoremap <silent> <C-[> <C-\><C-n>

nnoremap <silent> <Leader>tg <Cmd>LazyGit<CR>
