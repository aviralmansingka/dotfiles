# Direct VPS provisioning via SSH using Packer's null builder
# SSHes into an existing Hostinger VPS and runs the same provisioning scripts
# as the QEMU image build, but in-place on a live server.
#
# Usage:
#   packer build -only='hostinger-vps-provision.*' \
#     -var 'vps_host=avirus.xyz' \
#     .

source "null" "vps" {
  ssh_host             = var.vps_host
  ssh_username         = var.vps_ssh_user
  ssh_private_key_file = var.ssh_private_key_file
  ssh_timeout          = "5m"
}

build {
  name    = "hostinger-vps-provision"
  sources = ["source.null.vps"]

  # Setup user environment (needs root)
  provisioner "shell" {
    execute_command = "sudo sh -c '{{ .Vars }} {{ .Path }}'"
    scripts = [
      "scripts/setup-user.sh"
    ]
    environment_vars = [
      "TARGET_USER=${var.ssh_username}"
    ]
  }

  # Install dependencies (needs root)
  provisioner "shell" {
    execute_command = "sudo sh -c '{{ .Vars }} {{ .Path }}'"
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

  # Authorize SSH key for the target user
  provisioner "shell" {
    inline = [
      "if [ -n '${var.ssh_public_key}' ]; then",
      "  sudo mkdir -p /home/${var.ssh_username}/.ssh",
      "  echo '${var.ssh_public_key}' | sudo tee -a /home/${var.ssh_username}/.ssh/authorized_keys > /dev/null",
      "  sudo sort -u -o /home/${var.ssh_username}/.ssh/authorized_keys /home/${var.ssh_username}/.ssh/authorized_keys",
      "  sudo chmod 600 /home/${var.ssh_username}/.ssh/authorized_keys",
      "  sudo chown -R ${var.ssh_username}:${var.ssh_username} /home/${var.ssh_username}/.ssh",
      "  echo 'SSH key authorized for ${var.ssh_username}'",
      "fi"
    ]
  }

  # Set default shell to zsh for the target user
  provisioner "shell" {
    inline = [
      "sudo usermod -s /bin/zsh ${var.ssh_username}"
    ]
  }
}
