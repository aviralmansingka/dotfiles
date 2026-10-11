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
stow nvim tmux zsh starship ghostty aerospace gh-dash tuicr git agents pi herdr

# macOS: deploy user LaunchAgents
stow launchd

# Linux: deploy user services (systemd)
stow systemd
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
stow agents       # Deploy shared agent skills
stow pi           # Deploy Pi agent configuration
stow launchd      # Deploy macOS user LaunchAgents
stow systemd      # Deploy systemd user units (Linux)
```

### Plugin Management
```bash
# Tmux plugins (after tmux config is stowed; TPM self-bootstraps from .tmux.conf)
~/.local/share/tmux/plugins/tpm/bin/install_plugins

# Zsh plugins (handled automatically by install.sh)
# Oh My Zsh + autosuggestions + syntax highlighting (Starship is the prompt)
```

## Architecture

### Stow-Based Structure
Each tool has its own directory containing dotfiles in their target path structure:
- `nvim/.config/nvim/` → `~/.config/nvim/`
- `zsh/.zshrc` → `~/.zshrc`
- `tmux/.tmux.conf` → `~/.tmux.conf`
- `ghostty/.config/ghostty/` → `~/.config/ghostty/`

### Stow Packages

See the authoritative package inventory in [README.md](README.md#stow-packages).

### Key Configuration Patterns

**Zsh Configuration:**
- Starship prompt
- uv-based Python workflows (`inv` alias runs `uv run inv`)
- Development tools in PATH (Go, Rust, Node, Java)

**Tmux Configuration:**
- Gruvbox Material theme
- Custom prefix: Ctrl-A
- Vim-style pane navigation (h/j/k/l)
- Plugin ecosystem via TPM

**Neovim (LazyVim):**
- LazyVim distribution with extensive plugins
- Language support for Python, Golang, Lua, Markdown
- Session persistence and project management

### Development Dependencies

**Languages:** Go, Rust, Node.js, Python (via uv), Lua
**Cloud Tools:** AWS CLI, kubectl, kubectx, k9s, Docker
**Terminal Tools:** fd, fzf, ripgrep, eza, lazygit, tig
**Fonts:** JetBrains Mono, Meslo LG, Fira Code (Nerd Font variants)

## Infrastructure (ops/)

### Packer (`ops/packer/`)
Builds Ubuntu 24.04 development AMIs with a multi-phase provisioning pipeline:
1. System packages → Rust toolchain → CLI tools → Dotfiles deployment → Shell plugins → Cleanup

### Terraform (`ops/terraform/`)
Manages AWS infrastructure for the devbox:
- EC2 instance with conditional `devbox_enabled` flag
- IAM roles, security groups, DNS, GitHub OIDC integration

### CI/CD Workflows (`.github/workflows/`)
- **CI** (`ci.yml`) - Fast, deterministic gate on every PR/push to `main`: glob-discovered test suites (`scripts/test-*`, `pi/.pi/agent/extensions/**/*.test.mjs`, `pi/bin` python tests) with tier-2 live-env exclusions. Covers the surfaces an agent touches without bootstrapping plugins or infra.
- **Terraform** (`terraform.yml`) - Plans on PR, applies on push to `main` (when `ops/terraform/**` changes). The Packer AMI workflow was removed; build AMIs manually via `ops/packer/`.

## Dependency Management

### Centralized Package Configuration
All dependencies are managed centrally in `dependencies.json`: it maps each tool to its
Homebrew formula or cask and, where needed, to OS-specific install commands for Ubuntu and
Alpine.

### Generating Platform-Specific Files
```bash
# Generate Brewfile from dependencies
python3 scripts/install_deps.py --os macos --format brewfile > Brewfile
# Or use the convenience script:
./scripts/generate-brewfile.sh
```

## Working with This Repository

### Modifying Configurations
1. Edit files in their respective tool directories (e.g., `zsh/.zshrc`)
2. Re-run `stow <tool>` to deploy changes
3. Restart or reload the affected application

### Adding New Dependencies
1. Add packages to appropriate category in `dependencies.json`
2. Add OS-specific mappings if needed
3. Regenerate platform files:
   ```bash
   ./scripts/generate-brewfile.sh
   ```

### Adding New Tools
1. Create directory with proper stow structure
2. Add dependencies to `dependencies.json`
3. Update `install.sh` if special setup is required

### Testing Changes
```bash
# Test zsh config
zsh -c 'source ~/.zshrc'

# Test tmux config
tmux source-file ~/.tmux.conf
```

### Cross-Platform Considerations
- Install script targets macOS+Homebrew; the Ubuntu devbox is provisioned by `ops/packer/`
- Homebrew works on both macOS and Linux
- Configuration files are platform-agnostic where possible

## Agent skills

### Issue tracker

Work is tracked in the local Obsidian vault under `/Users/aviral/vault/1_projects/`. See
`docs/agents/issue-tracker.md`.

### Domain docs

This is a single-context repo with a root `CONTEXT.md` and repository-wide ADRs under `docs/adr/`. See
`docs/agents/domain.md`.
