package application

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/ports"
)

// IdentityDeps are the collaborators of the authorization use case.
type IdentityDeps struct {
	Backend  ports.IdentityBackend
	Delivery ports.BootstrapDelivery
	Logger   ports.Logger
	// TokenPolicy defaults to domain.DefaultTokenPolicy.
	TokenPolicy domain.TokenPolicy
	// LoginPolicy defaults to domain.DefaultLoginCredentialPolicy.
	LoginPolicy domain.LoginCredentialPolicy
	// WrapTTL defaults to domain.BootstrapWrapTTL.
	WrapTTL time.Duration
}

// IdentityService is the per-host OpenBao authorization use case. It implements
// the HostAuthorizer port, so the workflow and the activity stay unaware of
// AppRoles, policies, and response wrapping.
type IdentityService struct {
	backend     ports.IdentityBackend
	delivery    ports.BootstrapDelivery
	log         ports.Logger
	tokenPolicy domain.TokenPolicy
	loginPolicy domain.LoginCredentialPolicy
	wrapTTL     time.Duration
}

var _ ports.HostAuthorizer = (*IdentityService)(nil)

// NewIdentityService validates the dependencies and the lifetime policies before
// any identity is created: a token policy above the hard maximum is a
// configuration error, not a runtime surprise.
func NewIdentityService(deps IdentityDeps) (*IdentityService, error) {
	switch {
	case deps.Backend == nil:
		return nil, errors.New("application: openbao identity backend is required")
	case deps.Delivery == nil:
		return nil, errors.New("application: bootstrap delivery is required")
	case deps.Logger == nil:
		return nil, errors.New("application: logger is required")
	}
	tokenPolicy := deps.TokenPolicy
	if tokenPolicy == (domain.TokenPolicy{}) {
		tokenPolicy = domain.DefaultTokenPolicy()
	}
	if err := tokenPolicy.Validate(); err != nil {
		return nil, fmt.Errorf("application: %w", err)
	}
	loginPolicy := deps.LoginPolicy
	if loginPolicy == (domain.LoginCredentialPolicy{}) {
		loginPolicy = domain.DefaultLoginCredentialPolicy()
	}
	if err := loginPolicy.Validate(); err != nil {
		return nil, fmt.Errorf("application: %w", err)
	}
	wrapTTL := deps.WrapTTL
	if wrapTTL <= 0 {
		wrapTTL = domain.BootstrapWrapTTL
	}
	return &IdentityService{
		backend:     deps.Backend,
		delivery:    deps.Delivery,
		log:         deps.Logger,
		tokenPolicy: tokenPolicy,
		loginPolicy: loginPolicy,
		wrapTTL:     wrapTTL,
	}, nil
}

// AuthorizeHost creates the host's AppRole, applies its own-path policy, mints a
// one-use response-wrapped SecretID, and delivers the wrapping token out of band.
//
// The order is the security property:
//  1. derive the identity from the host id (not from the name, the profile, or any
//     client input), so the role name is unique by construction;
//  2. refuse a bundle that is not under the host's own KV path, before anything is
//     written;
//  3. write the policy, then the role; a role whose claim belongs to another host
//     is refused here and nothing is minted;
//  4. mint the SecretID wrapped, so the value never travels;
//  5. deliver the wrapping token as a 0600 file outside every record store.
//
// No SecretID exists in this process at any point, so none can reach a payload, a
// log, or an error.
func (s *IdentityService) AuthorizeHost(ctx context.Context, req ports.AuthorizeRequest) error {
	identity, err := domain.NewHostIdentity(req.HostID, req.Name)
	if err != nil {
		return err
	}
	bundles := domain.SortBundles(req.SecretBundles)
	for _, ref := range bundles {
		if err := identity.ValidateHostBundle(ref); err != nil {
			return err
		}
	}
	policy, err := domain.HostPolicyDocument(identity, bundles)
	if err != nil {
		return err
	}
	if err := s.backend.EnsurePolicy(ctx, ports.IdentityPolicy{
		Name:     policy.Name,
		HostID:   identity.HostID,
		Document: policy.HCL(),
	}); err != nil {
		return identityFailure("policy", identity.HostID, err)
	}

	state, err := s.backend.EnsureAppRole(ctx, ports.IdentityRole{
		Name:         identity.RoleName,
		HostID:       identity.HostID,
		HostName:     identity.HostName,
		PolicyName:   identity.PolicyName,
		TokenTTL:     s.tokenPolicy.TTL,
		TokenMax:     s.tokenPolicy.MaxTTL,
		Renewable:    s.tokenPolicy.Renewable,
		SecretIDTTL:  s.loginPolicy.SecretIDTTL,
		SecretIDUses: s.loginPolicy.SecretIDUses,
	})
	if err != nil {
		return identityFailure("role", identity.HostID, err)
	}
	if state.HostID != "" && state.HostID != identity.HostID {
		return &domain.RoleClaimError{
			RoleName:    identity.RoleName,
			ClaimedHost: state.HostID,
			RequestedBy: identity.HostID,
		}
	}

	wrapped, err := s.backend.MintWrappedSecretID(ctx, identity.RoleName, ports.IdentityWrapSpec{TTL: s.wrapTTL})
	if err != nil {
		return identityFailure("mint_wrapped_secret_id", identity.HostID, err)
	}
	// The wrapping token is destroyed before this call returns: the delivered file
	// is the host's copy, and this process keeps none.
	defer wrapped.WrapToken.Destroy()

	path, err := s.delivery.DeliverBootstrap(ctx, ports.BootstrapMaterial{
		HostID:  identity.HostID,
		RoleID:  identity.RoleName,
		WrapTok: wrapped.WrapToken,
		TTL:     wrapped.TTL,
	})
	if err != nil {
		return identityFailure("deliver_bootstrap", identity.HostID, err)
	}

	s.log.Info("host.identity.authorized",
		"host_id", identity.HostID,
		"role", identity.RoleName,
		"policy", identity.PolicyName,
		"bundles", len(bundles),
		"wrap_ttl_seconds", int(wrapped.TTL.Seconds()),
		"bootstrap_path", path,
	)
	return nil
}

