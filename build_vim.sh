cp ./.vimrc ~/;
cp -r .vim ~/;

mkdir -p ~/.vim/colors; \
cd ~/.vim/colors; \
wget https://raw.githubusercontent.com/vim-scripts/wombat256.vim/master/colors/wombat256mod.vim;

git clone https://github.com/VundleVim/Vundle.vim.git ~/.vim/bundle/Vundle.vim
