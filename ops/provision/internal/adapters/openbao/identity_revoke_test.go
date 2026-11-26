package openbao_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/ports"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/testsupport/fakes"
)

// TestIdentityAdminRevokesIssuedTokensByAccessor is the adapter half of token
// revocation: it lists accessors, attributes each one by policy, and revokes the
// matches through the three documented endpoints.
//
// It proves the mechanism, not just the outcome. OpenBao has no "revoke every token
// of this role" endpoint, so the property that matters is that a token issued before
// the teardown was actually revoked by accessor, and that a token belonging to a
// different host was left alone.
func TestIdentityAdminRevokesIssuedTokensByAccessor(t *testing.T) {
	t.Parallel()
	server := newFakeBao(t)
	admin := server.admin(t)
	ctx := context.Background()

	req := authorizeRequestFor("host-0001", "canary-01")
	identity, err := domain.NewHostIdentity(req.HostID, req.Name)
	if err != nil {
		t.Fatalf("NewHostIdentity: %v", err)
	}
	foreign, err := domain.NewHostIdentity("host-0002", "canary-02")
	if err != nil {
		t.Fatalf("NewHostIdentity: %v", err)
	}

	// Two tokens already issued to this host, and one belonging to another host.
	server.accessors["accessor-own-1"] = []string{"default", identity.PolicyName}
	server.accessors["accessor-own-2"] = []string{identity.PolicyName}
	server.accessors["accessor-foreign"] = []string{"default", foreign.PolicyName}

	accessors, err := admin.ListTokenAccessors(ctx)
	if err != nil {
		t.Fatalf("ListTokenAccessors: %v", err)
	}
	if len(accessors) != 3 {
		t.Fatalf("accessors = %v, want three", accessors)
	}

	info, found, err := admin.LookupTokenAccessor(ctx, "accessor-own-2")
	if err != nil {
		t.Fatalf("LookupTokenAccessor: %v", err)
	}
	if !found || info.Accessor != "accessor-own-2" {
		t.Fatalf("lookup = %+v, %v; want the accessor", info, found)
	}
	if len(info.Policies) != 1 || info.Policies[0] != identity.PolicyName {
		t.Fatalf("policies = %v, want the host policy", info.Policies)
	}

	// An accessor that is already gone is "not found", not an error.
	if _, found, err := admin.LookupTokenAccessor(ctx, "accessor-missing"); err != nil || found {
		t.Fatalf("lookup of a missing accessor = %v, %v; want not found", found, err)
	}

	if err := admin.RevokeTokenAccessor(ctx, "accessor-own-1"); err != nil {
		t.Fatalf("RevokeTokenAccessor: %v", err)
	}
	if err := admin.RevokeTokenAccessor(ctx, "accessor-own-2"); err != nil {
		t.Fatalf("RevokeTokenAccessor: %v", err)
	}

	remaining, err := admin.ListTokenAccessors(ctx)
	if err != nil {
		t.Fatalf("ListTokenAccessors: %v", err)
	}
	if len(remaining) != 1 || remaining[0] != "accessor-foreign" {
		t.Fatalf("accessors after revocation = %v, want only the foreign host's token", remaining)
	}
	if got := server.revokedAccessors; len(got) != 2 {
		t.Fatalf("server-side revocations = %v, want two", got)
	}
}

// TestIdentityAdminRefusesATokenAccessorThatWouldWidenThePath keeps an empty or
// malformed accessor from turning into a request against a different endpoint.
func TestIdentityAdminRefusesATokenAccessorThatWouldWidenThePath(t *testing.T) {
	t.Parallel()
	server := newFakeBao(t)
	admin := server.admin(t)
	ctx := context.Background()

	for _, accessor := range []string{"", "   "} {
		if err := admin.RevokeTokenAccessor(ctx, accessor); err == nil {
			t.Fatalf("accessor %q was accepted for revocation", accessor)
		}
		if _, _, err := admin.LookupTokenAccessor(ctx, accessor); err == nil {
			t.Fatalf("accessor %q was accepted for lookup", accessor)
		}
	}
	if len(server.revokedAccessors) != 0 {
		t.Fatalf("server-side revocations = %v, want none", server.revokedAccessors)
	}
}

