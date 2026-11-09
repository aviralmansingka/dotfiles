# Every value below is supplied by the provisioning service. None of them is
# client input: the API accepts a profile, region, and size *name* and the
# service resolves the concrete values from config/profiles.yaml.
#
# There is no variable for a credential, an account id, a state path, or a
# Terraform binary. A missing or malformed value fails here, at plan time,
# before any AWS call.
#
# The network is REQUIRED input, never a lookup. `vpc_id` and `subnet_id` name
# the owner-approved network the host joins; this root never discovers a default
# VPC and never creates a VPC or a subnet. A missing or malformed value fails
# against the variable by name, because an implicit default VPC does not exist
# in every account and region (live run: `VPCIdNotSpecified` in ap-south-1).

variable "host_name" {
  description = "Fleet host name. It names the tags and the per-host state key path segment."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]{1,30})[a-z0-9]$", var.host_name))
    error_message = "host_name must be 3 to 32 characters of lowercase letters, digits, and inner hyphens."
  }

  # Every AWS name this root creates is the project prefix plus this name, with
  # the prefix applied at most once (local.name in main.tf). 32 characters is the
  # ceiling for a derived name, so a name that does not already carry the prefix
  # leaves exactly six characters for it. Nothing is truncated: a truncated name
  # could collide with a different host.
  validation {
    condition     = length(var.host_name) <= (startswith(var.host_name, "fleet-") ? 32 : 26)
    error_message = "host_name must be at most 26 characters, or at most 32 when it already starts with \"fleet-\", so every derived resource name stays within 32 characters."
  }
}

variable "vpc_id" {
  description = "REQUIRED. VPC the host's security group is created in. There is no default-VPC fallback and no data-source lookup."
  type        = string

  # An empty value fails the pattern, so a missing `-var vpc_id=` is reported
  # against this variable by name instead of reaching AWS as VPCIdNotSpecified.
  validation {
    condition     = can(regex("^vpc-[0-9a-f]{8,17}$", var.vpc_id))
    error_message = "vpc_id must be a VPC id such as vpc-0123456789abcdef0; it is required and this root has no default-VPC fallback."
  }
}

variable "subnet_id" {
  description = "REQUIRED. Subnet the instance launches in. It must belong to vpc_id; there is no default-VPC fallback."
  type        = string

  validation {
    condition     = can(regex("^subnet-[0-9a-f]{8,17}$", var.subnet_id))
    error_message = "subnet_id must be a subnet id such as subnet-0123456789abcdef0; it is required and this root has no default-VPC fallback."
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

# The tag KEY is `owner`, the approved tag policy key. It is written as `owner`
# and never as `fleet-owner`; the value is fleet metadata, not a person.
variable "owner" {
  description = "Value of the `owner` tag written to every taggable resource. Fleet metadata, never a person's identity document."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$", var.owner))
    error_message = "owner must be 2 to 64 characters of [A-Za-z0-9._:-]."
  }
}

variable "test_run" {
  description = "Test-run tag value (`fleet-test-run`) written to every taggable resource, so a live acceptance run can find and destroy exactly its own hosts."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$", var.test_run))
    error_message = "test_run must be 2 to 64 characters of [A-Za-z0-9._:-]."
  }
}

variable "enrollment_parameter_prefix" {
  description = "SSM Parameter Store prefix an enrollment key waits under: <prefix>/<host_name>/<nonce>. The instance role can read only <prefix>/<host_name>/*, so this value and enrollment.ssm.parameter_prefix in the service file must agree."
  type        = string

  # The default matches ssm.DefaultParameterPrefix in the Go adapter, and
  # TestInstanceRoleReadsOnlyItsOwnEnrollmentPrefix asserts the agreement rather
  # than trusting it.
  default  = "/fleet/enroll"
  nullable = false

  # A hierarchical SSM path: /segment[/segment...], no empty segment, no traversal.
  validation {
    condition     = can(regex("^(/[A-Za-z0-9_.-]+)+$", var.enrollment_parameter_prefix)) && !strcontains(var.enrollment_parameter_prefix, "..")
    error_message = "enrollment_parameter_prefix must be a hierarchical SSM parameter path such as /fleet/enroll."
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
  description = "Optional single approved source CIDR allowed to reach port 22 for bootstrap. Empty (the default) emits NO ingress rule at all; a non-empty value emits exactly one 22/tcp rule from that CIDR. 0.0.0.0/0, ::/0, and anything wider than /8 are refused."
  type        = string

  # Empty is a real value here, not a missing one: it means "no SSH ingress".
  # The host root then emits no ingress rule at all (main.tf, local.bootstrap_cidrs),
  # so a fleet host accepts nothing inbound by default. `nullable = false` keeps
  # the adapter's `-var bootstrap_ssh_cidr=` an empty string instead of a null,
  # which is what makes the default reachable from the service.
  default  = ""
  nullable = false

  # /0 through /7 are outside the mask range, so a default route cannot be
  # expressed. The two wildcard spellings are also named outright, so a
  # permissive value fails here — against this variable, by name — and never
  # reaches AWS.
  validation {
    condition = var.bootstrap_ssh_cidr == "" || (
      !contains(["0.0.0.0/0", "::/0"], var.bootstrap_ssh_cidr) &&
      can(regex("^([0-9]{1,3}\\.){3}[0-9]{1,3}/([89]|[12][0-9]|3[0-2])$", var.bootstrap_ssh_cidr))
    )
    error_message = "bootstrap_ssh_cidr must be empty (no SSH ingress at all) or a single IPv4 CIDR between /8 and /32; 0.0.0.0/0 and ::/0 are not accepted."
  }

  # A malformed value fails at plan against the variable that carries it.
  validation {
    condition     = var.bootstrap_ssh_cidr == "" || can(cidrhost(var.bootstrap_ssh_cidr, 0))
    error_message = "bootstrap_ssh_cidr must be empty (no SSH ingress at all) or a valid IPv4 CIDR such as 203.0.113.10/32."
  }
}
