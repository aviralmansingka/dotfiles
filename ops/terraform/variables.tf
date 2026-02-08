variable "hostinger_api_token" {
  type        = string
  description = "Hostinger API token"
  sensitive   = true
}

variable "aws_region" {
  type        = string
  description = "AWS region"
  default     = "us-east-1"
}

variable "github_token" {
  type        = string
  description = "GitHub personal access token"
  sensitive   = true
}

variable "devbox_enabled" {
  type        = bool
  description = "Whether to create the devbox EC2 instance"
  default     = false
}

variable "ssh_public_key" {
  type        = string
  description = "SSH public key for devbox EC2 access"
  default     = ""
  sensitive   = true
}

variable "devbox_ami_override" {
  type        = string
  description = "Override the AMI ID for the devbox instance (skips data source lookup)"
  default     = ""
}

