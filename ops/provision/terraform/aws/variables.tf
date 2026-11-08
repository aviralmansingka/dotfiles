# Every value below is supplied by the provisioning service. None of them is
# client input: the API accepts a profile, region, and size *name* and the
# service resolves the concrete values from config/profiles.yaml.
#
# There is no variable for a credential, an account id, a subnet, a state path,
# or a Terraform binary. A missing or malformed value fails here, at plan time,
# before any AWS call.

variable "host_name" {
  description = "Fleet host name. It names the tags and the per-host state key path segment."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]{1,30})[a-z0-9]$", var.host_name))
    error_message = "host_name must be 3 to 32 characters of lowercase letters, digits, and inner hyphens."
  }
}

variable "profile" {
  description = "Approved host profile name (config/profiles.yaml). Recorded as a tag; it does not choose resources."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,31}$", var.profile))
    error_message = "profile must match ^[a-z][a-z0-9-]{0,31}$."
  }
}

variable "size_key" {
  description = "Approved size key from the profile's sizes map. Recorded as a tag; instance_type and disk_gb are its resolved values."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,31}$", var.size_key))
    error_message = "size_key must match ^[a-z][a-z0-9-]{0,31}$."
  }
}

variable "instance_type" {
  description = "EC2 instance type resolved server-side from the approved size key. Clients cannot supply it."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,19}\\.[a-z0-9]{1,10}$", var.instance_type))
    error_message = "instance_type must look like a family.size EC2 type, such as t3.medium."
  }
}

variable "disk_gb" {
  description = "Encrypted gp3 root volume size in GiB resolved server-side from the approved size key."
  type        = number

  validation {
    condition     = var.disk_gb >= 8 && var.disk_gb <= 1000 && floor(var.disk_gb) == var.disk_gb
    error_message = "disk_gb must be a whole number of GiB between 8 and 1000."
  }
}

variable "fleet_owner" {
  description = "Owner tag value written to every taggable resource. Fleet metadata, never a person's identity document."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$", var.fleet_owner))
    error_message = "fleet_owner must be 2 to 64 characters of [A-Za-z0-9._:-]."
  }
}

variable "test_run" {
  description = "Test-run tag value written to every taggable resource, so a live acceptance run can find and destroy exactly its own hosts."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$", var.test_run))
    error_message = "test_run must be 2 to 64 characters of [A-Za-z0-9._:-]."
  }
}

variable "ssh_public_key" {
  description = "OpenSSH PUBLIC key material for the bootstrap login. A private key or a key path is refused."
  type        = string

  validation {
    condition     = can(regex("^(ssh-(rsa|ed25519)|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\\.com|sk-ecdsa-sha2-nistp256@openssh\\.com) [A-Za-z0-9+/]+={0,2}( [^\\n]*)?$", var.ssh_public_key))
    error_message = "ssh_public_key must be one OpenSSH public key line, such as 'ssh-ed25519 AAAA... comment'."
  }

  # A private key body carries this header. Refusing it by name keeps a
  # misconfigured file from ever reaching instance metadata or Terraform state.
  validation {
    condition     = length(regexall("PRIVATE KEY", var.ssh_public_key)) == 0
    error_message = "ssh_public_key must not contain private key material."
  }
}

variable "bootstrap_ssh_cidr" {
  description = "The single approved source CIDR allowed to reach port 22 for bootstrap. 0.0.0.0/0 and anything wider than /8 are refused."
  type        = string

  # /0 through /7 (including the 0.0.0.0/0 default route) are outside the mask
  # range, so a permissive CIDR cannot be expressed here at all.
  validation {
    condition     = can(regex("^([0-9]{1,3}\\.){3}[0-9]{1,3}/([89]|[12][0-9]|3[0-2])$", var.bootstrap_ssh_cidr))
    error_message = "bootstrap_ssh_cidr must be a single IPv4 CIDR between /8 and /32; 0.0.0.0/0 is not accepted."
  }

  validation {
    condition     = can(cidrhost(var.bootstrap_ssh_cidr, 0))
    error_message = "bootstrap_ssh_cidr must be a valid IPv4 CIDR."
  }
}
