package workflows

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
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
			NonRetryableErrorTypes: []string{application.CodeNotImplemented, FailureTypePermanent},
		},
	}
}

// CreateHostWorkflow runs the approved creation lifecycle:
// queued → creating → enrolling → deploying → authorizing → ready.
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

// DeleteHostWorkflow runs teardown: queued → revoking_access →
// removing_device → destroying → deleted.
func DeleteHostWorkflow(ctx workflow.Context, in DeleteHostInput) (Status, error) {
	state := Status{
		HostID:        in.Spec.HostID,
		JobID:         in.JobID,
		Kind:          domain.JobKindDelete,
		State:         domain.JobQueued,
		Stage:         domain.StageQueued,
		ResourceID:    in.ResourceID,
		DeviceID:      in.DeviceID,
		FlakeRevision: in.FlakeRevision,
		UpdatedAt:     workflow.Now(ctx),
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

	advance(domain.StageRevokingAccess)
	if err := workflow.ExecuteActivity(ctx, ActivityRevokeHostAccess, RevokeHostAccessInput{
		HostID:        in.Spec.HostID,
		Name:          in.Spec.Name,
		Profile:       in.Spec.Profile,
		SecretBundles: in.Spec.SecretBundles,
	}).Get(ctx, nil); err != nil {
		return failDelete(ctx, state, err)
	}
	record(ctx, state)

	advance(domain.StageRemovingDevice)
	if err := workflow.ExecuteActivity(ctx, ActivityRemoveDevice, RemoveDeviceInput{
		HostID:   in.Spec.HostID,
		DeviceID: in.DeviceID,
	}).Get(ctx, nil); err != nil {
		return failDelete(ctx, state, err)
	}
	record(ctx, state)

	advance(domain.StageDestroying)
	if err := workflow.ExecuteActivity(ctx, ActivityDestroyHostResource, DestroyHostResourceInput{
		HostID:     in.Spec.HostID,
		Name:       in.Spec.Name,
		Provider:   in.Spec.Provider,
		Profile:    in.Spec.Profile,
		Region:     in.Spec.Region,
		Size:       in.Spec.Size,
		ResourceID: in.ResourceID,
	}).Get(ctx, nil); err != nil {
		return failDelete(ctx, state, err)
	}

	advance(domain.StageDeleted)
	state.State = domain.JobDeleted
	record(ctx, state)
	return state.Snapshot(), nil
}

// record persists a milestone. Its failure does not fail the workflow: the
// Temporal history remains the execution record, and the next milestone
// supersedes this one.
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
		Stage:          string(state.Stage),
		State:          string(state.State),
		ResourceID:     state.ResourceID,
		DeviceID:       state.DeviceID,
		PrivateAddress: state.PrivateAddress,
		FlakeRevision:  state.FlakeRevision,
		RexURL:         state.RexURL,
		Error:          state.Error,
	}
}

// fail records a sanitized terminal failure and returns an application error
// whose message is already safe to persist in Temporal history.
func fail(ctx workflow.Context, state Status, cause error) (Status, error) {
	return terminate(ctx, state, cause)
}

func failDelete(ctx workflow.Context, state Status, cause error) (Status, error) {
	return terminate(ctx, state, cause)
}

func terminate(ctx workflow.Context, state Status, cause error) (Status, error) {
	jobErr := application.SanitizeError(cause)
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
