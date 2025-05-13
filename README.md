# Dotfiles

This repository includes the local setup that is shared across development machines. It includes:

- `kitty` (Terminal application that uses GPU to render text)
- `zsh` (`bash` replacement with a good plugin system)
- `tmux` (Terminal multiplexer that makes it easier to persistently work on remote machines)
- `neovim` ("blazingly fast" text editor written in Lua)

## Easy Installation

```sh
git clone https://github.com/aviralmansingka/dotfiles ${HOME}/dotfiles
cd ${HOME}/dotfiles/
./install.sh
```

The script does the following:

1. Install `homebrew` (works on Linux as well!)
2. Install dependencies mentioned in `Brewfile`
3. Move configuration files using `stow` to `~/`

## Manual Installation

### Clone repository

```sh
git clone https://github.com/aviralmansingka/dotfiles ${HOME}/dotfiles
cd ${HOME}/dotfiles/
```

### Dependencies

#### MacOS

```sh
brew bundle
```

#### RHEL/CentOS

```sh
sudo yum update
sudo yum install git gcc gcc-c++ make tmux fd stow fzf ripgrep wget tree zsh
```

#### Ubuntu

```sh
sudo apt update
sudo apt-get install git build-essential tmux stow fzf ripgrep wget tree zsh fd-find curl python3-pip
```

### Install Neovim

```sh
cd ${HOME}
curl -LO https://github.com/neovim/neovim/releases/download/stable/nvim-linux-arm64.tar.gz
tar xvf ${HOME}/nvim-linux-arm64.tar.gz
ln -s ${HOME}/nvim-linux-arm64/bin/nvim /usr/local/bin/
```

### Setup all tools

**note**: This introduces a lot of additional packages and configuration
required for `tmux` and `zsh`

```sh
./install.sh
```

## LICENSE

Copyright (c) 2012-2022 Scott Chacon and others

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
