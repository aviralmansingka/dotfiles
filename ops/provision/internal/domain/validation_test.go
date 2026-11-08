package domain_test

import (
	"strings"
	"testing"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// TestValidateHostNameRejectsMetacharacters pins the host-name allow-list. The
// name is interpolated into tags and provider arguments, so anything that could
// be read as a command or a path must fail.
func TestValidateHostNameRejectsMetacharacters(t *testing.T) {
	t.Parallel()
	valid := []string{"canary-01", "abc", "a1b", "rex-host-0007"}
	for _, name := range valid {
		if err := domain.ValidateHostName(name); err != nil {
			t.Fatalf("ValidateHostName(%q) = %v, want nil", name, err)
		}
	}
	invalid := []string{
		"",
		"ab",
		strings.Repeat("a", 33),
		"Canary-01",
		"-canary",
		"canary-",
		"canary; rm -rf /",
		"canary-$(id)",
		"canary-`id`",
		"canary-01|tee",
		"canary-01&&reboot",
		"../etc",
		"canary/01",
		"canary 01",
		"canary.01",
		"canary_01",
		"canary\n01",
		"canary\t01",
		"canary#01",
		"canary:01",
	}
	for _, name := range invalid {
		if err := domain.ValidateHostName(name); err == nil {
			t.Fatalf("ValidateHostName(%q) must fail", name)
		}
	}
}

// TestValidateIdempotencyKeyRejectsMetacharacters keeps a client key usable as a
// durable ledger key and Temporal workflow-id fragment.
func TestValidateIdempotencyKeyRejectsMetacharacters(t *testing.T) {
	t.Parallel()
	valid := []string{"idem-key-0001", "restart-key-0001", "abc:def.123_4"}
	for _, key := range valid {
		if err := domain.ValidateIdempotencyKey(key); err != nil {
			t.Fatalf("ValidateIdempotencyKey(%q) = %v, want nil", key, err)
		}
	}
	invalid := []string{
		"",
		"short",
		"idem key 0001",
		"idem-key-0001; rm -rf /",
		"idem-key-0001$(id)",
		"idem-key-0001\nX",
		"-idem-key-0001",
		"idem/key/0001",
	}
	for _, key := range invalid {
		if err := domain.ValidateIdempotencyKey(key); err == nil {
			t.Fatalf("ValidateIdempotencyKey(%q) must fail", key)
		}
	}
}

// TestFingerprintIsStableAndDistinguishesBodies backs the 409 case: the same body
// under one key fingerprints identically, a different body does not.
func TestFingerprintIsStableAndDistinguishesBodies(t *testing.T) {
	t.Parallel()
	base := domain.CreateHostRequest{
		Provider: "aws", Name: "canary-01", Profile: "rex", Region: "ap-south-1", Size: "standard",
	}
	first, err := domain.Fingerprint(base)
	if err != nil {
		t.Fatalf("Fingerprint: %v", err)
	}
	again, err := domain.Fingerprint(base)
	if err != nil {
		t.Fatalf("Fingerprint: %v", err)
	}
	if first != again {
		t.Fatalf("fingerprint is not stable: %s != %s", first, again)
	}
	if len(first) != 64 {
		t.Fatalf("fingerprint = %q, want 64 hex characters", first)
	}
	other := base
	other.Name = "canary-02"
	different, err := domain.Fingerprint(other)
	if err != nil {
		t.Fatalf("Fingerprint: %v", err)
	}
	if different == first {
		t.Fatal("a different body must produce a different fingerprint")
	}
}
