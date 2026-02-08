source "amazon-ebs" "base" {
  ami_name      = "${var.base_ami_name_prefix}-{{timestamp}}"
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
    Name     = "devbox-base"
    built-by = "packer"
    branch   = var.branch
  }

  run_tags = {
    Name = "packer-build-devbox-base"
  }

  ami_description = "Base layer: system packages, Rust toolchain, and CLI tools"
}

build {
  sources = ["source.amazon-ebs.base"]

  # Phase 1: System packages (as ubuntu)
  provisioner "shell" {
    script      = "${path.root}/scripts/install_system_packages.sh"
    max_retries = 3
  }

  # Phase 2: Create aviralmansingka user (as ubuntu, before tool installs)
  provisioner "shell" {
    script = "${path.root}/scripts/create_user.sh"
  }

  # Phase 3: Rust toolchain + cargo-installed tools (as aviralmansingka)
  provisioner "shell" {
    script          = "${path.root}/scripts/install_rust.sh"
    execute_command = "chmod 755 {{.Path}} && sudo -iu aviralmansingka env -u SUDO_USER bash {{.Path}}"
  }

  # Phase 4: CLI tools installed via curl/binary downloads (as aviralmansingka)
  provisioner "shell" {
    script          = "${path.root}/scripts/install_cli_tools.sh"
    execute_command = "chmod 755 {{.Path}} && sudo -iu aviralmansingka env -u SUDO_USER bash {{.Path}}"
    max_retries     = 2
  }

  # Clean up to reduce base AMI size
  provisioner "shell" {
    inline = [
      "sudo apt-get clean",
      "sudo rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*"
    ]
  }
}