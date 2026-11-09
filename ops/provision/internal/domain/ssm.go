package domain

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// Approved enrollment store settings.
//
// Both are approved constants rather than free configuration, because a host's
// instance role is scoped to exactly `<prefix>/<host_name>/*` and to exactly one
// KMS key ARN. A configurable prefix would silently widen or break that grant, so
// the service refuses any other value; rotating the key means re-pointing the
// alias, not editing the service file.
const (
	// ApprovedEnrollmentParameterPrefix is the store path enrollment keys wait
	// under: <prefix>/<host_name>/<nonce>.
	ApprovedEnrollmentParameterPrefix = "/fleet/enroll"
	// ApprovedEnrollmentKMSKeyID is the one fleet key every enrollment parameter
	// is encrypted with.
	ApprovedEnrollmentKMSKeyID = "alias/fleet-enroll"
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

// kmsKeyIDPattern matches a KMS key id, which is a UUID.
var kmsKeyIDPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// ValidateKMSKeyID enforces the shape of a KMS key reference: an alias, a key id,
// or a key ARN. A value that could be a shell word or a CLI flag is refused, so
// the reference can only ever name a key.
func ValidateKMSKeyID(keyID string) error {
	if keyID == "" {
		return errors.New("kms key id is required")
	}
	if strings.ContainsAny(keyID, " \t\"';|&$`\\") {
		return fmt.Errorf("kms key id %q must not contain whitespace or shell metacharacters", keyID)
	}
	switch {
	case strings.HasPrefix(keyID, "alias/") && len(keyID) > len("alias/"):
		return nil
	case strings.HasPrefix(keyID, "arn:aws:kms:") && strings.Contains(keyID, ":key/"):
		return nil
	case kmsKeyIDPattern.MatchString(keyID):
		return nil
	default:
		return fmt.Errorf("kms key id %q must be an alias/, a key id, or a key ARN", keyID)
	}
}
