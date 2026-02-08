# Packer configuration for Ubuntu VM with dotfiles pre-installed
# Builds a QCOW2 image for deployment to Hostinger VPS (KVM)

packer {
  required_version = ">= 1.9.0"

  required_plugins {
    qemu = {
      version = ">= 1.1.0"
      source  = "github.com/hashicorp/qemu"
    }
  }
}

locals {
  image_name = "dotfiles-ubuntu-${var.ubuntu_version}"
  timestamp  = formatdate("YYYYMMDD-hhmm", timestamp())
}

source "qemu" "ubuntu" {
  # Cloud image mode - use existing cloud image as base
  disk_image       = true
  iso_url          = var.iso_url
  iso_checksum     = var.iso_checksum

  # Output configuration
  output_directory = var.output_directory
  vm_name          = "${local.image_name}.qcow2"
  format           = "qcow2"

  # VM Resources
  memory    = var.memory
  cpus      = var.cpus
  disk_size = var.disk_size

  # QEMU acceleration: hvf (macOS ARM), kvm (Linux), tcg (software/slow)
  accelerator  = var.accelerator
  headless     = var.headless
  qemu_binary  = var.qemu_binary
  machine_type = var.machine_type != "" ? var.machine_type : null

  # Network configuration
  net_device = "virtio-net"

  # Cloud-init configuration via CD-ROM
  cd_files = [
    "config/cloud-init/meta-data",
    "config/cloud-init/user-data",
    "config/cloud-init/network-config"
  ]
  cd_label = "cidata"

  # SSH configuration for provisioning
  ssh_username         = var.ssh_username
  ssh_password         = var.ssh_password
  ssh_timeout          = "20m"
  ssh_handshake_attempts = 100

  # Boot wait for cloud-init to complete
  boot_wait = "30s"

  # Shutdown command
  shutdown_command = "echo '${var.ssh_password}' | sudo -S shutdown -P now"
}

build {
  name    = "dotfiles-ubuntu"
  sources = ["source.qemu.ubuntu"]

  # Wait for cloud-init to fully complete
  provisioner "shell" {
    inline = [
      "echo 'Waiting for cloud-init to complete...'",
      "cloud-init status --wait",
      "echo 'Cloud-init complete.'"
    ]
  }

  # Copy provisioner scripts
  provisioner "file" {
    source      = "scripts/"
    destination = "/tmp/packer-scripts"
  }

  # Setup user environment
  provisioner "shell" {
    execute_command = "echo '${var.ssh_password}' | sudo -S sh -c '{{ .Vars }} {{ .Path }}'"
    scripts = [
      "scripts/setup-user.sh"
    ]
    environment_vars = [
      "TARGET_USER=${var.ssh_username}"
    ]
  }

  # Install dependencies
  provisioner "shell" {
    execute_command = "echo '${var.ssh_password}' | sudo -S sh -c '{{ .Vars }} {{ .Path }}'"
    scripts = [
      "scripts/setup-deps.sh"
    ]
    environment_vars = [
      "DEBIAN_FRONTEND=noninteractive"
    ]
  }

  # Setup dotfiles (run as target user)
  provisioner "shell" {
    execute_command = "echo '${var.ssh_password}' | sudo -S -u ${var.ssh_username} bash -c '{{ .Vars }} {{ .Path }}'"
    scripts = [
      "scripts/setup-dotfiles.sh"
    ]
    environment_vars = [
      "DOTFILES_REPO=${var.dotfiles_repo}",
      "DOTFILES_BRANCH=${var.dotfiles_branch}",
      "HOME=/home/${var.ssh_username}"
    ]
  }

  # Cleanup for minimal image size
  provisioner "shell" {
    execute_command = "echo '${var.ssh_password}' | sudo -S sh -c '{{ .Vars }} {{ .Path }}'"
    scripts = [
      "scripts/cleanup.sh"
    ]
  }

  # Generate image manifest
  post-processor "manifest" {
    output     = "${var.output_directory}/manifest.json"
    strip_path = true
  }
}
