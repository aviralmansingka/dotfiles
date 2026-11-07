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

# ---- S03 decryption probe (probe.tf) -------------------------------------
# Gated so an ordinary apply of this root never creates the instance. The
# commands that turn it on and tear it down are in the S03 artifact.

variable "probe_enabled" {
  type        = bool
  description = "Create the short-lived sops decryption probe"
  default     = false
}

variable "probe_instance_type" {
  type        = string
  description = "EC2 instance type for the sops decryption probe"
  default     = "t3.micro"
}

variable "probe_ssh_public_key_path" {
  type        = string
  description = "Local path to the SSH public key that may log in to the probe (only read when probe_enabled is true)"
  default     = "~/.ssh/id_rsa.pub"
}

variable "probe_ssh_cidr" {
  type        = string
  description = "CIDR allowed to reach the probe on port 22"
  default     = "0.0.0.0/0"
}

# ---- Mumbai Rex host (mumbai.tf) ------------------------------------------
# Enabled by default: the box is a long-lived fleet host, not a one-shot
# probe. Set mumbai_enabled=false to destroy it without touching anything
# else this root manages.

variable "mumbai_enabled" {
  type        = bool
  description = "Create the Mumbai EC2 Rex host"
  default     = true
}

variable "mumbai_instance_type" {
  type        = string
  description = "EC2 instance type for the Mumbai Rex host"
  default     = "t3.small"
}

variable "mumbai_ssh_public_key_path" {
  type        = string
  description = "Local path to the SSH public key that may log in to the Mumbai host (only read when mumbai_enabled is true)"
  default     = "~/.ssh/id_rsa.pub"
}

variable "mumbai_ssh_cidr" {
  type        = string
  description = "CIDR allowed to reach the Mumbai host on port 22"
  default     = "0.0.0.0/0"
}

variable "probe_sops_version" {
  type        = string
  description = "sops release the probe installs (must be >= the encryption version in secrets/probe.yaml)"
  default     = "3.13.3"
}

variable "probe_sops_sha256" {
  type        = string
  description = "sha256 of the released sops binary; checked on the probe when set (clear it when probe_sops_version changes)"
  # From sops-v3.13.3.checksums.txt on the release page. A mismatch fails the
  # boot loudly instead of running an unverified download.
  default = "e5bec3346a873ae91d871550f3e698c1aad962aff462a080e40f25fde17fef6b"
}

