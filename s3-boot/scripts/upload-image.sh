#!/bin/bash
# Convert QCOW2 image to raw+lz4 and upload to S3
set -euo pipefail

QCOW2_PATH="${1:?Usage: upload-image.sh <qcow2-path> <s3-bucket> [s3-prefix]}"
S3_BUCKET="${2:?Usage: upload-image.sh <qcow2-path> <s3-bucket> [s3-prefix]}"
S3_PREFIX="${3:-images}"

IMAGE_NAME="$(basename "${QCOW2_PATH}" .qcow2)"
WORK_DIR="$(mktemp -d)"
RAW_PATH="${WORK_DIR}/${IMAGE_NAME}.raw"
LZ4_PATH="${WORK_DIR}/${IMAGE_NAME}.raw.lz4"

cleanup() {
    rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

echo "=== Converting QCOW2 to raw ==="
qemu-img convert -f qcow2 -O raw "${QCOW2_PATH}" "${RAW_PATH}"
RAW_SIZE=$(stat --format=%s "${RAW_PATH}" 2>/dev/null || stat -f%z "${RAW_PATH}")
echo "Raw image size: $(numfmt --to=iec "${RAW_SIZE}" 2>/dev/null || echo "${RAW_SIZE} bytes")"

echo "=== Compressing with lz4 ==="
lz4 -9 --rm "${RAW_PATH}" "${LZ4_PATH}"
LZ4_SIZE=$(stat --format=%s "${LZ4_PATH}" 2>/dev/null || stat -f%z "${LZ4_PATH}")
echo "Compressed size: $(numfmt --to=iec "${LZ4_SIZE}" 2>/dev/null || echo "${LZ4_SIZE} bytes")"

echo "=== Computing SHA256 hash ==="
IMAGE_HASH=$(sha256sum "${LZ4_PATH}" | awk '{print $1}')
echo "${IMAGE_HASH}  ${IMAGE_NAME}.raw.lz4" > "${WORK_DIR}/${IMAGE_NAME}.raw.lz4.sha256"
echo "Hash: ${IMAGE_HASH}"

echo "=== Uploading to S3 ==="
S3_KEY="${S3_PREFIX}/${IMAGE_NAME}.raw.lz4"
aws s3 cp "${LZ4_PATH}" "s3://${S3_BUCKET}/${S3_KEY}" \
    --no-progress
aws s3 cp "${WORK_DIR}/${IMAGE_NAME}.raw.lz4.sha256" \
    "s3://${S3_BUCKET}/${S3_KEY}.sha256" \
    --no-progress

echo "=== Upload complete ==="
echo "Image: s3://${S3_BUCKET}/${S3_KEY}"
echo "Hash:  s3://${S3_BUCKET}/${S3_KEY}.sha256"

# Output for CI consumption
echo "image_hash=${IMAGE_HASH}"
echo "s3_key=${S3_KEY}"
