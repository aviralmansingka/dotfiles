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

variable "devbox_ami_override" {
  type        = string
  description = "Override the AMI ID for the devbox instance (skips data source lookup)"
  default     = ""
}

variable "instance_type" {
  type        = string
  description = "EC2 instance type for the devbox"
  default     = "c5.2xlarge"
}

variable "name_prefix" {
  type        = string
  description = "Prefix for AWS resource names (use branch name in CI for uniqueness)"
  default     = "devbox"
}
