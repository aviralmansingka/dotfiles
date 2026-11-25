package application

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// IdentityPolicy is one ACL policy document, already rendered by the domain.
// Document is policy text; it contains paths and capabilities, never a value.
type IdentityPolicy struct {
	Name     string
	HostID   string
	Document string
}

// IdentityRole is the AppRole definition for one host. Every lifetime is derived
// from the domain policy types, and HostID is the claim that makes the role
// unusable by any other host.
type IdentityRole struct {
	Name       string
	HostID     string
	HostName   string
	PolicyName string
	TokenTTL   time.Duration
	TokenMax   time.Duration
	Renewable  bool
	// SecretIDTTL and SecretIDUses describe the rotating login SecretID. The
	// one-use bootstrap SecretID is minted separately and is not part of the role
	// definition.
	SecretIDTTL  time.Duration
	SecretIDUses int
}

// IdentityRoleState is what the backend found or created for a role.
type IdentityRoleState struct {
	Name string
	// HostID is the claim the existing role carries. A different claim is a
	// refusal, not an update.
	HostID string
	Exists bool
}

// IdentityWrapSpec is the response-wrapping request for one SecretID.
type IdentityWrapSpec struct {
	TTL time.Duration
}

// WrappedSecretID is a minted SecretID that has never been seen in the clear: the
// backend wraps it server-side and returns only the wrapping token.
//
// There is deliberately no SecretID field anywhere on this type. The value only
// exists inside OpenBao until the host unwraps it.
type WrappedSecretID struct {
	// WrapToken is the one-use token that unwraps the SecretID. It is a Secret so
	// no format verb or JSON encoder can print it.
	WrapToken Secret
	// Accessor identifies the SecretID for rotation and revocation without
	// revealing it.
	Accessor string
	// TTL is how long the wrapping token is valid.
	TTL time.Duration
}

// IdentityBackend is the OpenBao mechanics port: policies, AppRoles,
// response-wrapped SecretIDs. It is implemented by the openbao adapter and by an
// in-process fake in tests.
//
// EnsureAppRole must refuse a role whose claim belongs to another host
// (domain.RoleClaimError) and must be idempotent for the same host.
type IdentityBackend interface {
	EnsurePolicy(ctx context.Context, policy IdentityPolicy) error
	EnsureAppRole(ctx context.Context, role IdentityRole) (IdentityRoleState, error)
	MintWrappedSecretID(ctx context.Context, roleName string, spec IdentityWrapSpec) (WrappedSecretID, error)
	DeleteAppRole(ctx context.Context, roleName string) error
	DeletePolicy(ctx context.Context, name string) error
}

// BootstrapMaterial is the out-of-band delivery of one wrapping token. It is the
// only type that carries the token, and it is never a job payload, a workflow
// input, an activity result, or a log field.
type BootstrapMaterial struct {
	HostID  string
	RoleID  string
	WrapTok Secret
	TTL     time.Duration
}

// BootstrapDelivery writes bootstrap material where the host can read it: a
// mode-0600 file outside the Nix store, Git, Terraform state, and job records.
type BootstrapDelivery interface {
	// DeliverBootstrap stores the wrapping token and returns a path an operator
	// can name. The path is safe to log; the token is not.
	DeliverBootstrap(ctx context.Context, material BootstrapMaterial) (string, error)
}

// IdentityDeps are the collaborators of the authorization use case.
type IdentityDeps struct {
	Backend  IdentityBackend
	Delivery BootstrapDelivery
	Logger   Logger
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
	backend     IdentityBackend
	delivery    BootstrapDelivery
	log         Logger
	tokenPolicy domain.TokenPolicy
	loginPolicy domain.LoginCredentialPolicy
	wrapTTL     time.Duration
}

var _ HostAuthorizer = (*IdentityService)(nil)

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
func (s *IdentityService) AuthorizeHost(ctx context.Context, req AuthorizeRequest) error {
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
	if err := s.backend.EnsurePolicy(ctx, IdentityPolicy{
		Name:     policy.Name,
		HostID:   identity.HostID,
		Document: policy.HCL(),
	}); err != nil {
		return identityFailure("policy", identity.HostID, err)
	}

	state, err := s.backend.EnsureAppRole(ctx, IdentityRole{
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

	wrapped, err := s.backend.MintWrappedSecretID(ctx, identity.RoleName, IdentityWrapSpec{TTL: s.wrapTTL})
	if err != nil {
		return identityFailure("mint_wrapped_secret_id", identity.HostID, err)
	}
	// The wrapping token is destroyed before this call returns: the delivered file
	// is the host's copy, and this process keeps none.
	defer wrapped.WrapToken.Destroy()

	path, err := s.delivery.DeliverBootstrap(ctx, BootstrapMaterial{
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

// RevokeHost removes the role and the policy. The SecretID claim goes with the
// role: OpenBao deletes every SecretID when the AppRole is deleted.
func (s *IdentityService) RevokeHost(ctx context.Context, req AuthorizeRequest) error {
	identity, err := domain.NewHostIdentity(req.HostID, req.Name)
	if err != nil {
		return err
	}
	if err := s.backend.DeleteAppRole(ctx, identity.RoleName); err != nil {
		return identityFailure("revoke_role", identity.HostID, err)
	}
	if err := s.backend.DeletePolicy(ctx, identity.PolicyName); err != nil {
		return identityFailure("revoke_policy", identity.HostID, err)
	}
	s.log.Info("host.identity.revoked", "host_id", identity.HostID, "role", identity.RoleName, "policy", identity.PolicyName)
	return nil
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
