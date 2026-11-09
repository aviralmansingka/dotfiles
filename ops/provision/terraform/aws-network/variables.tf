# The network root's only inputs are the two approved tag values. The VPC CIDR,
# the subnet CIDR, the zone, and the gateway are fixed here on purpose: the
# owner approved one dedicated fleet network, so no input can widen it or point
# it at another VPC.

variable "owner" {
  description = "Value of the `owner` tag written to every taggable resource. Fleet metadata, never a person's identity document."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$", var.owner))
    error_message = "owner must be 2 to 64 characters of [A-Za-z0-9._:-]."
  }
}

variable "test_run" {
  description = "Test-run tag value (`fleet-test-run`) written to every taggable resource, so a live acceptance run can find and destroy exactly its own objects."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$", var.test_run))
    error_message = "test_run must be 2 to 64 characters of [A-Za-z0-9._:-]."
  }
}
