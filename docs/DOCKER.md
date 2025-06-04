# Docker Development Environments

This repository publishes Docker images containing complete development environments for working with dotfiles across different Linux distributions.

## Available Images

| Platform | Image | Size | Description |
|----------|-------|------|-------------|
| **Ubuntu 22.04** | `ghcr.io/aviralmansingka/dotfiles-ubuntu:latest` | ~2GB | Full-featured Ubuntu development environment |
| **CentOS Stream 9** | `ghcr.io/aviralmansingka/dotfiles-centos:latest` | ~2.5GB | Enterprise Linux development environment |
| **Alpine Linux** | `ghcr.io/aviralmansingka/dotfiles-alpine:latest` | ~800MB | Lightweight Alpine development environment |

## What's Included

Each image provides a complete development environment with:

### Core Development Tools
- **Git** - Version control
- **Zsh** - Enhanced shell with completion
- **Tmux** - Terminal multiplexer
- **Neovim** - Modern text editor
- **Stow** - Symlink farm manager for dotfiles

### Programming Languages
- **Go** - Google's programming language
- **Python 3** - With pip package manager
- **Node.js** - JavaScript runtime with npm
- **Rust** - Systems programming language

### CLI Utilities
- **fd** - Modern find replacement
- **ripgrep** - Fast text search
- **fzf** - Fuzzy finder
- **lazygit** - Terminal UI for git
- **act** - Run GitHub Actions locally
- **tree** - Directory listing
- **curl/wget** - HTTP clients

### Development Environment
- **User**: `testuser` (password: `testuser`)
- **Shell**: Zsh with helpful welcome messages
- **Sudo Access**: Available for package installation
- **Ports**: 3000, 8000, 8080 exposed for development servers

## Quick Start

### Basic Usage

```bash
# Run Ubuntu environment
docker run -it --rm ghcr.io/aviralmansingka/dotfiles-ubuntu:latest

# Run Alpine environment (smaller)
docker run -it --rm ghcr.io/aviralmansingka/dotfiles-alpine:latest

# Run CentOS environment
docker run -it --rm ghcr.io/aviralmansingka/dotfiles-centos:latest
```

### With Dotfiles

```bash
# Mount your dotfiles repository
docker run -it --rm \
  -v $(pwd):/home/testuser/dotfiles \
  ghcr.io/aviralmansingka/dotfiles-ubuntu:latest

# Test dotfiles installation
docker run -it --rm \
  -v $(pwd):/home/testuser/dotfiles \
  ghcr.io/aviralmansingka/dotfiles-ubuntu:latest \
  bash -c "cd dotfiles && ./install.sh"
```

### Development Server

```bash
# Run with port forwarding for development
docker run -it --rm \
  -p 3000:3000 -p 8080:8080 \
  -v $(pwd):/home/testuser/workspace \
  ghcr.io/aviralmansingka/dotfiles-ubuntu:latest
```

## Image Tags

Each platform provides multiple tags:

- `latest` - Latest stable build from main branch
- `develop` - Latest development build from develop branch  
- `v1.0.0` - Specific version releases
- `main-abc123` - Commit-specific builds

## Use Cases

### Dotfiles Testing
Test your dotfiles across different Linux distributions:

```bash
# Test on all platforms
for platform in ubuntu centos alpine; do
  echo "Testing on $platform..."
  docker run --rm -v $(pwd):/home/testuser/dotfiles \
    ghcr.io/aviralmansingka/dotfiles-$platform:latest \
    bash -c "cd dotfiles && ./install.sh"
done
```

### CI/CD Environments
Use as base images for GitHub Actions or other CI systems:

```dockerfile
FROM ghcr.io/aviralmansingka/dotfiles-ubuntu:latest

# Add your application
COPY . /app
WORKDIR /app

# Your build commands
RUN npm install && npm run build
```

### Development Containers
Use with VS Code dev containers or similar tools:

```json
{
  "name": "Dotfiles Development",
  "image": "ghcr.io/aviralmansingka/dotfiles-ubuntu:latest",
  "customizations": {
    "vscode": {
      "extensions": ["ms-vscode.vscode-json"]
    }
  }
}
```

## Building Locally

To build images locally:

```bash
# Build all platforms
docker build -f tests/docker/ubuntu.Dockerfile -t dotfiles-ubuntu .
docker build -f tests/docker/centos.Dockerfile -t dotfiles-centos .
docker build -f tests/docker/alpine.Dockerfile -t dotfiles-alpine .

# Test the built images
docker run -it --rm dotfiles-ubuntu
```

## Architecture Support

All images are built for multiple architectures:
- `linux/amd64` (Intel/AMD x86_64)
- `linux/arm64` (ARM64/Apple Silicon)

Docker will automatically pull the correct architecture for your system.

## Updates

Images are automatically rebuilt:
- **Weekly** - Every Sunday at 6 AM UTC to get latest base image updates
- **On Push** - When code is pushed to main or develop branches
- **On Release** - When new version tags are created

## Security

- Images are scanned for vulnerabilities using Trivy
- Built with official base images only
- Non-root user by default
- Minimal package installation
- Regular security updates via automated rebuilds