# Dotfiles

This repository manages development environment configuration across macOS and Linux systems using [GNU Stow](https://www.gnu.org/software/stow/) for symlink management. It includes:

- **ghostty** - GPU-accelerated terminal emulator
- **zsh** - Shell with Oh My Zsh, Powerlevel10k, and plugins
- **tmux** - Terminal multiplexer with Catppuccin theme and TPM
- **neovim** - LazyVim distribution with AI coding assistance
- **aerospace** - Tiling window manager for macOS
- **starship** - Cross-shell prompt

## Quick Start

```sh
git clone https://github.com/aviralmansingka/dotfiles ${HOME}/dotfiles
cd ${HOME}/dotfiles/
./install.sh
```

The script installs dependencies via Homebrew, deploys configurations with `stow`, sets up shell plugins, and installs Neovim via `bob`.

## Manual Installation

### macOS

```sh
brew bundle
stow nvim tmux zsh ghostty git starship
```

### Ubuntu

```sh
sudo apt-get install -y git build-essential tmux stow fzf ripgrep wget tree zsh fd-find curl python3-pip
```

### RHEL/CentOS

```sh
sudo yum install -y git gcc gcc-c++ make fd stow fzf ripgrep wget tree zsh tmux
```

### Deploy Configurations

```sh
git clone https://github.com/aviralmansingka/dotfiles ${HOME}/dotfiles
cd ${HOME}/dotfiles
stow nvim tmux zsh ghostty git
```

### Shell Setup

```sh
# Oh My Zsh
sh -c "RUNZSH='no' KEEP_ZSHRC='yes' $(curl -fsSL https://raw.github.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"

# Plugins
git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/plugins/zsh-autosuggestions
git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting
```

### Tmux Setup

```sh
git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
~/.tmux/plugins/tpm/bin/install_plugins
```

## Stow Packages

| Package | Description |
|---------|-------------|
| `aerospace` | AeroSpace tiling window manager |
| `blinksh` | Blink Shell (iOS terminal) config |
| `claude` | Claude AI context files |
| `code` | Code snippets (Golang, Lua) |
| `ghostty` | Ghostty terminal emulator |
| `git` | Git configuration |
| `kube` | Kubernetes configuration |
| `neovide` | Neovide (Neovim GUI) config |
| `nvim` | Neovim with LazyVim |
| `ssh` | SSH configuration |
| `starship` | Starship prompt |
| `terminfo` | Custom terminfo entries |
| `tmux` | Tmux configuration |
| `tmuxinator` | Tmuxinator session templates |
| `zsh` | Zsh shell configuration |

## Infrastructure

Development environment AMIs and cloud infrastructure are managed in `ops/`:

- **Packer** (`ops/packer/`) - Builds Ubuntu 24.04 AMIs with full development toolchain
- **Terraform** (`ops/terraform/`) - Manages AWS infrastructure (EC2, IAM, DNS, GitHub OIDC)

CI/CD workflows automatically build AMIs and apply infrastructure changes on push to `main`.

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