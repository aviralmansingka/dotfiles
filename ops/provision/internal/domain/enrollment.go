package domain

import (
	"fmt"
	"regexp"
	"strings"
)

// ApprovedTailnetTag is the single tag every fleet host joins the tailnet with.
// It is the only tag the minting adapter will put in a key request, and the only
// tag the enrollment service searches device state by.
const ApprovedTailnetTag = "tag:aws-host"

// tailnetTagPattern bounds a tag the configuration may declare: `tag:` plus a
// lower-case label. Tailscale tags are labels, never free text.
var tailnetTagPattern = regexp.MustCompile(`^tag:[a-z0-9][a-z0-9-]{0,62}$`)

// deviceIDPattern is the shape of a Tailscale device id. It is an allow-list
// because the id is interpolated into a request path: a value carrying a slash,
// a dot, or a percent sign could address a different resource or escape the
// path entirely.
var deviceIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)

// ValidateDeviceID enforces the device-id shape before it reaches a URL path.
func ValidateDeviceID(id string) error {
	if strings.TrimSpace(id) == "" {
		return Invalid("device_id", "is required")
	}
	if !deviceIDPattern.MatchString(id) {
		return Invalid("device_id", "must be a bare alphanumeric identifier")
	}
	return nil
}

// ValidateTailnetTag enforces the tag shape.
func ValidateTailnetTag(tag string) error {
	if !tailnetTagPattern.MatchString(tag) {
		return Invalid("tailnet_tag", "must look like tag:<lowercase-label>")
	}
	return nil
}

// IsApprovedTailnetTag reports whether tag is the one approved tag. The minting
// adapter calls this before it builds a request body, so a value that reached it
// from anywhere other than the approved profile cannot mint a key.
func IsApprovedTailnetTag(tag string) bool { return tag == ApprovedTailnetTag }

// ResolveTailnetTag returns the tailnet tag of an approved profile.
//
// The tag lives in server-side configuration and is the only source of a tag in
// the whole service: there is no field on any client request that can carry one.
// A profile without a tag fails closed rather than falling back to a default,
// because a host on the wrong tag would be reachable by the wrong policy.
func ResolveTailnetTag(profile Profile) (string, error) {
	tag := strings.TrimSpace(profile.TailnetTag)
	if tag == "" {
		return "", fmt.Errorf("profile %q declares no tailnet_tag", profile.Name)
	}
	if err := ValidateTailnetTag(tag); err != nil {
		return "", fmt.Errorf("profile %q: %w", profile.Name, err)
	}
	if !IsApprovedTailnetTag(tag) {
		return "", fmt.Errorf("profile %q: tailnet_tag %q is not the approved tag %q", profile.Name, tag, ApprovedTailnetTag)
	}
	return tag, nil
}

// Auth key expiry bounds, in seconds. A key is delivered over a verified SSH
// session within seconds of minting, so a short window is enough: ten minutes is
// the approved window and one hour is the hard ceiling. A longer window would
// outlive the provisioning attempt and turn a leaked key into standing access.
const (
	// MinAuthKeyExpirySeconds bounds a policy from below: a key that expires
	// before the enrollment can plausibly finish is a false failure.
	MinAuthKeyExpirySeconds = 300
	// MaxAuthKeyExpirySeconds is the documented hard bound. No policy — approved
	// or otherwise — may exceed it.
	MaxAuthKeyExpirySeconds = 3600
	// ApprovedAuthKeyExpirySeconds is the window the fleet actually uses.
	ApprovedAuthKeyExpirySeconds = 600
)

// AuthKeyPolicy is the fixed set of options the service mints an enrollment key
// with. It is a typed value, not loose booleans at a call site, so a test can
// assert every field and no caller can set one in isolation.
//
// Every field is deliberately the safe choice:
//   - Preauthorized: the host is not left waiting for a human in the admin
//     console, so enrollment is unattended.
//   - Ephemeral and Reusable false: the key registers exactly one node, once. A
//     second use of the same key is rejected by the tailnet and refused by the
//     replay-aware fakes in this repository.
//   - ExpirySeconds: a short window (see the bounds above).
type AuthKeyPolicy struct {
	Reusable      bool `json:"reusable"`
	Ephemeral     bool `json:"ephemeral"`
	Preauthorized bool `json:"preauthorized"`
	ExpirySeconds int  `json:"expiry_seconds"`
}

