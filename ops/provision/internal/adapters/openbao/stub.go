// Package openbao holds the host-identity and secret-bundle adapter. S01 ships
// only a stub: S05 creates per-host AppRoles and bundle policies.
package openbao

import (
	"context"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// Stub refuses authorization and revocation.
type Stub struct{}

// NewStub builds the OpenBao stub.
func NewStub() *Stub { return &Stub{} }

var _ application.HostAuthorizer = (*Stub)(nil)

// AuthorizeHost implements application.HostAuthorizer by refusing.
func (*Stub) AuthorizeHost(_ context.Context, _ application.AuthorizeRequest) error {
	return &domain.NotImplementedError{
		Component: "openbao host identity",
		Step:      "S05 creates per-host AppRoles",
	}
}

// RevokeHost implements application.HostAuthorizer by refusing.
func (*Stub) RevokeHost(_ context.Context, _ application.AuthorizeRequest) error {
	return &domain.NotImplementedError{
		Component: "openbao host identity",
		Step:      "S05 creates per-host AppRoles",
	}
}
