# Per-host AWS entry point for the fleet provisioning API (S02).
#
# ONE HOST PER RUN DIRECTORY. This directory is a read-only template: the Go
# adapter in ops/provision/internal/adapters/terraform copies the tracked files
# into <run_dir>/<host> and runs Terraform there, so no host ever shares a
# working directory, a `.terraform` cache, or a state object with a sibling.
#
# It deliberately does not extend ops/terraform: that root owns the long-lived
# Mumbai Rex host and the account-level IAM/DNS objects, and a `destroy` in this
# root must never be able to reach them. The pieces it reuses from there are the
# provider alias shape (ops/terraform/providers.tf), the Canonical Ubuntu 24.04
# AMI filter, the gp3 encrypted root volume, IMDSv2, and the state bucket.

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source = "hashicorp/aws"
      # Pinned, not a range: this is the version the repository's other AWS
      # roots resolve (see ops/devbox/.terraform.lock.hcl).
      version = "5.100.0"
    }
  }

  # Partial backend configuration. The bucket and its own region are fixed
  # here; the state KEY is not. It is supplied at init time by the adapter as
  # `-backend-config=key=fleet-hosts/<host>/terraform.tfstate`, one object per
  # host, so two hosts can never share a state file and `destroy` can only see
  # the resources of the host whose key it opened. See README.md.
  #
  # us-east-1 is the *bucket's* region, as in ops/terraform/providers.tf. The
  # resources in this root are all pinned to ap-south-1 below.
  backend "s3" {
    bucket  = "aviral-dotfiles-terraform-state"
    region  = "us-east-1"
    encrypt = true
  }
}

# One provider, one region, and no default provider: every resource and the AMI
# lookup names this alias explicitly, so nothing here can follow
# AWS_DEFAULT_REGION, an ambient profile, or a future edit elsewhere.
provider "aws" {
  alias  = "ap_south_1"
  region = "ap-south-1"
}
