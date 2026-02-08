#!/bin/bash
set -euo pipefail

ARCH=$(dpkg --print-architecture)

mkdir -p "$HOME/.local/bin"

echo "==> Installing starship"
curl -sS https://starship.rs/install.sh | sh -s -- -y -b "$HOME/.local/bin"

echo "==> Installing zoxide"
curl -sSfL https://raw.githubusercontent.com/ajeetdsouza/zoxide/main/install.sh | sh

echo "==> Installing lazygit"
LAZYGIT_VERSION=$(curl -s "https://api.github.com/repos/jesseduffield/lazygit/releases/latest" | jq -r '.tag_name' | sed 's/^v//')
if [ "$ARCH" = "amd64" ]; then
  curl -Lo /tmp/lazygit.tar.gz "https://github.com/jesseduffield/lazygit/releases/download/v${LAZYGIT_VERSION}/lazygit_${LAZYGIT_VERSION}_Linux_x86_64.tar.gz"
else
  curl -Lo /tmp/lazygit.tar.gz "https://github.com/jesseduffield/lazygit/releases/download/v${LAZYGIT_VERSION}/lazygit_${LAZYGIT_VERSION}_Linux_arm64.tar.gz"
fi
tar xzf /tmp/lazygit.tar.gz -C /tmp lazygit
sudo install /tmp/lazygit /usr/local/bin/lazygit

echo "==> Installing yq"
if [ "$ARCH" = "amd64" ]; then
  sudo curl -Lo /usr/local/bin/yq "https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64"
else
  sudo curl -Lo /usr/local/bin/yq "https://github.com/mikefarah/yq/releases/latest/download/yq_linux_arm64"
fi
sudo chmod +x /usr/local/bin/yq

echo "==> Installing kubectl"
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/${ARCH}/kubectl"
sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl
rm kubectl

echo "==> Installing kubectx + kubens"
if [ ! -d /opt/kubectx ]; then
  sudo git clone https://github.com/ahmetb/kubectx /opt/kubectx
  sudo ln -sf /opt/kubectx/kubectx /usr/local/bin/kubectx
  sudo ln -sf /opt/kubectx/kubens /usr/local/bin/kubens
fi

echo "==> Installing k9s"
K9S_VERSION=$(curl -s "https://api.github.com/repos/derailed/k9s/releases/latest" | jq -r '.tag_name')
if [ "$ARCH" = "amd64" ]; then
  curl -Lo /tmp/k9s.tar.gz "https://github.com/derailed/k9s/releases/download/${K9S_VERSION}/k9s_Linux_amd64.tar.gz"
else
  curl -Lo /tmp/k9s.tar.gz "https://github.com/derailed/k9s/releases/download/${K9S_VERSION}/k9s_Linux_arm64.tar.gz"
fi
tar xzf /tmp/k9s.tar.gz -C /tmp k9s
sudo install /tmp/k9s /usr/local/bin/k9s

echo "==> Installing AWS CLI v2"
curl -sSL "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip" -o /tmp/awscliv2.zip
unzip -q /tmp/awscliv2.zip -d /tmp
sudo /tmp/aws/install
rm -rf /tmp/awscliv2.zip /tmp/aws

echo "==> Installing uv"
curl -LsSf https://astral.sh/uv/install.sh | sh

echo "==> Installing direnv"
export bin_path="$HOME/.local/bin"
curl -sfL https://direnv.net/install.sh | bash

echo "==> Installing Claude Code"
curl -fsSL https://claude.ai/install.sh | bash

echo "==> Installing OpenCode"
curl -fsSL https://opencode.ai/install | bash
