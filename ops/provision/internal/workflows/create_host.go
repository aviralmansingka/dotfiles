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
	// activityStartToClose bounds a single provider/enrollment/deploy attempt.
	activityStartToClose = 5 * time.Minute
	// activityScheduleToStart bounds queueing before the worker picks it up.
	activityScheduleToStart = 2 * time.Minute
	// milestoneTimeout is short: a persisted-progress write must never stall a
	// workflow for long.
	milestoneTimeout = 30 * time.Second
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
	var deployed DeployProfileOutput
	if err := workflow.ExecuteActivity(ctx, ActivityDeployProfile, DeployProfileInput{
		HostID:     in.Spec.HostID,
		Name:       in.Spec.Name,
		Profile:    in.Spec.Profile,
		ResourceID: created.ResourceID,
		FlakeRef:   in.Spec.FlakeRef,
	}).Get(ctx, &deployed); err != nil {
		return fail(ctx, state, err)
	}
	state.FlakeRevision = deployed.FlakeRevision
	state.RexURL = deployed.RexURL
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
