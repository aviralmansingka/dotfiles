#!/usr/bin/env bash
set -euo pipefail

VM_NAME=${PI_STT_VM_NAME:-pi-stt}
DISK_GIB=${PI_STT_VM_DISK_GIB:-40}
MEMORY_MIB=${PI_STT_VM_MEMORY_MIB:-8192}
VCPUS=${PI_STT_VM_VCPUS:-4}
SSH_PUBLIC_KEY=${PI_STT_VM_SSH_PUBLIC_KEY:-$HOME/.ssh/id_ed25519.pub}
IMAGE_DIR=/var/lib/libvirt/images
IMAGE_NAME=noble-server-cloudimg-amd64.img
IMAGE_URL=https://cloud-images.ubuntu.com/noble/current/$IMAGE_NAME
CACHE_DIR=${XDG_CACHE_HOME:-$HOME/.cache}/pi-stt-vm
GPU_VIDEO=0000:01:00.0
GPU_AUDIO=0000:01:00.1

for command_name in curl cloud-localds qemu-img virsh virt-install; do
  command -v "$command_name" >/dev/null || {
    printf 'missing required command: %s\n' "$command_name" >&2
    exit 1
  }
done

[[ -f $SSH_PUBLIC_KEY ]] || {
  printf 'SSH public key not found: %s\n' "$SSH_PUBLIC_KEY" >&2
  exit 1
}

for device in "$GPU_VIDEO" "$GPU_AUDIO"; do
  current_driver=$(basename "$(readlink -f "/sys/bus/pci/devices/$device/driver" 2>/dev/null)" 2>/dev/null || true)
  [[ $current_driver == vfio-pci ]] || {
    printf '%s uses %s, expected vfio-pci; run prepare-host.sh and reboot first.\n' \
      "$device" "${current_driver:-no driver}" >&2
    exit 1
  }
done

if sudo virsh dominfo "$VM_NAME" >/dev/null 2>&1; then
  printf 'libvirt domain already exists: %s\n' "$VM_NAME" >&2
  exit 1
fi

mkdir -p "$CACHE_DIR"
cached_image=$CACHE_DIR/$IMAGE_NAME
expected_sha=$(curl -fsSL https://cloud-images.ubuntu.com/noble/current/SHA256SUMS | awk -v name="$IMAGE_NAME" '$2 == name || $2 == "*" name {print $1; exit}')
[[ -n $expected_sha ]] || {
  printf 'could not find %s in Ubuntu SHA256SUMS\n' "$IMAGE_NAME" >&2
  exit 1
}
if [[ ! -f $cached_image ]]; then
  curl -fL "$IMAGE_URL" -o "$cached_image"
fi
printf '%s  %s\n' "$expected_sha" "$cached_image" | sha256sum --check --status || {
  printf 'cached cloud image checksum mismatch: %s\n' "$cached_image" >&2
  exit 1
}

ssh_key=$(<"$SSH_PUBLIC_KEY")
work_dir=$(mktemp -d)
trap 'rm -rf -- "$work_dir"' EXIT

cat > "$work_dir/user-data" <<EOF
#cloud-config
hostname: $VM_NAME
manage_etc_hosts: true
ssh_pwauth: false
disable_root: true
users:
  - name: avirus
    groups: [adm, sudo]
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    lock_passwd: true
    ssh_authorized_keys:
      - $ssh_key
package_update: true
packages:
  - ca-certificates
  - curl
  - ffmpeg
  - openssh-server
  - ubuntu-drivers-common
runcmd:
  - [systemctl, enable, --now, ssh.service]
EOF
printf 'instance-id: %s\nlocal-hostname: %s\n' "$VM_NAME" "$VM_NAME" > "$work_dir/meta-data"
cloud-localds "$work_dir/seed.img" "$work_dir/user-data" "$work_dir/meta-data"

base_image=$IMAGE_DIR/pi-stt-noble-base.qcow2
vm_disk=$IMAGE_DIR/$VM_NAME.qcow2
seed_image=$IMAGE_DIR/$VM_NAME-seed.img
for path in "$vm_disk" "$seed_image"; do
  [[ ! -e $path ]] || {
    printf 'refusing to overwrite existing VM artifact: %s\n' "$path" >&2
    exit 1
  }
done

if [[ ! -f $base_image ]]; then
  sudo install -o root -g root -m 0644 "$cached_image" "$base_image"
fi
sudo qemu-img create -f qcow2 -F qcow2 -b "$base_image" "$vm_disk" "${DISK_GIB}G"
sudo install -o root -g root -m 0644 "$work_dir/seed.img" "$seed_image"

if ! sudo virsh net-info default >/dev/null 2>&1; then
  printf 'libvirt default network is missing.\n' >&2
  exit 1
fi
if [[ $(sudo virsh net-info default | awk '/Active:/ {print $2}') != yes ]]; then
  sudo virsh net-start default
fi
sudo virsh net-autostart default

sudo virt-install \
  --name "$VM_NAME" \
  --memory "$MEMORY_MIB" \
  --vcpus "$VCPUS" \
  --cpu host-passthrough \
  --machine q35 \
  --boot uefi \
  --osinfo ubuntu24.04 \
  --import \
  --disk "path=$vm_disk,format=qcow2,bus=virtio" \
  --disk "path=$seed_image,device=cdrom" \
  --network network=default,model=virtio \
  --hostdev "$GPU_VIDEO" \
  --hostdev "$GPU_AUDIO" \
  --graphics none \
  --console pty,target_type=serial \
  --autostart \
  --noautoconsole

printf '\nCreated %s. Wait for cloud-init, then find its address with:\n' "$VM_NAME"
printf '  sudo virsh domifaddr %s --source lease\n' "$VM_NAME"

