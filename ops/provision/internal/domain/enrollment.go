package domain

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
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

// instanceIDInText finds an instance identifier anywhere in a comment, so a key
// comment that names another instance is recognised as a foreign key.
var instanceIDInText = regexp.MustCompile(`i-[0-9a-f]{8,17}`)

// ValidateInstanceID enforces the EC2 instance-identifier shape. It bounds what
// may be interpolated into an SSM request and into a host-key comment.
func ValidateInstanceID(id string) error {
	if !instanceIDPattern.MatchString(id) {
		return Invalid("instance_id", "must be an EC2 instance id such as i-0123456789abcdef0")
	}
	return nil
}

// HostPublicKey is a parsed OpenSSH host public key with its fingerprint.
type HostPublicKey struct {
	Type        string
	Base64      string
	Comment     string
	Fingerprint string
}

const ed25519KeyType = "ssh-ed25519"

// ed25519WireLen is the length of a decoded ed25519 public key blob: a 4-byte
// length prefix plus "ssh-ed25519", a 4-byte length prefix plus the 32-byte key.
const ed25519WireLen = 51

// ParseHostPublicKey validates one host public key line and ties it to the
// instance it was fetched from.
//
// Two independent checks make a forged key fail:
//   - the line must be a well-formed ssh-ed25519 public key of exactly 51 wire
//     bytes, so a private key, a different algorithm, or trailing garbage cannot
//     be accepted;
//   - a comment that names an instance must name this one, so a key copied from
//     another host is refused even before the pin would catch it at connect time.
//
// The fingerprint is what the caller may log and persist: it is a digest, not key
// material.
func ParseHostPublicKey(line, instanceID string) (HostPublicKey, error) {
	if err := ValidateInstanceID(instanceID); err != nil {
		return HostPublicKey{}, err
	}
	fields := strings.Fields(strings.TrimSpace(line))
	if len(fields) < 2 {
		return HostPublicKey{}, fmt.Errorf("host public key: expected `ssh-ed25519 <base64> <comment>`")
	}
	if fields[0] != ed25519KeyType {
		return HostPublicKey{}, fmt.Errorf("host public key: type %q is not %s", fields[0], ed25519KeyType)
	}
	blob, err := base64.StdEncoding.DecodeString(fields[1])
	if err != nil {
		return HostPublicKey{}, fmt.Errorf("host public key: body is not base64")
	}
	if len(blob) != ed25519WireLen {
		return HostPublicKey{}, fmt.Errorf("host public key: decoded body is %d bytes, want %d", len(blob), ed25519WireLen)
	}
	declared := int(binary.BigEndian.Uint32(blob[:4]))
	if declared != len(ed25519KeyType) || string(blob[4:4+declared]) != ed25519KeyType {
		return HostPublicKey{}, fmt.Errorf("host public key: blob does not declare %s", ed25519KeyType)
	}
	keyLen := int(binary.BigEndian.Uint32(blob[4+declared : 8+declared]))
	if keyLen != 32 {
		return HostPublicKey{}, fmt.Errorf("host public key: key material is %d bytes, want 32", keyLen)
	}
	comment := ""
	if len(fields) > 2 {
		comment = strings.Join(fields[2:], " ")
	}
	// A comment that names an instance must name *this* instance. EC2 host keys
	// usually carry a login-style comment (`root@ip-10-0-1-23`) or none, so an
	// ordinary comment is accepted; a key that explicitly belongs to another
	// instance is not.
	if named := instanceIDInText.FindString(comment); named != "" && named != instanceID {
		return HostPublicKey{}, fmt.Errorf(
			"host public key: comment names instance %s, not %s; refusing a key that does not belong to this host", named, instanceID)
	}
	sum := sha256.Sum256(blob)
	return HostPublicKey{
		Type:        ed25519KeyType,
		Base64:      fields[1],
		Comment:     comment,
		Fingerprint: "SHA256:" + base64.StdEncoding.EncodeToString(sum[:]),
	}, nil
}

// KnownHostsLine renders the pinned known_hosts entry for an address.
func (k HostPublicKey) KnownHostsLine(address string) string {
	return fmt.Sprintf("%s %s %s", address, k.Type, k.Base64)
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