// ApprovedAuthKeyPolicy returns the one policy the fleet mints with.
func ApprovedAuthKeyPolicy() AuthKeyPolicy {
	return AuthKeyPolicy{
		Reusable:      false,
		Ephemeral:     false,
		Preauthorized: true,
		ExpirySeconds: ApprovedAuthKeyExpirySeconds,
	}
}

// Validate enforces the whole policy as one rule. It is intentionally stricter
// than "in range": a single-use, non-ephemeral, preauthorized key is the only
// accepted shape, so relaxing any field is a validation failure rather than a
// quiet weakening at a call site.
func (p AuthKeyPolicy) Validate() error {
	if p.Reusable {
		return fmt.Errorf("auth key policy: reusable keys are refused: an enrollment key registers exactly one node")
	}
	if p.Ephemeral {
		return fmt.Errorf("auth key policy: ephemeral keys are refused: node removal is an explicit S07 step, not an expiry side effect")
	}
	if !p.Preauthorized {
		return fmt.Errorf("auth key policy: preauthorized must be true: unattended enrollment cannot wait for console approval")
	}
	if p.ExpirySeconds < MinAuthKeyExpirySeconds || p.ExpirySeconds > MaxAuthKeyExpirySeconds {
		return fmt.Errorf("auth key policy: expiry_seconds must be within [%d, %d], got %d",
			MinAuthKeyExpirySeconds, MaxAuthKeyExpirySeconds, p.ExpirySeconds)
	}
	return nil
}

// EnrollmentPlan is the fully server-resolved enrollment: the approved tag and
// the fixed key policy. Nothing here can be influenced by a request.
type EnrollmentPlan struct {
	Tag       string        `json:"tag"`
	KeyPolicy AuthKeyPolicy `json:"key_policy"`
}

// ResolveEnrollment resolves the plan from the approved profile.
//
// clientTags is the list of tags a transport decoded from the request, if any.
// It exists so the rule "a client cannot choose a tag" is enforced in the domain
// and testable, not merely implied by a request struct having no field: any
// non-empty value is a rejection, never a hint.
func ResolveEnrollment(profile Profile, clientTags []string) (EnrollmentPlan, error) {
	for _, tag := range clientTags {
		if strings.TrimSpace(tag) != "" {
			return EnrollmentPlan{}, Invalid("tailnet_tag",
				"is resolved server-side from the approved profile; a client cannot select a tag")
		}
	}
	tag, err := ResolveTailnetTag(profile)
	if err != nil {
		return EnrollmentPlan{}, err
	}
	policy := ApprovedAuthKeyPolicy()
	if err := policy.Validate(); err != nil {
		return EnrollmentPlan{}, err
	}
	return EnrollmentPlan{Tag: tag, KeyPolicy: policy}, nil
}

// instanceIDPattern is the shape of an EC2 instance identifier.
var instanceIDPattern = regexp.MustCompile(`^i-[0-9a-f]{8,17}$`)

// ValidateInstanceID enforces the EC2 instance-identifier shape. Enrollment is
// addressed by instance id, so this bounds what can reach a control-plane call.
func ValidateInstanceID(id string) error {
	if !instanceIDPattern.MatchString(id) {
		return Invalid("instance_id", "must be an EC2 instance id such as i-0123456789abcdef0")
	}
	return nil
}

// secretRefPattern bounds a secret reference: an OpenBao-shaped prefix, then a
// KV path. It cannot spell a CLI flag, a URL, or a shell word, because each of
// those needs a character the class excludes.
var secretRefPattern = regexp.MustCompile(`^[a-z][a-z0-9-]{1,15}:[A-Za-z0-9][A-Za-z0-9/_.-]{0,191}$`)

// ValidateSecretRef enforces the reference shape used to name a credential in
// OpenBao. It validates the *reference*, never a value: no credential value is
// ever a parameter of this package.
func ValidateSecretRef(ref string) error {
	if !secretRefPattern.MatchString(ref) {
		return Invalid("secret_ref", "must be a scheme:path reference such as bao:secret/data/hosts/rex/tailscale")
	}
	if strings.Contains(ref, "..") {
		return Invalid("secret_ref", "must not contain path traversal")
	}
	return nil
}
