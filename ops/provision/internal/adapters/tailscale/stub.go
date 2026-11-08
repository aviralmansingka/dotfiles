// Package tailscale holds the tailnet device adapter. S01 ships only a stub:
// S03 enrolls devices and S07 removes them.
package tailscale

import (
	"context"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// Stub refuses device operations.
type Stub struct{}

// NewStub builds the tailnet stub.
func NewStub() *Stub { return &Stub{} }

var _ application.TailnetDeviceManager = (*Stub)(nil)

// RemoveDevice implements application.TailnetDeviceManager by refusing.
func (*Stub) RemoveDevice(_ context.Context, _ application.RemoveDeviceRequest) error {
	return &domain.NotImplementedError{
		Component: "tailscale device manager",
		Step:      "S03 enrolls devices and S07 revokes them",
	}
}
