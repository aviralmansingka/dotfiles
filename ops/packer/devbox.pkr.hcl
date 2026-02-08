packer {
  required_plugins {
    amazon = {
      source  = "github.com/hashicorp/amazon"
      version = "~> 1"
    }
  }
}

source "amazon-ebs" "devbox" {
  ami_name      = "${var.ami_name_prefix}-{{timestamp}}"
  instance_type = var.instance_type
  region        = var.aws_region
  profile       = var.aws_profile

  source_ami_filter {
    filters = {
      name                = "${var.base_ami_name_prefix}-*"
      root-device-type    = "ebs"
      virtualization-type = "hvm"
    }
    most_recent = true
    owners      = ["self"]
  }

  ssh_username            = "ubuntu"
  temporary_key_pair_type = "ed25519"

  launch_block_device_mappings {
    device_name           = "/dev/sda1"
    volume_size           = 30
    volume_type           = "gp3"
    delete_on_termination = true
  }

  tags = {
    Name     = "dotfiles-devbox"
    built-by = "packer"
    branch   = var.branch
  }

  run_tags = {
    Name = "packer-build-dotfiles-devbox"
  }

  ami_description = "Development environment with dotfiles, zsh, tmux, neovim, and dev tools"
}

build {
  sources = ["source.amazon-ebs.devbox"]

  # Phase 5: Clone and deploy dotfiles via stow (as aviralmansingka)
  provisioner "shell" {
    script          = "${path.root}/scripts/deploy_dotfiles.sh"
    execute_command = "chmod 755 {{.Path}} && sudo -iu aviralmansingka env -u SUDO_USER bash {{.Path}}"
  }

  # Phase 6: Shell plugins (Oh My Zsh, zsh plugins, TPM) (as aviralmansingka)
  provisioner "shell" {
    script          = "${path.root}/scripts/install_shell_plugins.sh"
    execute_command = "chmod 755 {{.Path}} && sudo -iu aviralmansingka env -u SUDO_USER bash {{.Path}}"
    max_retries     = 2
  }

  # Phase 7: Cleanup and finalize (as aviralmansingka)
  provisioner "shell" {
    script          = "${path.root}/scripts/cleanup.sh"
    execute_command = "chmod 755 {{.Path}} && sudo -iu aviralmansingka env -u SUDO_USER bash {{.Path}}"
  }
}