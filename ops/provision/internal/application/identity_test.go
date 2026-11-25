package application_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/testsupport/fakes"
)

// identityHarness wires the OpenBao identity use case to in-process fakes. No
// server, no credential, no network.
type identityHarness struct {
	Backend  *fakes.IdentityBackend
	Delivery *fakes.Bootstrap
	Logger   *fakes.Logger
	Service  *application.IdentityService
}

func newIdentityHarness(t *testing.T) *identityHarness {
	t.Helper()
	h := &identityHarness{
		Backend:  fakes.NewIdentityBackend(),
		Delivery: fakes.NewBootstrap(),
		Logger:   &fakes.Logger{},
	}
	service, err := application.NewIdentityService(application.IdentityDeps{
		Backend:  h.Backend,
		Delivery: h.Delivery,
		Logger:   h.Logger,
	})
	if err != nil {
		t.Fatalf("NewIdentityService: %v", err)
	}
	h.Service = service
	return h
}

func authorizeRequest(hostID, name string) application.AuthorizeRequest {
	return application.AuthorizeRequest{
		HostID:        hostID,
		Name:          name,
		Profile:       "rex",
		SecretBundles: []string{"bao:secret/data/hosts/" + hostID + "/canary"},
	}
}

// TestAuthorizeHostCreatesOneRoleAndPolicyPerHost is property 2 at the use case:
// each host gets its own role and policy, the role carries its claim, and two
// hosts never share either.
func TestAuthorizeHostCreatesOneRoleAndPolicyPerHost(t *testing.T) {
	t.Parallel()
	h := newIdentityHarness(t)
	ctx := context.Background()
	for _, req := range []application.AuthorizeRequest{
		authorizeRequest("host-0001", "canary-01"),
		authorizeRequest("host-0002", "canary-02"),
	} {
		if err := h.Service.AuthorizeHost(ctx, req); err != nil {
			t.Fatalf("AuthorizeHost(%s): %v", req.HostID, err)
		}
	}
	roles := h.Backend.RoleNames()
	if len(roles) != 2 {
		t.Fatalf("roles = %v, want one per host", roles)
	}
	policies := h.Backend.PolicyNames()
	if len(policies) != 2 {
		t.Fatalf("policies = %v, want one per host", policies)
	}
	if roles[0] == roles[1] || policies[0] == policies[1] {
		t.Fatalf("two hosts shared an identity: roles=%v policies=%v", roles, policies)
	}
	role, ok := h.Backend.Role("fleet-host-host-0001")
	if !ok {
		t.Fatalf("role for host-0001 is missing (roles: %v)", roles)
	}
	if role.HostID != "host-0001" || role.PolicyName != "fleet-policy-host-0001" {
		t.Fatalf("role = %+v, want the claim and policy of host-0001", role)
	}
	if role.TokenTTL <= 0 || role.TokenTTL > 900*time.Second || role.TokenMax > 900*time.Second {
		t.Fatalf("role token lifetimes = ttl %s / max %s, want (0, 900s]", role.TokenTTL, role.TokenMax)
	}
	if !role.Renewable {
		t.Fatal("the role must issue renewable tokens")
	}
	if role.SecretIDTTL <= 0 || role.SecretIDUses < 2 {
		t.Fatalf("login credential = ttl %s uses %d, want a reboot-safe credential", role.SecretIDTTL, role.SecretIDUses)
	}
}

// TestAuthorizeHostRefusesASecondHostClaimingAnExistingRole is property 2's
// refusal: a role name already bound to one host cannot be claimed by another,
// and the refused host gets no SecretID.
func TestAuthorizeHostRefusesASecondHostClaimingAnExistingRole(t *testing.T) {
	t.Parallel()
	h := newIdentityHarness(t)
	// Model a role that already exists outside this run: the derived name for
	// host-0002 is claimed by host-0001.
	h.Backend.SeedRoleClaim("fleet-host-host-0002", "host-0001")

	err := h.Service.AuthorizeHost(context.Background(), authorizeRequest("host-0002", "canary-02"))
	if err == nil {
		t.Fatal("AuthorizeHost must refuse a role already claimed by another host")
	}
	var claim *domain.RoleClaimError
	if !errors.As(err, &claim) {
		t.Fatalf("error = %T (%v), want *domain.RoleClaimError", err, err)
	}
	if claim.ClaimedHost != "host-0001" || claim.RequestedBy != "host-0002" {
		t.Fatalf("claim error = %+v", claim)
	}
	if mints := h.Backend.Mints(); len(mints) != 0 {
		t.Fatalf("a refused host received %d SecretID mints", len(mints))
	}
	if delivered := h.Delivery.Deliveries(); len(delivered) != 0 {
		t.Fatalf("a refused host received %d bootstrap deliveries", len(delivered))
	}
}

