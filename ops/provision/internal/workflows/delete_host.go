package workflows

import (
	"errors"
	"fmt"
	"strings"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/ports"
)

// cleanupLog accumulates one outcome per teardown step. It is the workflow's
// record of what it actually finished, and it is what a partial teardown reports.
type cleanupLog struct {
	outcomes []CleanupOutcome
}

// pass records a step that finished.
func (l *cleanupLog) pass(step domain.CleanupStep) {
	l.outcomes = append(l.outcomes, CleanupOutcome{Step: string(step), Completed: true})
}

// fail records a step that did not finish, with a sanitized reason.
func (l *cleanupLog) fail(step domain.CleanupStep, reason string) {
	l.outcomes = append(l.outcomes, CleanupOutcome{Step: string(step), Completed: false, Reason: reason})
}

// DeleteHostWorkflow runs teardown: queued → revoking_access → removing_device →
// destroying → deleted.
//
// Four properties define it.
//
//  1. Credentials go first. Already-issued OpenBao tokens are revoked before the
//     AppRole is deleted, because deleting an AppRole does not invalidate a token
//     it already issued.
//  2. Every step runs even when an earlier one failed. A failing Bao endpoint must
//     not leave a billable EC2 instance running; containment and cost control are
//     the same action here, so the workflow destroys what it can and reports the
//     rest.
//  3. The outcome of every step is recorded in workflow history and persisted into
//     the inventory record after every step. A worker that dies mid-teardown
//     leaves a durable "which cleanup is left" answer, not a mystery.
//  4. A partial teardown is a retryable failure that names the incomplete steps. It
//     is never reported as deleted: a record that claims to be deleted while a live
//     token or a billable instance survives is worse than one that visibly needs
//     work.
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
		state.UpdatedAt = workflow.Now(ctx)
		record(ctx, state)
	}

	log := &cleanupLog{}

	advance(domain.StageRevokingAccess)

	// Step 1: invalidate every token that was already issued.
	var tokens RevokeHostTokensOutput
	if err := workflow.ExecuteActivity(ctx, ActivityRevokeHostTokens, RevokeHostTokensInput{
		HostID: in.Spec.HostID,
		Name:   in.Spec.Name,
	}).Get(ctx, &tokens); err != nil {
		log.fail(domain.CleanupRevokeTokens, reasonOf(err))
	} else {
		state.TokensRevoked = tokens.Revoked
		if tokens.Remaining > 0 {
			log.fail(domain.CleanupRevokeTokens,
				fmt.Sprintf("%d issued token(s) still carry the host policy", tokens.Remaining))
		} else {
			log.pass(domain.CleanupRevokeTokens)
		}
	}
	state.Cleanup = log.outcomes
	record(ctx, state)

	// Step 2: remove the future login credential and the policy behind it.
	if err := workflow.ExecuteActivity(ctx, ActivityRevokeHostCredentials, RevokeHostCredentialsInput{
		HostID:        in.Spec.HostID,
		Name:          in.Spec.Name,
		Profile:       in.Spec.Profile,
		SecretBundles: in.Spec.SecretBundles,
	}).Get(ctx, nil); err != nil {
		log.fail(domain.CleanupRevokeCredentials, reasonOf(err))
	} else {
		log.pass(domain.CleanupRevokeCredentials)
	}
	state.Cleanup = log.outcomes
	record(ctx, state)

	// Step 3: remove the tailnet device.
	advance(domain.StageRemovingDevice)
	if err := workflow.ExecuteActivity(ctx, ActivityRemoveDevice, RemoveDeviceInput{
		HostID:   in.Spec.HostID,
		HostName: in.Spec.Name,
		DeviceID: in.DeviceID,
	}).Get(ctx, nil); err != nil {
		log.fail(domain.CleanupRemoveDevice, reasonOf(err))
	} else {
		log.pass(domain.CleanupRemoveDevice)
	}
	state.Cleanup = log.outcomes
	record(ctx, state)

	// Step 4: destroy this host's Terraform state and nothing else.
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
		log.fail(domain.CleanupDestroyResources, reasonOf(err))
	} else {
		log.pass(domain.CleanupDestroyResources)
	}
	state.Cleanup = log.outcomes
	record(ctx, state)

	if incomplete := state.IncompleteSteps(); len(incomplete) > 0 {
		return partialTeardown(ctx, state)
	}

	advance(domain.StageDeleted)
	state.State = domain.JobDeleted
	record(ctx, state)
	return state.Snapshot(), nil
}

// partialTeardown ends a teardown that could not finish every step. The record is
// left out of "deleted", the error names the incomplete steps, and the failure is
// marked retryable: the cleanup steps are idempotent, so a retry finishes whatever
// was left, and the incomplete list tells the operator what to look at first.
func partialTeardown(ctx workflow.Context, state Status) (Status, error) {
	details := make([]string, 0, len(state.Cleanup))
	for _, outcome := range state.Cleanup {
		if outcome.Completed {
			continue
		}
		if outcome.Reason == "" {
			details = append(details, outcome.Step)
			continue
		}
		details = append(details, outcome.Step+" ("+outcome.Reason+")")
	}
	message := "teardown did not finish; incomplete cleanup: " + strings.Join(details, "; ")

	jobErr := domain.JobError{
		Code:      ports.CodeTeardownIncomplete,
		Message:   message,
		Retryable: true,
	}
	state.State = domain.JobFailed
	state.Error = &jobErr
	state.UpdatedAt = workflow.Now(ctx)
	record(ctx, state)
	return state.Snapshot(), temporal.NewApplicationError(message, FailureTypeRetryable)
}

// reasonOf turns an activity failure into a bounded, credential-free phrase for
// the cleanup report. The full failure stays in workflow history.
func reasonOf(err error) string {
	if err == nil {
		return ""
	}
	var canceled *temporal.CanceledError
	if errors.As(err, &canceled) {
		return "the activity was canceled"
	}
	return application.SanitizeError(err).Message
}
