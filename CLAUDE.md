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
stow lazyvim tmux zsh kitty git yabai skhd kube tmuxinator
```

### Component Installation
```bash
# Individual tools (use stow for each)
stow zsh          # Deploy zsh configuration
stow tmux         # Deploy tmux configuration  
stow lazyvim      # Deploy Neovim/LazyVim configuration
stow kitty        # Deploy Kitty terminal configuration
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
- `lazyvim/.config/nvim/` → `~/.config/nvim/`
- `zsh/.zshrc` → `~/.zshrc`
- `tmux/.tmux.conf` → `~/.tmux.conf`
- `kitty/.config/kitty/` → `~/.config/kitty/`

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

**Languages:** Go, Rust, Node.js, Python (via pyenv), Java 17, Lua
**Cloud Tools:** AWS CLI, kubectl, kubectx, k9s, Docker
**Terminal Tools:** fd, fzf, ripgrep, exa, lazygit, glow, tig
**Fonts:** JetBrains Mono, Meslo LG, Fira Code (Nerd Font variants)

## Dependency Management

### Centralized Package Configuration
All dependencies are managed centrally in `dependencies.yml`:

```yaml
categories:
  core: [git, curl, zsh, tmux, neovim, stow]
  development: [gcc, make, build-essential]
  languages: [golang, python3, nodejs, rust]
  tools: [fd, ripgrep, fzf, act, lazygit]
```

### Generating Platform-Specific Files
```bash
# Generate Brewfile from YAML
python3 scripts/install-deps.py --os macos --format brewfile > Brewfile
# Or use the convenience script:
./scripts/generate-brewfile.sh

# Generate Dockerfile commands
python3 scripts/install-deps.py --os ubuntu --format dockerfile
python3 scripts/install-deps.py --os centos --format dockerfile  
python3 scripts/install-deps.py --os alpine --format dockerfile
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
   # Update Dockerfiles manually or regenerate them
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

# Test kitty config
kitty @ load-config
```

### Cross-Platform Considerations
- Install script supports macOS, RHEL/CentOS, Ubuntu
- Homebrew works on both macOS and Linux
- Configuration files are platform-agnostic where possible

## Testing Infrastructure

### Container-Based Testing
The repository includes Docker containers for testing across multiple Linux distributions:

```bash
# Build test containers
docker build -f tests/docker/ubuntu.Dockerfile -t dotfiles-test-ubuntu .
docker build -f tests/docker/centos.Dockerfile -t dotfiles-test-centos .
docker build -f tests/docker/alpine.Dockerfile -t dotfiles-test-alpine .

# Test containers
docker run --rm dotfiles-test-ubuntu /bin/bash -c "which git zsh tmux nvim stow act"
docker run --rm dotfiles-test-centos /bin/bash -c "which git zsh tmux nvim stow act"
docker run --rm dotfiles-test-alpine /bin/bash -c "which git zsh tmux nvim stow act"
```

### Local Testing with Act
GitHub Actions can be tested locally using `act`:

```bash
# Install act (included in Brewfile)
brew install act

# Test all workflows
act push

# Test specific job
act push -j test-containers

# Test with specific platform
act push -j test-containers --matrix platform:ubuntu
```

### CI/CD Pipeline
- **Automated testing** on push/PR to develop/main branches
- **Multi-platform validation** across Ubuntu, CentOS, Alpine, and macOS
- **Container builds** verify all dependencies install correctly
- **Functional testing** validates tool integration and basic workflows
- **Integration testing** confirms dotfiles deployment works end-to-end

## Published Docker Images

Pre-built development environments are available as Docker images:

**Available Images:**
- `ghcr.io/aviralmansingka/dotfiles-ubuntu:latest` - Ubuntu 22.04 environment
- `ghcr.io/aviralmansingka/dotfiles-centos:latest` - CentOS Stream 9 environment  
- `ghcr.io/aviralmansingka/dotfiles-alpine:latest` - Alpine Linux environment

**Quick Start:**
```bash
# Run development environment
docker run -it --rm ghcr.io/aviralmansingka/dotfiles-ubuntu:latest

# Mount dotfiles for testing
docker run -it --rm -v $(pwd):/home/testuser/dotfiles \
  ghcr.io/aviralmansingka/dotfiles-alpine:latest
```

**Features:**
- Complete development toolchain (git, zsh, tmux, neovim, stow, act)
- Programming languages (Go, Python, Node.js, Rust)
- Non-root user `testuser` with sudo access
- Multi-architecture support (amd64, arm64)
- Automatic security scanning and updates

See [docs/DOCKER.md](docs/DOCKER.md) for detailed usage instructions.