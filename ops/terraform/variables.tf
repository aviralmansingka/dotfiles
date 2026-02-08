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

variable "aws_access_key_id" {
  type        = string
  description = "AWS access key ID for GitHub Actions"
  sensitive   = true
}

variable "aws_secret_access_key" {
  type        = string
  description = "AWS secret access key for GitHub Actions"
  sensitive   = true
}