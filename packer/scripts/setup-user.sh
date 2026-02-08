#!/bin/bash
# Setup user environment for dotfiles deployment
set -euo pipefail

TARGET_USER="${TARGET_USER:-aviral}"

echo "=== Setting up user: ${TARGET_USER} ==="

# Ensure user exists (should be created by cloud-init, but verify)
if ! id "${TARGET_USER}" &>/dev/null; then
    echo "Creating user ${TARGET_USER}..."
    useradd -m -s /bin/bash -G sudo "${TARGET_USER}"
fi

# Ensure user is in required groups
usermod -aG sudo "${TARGET_USER}" 2>/dev/null || true

# Create standard directories
USER_HOME="/home/${TARGET_USER}"
echo "Creating user directories..."
sudo -u "${TARGET_USER}" mkdir -p "${USER_HOME}/.config"
sudo -u "${TARGET_USER}" mkdir -p "${USER_HOME}/.local/bin"
sudo -u "${TARGET_USER}" mkdir -p "${USER_HOME}/.local/share"
sudo -u "${TARGET_USER}" mkdir -p "${USER_HOME}/.ssh"
sudo -u "${TARGET_USER}" mkdir -p "${USER_HOME}/.cache"

# Set correct permissions
chmod 700 "${USER_HOME}/.ssh"
chmod 755 "${USER_HOME}/.local/bin"

# Ensure user owns their home directory
chown -R "${TARGET_USER}:${TARGET_USER}" "${USER_HOME}"

echo "=== User setup complete ==="
