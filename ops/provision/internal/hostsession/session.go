// Package hostsession holds the OpenBao session client that runs on a managed
// host, not in the service.
//
// It is the host-side relogin path: a host that has rebooted takes its one-use
// wrapping token, unwraps the bootstrap SecretID, logs in, renews, and rotates
// the reboot-safe SecretID. Nothing here is compiled into, or reachable from, the
// API server or the worker binary, and no management token ever reaches this
// package. See internal/application for the service-side use cases.
package hostsession

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// HostSession is one logged-in host token. The token is a Secret: it never
// renders itself, and the TTL is the lifetime the server reported, already
// checked against the hard maximum.
type HostSession struct {
	Token     application.Secret
	TTL       time.Duration
	Renewable bool
	// Accessor identifies the token for revocation without revealing it.
	Accessor string
}

// HostSessionClient is the host-side OpenBao mechanics port. It is implemented
// by the openbao adapter and by an in-process fake in tests. It holds no
// management token: every call authenticates with the material the host has.
//
// UnwrapSecretID must refuse a wrapping token it has already consumed
// (domain.WrapTokenConsumedError) without a network call, and the server refuses
// a second unwrap independently.
type HostSessionClient interface {
	UnwrapSecretID(ctx context.Context, wrapToken application.Secret) (application.Secret, error)
	Login(ctx context.Context, roleID string, secretID application.Secret) (HostSession, error)
	RenewSelf(ctx context.Context, token application.Secret) (HostSession, error)
	RotateSecretID(ctx context.Context, roleName string, previousAccessor string) (application.WrappedSecretID, error)
}

// SessionDeps are the collaborators of the host-side session use case.
type SessionDeps struct {
	Client      HostSessionClient
	Logger      application.Logger
	TokenPolicy domain.TokenPolicy
}

// SessionService is the host-side use case: unwrap once, log in, renew, and
// rotate the reboot-safe SecretID. It enforces the short-lived bound on every
// session it returns, so a misconfigured role cannot hand a host a long-lived
// token.
type SessionService struct {
	client HostSessionClient
	log    application.Logger
	policy domain.TokenPolicy
}

// NewSessionService validates dependencies and the token policy.
func NewSessionService(deps SessionDeps) (*SessionService, error) {
	if deps.Client == nil {
		return nil, errors.New("application: host session client is required")
	}
	if deps.Logger == nil {
		return nil, errors.New("application: logger is required")
	}
	policy := deps.TokenPolicy
	if policy == (domain.TokenPolicy{}) {
		policy = domain.DefaultTokenPolicy()
	}
	if err := policy.Validate(); err != nil {
		return nil, fmt.Errorf("application: %w", err)
	}
	return &SessionService{client: deps.Client, log: deps.Logger, policy: policy}, nil
}

// LoginFromWrapped unwraps the one-use bootstrap SecretID and logs in with it.
// The wrapping token is one-use by contract: a second call with the same value is
// refused by the client before any network call.
func (s *SessionService) LoginFromWrapped(ctx context.Context, roleID string, wrapToken application.Secret) (HostSession, error) {
	if wrapToken.Empty() {
		return HostSession{}, domain.Invalid("wrapping_token", "is required")
	}
	secretID, err := s.client.UnwrapSecretID(ctx, wrapToken)
	if err != nil {
		return HostSession{}, fmt.Errorf("openbao session: unwrap secret id: %w", err)
	}
	defer secretID.Destroy()
	session, err := s.client.Login(ctx, roleID, secretID)
	if err != nil {
		return HostSession{}, fmt.Errorf("openbao session: login: %w", err)
	}
	if err := s.validate(session); err != nil {
		session.Token.Destroy()
		return HostSession{}, err
	}
	s.log.Info("host.session.login",
		"role", roleID,
		"ttl_seconds", int(session.TTL.Seconds()),
		"renewable", session.Renewable,
	)
	return session, nil
}

// Renew extends a live session. Renewal may not return a token older than the
// hard maximum, and it never asks for more than the remaining maximum.
func (s *SessionService) Renew(ctx context.Context, token application.Secret) (HostSession, error) {
	if token.Empty() {
		return HostSession{}, domain.Invalid("token", "is required")
	}
	session, err := s.client.RenewSelf(ctx, token)
	if err != nil {
		return HostSession{}, fmt.Errorf("openbao session: renew: %w", err)
	}
	if err := s.validate(session); err != nil {
		session.Token.Destroy()
		return HostSession{}, err
	}
	s.log.Info("host.session.renewed", "ttl_seconds", int(session.TTL.Seconds()))
	return session, nil
}

// Rotate replaces the rotating login SecretID. The previous one keeps working for
// the rotation grace, so a host that is rebooting during the rotation still logs
// in with the material it already has.
func (s *SessionService) Rotate(ctx context.Context, roleName, previousAccessor string) (application.WrappedSecretID, error) {
	if roleName == "" {
		return application.WrappedSecretID{}, domain.Invalid("role_name", "is required")
	}
	wrapped, err := s.client.RotateSecretID(ctx, roleName, previousAccessor)
	if err != nil {
		return application.WrappedSecretID{}, fmt.Errorf("openbao session: rotate secret id: %w", err)
	}
	s.log.Info("host.session.rotate", "role", roleName, "accessor", wrapped.Accessor)
	return wrapped, nil
}

// validate enforces the hard lifetime bound. A zero TTL is refused because it
// means the credential does not expire; anything above the maximum means the role
// is misconfigured and the host must not proceed with a token the service cannot
// bound.
func (s *SessionService) validate(session HostSession) error {
	if session.Token.Empty() {
		return &domain.IdentityError{Operation: "session", Reason: "no token was issued"}
	}
	if session.TTL <= 0 {
		return &domain.IdentityError{Operation: "session", Reason: "issued token has no expiry; a host token must be short-lived"}
	}
	if session.TTL > s.policy.MaxTTL {
		return &domain.IdentityError{
			Operation: "session",
			Reason:    fmt.Sprintf("issued token TTL %s exceeds the hard maximum of %s", session.TTL, s.policy.MaxTTL),
		}
	}
	if !session.Renewable {
		return &domain.IdentityError{Operation: "session", Reason: "issued token is not renewable"}
	}
	return nil
}
