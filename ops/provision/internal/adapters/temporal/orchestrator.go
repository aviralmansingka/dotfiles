package temporaladapter

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/api/serviceerror"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/temporal"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/workflows"
)

// Job ID prefixes make the job kind recoverable from a job ID alone, so a
// describe call never has to guess and never needs a second store.
const (
	createJobPrefix = "create-"
	deleteJobPrefix = "delete-"
)

// Orchestrator implements application.JobOrchestrator on Temporal.
type Orchestrator struct {
	client    client.Client
	namespace string
	taskQueue string
	log       application.Logger
}

var _ application.JobOrchestrator = (*Orchestrator)(nil)

// NewOrchestrator builds the orchestrator. It requires a client but not a live
// connection: connection setup belongs to the composition root.
func NewOrchestrator(c client.Client, namespace, taskQueue string, log application.Logger) (*Orchestrator, error) {
	if c == nil {
		return nil, errors.New("temporal: client is required")
	}
	if namespace == "" {
		return nil, errors.New("temporal: namespace is required")
	}
	if taskQueue == "" {
		return nil, errors.New("temporal: task queue is required")
	}
	if log == nil {
		return nil, errors.New("temporal: logger is required")
	}
	return &Orchestrator{client: c, namespace: namespace, taskQueue: taskQueue, log: log}, nil
}

// Namespace reports the configured namespace (a non-secret reference).
func (o *Orchestrator) Namespace() string { return o.namespace }

func (o *Orchestrator) startOptions(jobID string) client.StartWorkflowOptions {
	return client.StartWorkflowOptions{
		ID:        jobID,
		TaskQueue: o.taskQueue,
		// A duplicate start is rejected by the server, so exactly one durable
		// operation exists per job ID even if two API processes race.
		WorkflowIDReusePolicy:                    enumspb.WORKFLOW_ID_REUSE_POLICY_REJECT_DUPLICATE,
		WorkflowExecutionErrorWhenAlreadyStarted: true,
		WorkflowExecutionTimeout:                 45 * time.Minute,
	}
}

// StartCreateHost starts the creation workflow under the deterministic job ID.
func (o *Orchestrator) StartCreateHost(ctx context.Context, spec application.CreateHostSpec) (application.JobRef, error) {
	run, err := o.client.ExecuteWorkflow(ctx, o.startOptions(spec.JobID), workflows.CreateHostWorkflowName, workflows.CreateHostInput{
		Spec: workflows.HostSpec{
			HostID:        spec.HostID,
			Name:          spec.Name,
			Provider:      string(spec.Provider),
			Profile:       spec.Profile,
			Region:        spec.Region,
			Size:          spec.Size,
			InstanceType:  spec.InstanceType,
			DiskGB:        spec.DiskGB,
			Tags:          spec.Tags,
			SecretBundles: spec.SecretBundles,
			FlakeRef:      spec.FlakeRef,
		},
		JobID:          spec.JobID,
		IdempotencyKey: spec.IdempotencyKey,
		OwnerClientID:  spec.OwnerClientID,
	})
	if err != nil {
		if isAlreadyStarted(err) {
			o.log.Info("job.already_started", "job_id", spec.JobID, "host_id", spec.HostID)
			return application.JobRef{JobID: spec.JobID, HostID: spec.HostID}, nil
		}
		return application.JobRef{}, fmt.Errorf("temporal: start create workflow: %w", err)
	}
	return application.JobRef{JobID: run.GetID(), RunID: run.GetRunID(), HostID: spec.HostID}, nil
}

// StartDeleteHost starts the teardown workflow.
func (o *Orchestrator) StartDeleteHost(ctx context.Context, spec application.DeleteHostSpec) (application.JobRef, error) {
	run, err := o.client.ExecuteWorkflow(ctx, o.startOptions(spec.JobID), workflows.DeleteHostWorkflowName, workflows.DeleteHostInput{
		Spec: workflows.HostSpec{
			HostID:        spec.HostID,
			Name:          spec.Name,
			Provider:      string(spec.Provider),
			Region:        spec.Region,
			SecretBundles: spec.SecretBundles,
		},
		JobID:      spec.JobID,
		ResourceID: spec.ResourceID,
	})
	if err != nil {
		if isAlreadyStarted(err) {
			o.log.Info("job.already_started", "job_id", spec.JobID, "host_id", spec.HostID)
			return application.JobRef{JobID: spec.JobID, HostID: spec.HostID}, nil
		}
		return application.JobRef{}, fmt.Errorf("temporal: start delete workflow: %w", err)
	}
	return application.JobRef{JobID: run.GetID(), RunID: run.GetRunID(), HostID: spec.HostID}, nil
}

