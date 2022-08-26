FROM archlinux:latest

RUN pacman -Syu --noconfirm git

WORKDIR /root
RUN git clone https://github.com/aviralmansingka/dotfiles.git

WORKDIR /root/dotfiles
RUN pacman -S --noconfirm stow neovim gcc make ripgrep fd nodejs npm wget go rust unzip luarocks zsh exa zoxide
RUN stow nvim
RUN ./install.sh
ENTRYPOINT zsh
