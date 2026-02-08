# Variable definitions for direct VPS provisioning via null builder

variable "vps_host" {
  type        = string
  description = "Hostname or IP of the Hostinger VPS to provision"
  default     = "avirus.xyz"
}

variable "vps_ssh_user" {
  type        = string
  description = "SSH user for connecting to the VPS (must have sudo access)"
  default     = "aviral"
}

variable "ssh_private_key_file" {
  type        = string
  description = "Path to SSH private key for VPS access"
  default     = "~/.ssh/id_rsa"
}

variable "ssh_public_key" {
  type        = string
  description = "SSH public key to authorize for the target user"
  default     = ""
}