// DescribeJob reports a job from Temporal. A closed execution is read through
// Describe plus the recorded result or failure; a running one is read through
// the deterministic status query. Missing executions become ErrNotFound.
func (o *Orchestrator) DescribeJob(ctx context.Context, handle application.JobHandle) (application.JobView, error) {
	description, err := o.client.DescribeWorkflowExecution(ctx, handle.JobID, handle.RunID)
	if err != nil {
		var notFound *serviceerror.NotFound
		if errors.As(err, &notFound) {
			return application.JobView{}, domain.ErrNotFound
		}
		return application.JobView{}, fmt.Errorf("temporal: describe job: %w", err)
	}
	info := description.GetWorkflowExecutionInfo()
	runID := handle.RunID
	if runID == "" && info.GetExecution() != nil {
		runID = info.GetExecution().GetRunId()
	}
	view := application.JobView{
		JobID:     handle.JobID,
		Kind:      kindFromJobID(handle.JobID),
		RunID:     runID,
		State:     domain.JobInProgress,
		Stage:     domain.StageQueued,
		CreatedAt: timestampOrZero(info.GetStartTime()),
		UpdatedAt: timestampOrZero(info.GetStartTime()),
	}
	if closeTime := info.GetCloseTime(); closeTime != nil {
		view.UpdatedAt = closeTime.AsTime().UTC()
	}

	switch info.GetStatus() {
	case enumspb.WORKFLOW_EXECUTION_STATUS_RUNNING:
		o.applyRunningStatus(ctx, handle.JobID, runID, &view)
	case enumspb.WORKFLOW_EXECUTION_STATUS_COMPLETED:
		o.applyCompletedResult(ctx, handle.JobID, runID, &view)
	case enumspb.WORKFLOW_EXECUTION_STATUS_CANCELED:
		// A cancellation is not a provider failure. The job reports the canceled
		// state, keeps the stage it reached, and carries no error from a step that
		// never ran; whatever it allocated is still owned by the inventory record.
		view.State = domain.JobCanceled
		if view.Stage == "" {
			view.Stage = domain.StageQueued
		}
	case enumspb.WORKFLOW_EXECUTION_STATUS_FAILED,
		enumspb.WORKFLOW_EXECUTION_STATUS_TERMINATED,
		enumspb.WORKFLOW_EXECUTION_STATUS_TIMED_OUT:
		o.applyFailure(ctx, handle.JobID, runID, &view)
	default:
		// Pending, unspecific, or paused: the workflow has not produced a stage.
	}
	if view.HostID == "" {
		// The host ID rides in the workflow payload; recover it from the query or
		// result when available, otherwise leave it empty and let the use case
		// report not-found rather than guessing an owner.
		view.HostID = hostIDFromQuery(ctx, o.client, handle.JobID, runID)
	}
	if view.HostID == "" {
		view.HostID = strings.TrimPrefix(strings.TrimPrefix(handle.JobID, createJobPrefix), deleteJobPrefix)
	}
	return view, nil
}

func (o *Orchestrator) applyRunningStatus(ctx context.Context, jobID, runID string, view *application.JobView) {
	value, err := o.client.QueryWorkflow(ctx, jobID, runID, workflows.StatusQueryName)
	if err != nil {
		// The execution may have closed between describe and query. Keep the
		// in-progress view; a later poll returns the terminal state.
		o.log.Warn("job.query_failed", "job_id", jobID, "error", domain.SanitizeMessage(err.Error()))
		return
	}
	var status workflows.Status
	if err := value.Get(&status); err != nil {
		o.log.Warn("job.query_decode_failed", "job_id", jobID, "error", domain.SanitizeMessage(err.Error()))
		return
	}
	applyStatus(status, view)
}

func (o *Orchestrator) applyCompletedResult(ctx context.Context, jobID, runID string, view *application.JobView) {
	var status workflows.Status
	if err := o.client.GetWorkflow(ctx, jobID, runID).Get(ctx, &status); err != nil {
		o.log.Warn("job.result_failed", "job_id", jobID, "error", domain.SanitizeMessage(err.Error()))
		return
	}
	applyStatus(status, view)
}

func (o *Orchestrator) applyFailure(ctx context.Context, jobID, runID string, view *application.JobView) {
	view.State = domain.JobFailed
	if view.Stage == "" {
		view.Stage = domain.StageQueued
	}
	err := o.client.GetWorkflow(ctx, jobID, runID).Get(ctx, nil)
	if err == nil {
		return
	}
	jobErr := jobErrorFromExecution(err)
	view.Error = &jobErr
}

func applyStatus(status workflows.Status, view *application.JobView) {
	view.HostID = status.HostID
	view.Kind = status.Kind
	view.State = status.State
	view.Stage = status.Stage
	view.Error = status.Error
	if !status.UpdatedAt.IsZero() {
		view.UpdatedAt = status.UpdatedAt.UTC()
	}
}

// jobErrorFromExecution turns a workflow failure into a sanitized job error.
func jobErrorFromExecution(err error) domain.JobError {
	var appErr *temporal.ApplicationError
	if errors.As(err, &appErr) {
		return domain.JobError{
			Code:      codeFromFailureType(appErr.Type()),
			Message:   domain.SanitizeMessage(appErr.Message()),
			Retryable: workflows.FailureRetryable(appErr.Type()),
		}
	}
	return application.SanitizeError(err)
}

func codeFromFailureType(typeName string) string {
	switch typeName {
	case application.CodeNotImplemented:
		return application.CodeNotImplemented
	case application.CodeInvalidRequest:
		return application.CodeInvalidRequest
	default:
		return application.CodeProvisioningFailed
	}
}

func isAlreadyStarted(err error) bool {
	var alreadyStarted *serviceerror.WorkflowExecutionAlreadyStarted
	return errors.As(err, &alreadyStarted)
}

func kindFromJobID(jobID string) domain.JobKind {
	if strings.HasPrefix(jobID, deleteJobPrefix) {
		return domain.JobKindDelete
	}
	return domain.JobKindCreate
}

func hostIDFromQuery(ctx context.Context, c client.Client, jobID, runID string) string {
	value, err := c.QueryWorkflow(ctx, jobID, runID, workflows.StatusQueryName)
	if err != nil {
		return ""
	}
	var status workflows.Status
	if err := value.Get(&status); err != nil {
		return ""
	}
	return status.HostID
}

func timestampOrZero(ts *timestamppb.Timestamp) time.Time {
	if ts == nil {
		return time.Time{}
	}
	return ts.AsTime().UTC()
}
