package domain

import (
	"fmt"
	"net"
	"regexp"
	"strings"
)

// ApprovedAWSRegion is the single AWS region S02's per-host Terraform entry
// point creates resources in. Both the service configuration and the provider
// adapter refuse anything else, so no request can place a host outside Mumbai,
// and the Terraform variables cannot either.
const ApprovedAWSRegion = "ap-south-1"

// ValidateAWSRegion enforces the approved region set.
func ValidateAWSRegion(region string) error {
	if region != ApprovedAWSRegion {
		return Invalid("region", fmt.Sprintf("%q is not the approved region %q", region, ApprovedAWSRegion))
	}
	return nil
}

// sshPublicKeyPrefixes are the OpenSSH public key types the bootstrap accepts.
// A private key ("-----BEGIN OPENSSH PRIVATE KEY-----") matches none of them.
var sshPublicKeyPrefixes = []string{
	"ssh-ed25519 ",
	"ssh-rsa ",
	"ecdsa-sha2-nistp256 ",
	"ecdsa-sha2-nistp384 ",
	"ecdsa-sha2-nistp521 ",
	"sk-ssh-ed25519@openssh.com ",
	"sk-ecdsa-sha2-nistp256@openssh.com ",
}

var sshKeyBodyPattern = regexp.MustCompile(`^[A-Za-z0-9+/]+={0,2}$`)

// ValidateSSHPublicKey enforces public-key material for the bootstrap login:
// one OpenSSH public key line, never a private key and never a key path.
func ValidateSSHPublicKey(key string) error {
	if strings.TrimSpace(key) == "" {
		return Invalid("ssh_public_key", "public key material is required")
	}
	if strings.Contains(key, "PRIVATE KEY") {
		return Invalid("ssh_public_key", "private key material is refused; supply the .pub file")
	}
	if strings.ContainsAny(key, "\r\n") {
		return Invalid("ssh_public_key", "must be a single line of public key material")
	}
	prefix := ""
	for _, candidate := range sshPublicKeyPrefixes {
		if strings.HasPrefix(key, candidate) {
			prefix = candidate
			break
		}
	}
	if prefix == "" {
		return Invalid("ssh_public_key", "must be an OpenSSH public key (ssh-ed25519, ssh-rsa, ecdsa-sha2-nistp*, or a security-key type)")
	}
	fields := strings.SplitN(strings.TrimPrefix(key, prefix), " ", 2)
	if !sshKeyBodyPattern.MatchString(fields[0]) {
		return Invalid("ssh_public_key", "key body is not base64 public key material")
	}
	return nil
}

// ValidateBootstrapCIDR enforces the single approved SSH source range. It must
// be IPv4 and no wider than /8, so 0.0.0.0/0 and every other default-route
// shape is refused before Terraform or AWS ever sees it.
func ValidateBootstrapCIDR(cidr string) error {
	_, network, err := net.ParseCIDR(cidr)
	if err != nil {
		return Invalid("bootstrap_ssh_cidr", fmt.Sprintf("%q is not an IP network in CIDR form", cidr))
	}
	ones, bits := network.Mask.Size()
	if bits != 32 {
		return Invalid("bootstrap_ssh_cidr", fmt.Sprintf("%q is not an IPv4 network", cidr))
	}
	if ones < 8 {
		return Invalid("bootstrap_ssh_cidr", fmt.Sprintf("%q is wider than /8; 0.0.0.0/0 is never an approved bootstrap source", cidr))
	}
	return nil
}

// tagValuePattern bounds a tag value the service writes to AWS: letters,
// digits, and the separators AWS accepts, never whitespace or shell
// metacharacters.
var tagValuePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$`)

// ValidateTagValue enforces the shape of the owner and test-run tag values the
// adapter passes to Terraform.
func ValidateTagValue(field, value string) error {
	if !tagValuePattern.MatchString(value) {
		return Invalid(field, "must be 2 to 64 characters of [A-Za-z0-9._:-] and start alphanumeric")
	}
	return nil
}
