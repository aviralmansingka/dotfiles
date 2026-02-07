variable "vps_plan" {
  type        = string
  description = "Hostinger VPS plan identifier"
  default     = "hostingercom-vps-kvm2-usd-1m"
}

variable "vps_data_center_id" {
  type        = number
  description = "Hostinger data center ID"
}

variable "vps_template_id" {
  type        = number
  description = "Hostinger OS template ID (Ubuntu)"
}

variable "vps_hostname" {
  type        = string
  description = "VPS hostname"
}

variable "vps_password" {
  type        = string
  description = "VPS root password"
  sensitive   = true
}

variable "ssh_public_key" {
  type        = string
  description = "SSH public key for deployment"
}

variable "ssh_private_key" {
  type        = string
  description = "SSH private key for provisioners"
  sensitive   = true
}

variable "s3_bucket" {
  type        = string
  description = "S3 bucket for VM images and bootloader"
  default     = "aviralmansingka-vm-images"
}

variable "s3_region" {
  type        = string
  description = "S3 bucket region"
  default     = "us-east-1"
}

variable "image_hash" {
  type        = string
  description = "SHA256 hash of the current image (triggers redeployment when changed)"
  default     = ""
}
