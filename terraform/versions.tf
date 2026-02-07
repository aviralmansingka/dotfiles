terraform {
  required_version = ">= 1.5.0"

  required_providers {
    hostinger = {
      source  = "hostinger/hostinger"
      version = "~> 0.1.22"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket = "aviralmansingka-vm-images"
    key    = "terraform/dotfiles-vps/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "hostinger" {
  # Set via HOSTINGER_API_TOKEN env var
}

provider "aws" {
  # Set via AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY env vars
  region = var.s3_region
}
