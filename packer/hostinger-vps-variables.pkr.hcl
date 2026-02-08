# Variable definitions for direct VPS provisioning via null builder

variable "vps_host" {
  type        = string
  description = "IP address of the Hostinger VPS to provision"
  default     = ""
}

variable "ssh_private_key_file" {
  type        = string
  description = "Path to SSH private key for root access to the VPS"
  default     = "~/.ssh/id_ed25519"
}
