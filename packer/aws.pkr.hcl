# AWS AMI builder for dotfiles development environment
# Builds an Amazon Machine Image with all dotfiles pre-installed

packer {
  required_plugins {
    amazon = {
      version = ">= 1.3.0"
      source  = "github.com/hashicorp/amazon"
    }
  }
}

variable "aws_region" {
  type        = string
  description = "AWS region to build the AMI in"
  default     = "us-east-1"
}

variable "aws_instance_type" {
  type        = string
  description = "EC2 instance type for the build"
  default     = "t3.medium"
}

variable "aws_source_ami" {
  type        = string
  description = "Source AMI ID (Ubuntu 22.04). Leave empty to auto-detect latest."
  default     = ""
}

variable "aws_ami_name" {
  type        = string
  description = "Name for the output AMI"
  default     = ""
}

variable "aws_vpc_id" {
  type        = string
  description = "VPC ID (leave empty for default VPC)"
  default     = ""
}

variable "aws_subnet_id" {
  type        = string
  description = "Subnet ID (leave empty for auto-select)"
  default     = ""
}

locals {
  ami_name = var.aws_ami_name != "" ? var.aws_ami_name : "dotfiles-ubuntu-${var.ubuntu_version}-${local.timestamp}"
}

source "amazon-ebs" "ubuntu" {
  region        = var.aws_region
  instance_type = var.aws_instance_type
  ami_name      = local.ami_name

  # Source AMI: use provided or find latest Ubuntu 22.04
  source_ami = var.aws_source_ami

  dynamic "source_ami_filter" {
    for_each = var.aws_source_ami == "" ? [1] : []
    content {
      filters = {
        name                = "ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"
        root-device-type    = "ebs"
        virtualization-type = "hvm"
      }
      owners      = ["099720109477"] # Canonical
      most_recent = true
    }
  }

  vpc_id    = var.aws_vpc_id != "" ? var.aws_vpc_id : null
  subnet_id = var.aws_subnet_id != "" ? var.aws_subnet_id : null

  ssh_username = "ubuntu"

  # Tag the AMI and snapshots
  tags = {
    Name       = local.ami_name
    Builder    = "packer"
    OS         = "ubuntu-${var.ubuntu_version}"
    Repository = "aviralmansingka/dotfiles"
  }

  snapshot_tags = {
    Name = local.ami_name
  }

  # Use gp3 for better performance
  launch_block_device_mappings {
    device_name           = "/dev/sda1"
    volume_size           = 30
    volume_type           = "gp3"
    delete_on_termination = true
  }
}

build {
  name    = "dotfiles-aws"
  sources = ["source.amazon-ebs.ubuntu"]

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

  # Setup user environment (run as root via sudo)
  provisioner "shell" {
    execute_command = "sudo sh -c '{{ .Vars }} {{ .Path }}'"
    scripts = [
      "scripts/setup-user.sh"
    ]
    environment_vars = [
      "TARGET_USER=${var.ssh_username}"
    ]
  }

  # Install dependencies
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

  # Cleanup for minimal image size
  provisioner "shell" {
    execute_command = "sudo sh -c '{{ .Vars }} {{ .Path }}'"
    scripts = [
      "scripts/cleanup.sh"
    ]
  }

  post-processor "manifest" {
    output     = "${var.output_directory}/manifest-aws.json"
    strip_path = true
  }
}
