# Direct VPS provisioning via SSH using Packer's null builder
# SSHes into an existing Hostinger VPS and runs the same provisioning scripts
# as the QEMU image build, but in-place on a live server.
#
# Usage:
#   packer build -only='hostinger-vps-provision.*' \
#     -var 'vps_host=<IP>' \
#     -var 'ssh_private_key_file=~/.ssh/id_ed25519' \
#     .

source "null" "vps" {
  ssh_host        = var.vps_host
  ssh_username    = "root"
  ssh_private_key_file = var.ssh_private_key_file
  ssh_timeout     = "5m"
}

build {
  name    = "hostinger-vps-provision"
  sources = ["source.null.vps"]

  # Setup user environment
  provisioner "shell" {
    scripts = [
      "scripts/setup-user.sh"
    ]
    environment_vars = [
      "TARGET_USER=${var.ssh_username}"
    ]
  }

  # Install dependencies
  provisioner "shell" {
    scripts = [
      "scripts/setup-deps.sh"
    ]
    environment_vars = [
      "DEBIAN_FRONTEND=noninteractive"
    ]
  }

  # Setup dotfiles (run as target user)
  provisioner "shell" {
    execute_command = "sudo -u ${var.ssh_username} bash -c '{{ .Vars }} {{ .Path }}'"
    scripts = [
      "scripts/setup-dotfiles.sh"
    ]
    environment_vars = [
      "DOTFILES_REPO=${var.dotfiles_repo}",
      "DOTFILES_BRANCH=${var.dotfiles_branch}",
      "HOME=/home/${var.ssh_username}"
    ]
  }

  # Set default shell to zsh for the target user
  provisioner "shell" {
    inline = [
      "chsh -s /bin/zsh ${var.ssh_username}"
    ]
  }
}
