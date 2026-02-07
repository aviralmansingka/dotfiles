# Ubuntu 24.04 LTS (Noble Numbat) ARM64 configuration
# Use this for ARM-based VPS or faster builds on Apple Silicon

ubuntu_version = "24.04"
iso_url        = "https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-arm64.img"
iso_checksum   = "file:https://cloud-images.ubuntu.com/noble/current/SHA256SUMS"
accelerator    = "hvf"
qemu_binary    = "qemu-system-aarch64"
machine_type   = "virt"
