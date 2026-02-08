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
      name                = "ubuntu/images/*ubuntu-noble-24.04-amd64-server-*"
      root-device-type    = "ebs"
      virtualization-type = "hvm"
    }
    most_recent = true
    owners      = ["099720109477"] # Canonical
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
  }

  run_tags = {
    Name = "packer-build-dotfiles-devbox"
  }

  ami_description = "Development environment with dotfiles, zsh, tmux, neovim, and dev tools"
}

build {
  sources = ["source.amazon-ebs.devbox"]

  # Phase 1: System packages
  provisioner "shell" {
    script      = "${path.root}/scripts/install_system_packages.sh"
    max_retries = 3
  }

  # Phase 2: Rust toolchain + cargo-installed tools (eza, bob-nvim)
  provisioner "shell" {
    script = "${path.root}/scripts/install_rust.sh"
  }

  # Phase 3: CLI tools installed via curl/binary downloads
  provisioner "shell" {
    script      = "${path.root}/scripts/install_cli_tools.sh"
    max_retries = 2
  }

  # Phase 4: Clone and deploy dotfiles via stow
  provisioner "shell" {
    script = "${path.root}/scripts/deploy_dotfiles.sh"
  }

  # Phase 5: Shell plugins (Oh My Zsh, zsh plugins, TPM)
  provisioner "shell" {
    script      = "${path.root}/scripts/install_shell_plugins.sh"
    max_retries = 2
  }

  # Phase 6: Cleanup and finalize
  provisioner "shell" {
    script = "${path.root}/scripts/cleanup.sh"
  }
}
