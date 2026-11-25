package application_test

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// TestRevokeTokensInvalidatesAlreadyIssuedTokens is the property revocation exists
// for: a token that was handed out before the teardown stops working, and a token
// belonging to another host is untouched.
func TestRevokeTokensInvalidatesAlreadyIssuedTokens(t *testing.T) {
	t.Parallel()
	h := newIdentityHarness(t)
	ctx := context.Background()

	req := authorizeRequest("host-0001", "canary-01")
	if err := h.Service.AuthorizeHost(ctx, req); err != nil {
		t.Fatalf("AuthorizeHost: %v", err)
	}
	foreign := authorizeRequest("host-0002", "canary-02")
	if err := h.Service.AuthorizeHost(ctx, foreign); err != nil {
		t.Fatalf("AuthorizeHost(host-0002): %v", err)
	}

	own1 := h.Backend.IssueAppRoleToken("fleet-host-host-0001", "default")
	own2 := h.Backend.IssueAppRoleToken("fleet-host-host-0001", "default")
	theirs := h.Backend.IssueAppRoleToken("fleet-host-host-0002", "default")

	report, err := h.Service.RevokeTokens(ctx, req)
	if err != nil {
		t.Fatalf("RevokeTokens: %v", err)
	}
	if report.Revoked != 2 {
		t.Fatalf("revoked = %d, want the two tokens issued to this host", report.Revoked)
	}
	if report.Remaining != 0 {
		t.Fatalf("remaining = %d, want none still carrying the host policy", report.Remaining)
	}

	remaining := h.Backend.Tokens()
	if len(remaining) != 1 || remaining[0] != theirs {
		t.Fatalf("tokens after revocation = %v, want only the foreign host's", remaining)
	}
	for _, revoked := range []string{own1, own2} {
		if contains(h.Backend.Tokens(), revoked) {
			t.Fatalf("token %q survived revocation", revoked)
		}
	}
	if revoked := h.Backend.Revoked(); len(revoked) != 2 {
		t.Fatalf("revoked accessors = %v, want two", revoked)
	}
}

// TestRevokeCredentialsDoesNotInvalidateIssuedTokens states the documented
// asymmetry as a test: deleting the AppRole removes every SecretID and leaves an
// already-issued token working. This is why the teardown has two credential steps
// and why the docs say revoking an AppRole is not a revocation.
func TestRevokeCredentialsDoesNotInvalidateIssuedTokens(t *testing.T) {
	t.Parallel()
	h := newIdentityHarness(t)
	ctx := context.Background()

	req := authorizeRequest("host-0001", "canary-01")
	if err := h.Service.AuthorizeHost(ctx, req); err != nil {
		t.Fatalf("AuthorizeHost: %v", err)
	}
	issued := h.Backend.IssueAppRoleToken("fleet-host-host-0001", "default")

	report, err := h.Service.RevokeCredentials(ctx, req)
	if err != nil {
		t.Fatalf("RevokeCredentials: %v", err)
	}
	if !report.RoleDeleted || !report.PolicyDeleted {
		t.Fatalf("report = %+v, want both halves deleted", report)
	}
	if names := h.Backend.RoleNames(); len(names) != 0 {
		t.Fatalf("roles survived: %v", names)
	}
	// The point of the test: the issued token is still valid, because deleting an
	// AppRole only stops future logins.
	if tokens := h.Backend.Tokens(); len(tokens) != 1 || tokens[0] != issued {
		t.Fatalf("issued tokens after RevokeCredentials = %v, want the token to survive; deleting an AppRole does not invalidate it", tokens)
	}
	if revocations := h.Backend.Revoked(); len(revocations) != 0 {
		t.Fatalf("RevokeCredentials revoked %v; it must not touch issued tokens", revocations)
	}
}

// TestRevokeTokensIsIdempotent proves a retried teardown re-runs the step without
// error and reports nothing left to do.
func TestRevokeTokensIsIdempotent(t *testing.T) {
	t.Parallel()
	h := newIdentityHarness(t)
	ctx := context.Background()

	req := authorizeRequest("host-0001", "canary-01")
	if err := h.Service.AuthorizeHost(ctx, req); err != nil {
		t.Fatalf("AuthorizeHost: %v", err)
	}
	h.Backend.IssueAppRoleToken("fleet-host-host-0001", "default")

	first, err := h.Service.RevokeTokens(ctx, req)
	if err != nil {
		t.Fatalf("first RevokeTokens: %v", err)
	}
	second, err := h.Service.RevokeTokens(ctx, req)
	if err != nil {
		t.Fatalf("second RevokeTokens must not fail: %v", err)
	}
	if first.Revoked != 1 || second.Revoked != 0 {
		t.Fatalf("revocations = %d then %d, want 1 then 0", first.Revoked, second.Revoked)
	}
	if second.Remaining != 0 {
		t.Fatalf("remaining after the second pass = %d, want 0", second.Remaining)
	}
}

