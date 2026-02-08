terraform {
  required_providers {
    hostinger = {
      source  = "hostinger/hostinger"
      version = "~> 0.1"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "hostinger" {
  api_token = var.hostinger_api_token
}

provider "aws" {
  region  = var.aws_region
  profile = "dotfiles-ci"
}