// TestAuthorizeHostMintsOneUseWrappedSecretIDAndNeverReturnsIt is property 3 at
// the use case: the mandate is delivered as a wrapping token, only once, and no
// SecretID appears in the delivery, the log, or the returned error.
func TestAuthorizeHostMintsOneUseWrappedSecretIDAndNeverReturnsIt(t *testing.T) {
	t.Parallel()
	h := newIdentityHarness(t)
	if err := h.Service.AuthorizeHost(context.Background(), authorizeRequest("host-0001", "canary-01")); err != nil {
		t.Fatalf("AuthorizeHost: %v", err)
	}
	if mints := h.Backend.Mints(); len(mints) != 1 {
		t.Fatalf("mints = %v, want exactly one wrapped SecretID", mints)
	}
	delivered := h.Delivery.Deliveries()
	if len(delivered) != 1 {
		t.Fatalf("deliveries = %d, want 1", len(delivered))
	}
	material := delivered[0]
	if material.HostID != "host-0001" || material.RoleID != "fleet-host-host-0001" {
		t.Fatalf("delivery = %+v", material)
	}
	if material.WrapTok.Empty() {
		t.Fatal("the delivery must carry the wrapping token")
	}
	if material.TTL <= 0 || material.TTL > 900*time.Second {
		t.Fatalf("wrap TTL = %s, want a short one-use window", material.TTL)
	}
	paths := h.Delivery.Paths()
	if len(paths) != 1 || !strings.Contains(paths[0], "host-0001") {
		t.Fatalf("delivery path = %v", paths)
	}
	for _, line := range h.Logger.Lines() {
		if strings.Contains(line, "secret-id-value") {
			t.Fatalf("a log line carried a SecretID: %s", line)
		}
		if strings.Contains(line, string(material.WrapTok.Bytes())) {
			t.Fatalf("a log line carried the wrapping token: %s", line)
		}
	}
	if !strings.Contains(strings.Join(h.Logger.Lines(), "\n"), "bootstrap_path") {
		t.Fatalf("the authorization was not logged: %v", h.Logger.Lines())
	}
}

// TestAuthorizeHostRefusesABundleOutsideTheHostOwnPath is property 4's refusal at
// the use case: a bundle naming another host never reaches a policy or a role.
func TestAuthorizeHostRefusesABundleOutsideTheHostOwnPath(t *testing.T) {
	t.Parallel()
	h := newIdentityHarness(t)
	req := authorizeRequest("host-0001", "canary-01")
	req.SecretBundles = []string{"bao:secret/data/hosts/host-0002/canary"}
	if err := h.Service.AuthorizeHost(context.Background(), req); err == nil {
		t.Fatal("AuthorizeHost must refuse a bundle outside the host's own path")
	}
	if names := h.Backend.PolicyNames(); len(names) != 0 {
		t.Fatalf("a refused request wrote policies: %v", names)
	}
	if names := h.Backend.RoleNames(); len(names) != 0 {
		t.Fatalf("a refused request wrote roles: %v", names)
	}
}

// TestAuthorizeHostPolicyGrantsOnlyTheHostCanary is property 4 end to end through
// the fake: the document the adapter would send allows the host's canary, denies
// another host's path, and denies identity creation.
func TestAuthorizeHostPolicyGrantsOnlyTheHostCanary(t *testing.T) {
	t.Parallel()
	h := newIdentityHarness(t)
	if err := h.Service.AuthorizeHost(context.Background(), authorizeRequest("host-0001", "canary-01")); err != nil {
		t.Fatalf("AuthorizeHost: %v", err)
	}
	policy, ok := h.Backend.Policy("fleet-policy-host-0001")
	if !ok {
		t.Fatal("the host policy was not written")
	}
	if !strings.Contains(policy.Document, `path "secret/data/hosts/host-0001/*"`) {
		t.Fatalf("policy does not scope to the host tree:\n%s", policy.Document)
	}
	if strings.Contains(policy.Document, "host-0002") {
		t.Fatalf("policy names another host:\n%s", policy.Document)
	}
	if !strings.Contains(policy.Document, `path "auth/approle/role/*"`) {
		t.Fatalf("policy does not deny identity creation:\n%s", policy.Document)
	}
}

