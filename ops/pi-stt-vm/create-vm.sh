#!/usr/bin/env bash
set -euo pipefail

VM_NAME=${PI_STT_VM_NAME:-pi-stt}
VM_MAC=${PI_STT_VM_MAC:-52:54:00:13:10:01}
VM_IP=${PI_STT_VM_IP:-192.168.122.10}
DISK_GIB=${PI_STT_VM_DISK_GIB:-40}
MEMORY_MIB=${PI_STT_VM_MEMORY_MIB:-8192}
VCPUS=${PI_STT_VM_VCPUS:-4}
SSH_PUBLIC_KEY=${PI_STT_VM_SSH_PUBLIC_KEY:-$HOME/.ssh/id_ed25519.pub}
LIBVIRT_URI=qemu:///system
NETWORK_NAME=default
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

if virsh -c "$LIBVIRT_URI" dominfo "$VM_NAME" >/dev/null 2>&1; then
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
  - [ubuntu-drivers, --gpgpu, install]
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

if ! network_info=$(virsh -c "$LIBVIRT_URI" net-info "$NETWORK_NAME" 2>/dev/null); then
  printf 'libvirt %s network is missing.\n' "$NETWORK_NAME" >&2
  exit 1
fi
if [[ $(awk '/Active:/ {print $2}' <<<"$network_info") != yes ]]; then
  printf 'libvirt %s network is inactive; refusing to change network state.\n' "$NETWORK_NAME" >&2
  exit 1
fi

reservation="<host mac='$VM_MAC' name='$VM_NAME' ip='$VM_IP'/>"
network_xml=$(virsh -c "$LIBVIRT_URI" net-dumpxml "$NETWORK_NAME")
dhcp_hosts=$(grep -F '<host ' <<<"$network_xml" || true)
if [[ $dhcp_hosts != *"$reservation"* ]]; then
  for identifier in "mac='$VM_MAC'" "name='$VM_NAME'" "ip='$VM_IP'"; do
    if [[ $dhcp_hosts == *"$identifier"* ]]; then
      printf 'conflicting DHCP reservation contains %s; refusing to modify it.\n' "$identifier" >&2
      exit 1
    fi
  done
  virsh -c "$LIBVIRT_URI" net-update "$NETWORK_NAME" add-last ip-dhcp-host \
    "$reservation" --live --config
fi

if [[ ! -f $base_image ]]; then
  sudo install -o root -g root -m 0644 "$cached_image" "$base_image"
fi
sudo qemu-img create -f qcow2 -F qcow2 -b "$base_image" "$vm_disk" "${DISK_GIB}G"
sudo install -o root -g root -m 0644 "$work_dir/seed.img" "$seed_image"

virt-install \
  --connect "$LIBVIRT_URI" \
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
  --network "network=$NETWORK_NAME,model=virtio,mac=$VM_MAC" \
  --hostdev "$GPU_VIDEO" \
  --hostdev "$GPU_AUDIO" \
  --graphics none \
  --console pty,target_type=serial \
  --autostart \
  --noautoconsole

printf '\nCreated %s at its reserved private endpoint. Wait for cloud-init, then verify it with:\n' "$VM_NAME"
printf '  virsh -c %s domifaddr %s --source lease\n' "$LIBVIRT_URI" "$VM_NAME"
printf '  ssh avirus@%s\n' "$VM_IP"
