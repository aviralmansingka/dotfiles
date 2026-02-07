#!/bin/bash
# Install the s3-boot bootloader on a running VPS.
# Downloads kernel + initramfs from S3, creates a GRUB menu entry with
# a presigned URL for the image, and sets it for one-time boot.
#
# Usage: install-bootloader.sh <s3-bucket> <s3-region> <image-s3-key> [image-hash]
set -euo pipefail

S3_BUCKET="${1:?Usage: install-bootloader.sh <s3-bucket> <s3-region> <image-s3-key> [image-hash]}"
S3_REGION="${2:?Usage: install-bootloader.sh <s3-bucket> <s3-region> <image-s3-key> [image-hash]}"
IMAGE_S3_KEY="${3:?Usage: install-bootloader.sh <s3-bucket> <s3-region> <image-s3-key> [image-hash]}"
IMAGE_HASH="${4:-}"

BOOT_DIR="/boot/s3boot"
GRUB_CFG="/etc/grub.d/99-s3boot"

echo "=== Installing s3-boot bootloader ==="

# Create boot directory
mkdir -p "${BOOT_DIR}"

# Download bootloader files from S3
echo "Downloading bootloader kernel..."
aws s3 cp "s3://${S3_BUCKET}/bootloader/vmlinuz-s3boot" "${BOOT_DIR}/vmlinuz" \
    --region "${S3_REGION}" --no-progress

echo "Downloading bootloader initramfs..."
aws s3 cp "s3://${S3_BUCKET}/bootloader/s3boot-initramfs.cpio.gz" "${BOOT_DIR}/initramfs.cpio.gz" \
    --region "${S3_REGION}" --no-progress

# Generate a presigned URL for the image (valid for 1 hour)
echo "Generating presigned URL for image..."
PRESIGNED_URL=$(aws s3 presign "s3://${S3_BUCKET}/${IMAGE_S3_KEY}" \
    --region "${S3_REGION}" \
    --expires-in 3600)

# Build kernel command line
KCMDLINE="s3boot.url=${PRESIGNED_URL}"
if [ -n "${IMAGE_HASH}" ]; then
    KCMDLINE="${KCMDLINE} s3boot.hash=${IMAGE_HASH}"
fi

# Detect target disk (first virtio or SCSI disk)
TARGET_DISK=""
for disk in /dev/vda /dev/sda /dev/xvda; do
    if [ -b "${disk}" ]; then
        TARGET_DISK="${disk}"
        break
    fi
done
if [ -n "${TARGET_DISK}" ]; then
    KCMDLINE="${KCMDLINE} s3boot.disk=${TARGET_DISK}"
fi

# Create GRUB menu entry
echo "Creating GRUB menu entry..."
cat > "${GRUB_CFG}" << 'GRUB_HEADER'
#!/bin/sh
exec tail -n +3 $0
GRUB_HEADER

cat >> "${GRUB_CFG}" << GRUB_ENTRY
menuentry "s3-boot Flash" {
    linux ${BOOT_DIR}/vmlinuz ${KCMDLINE}
    initrd ${BOOT_DIR}/initramfs.cpio.gz
}
GRUB_ENTRY

chmod +x "${GRUB_CFG}"

# Update GRUB configuration
echo "Updating GRUB..."
update-grub 2>/dev/null || grub-mkconfig -o /boot/grub/grub.cfg 2>/dev/null || true

# Set one-time boot to s3-boot entry
echo "Setting one-time boot to s3-boot Flash..."
grub-reboot "s3-boot Flash" 2>/dev/null || true

echo "=== Bootloader installed ==="
echo "Kernel:    ${BOOT_DIR}/vmlinuz"
echo "Initramfs: ${BOOT_DIR}/initramfs.cpio.gz"
echo "Target:    ${TARGET_DISK:-auto-detect}"
echo "On next reboot, the VPS will flash the new image."
