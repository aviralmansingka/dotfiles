#!/bin/bash
# Install development dependencies for the dotfiles environment
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

echo "=== Installing development dependencies ==="

# Detect architecture
ARCH=$(uname -m)
case "$ARCH" in
    x86_64|amd64)
        ARCH_DEB="amd64"
        ARCH_GO="amd64"
        ARCH_RUST="x86_64-unknown-linux-gnu"
        ARCH_GENERIC="x86_64"
        ARCH_K8S="amd64"
        ;;
    aarch64|arm64)
        ARCH_DEB="arm64"
        ARCH_GO="arm64"
        ARCH_RUST="aarch64-unknown-linux-gnu"
        ARCH_GENERIC="aarch64"
        ARCH_K8S="arm64"
        ;;
    *)
        echo "Unsupported architecture: $ARCH"
        exit 1
        ;;
esac

echo "Detected architecture: $ARCH (deb: $ARCH_DEB, go: $ARCH_GO)"

# Update package lists
apt-get update

# Core packages from dependencies.yml
echo "Installing core packages..."
apt-get install -y \
    git \
    curl \
    wget \
    zsh \
    tmux \
    stow \
    unzip \
    jq

# Development tools
echo "Installing development tools..."
apt-get install -y \
    gcc \
    make \
    build-essential \
    ca-certificates \
    gnupg \
    lsb-release

# Languages
echo "Installing programming languages..."
apt-get install -y \
    golang-go \
    python3 \
    python3-pip \
    python3-venv \
    nodejs \
    cargo \
    luarocks

# Install npm only if not already bundled with nodejs (NodeSource packages include npm)
if ! command -v npm &>/dev/null; then
    apt-get install -y npm || true
fi

# s3-boot prerequisites (GRUB tools for bootloader installation)
echo "Installing s3-boot prerequisites..."
apt-get install -y \
    grub2-common \
    grub-pc-bin \
    lz4

# CLI tools available via apt
echo "Installing CLI tools..."
apt-get install -y \
    fd-find \
    ripgrep \
    fzf \
    tree \
    tig

# Create fd symlink (Ubuntu names it fdfind)
ln -sf /usr/bin/fdfind /usr/local/bin/fd || true

# ===== Special installations =====

