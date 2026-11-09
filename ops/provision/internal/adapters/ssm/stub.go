package ssm

import (
	"context"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// Stub refuses enrollment and the agent check. It is the composition fallback
// when the SSM enrollment block is not configured, never a silent success: a job
// cannot reach "ready" without a real enrollment, and nothing here reaches for
// another transport.
type Stub struct{}

// NewStub builds the refusing stub.
func NewStub() *Stub { return &Stub{} }

var (
	_ application.HostEnroller  = (*Stub)(nil)
	_ application.SSMAgentProbe = (*Stub)(nil)
)

// Enroll implements application.HostEnroller by refusing.
func (*Stub) Enroll(_ context.Context, _ application.EnrollRequest) (application.EnrollResult, error) {
	return application.EnrollResult{}, &domain.NotImplementedError{
		Component: "ssm enrollment",
		Step:      "enrollment.ssm.parameter_prefix is not configured for this worker",
	}
}

// AwaitRegistration implements application.SSMAgentProbe by refusing.
func (*Stub) AwaitRegistration(_ context.Context, _ string) (application.SSMAgentStatus, error) {
	return application.SSMAgentStatus{}, &domain.NotImplementedError{
		Component: "ssm agent check",
		Step:      "enrollment.ssm is not configured for this worker",
	}
}
