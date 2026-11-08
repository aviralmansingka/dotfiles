package ssh

import (
	"context"
	"fmt"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// UnavailableSSMRunner is the honest placeholder for the SSM transport: the
// control-plane call needs the AWS SDK binding, which this step does not build.
//
// It exists so the enrollment chain can be wired end to end without a silent
// gap: an enrollment attempt fails with a named, non-retryable error instead of
// pretending a host key was verified.
type UnavailableSSMRunner struct {
	// Reason names what is missing, for the job error an operator sees.
	Reason string
}

var _ application.SSMRunner = (*UnavailableSSMRunner)(nil)

// RunCommand implements application.SSMRunner by refusing.
func (r *UnavailableSSMRunner) RunCommand(_ context.Context, req application.SSMRunRequest) (application.SSMRunResult, error) {
	reason := r.Reason
	if reason == "" {
		reason = "the AWS SDK binding for ssm:SendCommand is not built in this step"
	}
	return application.SSMRunResult{}, fmt.Errorf("ssm run command on %s: %w", req.InstanceID, &domain.NotImplementedError{
		Component: "aws ssm run command",
		Step:      reason,
	})
}
