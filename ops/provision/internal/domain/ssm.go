package domain

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// Approved enrollment store settings.
//
// Both are constants rather than free configuration, because a host's instance
// role is scoped to exactly `<prefix>/<host_name>/*` and its decrypt grant is
// pinned to SSM in one region. A configurable prefix would silently widen or
// break that grant, so the service refuses any other value.
const (
	// ApprovedEnrollmentParameterPrefix is the store path enrollment keys wait
	// under: <prefix>/<host_name>/<nonce>.
	ApprovedEnrollmentParameterPrefix = "/fleet/enroll"
	// ApprovedEnrollmentKMSKeyID is the AWS-managed key every enrollment
	// parameter is encrypted with. AWS creates it with the account, the fleet
	// only references it, and its key policy is AWS's to change: the fleet
	// never creates a key, an alias, or a key policy of its own. Rotating it is
	// not an operator action either, because the key has no rotation schedule an
	// operator can edit.
	ApprovedEnrollmentKMSKeyID = "alias/aws/ssm"
)

// parameterNamePattern is the character set SSM accepts for a hierarchical
// parameter name. It excludes every character that could end a shell word, an
// argument, or a JSON string, so a validated name can be interpolated into the
// host script inside single quotes.
var parameterNamePattern = regexp.MustCompile(`^(/[A-Za-z0-9_.-]+)+$`)

// MaxParameterNameLen is SSM's documented ceiling for a parameter name.
const MaxParameterNameLen = 2048

// ValidateParameterName enforces the shape of an SSM parameter path such as
// /fleet/enroll/rex-1/9f3c1d.
//
// It is a domain rule, not an adapter rule, because three places must agree on
// it: the service configuration declares the prefix, the Terraform root scopes
// the instance role to `<prefix>/<host_name>/*`, and the worker builds the name.
func ValidateParameterName(name string) error {
	switch {
	case name == "":
		return errors.New("parameter name is required")
	case len(name) > MaxParameterNameLen:
		return fmt.Errorf("parameter name is %d characters; the limit is %d", len(name), MaxParameterNameLen)
	case !parameterNamePattern.MatchString(name):
		return fmt.Errorf("parameter name %q must be a hierarchical path of [A-Za-z0-9_.-] segments", name)
	case strings.Contains(name, ".."):
		return fmt.Errorf("parameter name %q must not contain path traversal", name)
	}
	return nil
}
