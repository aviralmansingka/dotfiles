// Package ssh holds the flake-deployment refusal used until the profile deployer
// lands.
//
// It no longer holds an enrollment path: enrollment runs over the SSM control
// plane (package ssm), so there is no SSH ingress to depend on, no bootstrap login
// key, and no host key to pin. That removed the last reason for this service to be
// able to reach a host on port 22, and `bootstrap_ssh_cidr` stays empty by
// default.
package ssh

import (
	"context"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// Stub refuses profile deployment. It is the composition fallback until the
// deployer lands, never a silent success.
type Stub struct{}

// NewStub builds the deployment stub.
func NewStub() *Stub { return &Stub{} }

var _ application.ProfileDeployer = (*Stub)(nil)

// DeployProfile implements application.ProfileDeployer by refusing.
func (*Stub) DeployProfile(_ context.Context, _ application.DeployRequest) (application.DeployResult, error) {
	return application.DeployResult{}, &domain.NotImplementedError{
		Component: "nix profile deployment",
		Step:      "S04 deploys the approved flake revision",
	}
}
