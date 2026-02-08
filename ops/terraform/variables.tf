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