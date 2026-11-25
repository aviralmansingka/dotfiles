package application

import (
	"errors"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// Failure codes reported in JobError.Code.
const (
	CodeInvalidRequest     = "invalid_request"
	CodeNotImplemented     = "not_implemented"
	CodeProvisioningFailed = "provisioning_failed"
	// CodeCanceled reports a job an operator cancelled. A cancelled job is not a
	// failure: it keeps whatever it allocated.
	CodeCanceled = "canceled"
	// CodeAgentUnavailable reports a host whose SSM agent never registered. It is
	// non-retryable: enrollment fails closed rather than trying another transport.
	CodeAgentUnavailable = "host_agent_unavailable"
)

// SanitizeError converts any error into a client-safe JobError. Unknown errors
// are retryable; a domain validation error or an unimplemented capability is
// not, because retrying cannot change the outcome.
func SanitizeError(err error) domain.JobError {
	if err == nil {
		return domain.JobError{Code: CodeProvisioningFailed, Message: "operation failed", Retryable: true}
	}
	var notImplemented *domain.NotImplementedError
	if errors.As(err, &notImplemented) {
		return domain.JobError{
			Code:      CodeNotImplemented,
			Message:   domain.SanitizeMessage(notImplemented.Error()),
			Retryable: false,
		}
	}
	var invalid *domain.ValidationError
	if errors.As(err, &invalid) {
		return domain.JobError{
			Code:      CodeInvalidRequest,
			Message:   domain.SanitizeMessage(invalid.Error()),
			Retryable: false,
		}
	}
	var agent *domain.AgentNotRegisteredError
	if errors.As(err, &agent) {
		return domain.JobError{
			Code:      CodeAgentUnavailable,
			Message:   domain.SanitizeMessage(agent.Error()),
			Retryable: false,
		}
	}
	// Identity refusals are permanent: a role already claimed by another host, a
	// consumed wrapping token, or a policy refusal cannot be fixed by retrying.
	// The message is already sanitized by the identity use case.
	var identityErr *domain.IdentityError
	if errors.As(err, &identityErr) {
		return domain.JobError{
			Code:      CodeProvisioningFailed,
			Message:   domain.SanitizeMessage(identityErr.Error()),
			Retryable: false,
		}
	}
	// Ambiguous ownership is a permanent refusal: an operator has to reconcile the
	// provider record by hand, and retrying the same destroy cannot make the
	// mapping less ambiguous.
	var ambiguous *domain.AmbiguousOwnershipError
	if errors.As(err, &ambiguous) {
		return domain.JobError{
			Code:      CodeProvisioningFailed,
			Message:   domain.SanitizeMessage(ambiguous.Error()),
			Retryable: false,
		}
	}
	var claim *domain.RoleClaimError
	if errors.As(err, &claim) {
		return domain.JobError{
			Code:      CodeProvisioningFailed,
			Message:   domain.SanitizeMessage(claim.Error()),
			Retryable: false,
		}
	}
	var consumed *domain.WrapTokenConsumedError
	if errors.As(err, &consumed) {
		return domain.JobError{
			Code:      CodeProvisioningFailed,
			Message:   domain.SanitizeMessage(consumed.Error()),
			Retryable: false,
		}
	}
	return domain.JobError{
		Code:      CodeProvisioningFailed,
		Message:   domain.SanitizeMessage(err.Error()),
		Retryable: true,
	}
}