// TestAuthorizeHostErrorCarriesNoCredential is the error-path half of the leak
// canary: a backend failure whose message contains a SecretID must reach the
// caller sanitized, never verbatim.
func TestAuthorizeHostErrorCarriesNoCredential(t *testing.T) {
	t.Parallel()
	const canary = "s.verySecretSecretIDValue0123456789"
	h := newIdentityHarness(t)
	h.Backend.FailMints(errors.New("server rejected secret_id=" + canary + " for role fleet-host-host-0001"))
	err := h.Service.AuthorizeHost(context.Background(), authorizeRequest("host-0001", "canary-01"))
	if err == nil {
		t.Fatal("AuthorizeHost must surface the minting failure")
	}
	if strings.Contains(err.Error(), canary) {
		t.Fatalf("the error carried a SecretID: %v", err)
	}
	if len(err.Error()) > 250 {
		t.Fatalf("the error is not bounded: %d bytes", len(err.Error()))
	}
	for _, line := range h.Logger.Lines() {
		if strings.Contains(line, canary) {
			t.Fatalf("a log line carried a SecretID: %s", line)
		}
	}
}

// TestRevokeHostRemovesTheRoleAndPolicy is the teardown side: revoking the login
// credential deletes both halves of the identity and is idempotent.
//
// It also pins the asymmetry the docs state: deleting the AppRole removes the
// ability to log in, and leaves a token that was already issued untouched. That is
// why teardown revokes tokens in its own step.
func TestRevokeHostRemovesTheRoleAndPolicy(t *testing.T) {
	t.Parallel()
	h := newIdentityHarness(t)
	ctx := context.Background()
	req := authorizeRequest("host-0001", "canary-01")
	if err := h.Service.AuthorizeHost(ctx, req); err != nil {
		t.Fatalf("AuthorizeHost: %v", err)
	}
	// A token that was already issued before the teardown: it carries the host's
	// policy, exactly as an AppRole login would.
	issued := h.Backend.IssueAppRoleToken("fleet-host-host-0001", "default")

	report, err := h.Service.RevokeCredentials(ctx, req)
	if err != nil {
		t.Fatalf("RevokeCredentials: %v", err)
	}
	if !report.RoleDeleted || !report.PolicyDeleted {
		t.Fatalf("revocation report = %+v, want both halves deleted", report)
	}
	if names := h.Backend.RoleNames(); len(names) != 0 {
		t.Fatalf("roles survived revocation: %v", names)
	}
	if names := h.Backend.PolicyNames(); len(names) != 0 {
		t.Fatalf("policies survived revocation: %v", names)
	}
	if tokens := h.Backend.Tokens(); len(tokens) != 1 || tokens[0] != issued {
		t.Fatalf("issued tokens after deleting the role = %v, want the one already-issued token still present; deleting an AppRole does not invalidate it", tokens)
	}

	second, err := h.Service.RevokeCredentials(ctx, req)
	if err != nil {
		t.Fatalf("RevokeCredentials must be idempotent: %v", err)
	}
	if !second.RoleDeleted || !second.PolicyDeleted {
		t.Fatalf("second revocation report = %+v, want both halves reported deleted", second)
	}
}

// TestNewIdentityServiceRefusesATokenPolicyAboveTheHardMaximum keeps a
// misconfiguration from becoming a long-lived host token.
func TestNewIdentityServiceRefusesATokenPolicyAboveTheHardMaximum(t *testing.T) {
	t.Parallel()
	_, err := application.NewIdentityService(application.IdentityDeps{
		Backend:  fakes.NewIdentityBackend(),
		Delivery: fakes.NewBootstrap(),
		Logger:   &fakes.Logger{},
		TokenPolicy: domain.TokenPolicy{
			TTL:            20 * time.Minute,
			MaxTTL:         20 * time.Minute,
			RenewIncrement: 5 * time.Minute,
			Renewable:      true,
		},
	})
	if err == nil {
		t.Fatal("a token policy above 900 seconds must be refused at construction")
	}
}
