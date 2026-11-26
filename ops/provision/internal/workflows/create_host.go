package workflows

import (
	"errors"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/ports"
)

const (
	// activityStartToClose bounds a single provider or enrollment attempt.
	activityStartToClose = 5 * time.Minute
	// activityScheduleToStart bounds queueing before the worker picks it up.
	activityScheduleToStart = 2 * time.Minute
	// milestoneTimeout is short: a persisted-progress write must never stall a
	// workflow for long.
	milestoneTimeout = 30 * time.Second
)

// The profile deploy and its readback carry their own bounds, and the numbers are
// measurements rather than preferences.
//
// Deploy is 45 minutes. A real profile deploy took 22 minutes on 2026-11-09: a
// cold x86_64-linux build of the Rex profile on the host itself, which is where a
// provisioned host builds it. The generic 5-minute step bound would have killed
// that deploy every time, and did not cover it on paper either. 45 minutes is
// about twice the measured time, which leaves room for a cold Nix cache or a
// slower instance while still bounding a stuck host to one worker slot for less
// than an hour.
//
// Readback is 10 minutes. It is a handful of control-plane queries against a host
// that has just finished building, so it is not a build and must not be allowed to
// look like one: a readback that cannot answer in ten minutes is a deploy problem
// reported late, not a slow build.
const (
	deployStartToClose      = 45 * time.Minute
	deployScheduleToStart   = 5 * time.Minute
	readbackStartToClose    = 10 * time.Minute
	readbackScheduleToStart = 5 * time.Minute
)

// activityOptions are the retry and timeout policy for provisioning steps. The
// not-implemented error type is non-retryable so an S01 stub fails fast instead
// of burning three attempts on every job.
func activityOptions() workflow.ActivityOptions {
	return workflow.ActivityOptions{
		ScheduleToStartTimeout: activityScheduleToStart,
		StartToCloseTimeout:    activityStartToClose,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:        time.Second,
			BackoffCoefficient:     2,
			MaximumAttempts:        3,
			NonRetryableErrorTypes: []string{ports.CodeNotImplemented, FailureTypePermanent},
		},
	}
}

// deployActivityOptions bound the one step that builds and activates the profile.
//
// Two attempts, not three. A deploy is idempotent — it adopts the deployment
// record an earlier attempt wrote instead of building the profile again — but one
// attempt can legitimately take most of an hour, and a third attempt buys time an
// operator would rather spend deciding by hand. The backoff is longer than a
// provider apply's because the retry re-enters a Nix build, not an API call.
func deployActivityOptions() workflow.ActivityOptions {
	return workflow.ActivityOptions{
		ScheduleToStartTimeout: deployScheduleToStart,
		StartToCloseTimeout:    deployStartToClose,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:        30 * time.Second,
			BackoffCoefficient:     2,
			MaximumAttempts:        2,
			NonRetryableErrorTypes: []string{ports.CodeNotImplemented, FailureTypePermanent},
		},
	}
}

// readbackActivityOptions bound the step that proves what landed. It retries like
// any other cheap step — a control-plane query that timed out is worth re-asking —
// and a host whose facts are wrong fails the same way every time, because the fact
// failures are reported permanently.
func readbackActivityOptions() workflow.ActivityOptions {
	return workflow.ActivityOptions{
		ScheduleToStartTimeout: readbackScheduleToStart,
		StartToCloseTimeout:    readbackStartToClose,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:        10 * time.Second,
			BackoffCoefficient:     2,
			MaximumAttempts:        3,
			NonRetryableErrorTypes: []string{ports.CodeNotImplemented, FailureTypePermanent},
		},
	}
}

