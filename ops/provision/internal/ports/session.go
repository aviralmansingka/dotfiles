package ports

import (
	"context"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// HostSession is one logged-in host token. The token is a Secret: it never
// renders itself, and the TTL is the lifetime the server reported, already
// checked against the hard maximum.
//
// The host-side session use case lives in internal/hostsession; the port and the
// value it returns are here so the OpenBao adapter can implement it without
// importing that use case.
type HostSession struct {
	Token     domain.Secret
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
	UnwrapSecretID(ctx context.Context, wrapToken domain.Secret) (domain.Secret, error)
	Login(ctx context.Context, roleID string, secretID domain.Secret) (HostSession, error)
	RenewSelf(ctx context.Context, token domain.Secret) (HostSession, error)
	RotateSecretID(ctx context.Context, roleName string, previousAccessor string) (WrappedSecretID, error)
}
