package workflows

import (
	"testing"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
)

// TestActivityOptionsBoundEveryStep is the offline proof of the per-step timeout
// property. A provisioning step is a provider apply, an SSM command, or a deploy:
// without a start-to-close bound, one stuck host holds an activity slot the whole
// worker shares, and without a retry ceiling one flaky provider retries forever.
// The numbers here are the ones the workflow hands to every activity, so an edit
// that widens or removes a bound fails this test instead of only failing in
// production.
func TestActivityOptionsBoundEveryStep(t *testing.T) {
	t.Parallel()
	options := activityOptions()

	if got, want := options.ScheduleToStartTimeout, 2*time.Minute; got != want {
		t.Fatalf("ScheduleToStartTimeout = %s, want %s", got, want)
	}
	if got, want := options.StartToCloseTimeout, 5*time.Minute; got != want {
		t.Fatalf("StartToCloseTimeout = %s, want %s", got, want)
	}
	if options.RetryPolicy == nil {
		t.Fatal("no retry policy: a failed step would either never retry or retry without limit")
	}
	if got, want := options.RetryPolicy.MaximumAttempts, int32(3); got != want {
		t.Fatalf("MaximumAttempts = %d, want %d", got, want)
	}
	nonRetryable := map[string]bool{}
	for _, name := range options.RetryPolicy.NonRetryableErrorTypes {
		nonRetryable[name] = true
	}
	for _, name := range []string{application.CodeNotImplemented, FailureTypePermanent} {
		if !nonRetryable[name] {
			t.Fatalf("%q is retryable: a permanent refusal would burn every attempt", name)
		}
	}
	// The milestone write is separate and much shorter: persisting progress must
	// never be what stalls a workflow.
	if got, want := milestoneTimeout, 30*time.Second; got != want {
		t.Fatalf("milestoneTimeout = %s, want %s", got, want)
	}
}
