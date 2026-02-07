#!/bin/bash
# Build a minimal initramfs for the s3-boot flash process.
# This creates a tiny Linux environment that can:
#   1. Boot via kexec/GRUB
#   2. Get a network address via DHCP
#   3. Download a compressed disk image from an S3 presigned URL
#   4. Decompress and flash it to disk
#   5. Reboot into the new system
#
# Output: s3-boot/bootloader/output/vmlinuz-s3boot
#         s3-boot/bootloader/output/s3boot-initramfs.cpio.gz
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="${SCRIPT_DIR}/output"
ROOTFS_DIR="$(mktemp -d)"
KERNEL_VERSION=""

cleanup() {
    echo "Cleaning up build directory..."
    rm -rf "${ROOTFS_DIR}"
}
trap cleanup EXIT

echo "=== Building s3-boot initramfs ==="

# Install build dependencies
apt-get update
apt-get install -y debootstrap cpio gzip

# Bootstrap a minimal Ubuntu rootfs
echo "=== Bootstrapping minimal rootfs ==="
debootstrap --variant=minbase --include=\
curl,lz4,iproute2,kmod,udev,systemd-sysv,ca-certificates,pv,dosfstools \
    jammy "${ROOTFS_DIR}" http://archive.ubuntu.com/ubuntu

# Copy the init script
echo "=== Installing init script ==="
cp "${SCRIPT_DIR}/init" "${ROOTFS_DIR}/init"
chmod 755 "${ROOTFS_DIR}/init"

# Extract the kernel from the rootfs (debootstrap installs one)
# If no kernel was installed, install one
if ! ls "${ROOTFS_DIR}"/boot/vmlinuz-* 2>/dev/null; then
    echo "Installing kernel in chroot..."
    chroot "${ROOTFS_DIR}" apt-get install -y --no-install-recommends linux-image-generic
fi

# Find and copy kernel
KERNEL_FILE=$(ls "${ROOTFS_DIR}"/boot/vmlinuz-* 2>/dev/null | sort -V | tail -1)
if [ -z "${KERNEL_FILE}" ]; then
    echo "ERROR: No kernel found in rootfs"
    exit 1
fi
KERNEL_VERSION=$(basename "${KERNEL_FILE}" | sed 's/vmlinuz-//')
echo "Using kernel: ${KERNEL_VERSION}"

mkdir -p "${OUTPUT_DIR}"
cp "${KERNEL_FILE}" "${OUTPUT_DIR}/vmlinuz-s3boot"

# Include kernel modules needed for VPS environments (virtio)
MODULES_DIR="${ROOTFS_DIR}/lib/modules/${KERNEL_VERSION}"
if [ -d "${MODULES_DIR}" ]; then
    echo "Including virtio kernel modules..."
    # Keep only the modules we need
    KEEP_MODULES=(
        "virtio" "virtio_pci" "virtio_net" "virtio_blk" "virtio_scsi"
        "virtio_ring" "virtio_console"
        "e1000" "e1000e"           # fallback NIC drivers
        "ext4" "xfs" "vfat"       # filesystems
        "sd_mod" "scsi_mod"       # SCSI
        "ahci" "ata_piix"         # SATA
    )
    echo "Modules dir: ${MODULES_DIR}"
else
    echo "WARNING: No kernel modules directory found for ${KERNEL_VERSION}"
fi

# Clean up unnecessary files to reduce initramfs size
echo "=== Stripping rootfs ==="
rm -rf "${ROOTFS_DIR}"/usr/share/doc/*
rm -rf "${ROOTFS_DIR}"/usr/share/man/*
rm -rf "${ROOTFS_DIR}"/usr/share/locale/*
rm -rf "${ROOTFS_DIR}"/usr/share/info/*
rm -rf "${ROOTFS_DIR}"/var/cache/apt/*
rm -rf "${ROOTFS_DIR}"/var/lib/apt/lists/*

# Create the CPIO archive
echo "=== Creating initramfs ==="
cd "${ROOTFS_DIR}"
find . | cpio -o -H newc 2>/dev/null | gzip -9 > "${OUTPUT_DIR}/s3boot-initramfs.cpio.gz"

echo "=== Build complete ==="
ls -lh "${OUTPUT_DIR}/"
echo "Kernel:    ${OUTPUT_DIR}/vmlinuz-s3boot"
echo "Initramfs: ${OUTPUT_DIR}/s3boot-initramfs.cpio.gz"