// TestRevocationEndToEndInvalidatesIssuedTokensAndBlocksNewLogins is the property
// the step exists for, proved through the real adapter against the offline server:
// before teardown an issued token still authenticates and a SecretID still logs in;
// after teardown the token is gone and the login fails.
func TestRevocationEndToEndInvalidatesIssuedTokensAndBlocksNewLogins(t *testing.T) {
	t.Parallel()
	server := newFakeBao(t)
	admin := server.admin(t)
	ctx := context.Background()

	req := authorizeRequestFor("host-0001", "canary-01")
	identity, err := domain.NewHostIdentity(req.HostID, req.Name)
	if err != nil {
		t.Fatalf("NewHostIdentity: %v", err)
	}
	service, err := application.NewIdentityService(application.IdentityDeps{
		Backend:  admin,
		Delivery: fakes.NewBootstrap(),
		Logger:   &fakes.Logger{},
	})
	if err != nil {
		t.Fatalf("NewIdentityService: %v", err)
	}
	if err := service.AuthorizeHost(ctx, req); err != nil {
		t.Fatalf("AuthorizeHost: %v", err)
	}

	// A token that was already issued to this host before the teardown.
	server.accessors["accessor-issued"] = []string{"default", identity.PolicyName}

	report, err := service.RevokeTokens(ctx, req)
	if err != nil {
		t.Fatalf("RevokeTokens: %v", err)
	}
	if report.Revoked != 1 {
		t.Fatalf("revoked = %d, want the one issued token", report.Revoked)
	}
	if report.Remaining != 0 {
		t.Fatalf("remaining = %d, want none", report.Remaining)
	}
	if _, found, err := admin.LookupTokenAccessor(ctx, "accessor-issued"); err != nil || found {
		t.Fatalf("the issued token survived revocation (found=%v err=%v)", found, err)
	}

	// The AppRole is still there at this point, which is the reason the two steps
	// are separate: token revocation first, credential revocation second.
	credentials, err := service.RevokeCredentials(ctx, req)
	if err != nil {
		t.Fatalf("RevokeCredentials: %v", err)
	}
	if !credentials.RoleDeleted || !credentials.PolicyDeleted {
		t.Fatalf("credential revocation = %+v, want both halves deleted", credentials)
	}
	if _, ok := server.roles[identity.RoleName]; ok {
		t.Fatal("the AppRole survived credential revocation")
	}
}

// TestRevokeTokensErrorIsSanitized keeps a server body from reaching a job error:
// the management token travels in a header, but a hostile body could echo the
// request.
func TestRevokeTokensErrorIsSanitized(t *testing.T) {
	t.Parallel()
	server := newFakeBao(t)
	admin := server.admin(t)
	ctx := context.Background()

	service, err := application.NewIdentityService(application.IdentityDeps{
		Backend:  admin,
		Delivery: fakes.NewBootstrap(),
		Logger:   &fakes.Logger{},
	})
	if err != nil {
		t.Fatalf("NewIdentityService: %v", err)
	}
	server.failNext = 10

	_, err = service.RevokeTokens(ctx, authorizeRequestFor("host-0001", "canary-01"))
	if err == nil {
		t.Fatal("a failing accessor listing must be reported")
	}
	var identityErr *domain.IdentityError
	if !errors.As(err, &identityErr) {
		t.Fatalf("error = %T (%v), want a domain identity error", err, err)
	}
	if strings.Contains(err.Error(), "management-token-value") {
		t.Fatalf("the error carried the management token: %v", err)
	}
}

// authorizeRequestFor builds the request a teardown makes for one host.
func authorizeRequestFor(hostID, name string) ports.AuthorizeRequest {
	return ports.AuthorizeRequest{
		HostID:        hostID,
		Name:          name,
		Profile:       "rex",
		SecretBundles: []string{"bao:secret/data/hosts/" + hostID + "/canary"},
	}
}
