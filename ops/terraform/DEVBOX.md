# Reusable Devbox Terraform Setup

How to add a Terraform-managed devbox to a new project using the existing `dotfiles-devbox-*` AMIs.

## Prerequisites

- `dotfiles-devbox-*` AMIs in `us-east-1`, tagged `built-by=packer`, owned by your account
- AWS credentials configured (`aws configure` or environment variables)

## Setup in a New Project

Create `ops/terraform/` with these 4 files:

### 1. `providers.tf`

```hcl
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket  = "<PROJECT-NAME>-terraform-state"
    key     = "terraform.tfstate"
    region  = "us-east-1"
    encrypt = true
  }
}

provider "aws" {
  region = var.aws_region
}
```

Create the S3 bucket before first `terraform init`:

```bash
aws s3api create-bucket --bucket <PROJECT-NAME>-terraform-state --region us-east-1
```

### 2. `variables.tf`

```hcl
variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "devbox_enabled" {
  type    = bool
  default = false
}

variable "ssh_public_key" {
  type      = string
  sensitive = true
  default   = ""
}
```

### 3. `devbox.tf`

Copy verbatim from [`ops/terraform/devbox.tf`](devbox.tf) in this repo. It contains:

- **AMI lookup** — most recent `dotfiles-devbox-*` with `built-by=packer`, owned by self
- **Key pair** — from `var.ssh_public_key`
- **Security group** — SSH (port 22) inbound from anywhere, all outbound
- **EC2 instance** — c5.2xlarge, 30GB gp3
- **Outputs** — `devbox_public_ip`, `devbox_instance_id`, `devbox_ami_id`

All resources are gated behind `var.devbox_enabled`.

### 4. `.gitignore`

```
.terraform/
*.tfstate
*.tfstate.backup
*.tfvars
```

## Usage

### Spin up

```bash
cd ops/terraform
terraform init
terraform apply \
  -var="devbox_enabled=true" \
  -var="ssh_public_key=$(cat ~/.ssh/id_ed25519.pub)"
```

### SSH in

```bash
ssh ubuntu@$(terraform output -raw devbox_public_ip)
```

### Tear down

```bash
terraform apply \
  -var="devbox_enabled=false" \
  -var="ssh_public_key=$(cat ~/.ssh/id_ed25519.pub)"
```

The `ssh_public_key` var is still required on teardown because Terraform needs all variables defined even when destroying resources.

## What's Excluded (vs this repo's full Terraform)

| File | Why not needed |
|------|---------------|
| `oidc.tf` | GitHub Actions OIDC — only if CI manages the devbox |
| `iam.tf` | IAM user/group — not devbox-related |
| `dns.tf` | Hostinger DNS — not devbox-related |
| `github.tf` | GitHub secrets — not devbox-related |
| `main.tf` | Hostinger VPS + S3 buckets — not devbox-related |
| Hostinger/GitHub providers | No DNS or repo management needed |
| AWS provider aliases | us-west-1, ap-south-1 not used by devbox |
