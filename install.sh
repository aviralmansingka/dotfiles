#!/bin/bash

/bin/bash -c "NONINTERACTIVE=1 $(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install all dependencies from Brewfile
brew bundle

# Get developer essentials
stow git blinksh

# Install tmux package manager
rm -rf ~/.tmux
git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
stow tmux

# Setup kitty
stow kitty

# Install oh-my-zsh
rm -rf ~/.oh-my-zsh
sh -c "RUNZSH='no' KEEP_ZSHRC='yes' $(curl -fsSL https://raw.github.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"

# Install plugins
git clone --depth=1 https://github.com/romkatv/powerlevel10k.git ${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/themes/powerlevel10k
git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/plugins/zsh-autosuggestions
git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting

rm -rf ~/.zshrc
stow zsh

# Set up EDITOR
python3 -m pip install pynvim
npm i -g neovim
stow nvim

# Language Servers
npm i -g bash-language-server                                 # Bash
npm install -g dockerfile-language-server-nodejs              # Dockerfile
go install golang.org/x/tools/gopls@latest                    # Golang
npm i -g vscode-langservers-extracted                         # HTML, JSON
go install github.com/grafana/jsonnet-language-server@latest  # JSonnet
python3 -m pip install pyright                                # Python
npm install -g solidity-language-server                       # Solidity
brew install lua-language-server                              # Lua
npm install -g @tailwindcss/language-server                   # Tailwind-CSS
brew install hashicorp/tap/terraform-ls                       # Terraform
npm install -g typescript typescript-language-server          # TypeScript
npm i -g yaml-language-server                                 # YAML

# Linters
go install golang.org/x/tools/cmd/goimports@latest
brew install tflint
