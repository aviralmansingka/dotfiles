# Ubuntu 22.04 LTS (Jammy Jellyfish) ARM64 configuration
# Use this for ARM-based VPS or faster builds on Apple Silicon

ubuntu_version = "22.04"
iso_url        = "https://cloud-images.ubuntu.com/jammy/current/jammy-server-cloudimg-arm64.img"
iso_checksum   = "file:https://cloud-images.ubuntu.com/jammy/current/SHA256SUMS"
accelerator    = "hvf"
qemu_binary    = "qemu-system-aarch64"
machine_type   = "virt"
