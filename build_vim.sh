cp ./.vimrc ~/;
cp -r .vim ~/;

mkdir ~/.vim; \
git clone https://github.com/tomasiser/vim-code-dark && \
mv vim-code-dark/* ~/.vim;

git clone https://github.com/VundleVim/Vundle.vim.git ~/.vim/bundle/Vundle.vim
