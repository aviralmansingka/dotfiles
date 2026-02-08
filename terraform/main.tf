# SSH key for VPS access
resource "hostinger_vps_ssh_key" "deploy" {
  name = "dotfiles-deploy"
  key  = var.ssh_public_key
}

# Post-install script for fresh VPS provisioning
# Installs prerequisites needed by the s3-boot process
resource "hostinger_vps_post_install_script" "bootstrap" {
  name = "dotfiles-bootstrap"
  content = <<-BASH
    #!/bin/bash
    set -euo pipefail
    apt-get update
    apt-get install -y grub2-common grub-pc-bin lz4 curl awscli
    echo "Bootstrap complete"
  BASH
}

# The VPS instance
resource "hostinger_vps" "dev" {
  plan                   = var.vps_plan
  data_center_id         = var.vps_data_center_id
  template_id            = var.vps_template_id
  hostname               = var.vps_hostname
  password               = var.vps_password
  ssh_key_ids            = [hostinger_vps_ssh_key.deploy.id]
  post_install_script_id = hostinger_vps_post_install_script.bootstrap.id

  # After import, don't fight over mutable attributes that may
  # drift outside Terraform (template changes via s3-boot, etc.)
  lifecycle {
    ignore_changes = [
      template_id,
      password,
      post_install_script_id,
    ]
  }
}
