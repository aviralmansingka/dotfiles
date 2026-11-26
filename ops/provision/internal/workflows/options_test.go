package workflows

import (
	"testing"
	"time"

	"go.temporal.io/sdk/workflow"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/ports"
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
	for _, name := range []string{ports.CodeNotImplemented, FailureTypePermanent} {
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

// TestDeployAndReadbackHaveTheirOwnBounds is the offline proof of the numbers.
//
// Deploy is 45 minutes because a real deploy took 22 minutes on 2026-11-09 (a cold
// x86_64-linux build on the host), and the generic 5-minute step bound would have
// killed it every time. Readback is 10 minutes because it is a handful of
// control-plane queries, not a build. Both are asserted on the options the workflow
// hands to the activity, so an edit that widens or removes a bound fails here.
func TestDeployAndReadbackHaveTheirOwnBounds(t *testing.T) {
	t.Parallel()

	deploy := deployActivityOptions()
	if got, want := deploy.StartToCloseTimeout, 45*time.Minute; got != want {
		t.Fatalf("deploy StartToCloseTimeout = %s, want %s", got, want)
	}
	if got := deploy.StartToCloseTimeout; got <= activityOptions().StartToCloseTimeout {
		t.Fatalf("deploy bound %s does not exceed the generic step bound %s: the measured deploy is 22 minutes",
			got, activityOptions().StartToCloseTimeout)
	}
	if deploy.RetryPolicy == nil {
		t.Fatal("deploy has no retry policy")
	}
	if got, want := deploy.RetryPolicy.MaximumAttempts, int32(2); got != want {
		t.Fatalf("deploy MaximumAttempts = %d, want %d: a second attempt adopts the record a first one wrote, and a third costs another build", got, want)
	}
	assertPermanentIsNonRetryable(t, deploy)

	readback := readbackActivityOptions()
	if got, want := readback.StartToCloseTimeout, 10*time.Minute; got != want {
		t.Fatalf("readback StartToCloseTimeout = %s, want %s", got, want)
	}
	if got, want := readback.RetryPolicy.MaximumAttempts, int32(3); got != want {
		t.Fatalf("readback MaximumAttempts = %d, want %d: a control-plane query that timed out is worth re-asking", got, want)
	}
	assertPermanentIsNonRetryable(t, readback)
}

// assertPermanentIsNonRetryable keeps the two new steps from retrying a refusal
// that will not change: a fact that does not hold is not an outage.
func assertPermanentIsNonRetryable(t *testing.T, options workflow.ActivityOptions) {
	t.Helper()
	nonRetryable := map[string]bool{}
	for _, name := range options.RetryPolicy.NonRetryableErrorTypes {
		nonRetryable[name] = true
	}
	for _, name := range []string{ports.CodeNotImplemented, FailureTypePermanent} {
		if !nonRetryable[name] {
			t.Fatalf("%q is retryable in %v", name, options.RetryPolicy.NonRetryableErrorTypes)
		}
	}
}
