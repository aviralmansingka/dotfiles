# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Purpose

This is a dotfiles repository that manages development environment configuration across macOS and Linux systems using GNU Stow for symlink management. It configures terminal emulators, shells, editors, and development tools for a consistent coding environment.

## Installation Commands

### Full Environment Setup
```bash
# Complete automated installation
./install.sh

# Manual installation with stow
brew bundle                    # Install dependencies from Brewfile
stow nvim tmux zsh ghostty git kube tmuxinator
```

### Component Installation
```bash
# Individual tools (use stow for each)
stow zsh          # Deploy zsh configuration
stow tmux         # Deploy tmux configuration
stow nvim         # Deploy Neovim/LazyVim configuration
stow ghostty      # Deploy Ghostty terminal configuration
stow git          # Deploy git configuration
stow starship     # Deploy Starship prompt configuration
stow aerospace    # Deploy AeroSpace window manager configuration
```

### Plugin Management
```bash
# Tmux plugins (after tmux config is stowed)
~/.tmux/plugins/tpm/bin/install_plugins

# Zsh plugins (handled automatically by install.sh)
# Oh My Zsh + Powerlevel10k + autosuggestions + syntax highlighting
```

## Architecture

### Stow-Based Structure
Each tool has its own directory containing dotfiles in their target path structure:
- `nvim/.config/nvim/` → `~/.config/nvim/`
- `zsh/.zshrc` → `~/.zshrc`
- `tmux/.tmux.conf` → `~/.tmux.conf`
- `ghostty/.config/ghostty/` → `~/.config/ghostty/`

### Stow Packages
- **aerospace** - AeroSpace tiling window manager
- **blinksh** - Blink Shell (iOS terminal) configuration
- **claude** - Claude AI context files
- **code** - Code snippets (Golang, Lua)
- **ghostty** - Ghostty terminal emulator
- **git** - Git configuration
- **kube** - Kubernetes configuration
- **neovide** - Neovide (Neovim GUI) configuration
- **nvim** - Neovim with LazyVim distribution
- **ssh** - SSH configuration
- **starship** - Starship prompt
- **terminfo** - Custom terminfo entries (xterm-ghostty)
- **tmux** - Tmux configuration
- **tmuxinator** - Tmuxinator session templates
- **zsh** - Zsh shell configuration

### Key Configuration Patterns

**Zsh Configuration:**
- Powerlevel10k theme with instant prompt
- Extensive Kubernetes aliases (k, kgp, kgs, etc.)
- Python virtual environment integration via pyenv
- Development tools in PATH (Go, Rust, Node, Java)

**Tmux Configuration:**
- Catppuccin theme (macchiato)
- Custom prefix: Ctrl-A
- Vim-style pane navigation (h/j/k/l)
- Plugin ecosystem via TPM

**Neovim (LazyVim):**
- LazyVim distribution with extensive plugins
- AI coding assistance (Avante plugin)
- Language support for Python, Golang, Lua, Markdown
- Session persistence and project management

### Development Dependencies

**Languages:** Go, Rust, Node.js, Python (via pyenv), Lua
**Cloud Tools:** AWS CLI, kubectl, kubectx, k9s, Docker
**Terminal Tools:** fd, fzf, ripgrep, eza, lazygit, tig
**Fonts:** JetBrains Mono, Meslo LG, Fira Code (Nerd Font variants)

## Infrastructure (ops/)

### Packer (`ops/packer/`)
Builds Ubuntu 24.04 development AMIs with a multi-phase provisioning pipeline:
1. System packages → Rust toolchain → CLI tools → Dotfiles deployment → Shell plugins → Cleanup
2. Includes a validation script that checks 20+ tools post-build

### Terraform (`ops/terraform/`)
Manages AWS infrastructure for the devbox:
- EC2 instance with conditional `devbox_enabled` flag
- IAM roles, security groups, DNS, GitHub OIDC integration

### CI/CD Workflows (`.github/workflows/`)
- **Packer** (`packer.yml`) - Builds AMI on push to `main` (when `ops/packer/**` changes), validates via temporary EC2 instance
- **Terraform** (`terraform.yml`) - Plans on PR, applies on push to `main` (when `ops/terraform/**` changes)

## Dependency Management

### Centralized Package Configuration
All dependencies are managed centrally in `dependencies.yml` / `dependencies.json`:

```yaml
categories:
  core: [git, curl, zsh, tmux, neovim, stow]
  development: [gcc, make, build-essential]
  languages: [golang, python3, nodejs, rust]
  tools: [fd, ripgrep, fzf, lazygit]
```

### Generating Platform-Specific Files
```bash
# Generate Brewfile from dependencies
python3 scripts/install_deps.py --os macos --format brewfile > Brewfile
# Or use the convenience script:
./scripts/generate-brewfile.sh

# Generate Dockerfile commands
python3 scripts/install_deps.py --os ubuntu --format dockerfile
python3 scripts/install_deps.py --os centos --format dockerfile
python3 scripts/install_deps.py --os alpine --format dockerfile
```

## Working with This Repository

### Modifying Configurations
1. Edit files in their respective tool directories (e.g., `zsh/.zshrc`)
2. Re-run `stow <tool>` to deploy changes
3. Restart or reload the affected application

### Adding New Dependencies
1. Add packages to appropriate category in `dependencies.yml`
2. Add OS-specific mappings if needed
3. Regenerate platform files:
   ```bash
   ./scripts/generate-brewfile.sh
   ```

### Adding New Tools
1. Create directory with proper stow structure
2. Add dependencies to `dependencies.yml`
3. Update `install.sh` if special setup is required

### Testing Changes
```bash
# Test zsh config
zsh -c 'source ~/.zshrc'

# Test tmux config
tmux source-file ~/.tmux.conf
```

### Cross-Platform Considerations
- Install script supports macOS, RHEL/CentOS, Ubuntu
- Homebrew works on both macOS and Linux
- Configuration files are platform-agnostic where possible