echo "Installing Neovim (latest release)..."
NVIM_VERSION="v0.10.2"
if [ "$ARCH" = "x86_64" ] || [ "$ARCH" = "amd64" ]; then
    curl -LO "https://github.com/neovim/neovim/releases/download/${NVIM_VERSION}/nvim-linux64.tar.gz"
    tar -xzf nvim-linux64.tar.gz
    cp -r nvim-linux64/* /usr/local/
    rm -rf nvim-linux64 nvim-linux64.tar.gz
else
    # ARM64: Build from source or use apt (Ubuntu 22.04+ has recent nvim)
    apt-get install -y neovim || {
        echo "Installing Neovim from source for ARM64..."
        apt-get install -y ninja-build gettext cmake
        git clone --depth 1 --branch ${NVIM_VERSION} https://github.com/neovim/neovim /tmp/neovim
        cd /tmp/neovim && make CMAKE_BUILD_TYPE=Release && make install
        rm -rf /tmp/neovim
    }
fi

echo "Installing Starship prompt..."
curl -sS https://starship.rs/install.sh | sh -s -- -y

echo "Installing eza (modern ls)..."
EZA_VERSION="v0.18.24"
curl -LO "https://github.com/eza-community/eza/releases/download/${EZA_VERSION}/eza_${ARCH_RUST}.tar.gz"
tar -xzf "eza_${ARCH_RUST}.tar.gz"
mv eza /usr/local/bin/
rm -f "eza_${ARCH_RUST}.tar.gz"

echo "Installing lazygit..."
LAZYGIT_VERSION="0.44.1"
if [ "$ARCH_GENERIC" = "x86_64" ]; then
    LAZYGIT_ARCH="x86_64"
else
    LAZYGIT_ARCH="arm64"
fi
curl -LO "https://github.com/jesseduffield/lazygit/releases/download/v${LAZYGIT_VERSION}/lazygit_${LAZYGIT_VERSION}_Linux_${LAZYGIT_ARCH}.tar.gz"
tar -xzf "lazygit_${LAZYGIT_VERSION}_Linux_${LAZYGIT_ARCH}.tar.gz"
mv lazygit /usr/local/bin/
rm -f "lazygit_${LAZYGIT_VERSION}_Linux_${LAZYGIT_ARCH}.tar.gz" README.md LICENSE

echo "Installing k9s..."
K9S_VERSION="v0.32.5"
curl -LO "https://github.com/derailed/k9s/releases/download/${K9S_VERSION}/k9s_Linux_${ARCH_K8S}.tar.gz"
tar -xzf "k9s_Linux_${ARCH_K8S}.tar.gz"
mv k9s /usr/local/bin/
rm -f "k9s_Linux_${ARCH_K8S}.tar.gz" README.md LICENSE

echo "Installing kubectl..."
KUBECTL_VERSION=$(curl -L -s https://dl.k8s.io/release/stable.txt)
curl -LO "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${ARCH_K8S}/kubectl"
chmod +x kubectl
mv kubectl /usr/local/bin/

echo "Installing kubectx and kubens..."
KUBECTX_VERSION="v0.9.5"
if [ "$ARCH_GENERIC" = "x86_64" ]; then
    KUBECTX_ARCH="x86_64"
else
    KUBECTX_ARCH="arm64"
fi
curl -LO "https://github.com/ahmetb/kubectx/releases/download/${KUBECTX_VERSION}/kubectx_${KUBECTX_VERSION}_linux_${KUBECTX_ARCH}.tar.gz"
tar -xzf "kubectx_${KUBECTX_VERSION}_linux_${KUBECTX_ARCH}.tar.gz"
mv kubectx /usr/local/bin/
rm -f "kubectx_${KUBECTX_VERSION}_linux_${KUBECTX_ARCH}.tar.gz" LICENSE

curl -LO "https://github.com/ahmetb/kubectx/releases/download/${KUBECTX_VERSION}/kubens_${KUBECTX_VERSION}_linux_${KUBECTX_ARCH}.tar.gz"
tar -xzf "kubens_${KUBECTX_VERSION}_linux_${KUBECTX_ARCH}.tar.gz"
mv kubens /usr/local/bin/
rm -f "kubens_${KUBECTX_VERSION}_linux_${KUBECTX_ARCH}.tar.gz" LICENSE

echo "Installing uv (Python package manager)..."
curl -LsSf https://astral.sh/uv/install.sh | sh
# Move to system path
mv /root/.local/bin/uv /usr/local/bin/ 2>/dev/null || true
mv /root/.local/bin/uvx /usr/local/bin/ 2>/dev/null || true

echo "Installing zoxide..."
curl -sS https://raw.githubusercontent.com/ajeetdsouza/zoxide/main/install.sh | bash
mv /root/.local/bin/zoxide /usr/local/bin/ 2>/dev/null || true

echo "Installing direnv..."
DIRENV_VERSION="v2.34.0"
curl -LO "https://github.com/direnv/direnv/releases/download/${DIRENV_VERSION}/direnv.linux-${ARCH_K8S}"
chmod +x "direnv.linux-${ARCH_K8S}"
mv "direnv.linux-${ARCH_K8S}" /usr/local/bin/direnv

echo "Installing yq..."
YQ_VERSION="v4.44.3"
curl -LO "https://github.com/mikefarah/yq/releases/download/${YQ_VERSION}/yq_linux_${ARCH_K8S}"
chmod +x "yq_linux_${ARCH_K8S}"
mv "yq_linux_${ARCH_K8S}" /usr/local/bin/yq

echo "Installing tmuxinator..."
gem install tmuxinator 2>/dev/null || pip3 install tmuxinator || true

# Ensure /usr/local/bin is in PATH for all users
echo 'export PATH="/usr/local/bin:$PATH"' >> /etc/profile.d/local-bin.sh

echo "=== Dependencies installation complete ==="

# Verify installations
echo "=== Verifying installations ==="
command -v git && git --version
command -v zsh && zsh --version
command -v tmux && tmux -V
command -v nvim && nvim --version | head -1
command -v starship && starship --version
command -v eza && eza --version
command -v lazygit && lazygit --version
command -v kubectl && kubectl version --client
command -v k9s && k9s version --short
echo "=== Verification complete ==="
