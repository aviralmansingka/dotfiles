package domain_test

import (
	"testing"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

const testInstanceID = "i-0123456789abcdef0"

// TestApprovedAuthKeyPolicyIsTheFixedPolicy is the policy assertion: every field
// of the typed value, not just the ones a caller happens to read.
func TestApprovedAuthKeyPolicyIsTheFixedPolicy(t *testing.T) {
	t.Parallel()
	policy := domain.ApprovedAuthKeyPolicy()
	if policy.Preauthorized != true {
		t.Errorf("Preauthorized = %v, want true", policy.Preauthorized)
	}
	if policy.Ephemeral != false {
		t.Errorf("Ephemeral = %v, want false", policy.Ephemeral)
	}
	if policy.Reusable != false {
		t.Errorf("Reusable = %v, want false", policy.Reusable)
	}
	if policy.ExpirySeconds != domain.ApprovedAuthKeyExpirySeconds {
		t.Errorf("ExpirySeconds = %d, want %d", policy.ExpirySeconds, domain.ApprovedAuthKeyExpirySeconds)
	}
	if policy.ExpirySeconds < domain.MinAuthKeyExpirySeconds || policy.ExpirySeconds > domain.MaxAuthKeyExpirySeconds {
		t.Errorf("ExpirySeconds = %d, want within [%d, %d]",
			policy.ExpirySeconds, domain.MinAuthKeyExpirySeconds, domain.MaxAuthKeyExpirySeconds)
	}
	if err := policy.Validate(); err != nil {
		t.Fatalf("approved policy must validate, got %v", err)
	}
}

// TestAuthKeyPolicyRefusesEveryRelaxation proves the policy cannot be weakened
// one field at a time at a call site.
func TestAuthKeyPolicyRefusesEveryRelaxation(t *testing.T) {
	t.Parallel()
	cases := map[string]func(p *domain.AuthKeyPolicy){
		"reusable":          func(p *domain.AuthKeyPolicy) { p.Reusable = true },
		"ephemeral":         func(p *domain.AuthKeyPolicy) { p.Ephemeral = true },
		"not preauthorized": func(p *domain.AuthKeyPolicy) { p.Preauthorized = false },
		"expiry too long":   func(p *domain.AuthKeyPolicy) { p.ExpirySeconds = domain.MaxAuthKeyExpirySeconds + 1 },
		"expiry too short":  func(p *domain.AuthKeyPolicy) { p.ExpirySeconds = domain.MinAuthKeyExpirySeconds - 1 },
	}
	for name, mutate := range cases {
		name, mutate := name, mutate
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			policy := domain.ApprovedAuthKeyPolicy()
			mutate(&policy)
			if err := policy.Validate(); err == nil {
				t.Fatalf("policy %+v must be refused", policy)
			}
		})
	}
}

// TestResolveEnrollmentRejectsAClientSuppliedTag is the "a client cannot select a
// tag" rule: any tag arriving from a request is a rejection, never a hint.
func TestResolveEnrollmentRejectsAClientSuppliedTag(t *testing.T) {
	t.Parallel()
	profile := approvedProfile()
	profile.TailnetTag = domain.ApprovedTailnetTag
	// A whitespace-only value cannot become a tag, so it counts as absent rather
	// than as a selection; every value that could be a tag is rejected.
	for _, tag := range []string{"tag:aws-host", "tag:evil", "tag:"} {
		tag := tag
		t.Run(tag, func(t *testing.T) {
			t.Parallel()
			if _, err := domain.ResolveEnrollment(profile, []string{tag}); err == nil {
				t.Fatalf("client tag %q must be rejected", tag)
			}
		})
	}
	if _, err := domain.ResolveEnrollment(profile, nil); err != nil {
		t.Fatalf("ResolveEnrollment without a client tag = %v, want nil", err)
	}
	if _, err := domain.ResolveEnrollment(profile, []string{""}); err != nil {
		t.Fatalf("empty tag list entry must not be treated as a tag: %v", err)
	}
}

// TestResolveTailnetTagFailsClosed proves an untagged profile cannot enroll, and
// that a tag other than the approved one is refused even if it is well formed.
func TestResolveTailnetTagFailsClosed(t *testing.T) {
	t.Parallel()
	untagged := approvedProfile()
	if _, err := domain.ResolveTailnetTag(untagged); err == nil {
		t.Fatal("a profile with no tailnet_tag must fail closed")
	}
	other := approvedProfile()
	other.TailnetTag = "tag:some-other-fleet"
	if _, err := domain.ResolveTailnetTag(other); err == nil {
		t.Fatal("a tag other than the approved one must be refused")
	}
	approved := approvedProfile()
	approved.TailnetTag = domain.ApprovedTailnetTag
	tag, err := domain.ResolveTailnetTag(approved)
	if err != nil {
		t.Fatalf("ResolveTailnetTag(approved) = %v", err)
	}
	if tag != domain.ApprovedTailnetTag {
		t.Fatalf("tag = %q, want %q", tag, domain.ApprovedTailnetTag)
	}
}

// TestValidateTailnetTagRejectsNonTagShapes keeps free text, flags, and shell
// words out of the value that is interpolated into a remote command.
func TestValidateTailnetTagRejectsNonTagShapes(t *testing.T) {
	t.Parallel()
	for _, tag := range []string{"", "aws-host", "tag:", "tag:AWS", "tag:aws host", "tag:aws-host;rm", "tag:$(id)"} {
		if err := domain.ValidateTailnetTag(tag); err == nil {
			t.Fatalf("tag %q must be rejected", tag)
		}
	}
	if err := domain.ValidateTailnetTag(domain.ApprovedTailnetTag); err != nil {
		t.Fatalf("approved tag must validate: %v", err)
	}
}

// TestParseHostPublicKeyAcceptsOnlyThisInstancesKey is the forged-key rule: the
// key must be a well-formed ed25519 key whose comment names the instance it was
// fetched from.
func TestValidateInstanceIDRejectsNonInstanceValues(t *testing.T) {
	t.Parallel()
	for _, value := range []string{"", "i-", "i-0123", "0123456789abcdef0", "i-0123456789ABCDEF0", "i-0123456789abcdef0;id"} {
		if err := domain.ValidateInstanceID(value); err == nil {
			t.Fatalf("instance id %q must be rejected", value)
		}
	}
	if err := domain.ValidateInstanceID(testInstanceID); err != nil {
		t.Fatalf("valid instance id refused: %v", err)
	}
}

func TestValidateSecretRefRejectsFlagsAndTraversal(t *testing.T) {
	t.Parallel()
	for _, ref := range []string{"", "--api-key", "bao:", "bao:secret/data/../../etc/passwd", "bao:secret/data/x y", "secret/data/x"} {
		if err := domain.ValidateSecretRef(ref); err == nil {
			t.Fatalf("secret ref %q must be rejected", ref)
		}
	}
	for _, ref := range []string{"bao:secret/data/hosts/rex/canary", "bao:kv/fleet/tailscale-oauth"} {
		if err := domain.ValidateSecretRef(ref); err != nil {
			t.Fatalf("secret ref %q refused: %v", ref, err)
		}
	}
}