// TestRevokeTokensReportsWhatStayedWhenTheServerRefuses proves a partial revocation
// is reported rather than reported as success: the count of tokens that still carry
// the policy is what the teardown turns into an incomplete step.
func TestRevokeTokensReportsWhatStayedWhenTheServerRefuses(t *testing.T) {
	t.Parallel()
	h := newIdentityHarness(t)
	ctx := context.Background()

	req := authorizeRequest("host-0001", "canary-01")
	if err := h.Service.AuthorizeHost(ctx, req); err != nil {
		t.Fatalf("AuthorizeHost: %v", err)
	}
	h.Backend.IssueAppRoleToken("fleet-host-host-0001", "default")
	h.Backend.FailRevokes(errors.New("permission denied on auth/token/revoke-accessor"))

	report, err := h.Service.RevokeTokens(ctx, req)
	if err != nil {
		t.Fatalf("a refused accessor revocation is reported in the result, not as an error: %v", err)
	}
	if report.Revoked != 0 {
		t.Fatalf("revoked = %d, want none", report.Revoked)
	}
	if report.Remaining != 1 {
		t.Fatalf("remaining = %d, want the token that could not be revoked", report.Remaining)
	}
}

// TestRevokeTokensRefusesWhenAccessorsCannotBeListed is the fail-closed half: if the
// management token cannot list accessors, revocation cannot know what to revoke, so
// it reports an error instead of claiming the host is cut off.
func TestRevokeTokensRefusesWhenAccessorsCannotBeListed(t *testing.T) {
	t.Parallel()
	h := newIdentityHarness(t)
	ctx := context.Background()

	req := authorizeRequest("host-0001", "canary-01")
	if err := h.Service.AuthorizeHost(ctx, req); err != nil {
		t.Fatalf("AuthorizeHost: %v", err)
	}
	h.Backend.FailListTokenAccessors(errors.New("permission denied on auth/token/accessors"))

	if _, err := h.Service.RevokeTokens(ctx, req); err == nil {
		t.Fatal("revocation must fail when the issued tokens cannot be enumerated")
	}
}

// TestRevokeCredentialsRefusesAnotherHostsRole keeps one host's teardown from
// deleting another host's identity: the role name is derived from the host id, and
// a claim that belongs elsewhere is refused by the backend.
func TestRevokeCredentialsRefusesAnotherHostsRole(t *testing.T) {
	t.Parallel()
	h := newIdentityHarness(t)
	ctx := context.Background()

	foreign := authorizeRequest("host-0002", "canary-02")
	if err := h.Service.AuthorizeHost(ctx, foreign); err != nil {
		t.Fatalf("AuthorizeHost(host-0002): %v", err)
	}
	// A hostile or broken caller naming host-0001 must not be able to delete
	// host-0002's role, so the roles must simply be different names.
	own := authorizeRequest("host-0001", "canary-01")
	if _, err := h.Service.RevokeCredentials(ctx, own); err != nil {
		t.Fatalf("RevokeCredentials for a host that was never authorized: %v", err)
	}
	if names := h.Backend.RoleNames(); len(names) != 1 || names[0] != "fleet-host-host-0002" {
		t.Fatalf("roles after revoking host-0001 = %v, want host-0002's role untouched", names)
	}
}

// TestRevocationLogCarriesNoAccessorValue keeps the identifiers revocation works
// on out of the log: the counts are reported, the accessor values are not.
func TestRevocationLogCarriesNoAccessorValue(t *testing.T) {
	t.Parallel()
	h := newIdentityHarness(t)
	ctx := context.Background()

	req := authorizeRequest("host-0001", "canary-01")
	if err := h.Service.AuthorizeHost(ctx, req); err != nil {
		t.Fatalf("AuthorizeHost: %v", err)
	}
	accessor := h.Backend.IssueAppRoleToken("fleet-host-host-0001", "default")
	if _, err := h.Service.RevokeTokens(ctx, req); err != nil {
		t.Fatalf("RevokeTokens: %v", err)
	}

	joined := strings.Join(h.Logger.Lines(), "\n")
	if strings.Contains(joined, accessor) {
		t.Fatalf("a log line carried the accessor value: %s", joined)
	}
	if !strings.Contains(joined, "accessors_revoked") {
		t.Fatalf("the log does not report the count that makes revocation auditable: %s", joined)
	}
}

// contains reports whether values holds want.
func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
