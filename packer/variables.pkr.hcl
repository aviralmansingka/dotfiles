# Variable definitions for Packer VM build

variable "ubuntu_version" {
  type        = string
  description = "Ubuntu version to build (22.04 or 24.04)"
  default     = "22.04"
}

variable "iso_url" {
  type        = string
  description = "URL to the Ubuntu cloud image"
}

variable "iso_checksum" {
  type        = string
  description = "Checksum for the cloud image (file: prefix for URL)"
}

variable "disk_size" {
  type        = string
  description = "Size of the VM disk"
  default     = "20G"
}

variable "memory" {
  type        = number
  description = "Memory in MB for the build VM"
  default     = 2048
}

variable "cpus" {
  type        = number
  description = "Number of CPUs for the build VM"
  default     = 2
}

variable "ssh_username" {
  type        = string
  description = "SSH username for provisioning"
  default     = "devuser"
}

variable "ssh_password" {
  type        = string
  description = "SSH password for provisioning (temporary)"
  default     = "packer"
  sensitive   = true
}

variable "dotfiles_repo" {
  type        = string
  description = "Git repository URL for dotfiles"
  default     = "https://github.com/aviralmansingka/dotfiles.git"
}

variable "dotfiles_branch" {
  type        = string
  description = "Git branch to clone"
  default     = "develop"
}

variable "output_directory" {
  type        = string
  description = "Directory for output images"
  default     = "output"
}

variable "headless" {
  type        = bool
  description = "Run QEMU in headless mode"
  default     = true
}

variable "accelerator" {
  type        = string
  description = "QEMU accelerator: kvm (Linux x86), hvf (macOS x86 Intel), tcg (software/cross-arch)"
  # TCG is required for x86_64 emulation on Apple Silicon (ARM)
  # Use kvm on Linux x86_64 for faster builds
  default     = "tcg"
}

variable "qemu_binary" {
  type        = string
  description = "QEMU binary: qemu-system-x86_64 or qemu-system-aarch64"
  default     = "qemu-system-x86_64"
}

variable "machine_type" {
  type        = string
  description = "QEMU machine type (virt for ARM, pc for x86)"
  default     = ""
}
