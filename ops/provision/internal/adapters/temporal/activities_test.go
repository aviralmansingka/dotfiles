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

// TestRecordHostMilestoneKeepsATeardownOutOfProvisioning is the record-model
// defect this step fixed: an in-progress delete milestone mapped onto "provisioning"
// because the milestone carried no job kind, so a teardown flipped its own record
// back to the state a create writes.
//
// It also pins the counter rule: the attempt number and the owning job id are set
// once by the use case, and a milestone cannot inflate either.
func TestRecordHostMilestoneKeepsATeardownOutOfProvisioning(t *testing.T) {
	t.Parallel()
	harness := fakes.NewHarness(t)
	ctx := context.Background()
	now := time.Date(2026, 11, 25, 12, 0, 0, 0, time.UTC)
	clock := fakes.NewClock()

	if _, _, err := harness.Store.CreateHost(ctx, domain.Host{
		ID:             "host-0001",
		Name:           "canary-01",
		Provider:       domain.ProviderAWS,
		Profile:        "rex",
		Region:         "ap-south-1",
		Size:           "standard",
		OwnerClientID:  "test-client",
		State:          domain.HostStateDeleting,
		DeleteJobID:    "delete-host-0001",
		DeleteAttempts: 2,
		CreatedAt:      now,
		UpdatedAt:      now,
	}); err != nil {
		t.Fatalf("seed host: %v", err)
	}

	acts := &temporaladapter.Activities{
		Inventory: harness.Store,
		Clock:     clock,
		Logger:    &fakes.Logger{},
	}
	if err := acts.RecordHostMilestone(ctx, workflows.RecordHostMilestoneInput{
		HostID: "host-0001",
		JobID:  "delete-host-0001-r2",
		Kind:   string(domain.JobKindDelete),
		Stage:  string(domain.StageRevokingAccess),
		State:  string(domain.JobInProgress),
	}); err != nil {
		t.Fatalf("RecordHostMilestone: %v", err)
	}

	host, err := harness.Store.GetHost(ctx, "host-0001")
	if err != nil {
		t.Fatalf("GetHost: %v", err)
	}
	if host.State != domain.HostStateDeleting {
		t.Fatalf("record state = %q, want deleting: an in-progress teardown must not become provisioning", host.State)
	}
	if host.DeleteAttempts != 2 {
		t.Fatalf("delete attempts = %d, want the use case's 2 unchanged by a milestone", host.DeleteAttempts)
	}
	if host.DeleteJobID != "delete-host-0001" {
		t.Fatalf("delete job = %q, want the owning job unchanged by a milestone", host.DeleteJobID)
	}
}

// TestRecordHostMilestoneWritesTheTombstoneOnlyWhenEveryStepReleased keeps the
// "deleted" claim honest: a milestone that reports deleted with an unfinished step is
// refused, and the process does not silently record a half-finished teardown as done.
func TestRecordHostMilestoneWritesTheTombstoneOnlyWhenEveryStepReleased(t *testing.T) {
	t.Parallel()
	harness := fakes.NewHarness(t)
	ctx := context.Background()
	now := time.Date(2026, 11, 25, 12, 0, 0, 0, time.UTC)
	clock := fakes.NewClock()

	if _, _, err := harness.Store.CreateHost(ctx, domain.Host{
		ID:             "host-0001",
		Name:           "canary-01",
		Provider:       domain.ProviderAWS,
		Profile:        "rex",
		Region:         "ap-south-1",
		Size:           "standard",
		OwnerClientID:  "test-client",
		State:          domain.HostStateDeleting,
		PrivateAddress: "10.99.1.10",
		Tags:           map[string]string{"owner": "fleet"},
		CreatedAt:      now,
		UpdatedAt:      now,
	}); err != nil {
		t.Fatalf("seed host: %v", err)
	}
	acts := &temporaladapter.Activities{Inventory: harness.Store, Clock: clock, Logger: &fakes.Logger{}}

	// Every step but the destroy: the record must not be tombstoned.
	err := acts.RecordHostMilestone(ctx, workflows.RecordHostMilestoneInput{
		HostID:     "host-0001",
		JobID:      "delete-host-0001",
		Kind:       string(domain.JobKindDelete),
		Stage:      string(domain.StageDestroying),
		State:      string(domain.HostStateDeleted),
		Released:   []string{string(domain.CleanupRevokeTokens), string(domain.CleanupRevokeCredentials), string(domain.CleanupRemoveDevice)},
		Incomplete: []string{string(domain.CleanupDestroyResources)},
	})
	if err == nil {
		t.Fatal("a milestone claiming deletion with an unfinished step was accepted")
	}
	host, err := harness.Store.GetHost(ctx, "host-0001")
	if err != nil {
		t.Fatalf("GetHost: %v", err)
	}
	if host.Tombstone != nil || host.State == domain.HostStateDeleted {
		t.Fatalf("the record was tombstoned from an incomplete report: %+v", host.Tombstone)
	}

	// Every step: the tombstone is written and the address is cleared.
	if err := acts.RecordHostMilestone(ctx, workflows.RecordHostMilestoneInput{
		HostID:        "host-0001",
		JobID:         "delete-host-0001",
		Kind:          string(domain.JobKindDelete),
		Stage:         string(domain.StageDeleted),
		State:         string(domain.HostStateDeleted),
		TokensRevoked: 3,
		Released: []string{
			string(domain.CleanupRevokeTokens),
			string(domain.CleanupRevokeCredentials),
			string(domain.CleanupRemoveDevice),
			string(domain.CleanupDestroyResources),
		},
	}); err != nil {
		t.Fatalf("RecordHostMilestone (complete): %v", err)
	}
	host, err = harness.Store.GetHost(ctx, "host-0001")
	if err != nil {
		t.Fatalf("GetHost: %v", err)
	}
	if host.State != domain.HostStateDeleted || host.Tombstone == nil {
		t.Fatalf("record = %q / tombstone %+v, want a tombstone", host.State, host.Tombstone)
	}
	if host.Tombstone.TokenAccessorsRevoked != 3 {
		t.Fatalf("tombstone token count = %d, want 3", host.Tombstone.TokenAccessorsRevoked)
	}
	if host.PrivateAddress != "" || len(host.Tags) != 0 {
		t.Fatalf("tombstoned record kept its address %q and tags %v", host.PrivateAddress, host.Tags)
	}
}
