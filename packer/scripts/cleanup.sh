#!/bin/bash
# Cleanup script to minimize image size and prepare for deployment
set -euo pipefail

echo "=== Starting cleanup ==="

# Clean apt cache
echo "Cleaning apt cache..."
apt-get clean
apt-get autoremove -y
rm -rf /var/lib/apt/lists/*
rm -rf /var/cache/apt/archives/*

# Remove temporary files
echo "Removing temporary files..."
rm -rf /tmp/*
rm -rf /var/tmp/*

# Remove packer scripts
rm -rf /tmp/packer-scripts

# Clear log files
echo "Clearing log files..."
find /var/log -type f -name "*.log" -delete
find /var/log -type f -name "*.gz" -delete
journalctl --vacuum-time=1d 2>/dev/null || true

# Remove SSH host keys (will be regenerated on first boot)
echo "Removing SSH host keys..."
rm -f /etc/ssh/ssh_host_*

# Clear machine-id (will be regenerated on first boot)
echo "Clearing machine-id..."
truncate -s 0 /etc/machine-id 2>/dev/null || true
rm -f /var/lib/dbus/machine-id 2>/dev/null || true

# Clean cloud-init for fresh first boot
echo "Cleaning cloud-init..."
cloud-init clean --logs 2>/dev/null || true
rm -rf /var/lib/cloud/instances/*

# Remove bash history
echo "Removing bash history..."
rm -f /root/.bash_history
rm -f /home/*/.bash_history 2>/dev/null || true

# Clear command history
history -c 2>/dev/null || true

# Zero out free space for better compression (optional, takes time)
echo "Zeroing free space for compression..."
dd if=/dev/zero of=/EMPTY bs=1M 2>/dev/null || true
rm -f /EMPTY
sync

echo "=== Cleanup complete ==="
echo "Image is ready for deployment."
