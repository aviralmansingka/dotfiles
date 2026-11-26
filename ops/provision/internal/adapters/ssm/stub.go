package ssm

import (
	"context"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/ports"
)

// Stub refuses enrollment and the agent check. It is the composition fallback
// when the SSM enrollment block is not configured, never a silent success: a job
// cannot reach "ready" without a real enrollment, and nothing here reaches for
// another transport.
type Stub struct{}

// NewStub builds the refusing stub.
func NewStub() *Stub { return &Stub{} }

var (
	_ ports.HostEnroller  = (*Stub)(nil)
	_ ports.SSMAgentProbe = (*Stub)(nil)
)

// Enroll implements ports.HostEnroller by refusing.
func (*Stub) Enroll(_ context.Context, _ ports.EnrollRequest) (ports.EnrollResult, error) {
	return ports.EnrollResult{}, &domain.NotImplementedError{
		Component: "ssm enrollment",
		Step:      "enrollment.ssm.parameter_prefix is not configured for this worker",
	}
}

// AwaitRegistration implements ports.SSMAgentProbe by refusing.
func (*Stub) AwaitRegistration(_ context.Context, _ string) (ports.SSMAgentStatus, error) {
	return ports.SSMAgentStatus{}, &domain.NotImplementedError{
		Component: "ssm agent check",
		Step:      "enrollment.ssm is not configured for this worker",
	}
}