// CreateHostWorkflow runs the approved creation lifecycle:
// queued → creating → enrolling (agent check, then enrollment) → deploying →
// authorizing → ready.
//
// It is deterministic: no wall clock, randomness, I/O, or map iteration. The
// only side effects are activity executions, and the status query is a pure
// read of local state.
func CreateHostWorkflow(ctx workflow.Context, in CreateHostInput) (Status, error) {
	state := Status{
		HostID:    in.Spec.HostID,
		JobID:     in.JobID,
		Kind:      domain.JobKindCreate,
		State:     domain.JobQueued,
		Stage:     domain.StageQueued,
		UpdatedAt: workflow.Now(ctx),
	}
	if err := workflow.SetQueryHandler(ctx, StatusQueryName, func() (Status, error) {
		return state.Snapshot(), nil
	}); err != nil {
		return state.Snapshot(), err
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions())

	advance := func(stage domain.Stage) {
		state.Stage = stage
		state.State = domain.JobInProgress
		state.Attempt++
		state.UpdatedAt = workflow.Now(ctx)
	}

	advance(domain.StageCreating)
	var created CreateHostResourceOutput
	if err := workflow.ExecuteActivity(ctx, ActivityCreateHostResource, CreateHostResourceInput{
		HostID:       in.Spec.HostID,
		Name:         in.Spec.Name,
		Provider:     in.Spec.Provider,
		Profile:      in.Spec.Profile,
		Region:       in.Spec.Region,
		Size:         in.Spec.Size,
		InstanceType: in.Spec.InstanceType,
		DiskGB:       in.Spec.DiskGB,
		Tags:         in.Spec.Tags,
	}).Get(ctx, &created); err != nil {
		return fail(ctx, state, err)
	}
	state.ResourceID = created.ResourceID
	state.PrivateAddress = created.PrivateAddress
	record(ctx, state)

	advance(domain.StageEnrolling)
	// The agent check is its own activity: it is the gate in front of enrollment,
	// it appears in workflow history, and its failure fails the job. There is no
	// fallback transport to try instead.
	var agent CheckSSMAgentOutput
	if err := workflow.ExecuteActivity(ctx, ActivityCheckSSMAgent, CheckSSMAgentInput{
		HostID:     in.Spec.HostID,
		InstanceID: created.ResourceID,
	}).Get(ctx, &agent); err != nil {
		return fail(ctx, state, err)
	}
	record(ctx, state)

	var enrolled EnrollHostOutput
	if err := workflow.ExecuteActivity(ctx, ActivityEnrollHost, EnrollHostInput{
		HostID:         in.Spec.HostID,
		Name:           in.Spec.Name,
		ResourceID:     created.ResourceID,
		PrivateAddress: created.PrivateAddress,
		Profile:        in.Spec.Profile,
		SecretBundles:  in.Spec.SecretBundles,
	}).Get(ctx, &enrolled); err != nil {
		return fail(ctx, state, err)
	}
	state.DeviceID = enrolled.DeviceID
	record(ctx, state)

	advance(domain.StageDeploying)
	// The deploy builds and activates the profile. It carries its own start-to-close
	// bound because a real one takes tens of minutes; the generic step bound would
	// kill it.
	deployCtx := workflow.WithActivityOptions(ctx, deployActivityOptions())
	var deployed DeployProfileOutput
	if err := workflow.ExecuteActivity(deployCtx, ActivityDeployProfile, DeployProfileInput{
		HostID:     in.Spec.HostID,
		Name:       in.Spec.Name,
		Profile:    in.Spec.Profile,
		ResourceID: created.ResourceID,
		FlakeRef:   in.Spec.FlakeRef,
	}).Get(ctx, &deployed); err != nil {
		return fail(ctx, state, err)
	}

	// The readback is its own step and the only source of a recorded revision and
	// Rex address: what the deploy reported travels in as the claim to check, never
	// into the record. A host that cannot prove what landed does not reach "ready".
	readbackCtx := workflow.WithActivityOptions(ctx, readbackActivityOptions())
	var verified ReadBackProfileOutput
	if err := workflow.ExecuteActivity(readbackCtx, ActivityReadBackProfile, ReadBackProfileInput{
		HostID:        in.Spec.HostID,
		Name:          in.Spec.Name,
		ResourceID:    created.ResourceID,
		FlakeRevision: deployed.FlakeRevision,
	}).Get(ctx, &verified); err != nil {
		return fail(ctx, state, err)
	}
	state.FlakeRevision = verified.FlakeRevision
	state.RexURL = verified.RexURL
	record(ctx, state)

	advance(domain.StageAuthorizing)
	if err := workflow.ExecuteActivity(ctx, ActivityAuthorizeHost, AuthorizeHostInput{
		HostID:        in.Spec.HostID,
		Name:          in.Spec.Name,
		Profile:       in.Spec.Profile,
		SecretBundles: in.Spec.SecretBundles,
	}).Get(ctx, nil); err != nil {
		return fail(ctx, state, err)
	}

	advance(domain.StageReady)
	state.State = domain.JobReady
	record(ctx, state)
	return state.Snapshot(), nil
}

