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

  # Partial backend configuration: the block is EMPTY on purpose. Nothing about
  # the real backend — bucket, bucket region, encryption, or the state key — is
  # in this file, and no credential or bucket name is written here at all.
  #
  # The adapter supplies every value at init time (`initArgs` in
  # internal/adapters/terraform/aws.go):
  #
  #   -backend-config=bucket=<state bucket>
  #   -backend-config=key=fleet-hosts/<host>/terraform.tfstate
  #   -backend-config=region=<bucket region>
  #   -backend-config=encrypt=true
  #
  # One key per host, so two hosts can never share a state file and `destroy`
  # can only see the resources of the host whose key it opened.
  #
  # Because the block is partial, a smoke run can leave the tracked files
  # untouched and use local state through a backend override file, which Terraform
  # merges over this block (the override also switches the backend type):
  #
  #   terraform { backend "local" { path = "/tmp/<run>/terraform.tfstate" } }
  #
  # See README.md, "Backend: partial configuration", for both command forms.
  backend "s3" {}
}

# One provider, one region, and no default provider: every resource and the AMI
# lookup names this alias explicitly, so nothing here can follow
# AWS_DEFAULT_REGION, an ambient profile, or a future edit elsewhere.
provider "aws" {
  alias  = "ap_south_1"
  region = "ap-south-1"
}
