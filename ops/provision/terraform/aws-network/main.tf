# Dedicated fleet network for the provisioning API (S04 owner decision).
#
# ONE NETWORK, CREATED ONCE, BEFORE ANY HOST. This root owns the VPC, its single
# public subnet, its internet gateway, and its route table. It is deliberately
# separate from ops/provision/terraform/aws (the per-host root): the host root is
# a read-only template that the Go adapter copies into a run directory for every
# host and that `terraform destroy` must be able to empty without touching the
# network, while this root is created once and destroyed only when the fleet is
# retired.
#
# Order: this root first (it emits vpc_id and subnet_id), then the host root with
# those two values as required input. See README.md.
#
# No NAT gateway and no NAT instance: a NAT gateway costs more than the host
# itself and this design does not need one, because the subnet is public and the
# host's only inbound path is the tailnet.

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "5.100.0"
    }
  }

  # Partial backend, exactly as in the host root: nothing about the real backend
  # is in this file. Initialize with -backend-config flags or a local-backend
  # override file; see README.md.
  backend "s3" {}
}

provider "aws" {
  alias  = "ap_south_1"
  region = "ap-south-1"
}

locals {
  # Approved tag policy: the owner tag KEY is `owner` (never `fleet-owner`), plus
  # `fleet-test-run` so a live acceptance run can find and destroy exactly what it
  # created. Every taggable resource in this root carries both plus a Name.
  tags = {
    ManagedBy        = "terraform"
    owner            = var.owner
    "fleet-test-run" = var.test_run
    "fleet-network"  = "fleet"
  }
}

# The dedicated fleet VPC. Not the account's default VPC (there is none in this
# account and region) and not the existing Mumbai VPC (10.98.0.0/24): the fleet
# gets its own /16 so a route, ACL, or peering change here can never reach the
# long-lived infrastructure.
resource "aws_vpc" "fleet" {
  provider = aws.ap_south_1

  cidr_block           = "10.99.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = merge(local.tags, { Name = "fleet-vpc" })
}

# One public subnet in ap-south-1a. Public IP on launch is enabled so a host can
# reach cache.nixos.org and the Tailscale control plane on first boot without a
# NAT gateway. Ingress is closed everywhere in this root; the tailnet is the only
# way in.
resource "aws_subnet" "public" {
  provider = aws.ap_south_1

  vpc_id                  = aws_vpc.fleet.id
  cidr_block              = "10.99.1.0/24"
  availability_zone       = "ap-south-1a"
  map_public_ip_on_launch = true

  tags = merge(local.tags, { Name = "fleet-public-1a" })
}

resource "aws_internet_gateway" "fleet" {
  provider = aws.ap_south_1

  vpc_id = aws_vpc.fleet.id

  tags = merge(local.tags, { Name = "fleet-igw" })
}

# Egress only: the default route to the internet gateway. There is no route to a
# NAT gateway and no second subnet, because neither is needed.
resource "aws_route_table" "public" {
  provider = aws.ap_south_1

  vpc_id = aws_vpc.fleet.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.fleet.id
  }

  tags = merge(local.tags, { Name = "fleet-public-rt" })
}

resource "aws_route_table_association" "public" {
  provider = aws.ap_south_1

  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# The two values the host root requires. They are outputs, not lookups, so an
# operator wires the network to the hosts explicitly and nothing discovers a
# default VPC.
output "vpc_id" {
  description = "VPC the fleet hosts' security groups are created in (host root variable vpc_id)"
  value       = aws_vpc.fleet.id
}

output "subnet_id" {
  description = "Subnet the fleet hosts launch in (host root variable subnet_id)"
  value       = aws_subnet.public.id
}

output "vpc_cidr" {
  description = "Dedicated fleet VPC CIDR, for the teardown audit"
  value       = aws_vpc.fleet.cidr_block
}

output "subnet_cidr" {
  description = "Public fleet subnet CIDR and zone, for the teardown audit"
  value       = "${aws_subnet.public.cidr_block} (${aws_subnet.public.availability_zone})"
}

output "region" {
  description = "Region this network lives in"
  value       = "ap-south-1"
}
