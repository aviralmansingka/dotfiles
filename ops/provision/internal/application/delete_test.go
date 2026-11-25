package application_test

// Offline tests for the teardown use case: what a DELETE request starts, what a
// repeated one does, and what a retry after a partial teardown gets.
//
// The property under test is that a teardown is safe to call twice and possible to
// finish after a failure. No test here starts a real workflow: the orchestrator is
// the in-process fake, and the inventory is a real file-backed store in a temporary
// directory.

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/testsupport/fakes"
)

// deleteHarness creates one ready host with a recorded resource and device, which
// is the state a teardown is asked to handle.
type deleteHarness struct {
	*fakes.Harness
	HostID string
}

func newDeleteHarness(t *testing.T) *deleteHarness {
	t.Helper()
	harness := fakes.NewHarness(t)
	ctx := context.Background()
	principal := application.Principal{ClientID: "test-client"}

	accepted, err := harness.Service.CreateHost(ctx, principal, "idem-key-0001", createRequest)
	if err != nil {
		t.Fatalf("CreateHost: %v", err)
	}
	// The workflow would have recorded these; a teardown reads them from the record.
	if _, err := harness.Store.UpdateHost(ctx, accepted.HostID, func(h *domain.Host) error {
		h.MarkResource("i-0123456789abcdef0", "10.99.1.10", harness.Clock.Now())
		h.MarkDevice("n1234CNTRL", harness.Clock.Now())
		h.MarkReady("sha256:revision-1", "10.99.1.10", "https://canary-01.fleet.example", harness.Clock.Now())
		return nil
	}); err != nil {
		t.Fatalf("seed resource and device: %v", err)
	}
	return &deleteHarness{Harness: harness, HostID: accepted.HostID}
}

// startDelete issues one DELETE and returns the accepted identifiers.
func (d *deleteHarness) startDelete(t *testing.T) application.AcceptedIDs {
	t.Helper()
	accepted, err := d.Service.DeleteHost(context.Background(), application.Principal{ClientID: "test-client"}, d.HostID)
	if err != nil {
		t.Fatalf("DeleteHost: %v", err)
	}
	return accepted
}

// tombstone records a completed teardown on the stored host, the way the milestone
// activity would.
func (d *deleteHarness) tombstone(t *testing.T) {
	t.Helper()
	ctx := context.Background()
	if _, err := d.Store.UpdateHost(ctx, d.HostID, func(h *domain.Host) error {
		return h.CompleteTeardown(domain.NewTombstone(
			d.Clock.Now(),
			domain.CleanupSteps,
			nil,
			2,
		))
	}); err != nil {
		t.Fatalf("tombstone host: %v", err)
	}
}

// TestDeleteStartsOneTeardownAndCarriesTheResolvedShape proves the teardown spec is
// complete: the destroy step needs the same shape the create used, the ownership
// proof, and the device to remove. A spec missing any of them is a teardown that
// either destroys nothing or reports an unclear failure.
func TestDeleteStartsOneTeardownAndCarriesTheResolvedShape(t *testing.T) {
	t.Parallel()
	d := newDeleteHarness(t)

	accepted := d.startDelete(t)
	if accepted.HostID != d.HostID {
		t.Fatalf("host id = %q, want %q", accepted.HostID, d.HostID)
	}
	if accepted.JobID != "delete-"+d.HostID {
		t.Fatalf("job id = %q, want delete-%s", accepted.JobID, d.HostID)
	}
	if teardowns := len(d.Orchestrator.DeleteSpecs()); teardowns != 1 {
		t.Fatalf("teardown operations started = %d, want exactly one", teardowns)
	}

	host := d.host(t)
	if host.State != domain.HostStateDeleting {
		t.Fatalf("host state = %q, want deleting", host.State)
	}
	if host.DeleteJobID != accepted.JobID {
		t.Fatalf("recorded delete job = %q, want %q", host.DeleteJobID, accepted.JobID)
	}
	if host.DeleteAttempts != 1 {
		t.Fatalf("delete attempts = %d, want 1", host.DeleteAttempts)
	}

	spec := d.deleteSpec(t, accepted.JobID)
	if spec.ResourceID != host.ResourceID {
		t.Fatalf("spec resource id = %q, want the recorded %q", spec.ResourceID, host.ResourceID)
	}
	if spec.DeviceID != host.DeviceID {
		t.Fatalf("spec device id = %q, want the recorded %q", spec.DeviceID, host.DeviceID)
	}
	if spec.Profile != host.Profile || spec.Size != host.Size || spec.Region != host.Region {
		t.Fatalf("spec shape = %s/%s/%s, want %s/%s/%s", spec.Profile, spec.Size, spec.Region, host.Profile, host.Size, host.Region)
	}
	if spec.Attempt != 1 {
		t.Fatalf("spec attempt = %d, want 1", spec.Attempt)
	}
}