// RevokeTokens invalidates every already-issued token that carries this host's
// policy and reports how many it revoked and how many remain.
//
// This is the step that deleting an AppRole cannot do. OpenBao keeps an issued
// token alive until it expires; deleting the role it came from removes the ability
// to log in again and leaves the existing session working. Revocation therefore
// enumerates accessors, attributes each one by policy, and revokes the matches.
//
// The call is idempotent: a second pass finds nothing carrying the policy and
// reports zero revoked, zero remaining.
func (s *IdentityService) RevokeTokens(ctx context.Context, req ports.AuthorizeRequest) (ports.TokenRevocation, error) {
	identity, err := domain.NewHostIdentity(req.HostID, req.Name)
	if err != nil {
		return ports.TokenRevocation{}, err
	}
	revoked, remaining, err := s.revokeIssuedTokens(ctx, identity)
	if err != nil {
		return ports.TokenRevocation{Revoked: revoked, Remaining: remaining}, identityFailure("revoke_tokens", identity.HostID, err)
	}
	s.log.Info("host.identity.tokens_revoked",
		"host_id", identity.HostID,
		"policy", identity.PolicyName,
		"accessors_revoked", revoked,
		"accessors_remaining", remaining,
	)
	return ports.TokenRevocation{Revoked: revoked, Remaining: remaining}, nil
}

// RevokeCredentials deletes the AppRole and the ACL policy, which is what stops
// every future login. It deliberately does not claim to invalidate anything that
// was already issued: the returned struct reports only what it deleted, and the
// docs state the distinction plainly.
//
// The AppRole goes first: OpenBao deletes every SecretID and the ownership claim
// with it, so an interrupted run leaves no way to log in even if the policy is
// still present.
func (s *IdentityService) RevokeCredentials(ctx context.Context, req ports.AuthorizeRequest) (ports.CredentialRevocation, error) {
	identity, err := domain.NewHostIdentity(req.HostID, req.Name)
	if err != nil {
		return ports.CredentialRevocation{}, err
	}
	report := ports.CredentialRevocation{}
	if err := s.backend.DeleteAppRole(ctx, identity.RoleName); err != nil {
		return report, identityFailure("revoke_role", identity.HostID, err)
	}
	report.RoleDeleted = true
	if err := s.backend.DeletePolicy(ctx, identity.PolicyName); err != nil {
		return report, identityFailure("revoke_policy", identity.HostID, err)
	}
	report.PolicyDeleted = true
	s.log.Info("host.identity.credentials_revoked",
		"host_id", identity.HostID,
		"role", identity.RoleName,
		"policy", identity.PolicyName,
	)
	return report, nil
}

// revokeIssuedTokens invalidates every accessor carrying this host's policy. It
// returns the number revoked and the number that still carry the policy
// afterwards, so a partial revocation is reportable rather than silent.
//
// A token that disappears between listing and lookup is skipped: it expired, which
// is the outcome revocation wanted. A host with no tokens is the normal case for a
// host that never logged in, and it is not an error.
func (s *IdentityService) revokeIssuedTokens(ctx context.Context, identity domain.HostIdentity) (revoked, remaining int, err error) {
	accessors, err := s.backend.ListTokenAccessors(ctx)
	if err != nil {
		return 0, 0, err
	}
	for _, accessor := range accessors {
		info, found, lookupErr := s.backend.LookupTokenAccessor(ctx, accessor)
		if lookupErr != nil {
			return revoked, remaining, lookupErr
		}
		if !found || !containsString(info.Policies, identity.PolicyName) {
			continue
		}
		if revokeErr := s.backend.RevokeTokenAccessor(ctx, accessor); revokeErr != nil {
			remaining++
			continue
		}
		revoked++
	}
	return revoked, remaining, nil
}

// identityFailure converts a backend failure into a bounded, credential-free
// error. Typed refusals (a role claimed by another host, a consumed wrapping
// token, an invalid request) survive as themselves; anything else — including a
// server message that echoed a request — is sanitized, so no SecretID, wrapping
// token, or token value can reach a job record, a workflow error, or a log line.
func identityFailure(operation, hostID string, err error) error {
	var claim *domain.RoleClaimError
	if errors.As(err, &claim) {
		return claim
	}
	var consumed *domain.WrapTokenConsumedError
	if errors.As(err, &consumed) {
		return consumed
	}
	var invalid *domain.ValidationError
	if errors.As(err, &invalid) {
		return invalid
	}
	var notImplemented *domain.NotImplementedError
	if errors.As(err, &notImplemented) {
		return notImplemented
	}
	return &domain.IdentityError{Operation: operation, HostID: hostID, Reason: domain.SanitizeMessage(err.Error())}
}

// LoginCredentialPolicy reports the rotation policy in force, so an operator
// command and a test read the same values the service uses.
func (s *IdentityService) LoginCredentialPolicy() domain.LoginCredentialPolicy { return s.loginPolicy }

// containsString reports whether values holds want. It is the one comparison
// revocation needs: does this token carry the host's policy?
func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
