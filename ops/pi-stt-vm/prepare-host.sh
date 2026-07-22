#!/usr/bin/env bash
set -euo pipefail

GPU_VIDEO=0000:01:00.0
GPU_AUDIO=0000:01:00.1
GPU_IDS=10de:2487,10de:228b

driver() {
  basename "$(readlink -f "/sys/bus/pci/devices/$1/driver" 2>/dev/null)" 2>/dev/null || printf 'none\n'
}

check() {
  local failed=0 command_name
  for command_name in virsh virt-install cloud-localds qemu-img; do
    if command -v "$command_name" >/dev/null; then
      printf 'ok command %s\n' "$command_name"
    else
      printf 'missing command %s\n' "$command_name"
      failed=1
    fi
  done
  for device in "$GPU_VIDEO" "$GPU_AUDIO"; do
    local current_driver
    current_driver=$(driver "$device")
    printf '%s driver=%s\n' "$device" "$current_driver"
    [[ "$current_driver" == vfio-pci ]] || failed=1
  done
  return "$failed"
}

if [[ ${1:-} == --check ]]; then
  check
  exit
fi

if [[ $EUID -ne 0 ]]; then
  exec sudo "$0" "$@"
fi

operator=${SUDO_USER:-}
if [[ -z $operator || $operator == root ]]; then
  printf 'Run this as the normal homelab user; the script will invoke sudo.\n' >&2
  exit 2
fi

apt-get update
apt-get install -y \
  cloud-image-utils \
  libvirt-clients \
  libvirt-daemon-system \
  qemu-system-x86 \
  virtinst

systemctl enable --now libvirtd.service
usermod -aG libvirt,kvm "$operator"

printf '%s\n' \
  "options vfio-pci ids=$GPU_IDS disable_vga=1" \
  'softdep nvidia pre: vfio-pci' \
  'softdep nouveau pre: vfio-pci' \
  'softdep snd_hda_intel pre: vfio-pci' \
  > /etc/modprobe.d/pi-stt-vfio.conf

for module in vfio vfio_iommu_type1 vfio_pci; do
  grep -qxF "$module" /etc/initramfs-tools/modules || printf '%s\n' "$module" >> /etc/initramfs-tools/modules
done
update-initramfs -u

printf '\nHost preparation complete. Reboot once, reconnect over SSH, then run:\n'
printf '  %s --check\n' "$0"

