#!/bin/bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

echo "==> Updating apt and installing system packages"
sudo apt-get update -y
sudo apt-get install -y \
  git curl wget zsh tmux stow \
  gcc make build-essential \
  golang-go python3 python3-pip python3-venv nodejs npm \
  fd-find ripgrep fzf tree \
  luarocks unzip jq \
  software-properties-common
