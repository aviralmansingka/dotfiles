data "aws_ami" "devbox" {
  count = var.devbox_ami_override == "" && var.devbox_enabled ? 1 : 0

  most_recent = true

  filter {
    name   = "name"
    values = ["dotfiles-devbox-*"]
  }

  filter {
    name   = "tag:built-by"
    values = ["packer"]
  }

  owners = ["self"]
}

locals {
  devbox_ami_id = var.devbox_ami_override != "" ? var.devbox_ami_override : (
    var.devbox_enabled ? data.aws_ami.devbox[0].id : null
  )
}

resource "aws_key_pair" "devbox" {
  count = var.devbox_enabled ? 1 : 0

  key_name   = "devbox-key"
  public_key = var.ssh_public_key
}

resource "aws_security_group" "devbox" {
  count = var.devbox_enabled ? 1 : 0

  name        = "devbox-sg"
  description = "Security group for devbox EC2 instance"

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "devbox-sg"
  }
}

resource "aws_instance" "devbox" {
  count = var.devbox_enabled ? 1 : 0

  ami                    = local.devbox_ami_id
  instance_type          = "c5.2xlarge"
  key_name               = aws_key_pair.devbox[0].key_name
  vpc_security_group_ids = [aws_security_group.devbox[0].id]

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
  }

  tags = {
    Name = "dotfiles-devbox"
  }
}

output "devbox_public_ip" {
  value       = var.devbox_enabled ? aws_instance.devbox[0].public_ip : null
  description = "Public IP of the devbox instance"
}

output "devbox_instance_id" {
  value       = var.devbox_enabled ? aws_instance.devbox[0].id : null
  description = "Instance ID of the devbox"
}

output "devbox_ami_id" {
  value       = local.devbox_ami_id
  description = "AMI ID used for the devbox"
}