// TestRepeatDeleteOfATombstonedHostStartsNoNewOperation is the idempotency property:
// a second DELETE against a deleted host answers with the job that did the work and
// creates nothing — no reservation, no workflow.
func TestRepeatDeleteOfATombstonedHostStartsNoNewOperation(t *testing.T) {
	t.Parallel()
	d := newDeleteHarness(t)

	first := d.startDelete(t)
	d.tombstone(t)
	teardownsBefore := len(d.Orchestrator.DeleteSpecs())

	second := d.startDelete(t)
	if second.JobID != first.JobID {
		t.Fatalf("repeat delete answered with job %q, want the original %q", second.JobID, first.JobID)
	}
	if teardowns := len(d.Orchestrator.DeleteSpecs()); teardowns != teardownsBefore {
		t.Fatalf("repeat delete started %d teardown(s), want none", teardowns-teardownsBefore)
	}
	if attempts := d.host(t).DeleteAttempts; attempts != 1 {
		t.Fatalf("delete attempts = %d after a repeat, want 1", attempts)
	}

	// A third repeat, after a restart, is still a read: durability is not a cache.
	d.Restart(false)
	third := d.startDelete(t)
	if third.JobID != first.JobID {
		t.Fatalf("repeat delete after restart answered with %q, want %q", third.JobID, first.JobID)
	}
	if teardowns := len(d.Orchestrator.DeleteSpecs()); teardowns != teardownsBefore {
		t.Fatalf("repeat delete after restart started %d teardown(s), want none", teardowns-teardownsBefore)
	}
}

// TestDeleteRetriesAPartialTeardownWithANewJob proves a failed teardown can be
// finished. Temporal refuses to re-run a closed execution under the same id, so the
// retry must get an id of its own while still being the same host's teardown.
func TestDeleteRetriesAPartialTeardownWithANewJob(t *testing.T) {
	t.Parallel()
	d := newDeleteHarness(t)

	first := d.startDelete(t)
	// The workflow failed part-way and recorded which cleanup is left.
	if _, err := d.Store.UpdateHost(context.Background(), d.HostID, func(h *domain.Host) error {
		h.MarkCleanupIncomplete([]domain.CleanupStep{domain.CleanupRemoveDevice}, d.Clock.Now())
		return nil
	}); err != nil {
		t.Fatalf("record partial teardown: %v", err)
	}
	d.Orchestrator.SetJob(application.JobView{
		JobID:  first.JobID,
		HostID: d.HostID,
		Kind:   domain.JobKindDelete,
		State:  domain.JobFailed,
		Stage:  domain.StageDestroying,
		Error:  &domain.JobError{Code: application.CodeTeardownIncomplete, Message: "incomplete", Retryable: true},
	})

	second := d.startDelete(t)
	if second.JobID == first.JobID {
		t.Fatalf("the retry reused the failed job id %q; Temporal would refuse to run it", second.JobID)
	}
	if !strings.HasPrefix(second.JobID, "delete-"+d.HostID) {
		t.Fatalf("retry job id = %q, want it derived from the host", second.JobID)
	}
	if starts := d.Orchestrator.StartCount(second.JobID); starts != 1 {
		t.Fatalf("the retry started %d time(s), want exactly one new operation", starts)
	}
	host := d.host(t)
	if host.DeleteAttempts != 2 {
		t.Fatalf("delete attempts = %d, want 2", host.DeleteAttempts)
	}
	if host.DeleteJobID != second.JobID {
		t.Fatalf("recorded delete job = %q, want the retry %q", host.DeleteJobID, second.JobID)
	}
}

// TestDeleteDoesNotStackASecondTeardownWhileOneIsRunning keeps two concurrent
// DELETEs from starting two teardowns of the same host.
func TestDeleteDoesNotStackASecondTeardownWhileOneIsRunning(t *testing.T) {
	t.Parallel()
	d := newDeleteHarness(t)

	first := d.startDelete(t)
	second := d.startDelete(t)
	if second.JobID != first.JobID {
		t.Fatalf("a second DELETE while the teardown runs answered with %q, want %q", second.JobID, first.JobID)
	}
	if teardowns := len(d.Orchestrator.DeleteSpecs()); teardowns != 1 {
		t.Fatalf("teardown operations started = %d, want exactly one", teardowns)
	}
}

// TestDeleteRefusesAForeignHost keeps one client from starting another client's
// teardown, and keeps the record out of "deleting".
func TestDeleteRefusesAForeignHost(t *testing.T) {
	t.Parallel()
	d := newDeleteHarness(t)

	_, err := d.Service.DeleteHost(context.Background(), application.Principal{ClientID: "another-client"}, d.HostID)
	if !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("error = %v, want not found for a host owned by another client", err)
	}
	if teardowns := len(d.Orchestrator.DeleteSpecs()); teardowns != 0 {
		t.Fatalf("teardown operations started = %d, want none", teardowns)
	}
	if host := d.host(t); host.State == domain.HostStateDeleting {
		t.Fatal("a refused delete marked the host deleting")
	}
}

// deleteSpec returns the spec the service handed the orchestrator for one job.
func (d *deleteHarness) deleteSpec(t *testing.T, jobID string) application.DeleteHostSpec {
	t.Helper()
	specs := d.Orchestrator.DeleteSpecs()
	for _, spec := range specs {
		if spec.JobID == jobID {
			return spec
		}
	}
	t.Fatalf("no teardown spec was recorded for job %q (recorded: %d)", jobID, len(specs))
	return application.DeleteHostSpec{}
}

// host reads the stored record.
func (d *deleteHarness) host(t *testing.T) domain.Host {
	t.Helper()
	host, err := d.Store.GetHost(context.Background(), d.HostID)
	if err != nil {
		t.Fatalf("GetHost: %v", err)
	}
	return host
}
