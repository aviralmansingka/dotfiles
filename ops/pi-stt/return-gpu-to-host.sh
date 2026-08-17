#!/usr/bin/env bash
# Return the homelab RTX 3060 from vfio-pci (pi-stt VM passthrough) to the host
# NVIDIA driver. Idempotent. Requires root; re-execs through sudo.
#
# What this does:
#   1. Refuses to run while the pi-stt domain is still running.
#   2. Removes /etc/modprobe.d/pi-stt-vfio.conf (vfio-pci ids + softdeps).
#   3. Removes the vfio module lines prepare-host.sh added to
#      /etc/initramfs-tools/modules, then rebuilds the initramfs.
#   4. Unbinds both GPU functions from vfio-pci at runtime and loads the
#      host NVIDIA driver (plus snd_hda_intel for the audio function).
#   5. Verifies with nvidia-smi.
#
# What this does NOT do:
#   - It does not reboot. Runtime rebinding takes effect immediately; the
#     initramfs/modprobe.d changes make it durable across the next boot.
#   - It does not touch the VM definition or disks. Decommission those with
#     virsh per ops/pi-stt/README.md once the host-native worker is verified.
set -euo pipefail

GPU_VIDEO=0000:01:00.0
GPU_AUDIO=0000:01:00.1
VFIO_CONF=/etc/modprobe.d/pi-stt-vfio.conf
INITRAMFS_MODULES=/etc/initramfs-tools/modules

if [[ $EUID -ne 0 ]]; then
  exec sudo "$0" "$@"
fi

operator=${SUDO_USER:-avirus}

if sudo -u "$operator" virsh domstate pi-stt 2>/dev/null | grep -qx running; then
  printf 'pi-stt is still running; shut it down first: virsh shutdown pi-stt\n' >&2
  exit 1
fi

driver_of() {
  basename "$(readlink -f "/sys/bus/pci/devices/$1/driver" 2>/dev/null)" 2>/dev/null || printf 'none\n'
}

changed=0

if [[ -f $VFIO_CONF ]]; then
  rm -f "$VFIO_CONF"
  printf 'removed %s\n' "$VFIO_CONF"
  changed=1
fi

if grep -qxE 'vfio|vfio_iommu_type1|vfio_pci' "$INITRAMFS_MODULES" 2>/dev/null; then
  sed -i '/^vfio$/d;/^vfio_iommu_type1$/d;/^vfio_pci$/d' "$INITRAMFS_MODULES"
  printf 'removed vfio module lines from %s\n' "$INITRAMFS_MODULES"
  changed=1
fi

if ((changed)); then
  update-initramfs -u
else
  printf 'vfio boot plumbing already absent; initramfs unchanged\n'
fi

for device in "$GPU_VIDEO" "$GPU_AUDIO"; do
  if [[ $(driver_of "$device") == vfio-pci ]]; then
    printf '%s\n' "$device" > /sys/bus/pci/drivers/vfio-pci/unbind
    printf 'unbound %s from vfio-pci\n' "$device"
  fi
done

# Drop the now-unused vfio stack so a future nvidia module load is unaffected.
for module in vfio_pci vfio_iommu_type1 vfio; do
  if lsmod | awk '{print $1}' | grep -qx "$module"; then
    rmmod "$module" 2>/dev/null || true
  fi
done

if [[ $(driver_of "$GPU_VIDEO") != nvidia ]]; then
  modprobe nvidia
  modprobe nvidia_uvm 2>/dev/null || true
  modprobe nvidia_drm 2>/dev/null || true
fi

# modprobe is a no-op when snd_hda_intel is already loaded (e.g. for the iGPU
# audio), so bind the HDMI-audio function explicitly when it is driverless.
if [[ $(driver_of "$GPU_AUDIO") != snd_hda_intel ]]; then
  modprobe snd_hda_intel 2>/dev/null || true
  if [[ ! -e /sys/bus/pci/devices/$GPU_AUDIO/driver && -d /sys/bus/pci/drivers/snd_hda_intel ]]; then
    printf '%s\n' "$GPU_AUDIO" > /sys/bus/pci/drivers/snd_hda_intel/bind 2>/dev/null || true
  fi
fi

printf '%s driver=%s\n' "$GPU_VIDEO" "$(driver_of "$GPU_VIDEO")"
printf '%s driver=%s\n' "$GPU_AUDIO" "$(driver_of "$GPU_AUDIO")"

if [[ $(driver_of "$GPU_VIDEO") != nvidia ]]; then
  printf 'GPU did not bind to nvidia; a reboot may be required.\n' >&2
  exit 1
fi

# RM initialization trails module load; nvidia-smi can fail if called instantly.
for _ in $(seq 1 10); do
  if sudo -u "$operator" nvidia-smi >/dev/null 2>&1; then
    break
  fi
  sleep 3
done
sudo -u "$operator" nvidia-smi
printf '\nGPU is back on the host NVIDIA driver. Reboot is not required for this\n'
printf 'session; the initramfs/modprobe.d changes govern the next boot.\n'