// record persists a milestone. Its failure does not fail the workflow: the
// Temporal history remains the execution record, and the next milestone
// supersedes this one. It accepts a detached context so the cancellation path can
// still write the ownership record.
func record(ctx workflow.Context, state Status) {
	actCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		ScheduleToStartTimeout: milestoneTimeout,
		StartToCloseTimeout:    milestoneTimeout,
		RetryPolicy:            &temporal.RetryPolicy{MaximumAttempts: 2},
	})
	_ = workflow.ExecuteActivity(actCtx, ActivityRecordHostMilestone, milestoneInput(state)).Get(actCtx, nil)
}

func milestoneInput(state Status) RecordHostMilestoneInput {
	return RecordHostMilestoneInput{
		HostID:         state.HostID,
		JobID:          state.JobID,
		Kind:           string(state.Kind),
		Stage:          string(state.Stage),
		State:          string(state.State),
		ResourceID:     state.ResourceID,
		DeviceID:       state.DeviceID,
		PrivateAddress: state.PrivateAddress,
		FlakeRevision:  state.FlakeRevision,
		RexURL:         state.RexURL,
		TokensRevoked:  state.TokensRevoked,
		Released:       state.ReleasedSteps(),
		Incomplete:     state.IncompleteSteps(),
		Error:          state.Error,
	}
}

// fail records a sanitized terminal failure and returns an application error
// whose message is already safe to persist in Temporal history.
func fail(ctx workflow.Context, state Status, cause error) (Status, error) {
	return terminate(ctx, state, cause)
}

// terminate records a terminal state and returns the workflow error.
//
// Cancellation is its own outcome, not a failure. A cancelled execution destroys
// nothing: the resource it may have allocated stays owned by the inventory record,
// the record stays "provisioning", and the milestone is written through a
// disconnected context because the cancelled one can no longer schedule an
// activity. An operator reconciles or tears the host down deliberately.
func terminate(ctx workflow.Context, state Status, cause error) (Status, error) {
	var canceled *temporal.CanceledError
	if errors.As(cause, &canceled) || ctx.Err() != nil {
		detached, _ := workflow.NewDisconnectedContext(ctx)
		state.State = domain.JobCanceled
		state.Error = &domain.JobError{
			Code:      ports.CodeCanceled,
			Message:   "job canceled; anything already allocated stays owned and is not destroyed automatically",
			Retryable: false,
		}
		state.UpdatedAt = workflow.Now(detached)
		record(detached, state)
		return state.Snapshot(), temporal.NewCanceledError(state.Error.Message)
	}

	jobErr := application.SanitizeError(cause)
	// An activity that refused permanently carries that refusal in its own error
	// type. The workflow cannot see the domain error through the SDK boundary, so
	// it reads the permanence the activity recorded.
	var activityErr *temporal.ApplicationError
	if errors.As(cause, &activityErr) && activityErr.NonRetryable() {
		jobErr.Retryable = false
	}
	state.State = domain.JobFailed
	state.Error = &jobErr
	state.Attempt++
	state.UpdatedAt = workflow.Now(ctx)
	record(ctx, state)
	return state.Snapshot(), temporal.NewApplicationError(
		jobErr.Message,
		failureType(jobErr.Retryable),
	)
}

// failureType maps retryability onto the application error type so the adapter
// can reconstruct it from a closed execution without decoding details.
func failureType(retryable bool) string {
	if retryable {
		return FailureTypeRetryable
	}
	return FailureTypePermanent
}

// FailureRetryable reports the retryability encoded by a workflow failure type.
func FailureRetryable(typeName string) bool {
	return typeName != FailureTypePermanent
}
