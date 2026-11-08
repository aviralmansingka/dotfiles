// Package ssh holds the trusted-SSH bootstrap and flake-deployment adapters.
// S01 ships only stubs: S03 adds verified-host-key enrollment and S04 the
// profile deployment.
package ssh

import (
	"context"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// Stub refuses enrollment and deployment.
type Stub struct{}

// NewStub builds the SSH stub.
func NewStub() *Stub { return &Stub{} }

var (
	_ application.HostEnroller    = (*Stub)(nil)
	_ application.ProfileDeployer = (*Stub)(nil)
)

// Enroll implements application.HostEnroller by refusing.
func (*Stub) Enroll(_ context.Context, _ application.EnrollRequest) (application.EnrollResult, error) {
	return application.EnrollResult{}, &domain.NotImplementedError{
		Component: "trusted ssh enrollment",
		Step:      "S03 adds verified-host-key bootstrap",
	}
}

// DeployProfile implements application.ProfileDeployer by refusing.
func (*Stub) DeployProfile(_ context.Context, _ application.DeployRequest) (application.DeployResult, error) {
	return application.DeployResult{}, &domain.NotImplementedError{
		Component: "nix profile deployment",
		Step:      "S04 deploys the approved flake revision",
	}
}
