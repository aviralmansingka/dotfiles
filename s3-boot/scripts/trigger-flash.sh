#!/bin/bash
# Orchestrator script: checks if a flash is needed, installs the bootloader,
# and schedules a deferred reboot.
#
# Usage: trigger-flash.sh <s3-bucket> <s3-region> <image-s3-key> <image-hash>
set -euo pipefail

S3_BUCKET="${1:?Usage: trigger-flash.sh <s3-bucket> <s3-region> <image-s3-key> <image-hash>}"
S3_REGION="${2:?Usage: trigger-flash.sh <s3-bucket> <s3-region> <image-s3-key> <image-hash>}"
IMAGE_S3_KEY="${3:?Usage: trigger-flash.sh <s3-bucket> <s3-region> <image-s3-key> <image-hash>}"
IMAGE_HASH="${4:?Usage: trigger-flash.sh <s3-bucket> <s3-region> <image-s3-key> <image-hash>}"

HASH_FILE="/etc/s3boot-image-hash"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== s3-boot trigger ==="
echo "Image key:  ${IMAGE_S3_KEY}"
echo "Image hash: ${IMAGE_HASH}"

# Check if already running this image
if [ -f "${HASH_FILE}" ]; then
    CURRENT_HASH=$(cat "${HASH_FILE}" | tr -d '[:space:]')
    if [ "${CURRENT_HASH}" = "${IMAGE_HASH}" ]; then
        echo "VPS is already running image with hash ${IMAGE_HASH}"
        echo "No flash needed."
        exit 0
    fi
    echo "Current hash: ${CURRENT_HASH}"
    echo "New hash:     ${IMAGE_HASH}"
    echo "Flash required."
else
    echo "No previous image hash found. Flash required."
fi

# Install the bootloader
echo "Installing bootloader..."
bash "${SCRIPT_DIR}/install-bootloader.sh" \
    "${S3_BUCKET}" "${S3_REGION}" "${IMAGE_S3_KEY}" "${IMAGE_HASH}"

# Schedule a deferred reboot (gives SSH session time to close cleanly)
echo "Scheduling reboot in 10 seconds..."
nohup bash -c 'sleep 10 && reboot' > /dev/null 2>&1 &

echo "=== Flash triggered. VPS will reboot shortly. ==="
