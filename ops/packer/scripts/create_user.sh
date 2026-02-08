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

echo "==> Setting up home directories"
sudo mkdir -p /home/"$USERNAME"/.ssh
sudo mkdir -p /home/"$USERNAME"/.local/bin
sudo mkdir -p /home/"$USERNAME"/.local/share/bob
sudo chmod 700 /home/"$USERNAME"/.ssh
sudo chown -R "$USERNAME":"$USERNAME" /home/"$USERNAME"

echo "==> User $USERNAME created successfully"
id "$USERNAME"
