package temporaladapter_test

import (
	"context"
	"testing"
	"time"

	"go.temporal.io/sdk/temporal"

	temporaladapter "github.com/aviralmansingka/dotfiles/ops/provision/internal/adapters/temporal"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/testsupport/fakes"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/workflows"
)

const testInstanceID = "i-0123456789abcdef0"

// fakeProbe answers the agent check without a control plane.
type fakeProbe struct {
	status application.SSMAgentStatus
	err    error
	calls  int
}

func (f *fakeProbe) AwaitRegistration(_ context.Context, _ string) (application.SSMAgentStatus, error) {
	f.calls++
	if f.err != nil {
		return application.SSMAgentStatus{}, f.err
	}
	return f.status, nil
}

// TestCheckSSMAgentIsAnExplicitGateWithARecordedAnswer: the check is its own
// activity, and its answer is what the workflow history keeps.
func TestCheckSSMAgentIsAnExplicitGateWithARecordedAnswer(t *testing.T) {
	t.Parallel()
	probe := &fakeProbe{status: application.SSMAgentStatus{
		InstanceID: testInstanceID,
		PingStatus: "Online",
		Online:     true,
		LastPing:   time.Date(2026, 11, 9, 5, 0, 0, 0, time.UTC),
	}}
	logger := &fakes.Logger{}
	acts := &temporaladapter.Activities{Agent: probe, Logger: logger}

	out, err := acts.CheckSSMAgent(context.Background(), workflows.CheckSSMAgentInput{
		HostID:     "host-0001",
		InstanceID: testInstanceID,
	})
	if err != nil {
		t.Fatalf("CheckSSMAgent: %v", err)
	}
	if !out.Online || out.PingStatus != "Online" || out.InstanceID != testInstanceID {
		t.Fatalf("output = %+v, want the agent's online report", out)
	}
	if probe.calls != 1 {
		t.Fatalf("probe calls = %d, want 1", probe.calls)
	}
	if len(logger.Lines()) == 0 {
		t.Fatal("the agent check recorded nothing")
	}
}

// TestCheckSSMAgentFailsTheJobPermanentlyWithoutSSH is the fail-closed rule at the
// activity boundary: an agent that never registers ends the workflow as a
// non-retryable failure, and nothing in the error suggests another transport.
func TestCheckSSMAgentFailsTheJobPermanentlyWithoutSSH(t *testing.T) {
	t.Parallel()
	probe := &fakeProbe{err: &domain.AgentNotRegisteredError{
		InstanceID: testInstanceID,
		Waited:     4 * time.Minute,
		PingStatus: "ConnectionLost",
	}}
	acts := &temporaladapter.Activities{Agent: probe, Logger: &fakes.Logger{}}

	_, err := acts.CheckSSMAgent(context.Background(), workflows.CheckSSMAgentInput{
		HostID:     "host-0001",
		InstanceID: testInstanceID,
	})
	if err == nil {
		t.Fatal("CheckSSMAgent must fail when the agent never registers")
	}
	var appErr *temporal.ApplicationError
	if !asApplicationError(err, &appErr) {
		t.Fatalf("error is not a Temporal application error: %v", err)
	}
	if appErr.Type() != application.CodeAgentUnavailable {
		t.Fatalf("error type = %q, want %q", appErr.Type(), application.CodeAgentUnavailable)
	}
	if !appErr.NonRetryable() {
		t.Fatal("an unregistered agent must be non-retryable")
	}
}

// asApplicationError keeps the assertion readable without importing errors in
// every test in this file.
func asApplicationError(err error, target **temporal.ApplicationError) bool {
	appErr, ok := err.(*temporal.ApplicationError)
	if ok {
		*target = appErr
	}
	return ok
}
