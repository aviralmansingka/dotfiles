package domain_test

import (
	"strings"
	"testing"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// TestHostRoleNameIsDerivedFromHostIdentityAndNeverShared pins property 2 at the
// rule: the role name is a pure function of the server-generated host id, so two
// hosts cannot land on one role, and a name that could escape its segment is
// refused before it becomes part of a role, a policy, or a KV path.
func TestHostRoleNameIsDerivedFromHostIdentityAndNeverShared(t *testing.T) {
	t.Parallel()
	first, err := domain.HostRoleName("host-0001")
	if err != nil {
		t.Fatalf("HostRoleName(host-0001): %v", err)
	}
	second, err := domain.HostRoleName("host-0002")
	if err != nil {
		t.Fatalf("HostRoleName(host-0002): %v", err)
	}
	if first == second {
		t.Fatalf("two hosts derived the same role name %q", first)
	}
	if first != "fleet-host-host-0001" {
		t.Fatalf("HostRoleName = %q, want fleet-host-<host id>", first)
	}
	policy, err := domain.HostPolicyName("host-0001")
	if err != nil {
		t.Fatalf("HostPolicyName: %v", err)
	}
	if policy == first {
		t.Fatal("the role and the policy of one host must not share a name")
	}
	for _, bad := range []string{"", "Host-0001", "host/0001", "host-0001;id", "../host-0001", strings.Repeat("a", 80)} {
		if _, err := domain.HostRoleName(bad); err == nil {
			t.Fatalf("HostRoleName(%q) must fail", bad)
		}
	}
}

// TestHostIdentityOwnsOnlyItsOwnKVTree is the second half of property 2 and the
// whole of property 4's path scoping: a bundle inside the host tree is owned, and
// one that names another host, a shared path, or a different scheme is not.
func TestHostIdentityOwnsOnlyItsOwnKVTree(t *testing.T) {
	t.Parallel()
	identity, err := domain.NewHostIdentity("host-0001", "canary-01")
	if err != nil {
		t.Fatalf("NewHostIdentity: %v", err)
	}
	if identity.KVPath != "secret/data/hosts/host-0001" {
		t.Fatalf("KVPath = %q", identity.KVPath)
	}
	if !identity.OwnsPath("bao:secret/data/hosts/host-0001/canary") {
		t.Fatal("the host must own its own canary path")
	}
	for _, ref := range []string{
		"bao:secret/data/hosts/host-0002/canary",
		"bao:secret/data/hosts/host-0001-other/canary",
		"bao:secret/data/hosts/canary",
		"bao:secret/data/fleet/tailscale-oauth",
		"vault:secret/data/hosts/host-0001/canary",
		"secret/data/hosts/host-0001/canary",
	} {
		if identity.OwnsPath(ref) {
			t.Fatalf("host-0001 must not own %q", ref)
		}
		if err := identity.ValidateHostBundle(ref); err == nil {
			t.Fatalf("ValidateHostBundle(%q) must fail", ref)
		}
	}
	if err := identity.ValidateHostBundle("bao:secret/data/hosts/host-0001/canary"); err != nil {
		t.Fatalf("ValidateHostBundle(own canary) = %v", err)
	}
}

// TestHostPolicyAllowsOnlyTheHostOwnCanaryPath is property 4's read-scoping
// proof: the policy grants this host's canary and denies every other host's path.
func TestHostPolicyAllowsOnlyTheHostOwnCanaryPath(t *testing.T) {
	t.Parallel()
	identity, err := domain.NewHostIdentity("host-0001", "canary-01")
	if err != nil {
		t.Fatalf("NewHostIdentity: %v", err)
	}
	policy, err := domain.HostPolicyDocument(identity, []string{"bao:secret/data/hosts/host-0001/canary"})
	if err != nil {
		t.Fatalf("HostPolicyDocument: %v", err)
	}
	if !policy.AllowsRead("secret/data/hosts/host-0001/canary") {
		t.Fatal("the policy must allow reading the host's own canary")
	}
	if !policy.AllowsRead("secret/data/hosts/host-0001/anything-else") {
		t.Fatal("the policy must allow the host's own tree, which is what the wildcard is for")
	}
	for _, path := range []string{
		"secret/data/hosts/host-0002/canary",
		"secret/data/hosts/host-0001-other/canary",
		"secret/data/hosts/canary",
		"secret/data/fleet/tailscale-oauth",
		"secret/data/hosts",
	} {
		if policy.AllowsRead(path) {
			t.Fatalf("the policy must not allow reading %q", path)
		}
	}

	rendered := policy.HCL()
	if !strings.Contains(rendered, `path "secret/data/hosts/host-0001/*"`) {
		t.Fatalf("rendered policy does not name the host tree:\n%s", rendered)
	}
	if strings.Contains(rendered, "host-0002") {
		t.Fatalf("rendered policy mentions another host:\n%s", rendered)
	}
}

// TestHostPolicyDeniesCreatingAndChangingIdentities is property 4's write-scoping
// proof: the host cannot create a role, mint a SecretID, create a token, edit a
// policy, or mount an auth method, and a deny wins over any grant.
func TestHostPolicyDeniesCreatingAndChangingIdentities(t *testing.T) {
	t.Parallel()
	identity, err := domain.NewHostIdentity("host-0001", "canary-01")
	if err != nil {
		t.Fatalf("NewHostIdentity: %v", err)
	}
	policy, err := domain.HostPolicyDocument(identity, nil)
	if err != nil {
		t.Fatalf("HostPolicyDocument: %v", err)
	}
	deniedPaths := []string{
		"auth/approle/role/host-0002",
		"auth/approle/role/host-0001",
		"auth/approle/role/host-0001/secret-id",
		"auth/token/create",
		"auth/token/create-orphan",
		"sys/policies/acl/fleet-policy-host-0002",
		"identity/entity/id/0001",
		"sys/auth/approle",
	}
	for _, path := range deniedPaths {
		if !policy.Denies(path) {
			t.Fatalf("policy has no deny rule covering %q", path)
		}
		if policy.AllowsRead(path) {
			t.Fatalf("the policy must not allow reading %q", path)
		}
	}
	rendered := policy.HCL()
	if !strings.Contains(rendered, `path "auth/approle/role/*"`) {
		t.Fatalf("rendered policy does not deny AppRole management:\n%s", rendered)
	}
	for _, capability := range []string{`capabilities = ["read"]`, `capabilities = ["deny"]`} {
		if !strings.Contains(rendered, capability) {
			t.Fatalf("rendered policy is missing %s:\n%s", capability, rendered)
		}
	}
}

// TestHostPolicyRefusesABundleOutsideTheHostTree proves a wrong profile template
// fails before a policy is built, not after a host has been authorized.
func TestHostPolicyRefusesABundleOutsideTheHostTree(t *testing.T) {
	t.Parallel()
	identity, err := domain.NewHostIdentity("host-0001", "canary-01")
	if err != nil {
		t.Fatalf("NewHostIdentity: %v", err)
	}
	if _, err := domain.HostPolicyDocument(identity, []string{"bao:secret/data/hosts/host-0002/canary"}); err == nil {
		t.Fatal("a bundle naming another host must be refused")
	}
	if _, err := domain.HostPolicyDocument(identity, []string{"bao:secret/data/fleet/tailscale-oauth"}); err == nil {
		t.Fatal("a shared bundle must be refused")
	}
}

// TestTokenPolicyRequiresAShortLivedBoundedRenewableToken is property 5's lifetime
// bound at the rule: a host token expires, it can be renewed, and it can never be
// valid past 900 seconds.
func TestTokenPolicyRequiresAShortLivedBoundedRenewableToken(t *testing.T) {
	t.Parallel()
	policy := domain.DefaultTokenPolicy()
	if err := policy.Validate(); err != nil {
		t.Fatalf("DefaultTokenPolicy: %v", err)
	}
	if policy.TTL <= 0 || policy.TTL > 900*time.Second {
		t.Fatalf("default TTL = %s, want (0, 900s]", policy.TTL)
	}
	if policy.MaxTTL > 900*time.Second {
		t.Fatalf("default maximum TTL = %s, want at most 900s", policy.MaxTTL)
	}
	if !policy.Renewable {
		t.Fatal("a host token must be renewable")
	}
	refused := []domain.TokenPolicy{
		{TTL: 0, MaxTTL: 900 * time.Second, RenewIncrement: time.Minute, Renewable: true},
		{TTL: 600 * time.Second, MaxTTL: 901 * time.Second, RenewIncrement: time.Minute, Renewable: true},
		{TTL: 600 * time.Second, MaxTTL: 900 * time.Second, RenewIncrement: time.Minute, Renewable: false},
		{TTL: 900 * time.Second, MaxTTL: 600 * time.Second, RenewIncrement: time.Minute, Renewable: true},
		{TTL: 600 * time.Second, MaxTTL: 900 * time.Second, RenewIncrement: 0, Renewable: true},
		{TTL: 600 * time.Second, MaxTTL: 900 * time.Second, RenewIncrement: 901 * time.Second, Renewable: true},
	}
	for i, candidate := range refused {
		if err := candidate.Validate(); err == nil {
			t.Fatalf("token policy %d (%+v) must be refused", i, candidate)
		}
	}
}

// TestLoginCredentialPolicySurvivesARebootWithSpareUses is property 5's other
// half: the rotating SecretID has a real lifetime and enough uses for a reboot,
// and rotation happens before expiry.
func TestLoginCredentialPolicySurvivesARebootWithSpareUses(t *testing.T) {
	t.Parallel()
	policy := domain.DefaultLoginCredentialPolicy()
	if err := policy.Validate(); err != nil {
		t.Fatalf("DefaultLoginCredentialPolicy: %v", err)
	}
	if policy.SecretIDTTL <= 0 {
		t.Fatalf("SecretIDTTL = %s, want a non-zero lifetime", policy.SecretIDTTL)
	}
	if policy.SecretIDUses < 2 {
		t.Fatalf("SecretIDUses = %d, want at least one use left for the next boot", policy.SecretIDUses)
	}
	if policy.RotationEvery >= policy.SecretIDTTL {
		t.Fatalf("rotation every %s is not shorter than the %s lifetime", policy.RotationEvery, policy.SecretIDTTL)
	}
	mintedAt := time.Date(2026, 11, 26, 0, 0, 0, 0, time.UTC)
	rotateAt, previousExpires := policy.RotateAt(mintedAt)
	if !rotateAt.After(mintedAt) || !rotateAt.Before(mintedAt.Add(policy.SecretIDTTL)) {
		t.Fatalf("rotateAt = %s, want a time before the credential expires", rotateAt)
	}
	if !previousExpires.After(rotateAt) {
		t.Fatalf("previous credential expires at %s, before the rotation at %s", previousExpires, rotateAt)
	}
	for _, candidate := range []domain.LoginCredentialPolicy{
		{SecretIDTTL: 0, SecretIDUses: 8, RotationEvery: time.Hour},
		{SecretIDTTL: time.Hour, SecretIDUses: 1, RotationEvery: time.Minute},
		{SecretIDTTL: time.Hour, SecretIDUses: 8, RotationEvery: time.Hour},
		{SecretIDTTL: time.Hour, SecretIDUses: 8, RotationEvery: 2 * time.Hour},
	} {
		if err := candidate.Validate(); err == nil {
			t.Fatalf("login credential policy %+v must be refused", candidate)
		}
	}
}

// TestSecretBundlesRenderAPerHostPath is property 4's configuration half: the
// shipped mapping renders a different path for each host, and a literal shared
// path is refused at load time.
func TestSecretBundlesRenderAPerHostPath(t *testing.T) {
	t.Parallel()
	bundles := domain.SecretBundles{
		"canary": "bao:secret/data/hosts/{host}/canary",
		"rex":    "bao:secret/data/hosts/{host}/rex",
	}
	first, err := bundles.Render("host-0001")
	if err != nil {
		t.Fatalf("Render(host-0001): %v", err)
	}
	second, err := bundles.Render("host-0002")
	if err != nil {
		t.Fatalf("Render(host-0002): %v", err)
	}
	if len(first) != 2 || first[0] != "bao:secret/data/hosts/host-0001/canary" {
		t.Fatalf("first render = %v", first)
	}
	for i := range first {
		if first[i] == second[i] {
			t.Fatalf("two hosts rendered the same bundle %q", first[i])
		}
	}
}

// TestSecretBundlesRejectASharedOrMalformedTemplate proves every shape that could
// give two hosts one path is refused: no placeholder, a placeholder outside the
// host segment, two placeholders, traversal, and an empty tail.
func TestSecretBundlesRejectASharedOrMalformedTemplate(t *testing.T) {
	t.Parallel()
	rejected := []domain.SecretBundles{
		{"canary": "bao:secret/data/hosts/rex/canary"},
		{"canary": "bao:secret/data/hosts/{host}"},
		{"canary": "bao:secret/data/hosts/{host}/{host}"},
		{"canary": "bao:secret/data/{host}/canary"},
		{"canary": "bao:secret/data/fleet/{host}/canary"},
		{"canary": "bao:secret/data/hosts/{host}/../../etc/passwd"},
		{"canary": "bao:secret/data/hosts/{host}/"},
		{"Canary": "bao:secret/data/hosts/{host}/canary"},
		{"canary": ""},
	}
	for i, bundles := range rejected {
		if _, err := bundles.Render("host-0001"); err == nil {
			t.Fatalf("bundle mapping %d (%v) must be refused", i, bundles)
		}
	}
	if _, err := (domain.SecretBundles{"canary": "bao:secret/data/hosts/{host}/canary"}).Render("../host-0001"); err == nil {
		t.Fatal("rendering for an unsafe host id must fail")
	}
}
