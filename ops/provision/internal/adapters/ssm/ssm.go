// Package ssm enrolls a fleet host over the SSM control plane and nothing else.
//
// There is no SSH ingress anywhere in this package, and enrollment needs none:
// the trust anchor is IAM, not a host key. Three parts make up the chain, and the
// split between them is the security property.
//
//   - Handoff through SSM Parameter Store. The enrollment key is written as a
//     SecureString at /fleet/enroll/<host>/<nonce>, encrypted with the
//     AWS-managed `alias/aws/ssm` key — no fleet key is created, held, or rotated
//     by an operator. The instance role can read only its own prefix, so one host
//     cannot read another host's key even if it knows the path, and its decrypt
//     grant only applies when SSM is the calling service.
//   - Delivery through SSM Run Command, addressed by instance id. `ssm
//     send-command` parameters stay in SSM command history, so the command
//     carries the parameter NAME and the nonce and never the key. History holds a
//     parameter path.
//   - Cleanup on both paths. The host script removes its key file after
//     `tailscale up`, and the worker deletes the parameter on success and on
//     failure.
//
// Fail closed: if the SSM agent never registers, the attempt aborts before a
// single key is minted, and there is no fallback transport to reach for.
package ssm

import (
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

import ()

const (
	// DefaultParameterPrefix is the SSM Parameter Store path enrollment keys are
	// stored under. terraform/aws/main.tf scopes the instance role to exactly
	// `<prefix>/<host_name>/*`, and TestInstanceRoleReadsOnlyItsOwnEnrollmentPrefix
	// binds the two values together so they cannot drift.
	DefaultParameterPrefix = domain.ApprovedEnrollmentParameterPrefix

	// DefaultKMSKeyID is the AWS-managed key every enrollment parameter is
	// encrypted with. Naming it explicitly keeps the encryption property in the
	// code instead of borrowing a CLI default. There is nothing for an operator
	// to create: AWS owns the key, its key policy, and its rotation, and the
	// instance role's kms:Decrypt grant is limited by a via-service condition
	// rather than by a key ARN.
	DefaultKMSKeyID = domain.ApprovedEnrollmentKMSKeyID

	// DefaultRegion is the region of the parameter, the command, and the host.
	// SSM parameter names are regional, so the host script passes it explicitly
	// instead of trusting a default on the box.
	DefaultRegion = domain.ApprovedAWSRegion

	// DefaultHostKeyPath is where the host writes the key. It lives on tmpfs, so a
	// reboot removes it even if cleanup never ran.
	DefaultHostKeyPath = "/run/fleet-enroll.key"

	// DefaultBinary is the pinned AWS CLI v2 executable from the Nix profile. It
	// is a constant, never a configuration value an operator can point elsewhere.
	DefaultBinary = "aws"

	// Command document every enrollment command runs under.
	runShellScriptDocument = "AWS-RunShellScript"

	// statusSuccess is the SSM invocation status of a command that exited 0.
	statusSuccess = "Success"
)
