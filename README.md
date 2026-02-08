# Dotfiles

Development environment configuration for macOS and AWS devbox (Ubuntu), managed with [GNU Stow](https://www.gnu.org/software/stow/).

- **ghostty** - GPU-accelerated terminal emulator
- **zsh** - Shell with Oh My Zsh, Powerlevel10k, and plugins
- **tmux** - Terminal multiplexer with Catppuccin theme and TPM
- **neovim** - LazyVim distribution with AI coding assistance
- **aerospace** - Tiling window manager for macOS
- **starship** - Cross-shell prompt

## Setup

### Option A: macOS (local)

```sh
git clone https://github.com/aviralmansingka/dotfiles ${HOME}/dotfiles
cd ${HOME}/dotfiles/
./install.sh
```

The script installs dependencies via Homebrew, deploys configurations with `stow`, sets up shell plugins, and installs Neovim via `bob`.

For manual installation:

```sh
brew bundle
stow nvim tmux zsh ghostty git starship
```

### Option B: AWS Devbox

A fully provisioned Ubuntu 24.04 EC2 instance with all tools pre-installed. AMIs are built with Packer and the instance is managed with Terraform.

**Prerequisites:** AWS credentials configured, Terraform installed, an SSH key pair.

```sh
cd ops/devbox
terraform init
terraform apply \
  -var="devbox_enabled=true" \
  -var="ssh_public_key=$(cat ~/.ssh/id_ed25519.pub)"
```

Then SSH in:

```sh
ssh aviralmansingka@$(terraform -chdir=ops/devbox output -raw devbox_public_ip)
```

The devbox comes with: zsh + Oh My Zsh, tmux + TPM, Neovim via bob, Rust toolchain, Go, Node.js, Python, kubectl, k9s, lazygit, Claude Code, and all dotfiles stowed.

To tear down:

```sh
terraform -chdir=ops/devbox destroy \
  -var="devbox_enabled=true" \
  -var="ssh_public_key=$(cat ~/.ssh/id_ed25519.pub)"
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

AMIs and cloud infrastructure are managed in `ops/`:

- **Packer** (`ops/packer/`) - Builds Ubuntu 24.04 devbox AMIs with full development toolchain
- **Terraform** (`ops/terraform/`) - Manages shared AWS infrastructure (IAM, DNS, GitHub OIDC)
- **Devbox** (`ops/devbox/`) - Manages the devbox EC2 instance

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