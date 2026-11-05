# The S03 decryption probe: one short-lived EC2 instance that proves a fresh
# Ubuntu box can become a recipient of secrets/probe.yaml and decrypt from it.
#
# It lives in this root because the provider, the region and the S3 backend are
# here (`providers.tf`); it is `count`-gated on `probe_enabled` (default false)
# so an ordinary `terraform apply` of the VPS, buckets and IAM never creates it.
# The instance is the only long-lived object: a key pair and a security group
# exist for it and for nothing else, and terminate with it.
#
#   terraform -chdir=ops/terraform apply -var="probe_enabled=true" ... (see the
#   S03 artifact for the exact command block, which the human runs)
#
# What the box does on first boot, all of it public:
#   1. installs `age`, and `sops` from its release tarball (Ubuntu 24.04 does
#      not package sops),
#   2. mints its own age identity at ~/.config/sops/age/keys.txt, 0600, owned by
#      the login user `ubuntu` — the same shape the lab uses, and deliberately
#      not derived from the SSH host key (.sops.yaml says why host-key material
#      is retired as fleet identity),
#   3. touches /var/lib/sops-probe-ready.
# No ciphertext and no plaintext value is baked into user_data or into this
# file. scripts/sops-probe.py copies secrets/probe.yaml over afterwards, one
# step at a time.

data "aws_ami" "sops_probe" {
  count = var.probe_enabled ? 1 : 0

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

resource "aws_key_pair" "sops_probe" {
  count = var.probe_enabled ? 1 : 0

  key_name   = "dotfiles-sops-probe"
  public_key = file(pathexpand(var.probe_ssh_public_key_path))

  tags = {
    Name      = "dotfiles-sops-probe"
    ManagedBy = "terraform"
  }
}

resource "aws_security_group" "sops_probe" {
  count = var.probe_enabled ? 1 : 0

  name        = "dotfiles-sops-probe"
  description = "SSH only, for the S03 sops decryption probe"

  ingress {
    description = "SSH from the operator"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.probe_ssh_cidr]
  }

  egress {
    description = "package and release downloads on first boot"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name      = "dotfiles-sops-probe"
    ManagedBy = "terraform"
  }
}

resource "aws_instance" "sops_probe" {
  count = var.probe_enabled ? 1 : 0

  ami                    = data.aws_ami.sops_probe[0].id
  instance_type          = var.probe_instance_type
  key_name               = aws_key_pair.sops_probe[0].key_name
  vpc_security_group_ids = [aws_security_group.sops_probe[0].id]

  # The instance carries its own identity, so IMDSv1 stays off: nothing here
  # needs instance metadata.
  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = 10
    delete_on_termination = true
    encrypted             = true
  }

  user_data = <<-EOT
    #!/bin/bash
    # Public bootstrap only: tool versions, paths, modes. Never a value.
    set -euo pipefail
    export DEBIAN_FRONTEND=noninteractive

    apt-get update -y
    apt-get install -y --no-install-recommends age ca-certificates curl

    # sops from the release tarball. Pinned in variables.tf so the probe is
    # reproducible; the checksum is optional and is checked when it is set.
    curl -fsSL --retry 5 --retry-delay 5 \
      -o /usr/local/bin/sops \
      "https://github.com/getsops/sops/releases/download/v${var.probe_sops_version}/sops-v${var.probe_sops_version}.linux.amd64"
    chmod 0755 /usr/local/bin/sops
    expected="${var.probe_sops_sha256}"
    if [ -n "$expected" ]; then
      printf '%s  %s\n' "$expected" /usr/local/bin/sops | sha256sum -c -
    fi

    # The probe's own age identity: a machine-local key, not host-key material.
    install -d -o ubuntu -g ubuntu -m 0700 /home/ubuntu/.config/sops/age
    if [ ! -s /home/ubuntu/.config/sops/age/keys.txt ]; then
      runuser -u ubuntu -- age-keygen -o /home/ubuntu/.config/sops/age/keys.txt
      chmod 0600 /home/ubuntu/.config/sops/age/keys.txt
    fi

    touch /var/lib/sops-probe-ready
  EOT

  tags = {
    Name      = "dotfiles-sops-probe"
    ManagedBy = "terraform"
  }
}

output "probe_instance_id" {
  description = "Instance id of the S03 decryption probe (empty when disabled)"
  value       = try(aws_instance.sops_probe[0].id, "")
}

output "probe_ip" {
  description = "Public IP of the S03 decryption probe (empty when disabled)"
  value       = try(aws_instance.sops_probe[0].public_ip, "")
}
