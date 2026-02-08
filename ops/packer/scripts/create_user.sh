#!/bin/bash
set -euo pipefail

USERNAME="aviralmansingka"
SOURCE_USER="ubuntu"

echo "==> Creating user $USERNAME"
sudo useradd -m -s /usr/bin/zsh "$USERNAME"

echo "==> Adding $USERNAME to same groups as $SOURCE_USER"
for group in $(id -nG "$SOURCE_USER"); do
  if [ "$group" != "$SOURCE_USER" ]; then
    sudo usermod -aG "$group" "$USERNAME"
  fi
done

echo "==> Granting passwordless sudo"
echo "$USERNAME ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/"$USERNAME" > /dev/null
sudo chmod 440 /etc/sudoers.d/"$USERNAME"

echo "==> Setting up SSH directory"
sudo mkdir -p /home/"$USERNAME"/.ssh
sudo chmod 700 /home/"$USERNAME"/.ssh
sudo chown "$USERNAME":"$USERNAME" /home/"$USERNAME"/.ssh

echo "==> Copying tool installations from $SOURCE_USER"
# Copy cargo (rust toolchain + cargo-installed binaries like eza, bob, starship, etc.)
sudo cp -a /home/"$SOURCE_USER"/.cargo /home/"$USERNAME"/.cargo
# Copy local (bob nvim, pipx, etc.)
sudo cp -a /home/"$SOURCE_USER"/.local /home/"$USERNAME"/.local
# Copy opencode if it exists
if [ -d /home/"$SOURCE_USER"/.opencode ]; then
  sudo cp -a /home/"$SOURCE_USER"/.opencode /home/"$USERNAME"/.opencode
fi

echo "==> Fixing ownership"
sudo chown -R "$USERNAME":"$USERNAME" /home/"$USERNAME"/

echo "==> User $USERNAME created successfully"
id "$USERNAME"
