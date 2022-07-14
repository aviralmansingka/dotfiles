FROM archlinux:latest

RUN pacman -Syu --noconfirm git

WORKDIR /root
RUN git clone https://github.com/aviralmansingka/dotfiles.git

WORKDIR /root/dotfiles
RUN pacman -S --noconfirm stow neovim gcc make ripgrep fd
RUN stow nvim
