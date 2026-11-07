# The Mumbai Rex host: one long-lived EC2 instance in ap-south-1.
#
# It lives in this root because the provider alias (`ap_south_1` in
# providers.tf) and the S3 backend are here. It is gated on `mumbai_enabled`
# (default true): the box is the fleet's Rex server, so an ordinary apply
# creates it. The instance is the only long-lived object; its key pair,
# security group and Elastic IP exist for it and terminate with it.
#
# First boot, all public, in user_data:
#   1. apt installs git and stow — the deploy's file half needs both,
#   2. the multi-user Nix installer runs, so `just deploy remote mumbai` can
#      switch on the box with no manual step,
#   3. `loginctl enable-linger ubuntu`, so the Rex user unit runs at boot
#      without anyone logged in.
# Rex itself is NOT installed here: the home-manager profile installs it from
# the nix flake input, which is the point of this host.

data "aws_ami" "mumbai_ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "state"
    values = ["available"]
  }
}

resource "aws_key_pair" "mumbai" {
  count = var.mumbai_enabled ? 1 : 0

  key_name   = "dotfiles-mumbai"
  public_key = file(pathexpand(var.mumbai_ssh_public_key_path))

  tags = {
    Name      = "dotfiles-mumbai"
    ManagedBy = "terraform"
  }
}

resource "aws_security_group" "mumbai" {
  provider = aws.ap_south_1
  count    = var.mumbai_enabled ? 1 : 0

  name        = "dotfiles-mumbai"
  description = "SSH only; Rex is reached over its built-in Tailscale"

  ingress {
    description = "SSH from the operator"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.mumbai_ssh_cidr]
  }

  egress {
    description = "package and tailnet traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name      = "dotfiles-mumbai"
    ManagedBy = "terraform"
  }
}

resource "aws_instance" "mumbai" {
  provider = aws.ap_south_1
  count    = var.mumbai_enabled ? 1 : 0

  ami                    = data.aws_ami.mumbai_ubuntu.id
  instance_type          = var.mumbai_instance_type
  key_name               = aws_key_pair.mumbai[0].key_name
  vpc_security_group_ids = [aws_security_group.mumbai[0].id]

  # The instance carries its own identity, so IMDSv1 stays off.
  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = 20
    delete_on_termination = true
    encrypted             = true
  }

  user_data = <<-EOT
    #!/bin/bash
    # Public bootstrap only: tools, paths, modes. Never a value.
    set -euo pipefail
    export DEBIAN_FRONTEND=noninteractive

    apt-get update -y
    apt-get install -y --no-install-recommends ca-certificates curl git stow

    # Multi-user Nix: the daemon and /nix, so the deploy's
    # `nix run …#home-manager` works as ubuntu with no manual step.
    if [ ! -e /nix/var/nix/profiles/default/bin/nix ]; then
      curl -fsSL https://nixos.org/nix/install | sh -s -- --daemon --yes
    fi

    # The Rex user unit runs at boot, not only while someone is logged in.
    loginctl enable-linger ubuntu
  EOT

  tags = {
    Name      = "dotfiles-mumbai"
    ManagedBy = "terraform"
  }
}

# A stable address: the ssh config names it, so a reboot or recreate never
# rewrites ~/.ssh/config.
resource "aws_eip" "mumbai" {
  provider = aws.ap_south_1
  count    = var.mumbai_enabled ? 1 : 0

  instance = aws_instance.mumbai[0].id

  tags = {
    Name      = "dotfiles-mumbai"
    ManagedBy = "terraform"
  }
}

output "mumbai_instance_id" {
  description = "Instance id of the Mumbai Rex host (empty when disabled)"
  value       = try(aws_instance.mumbai[0].id, "")
}

output "mumbai_ip" {
  description = "Elastic IP of the Mumbai Rex host (empty when disabled)"
  value       = try(aws_eip.mumbai[0].public_ip, "")
}
