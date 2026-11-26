package ports

// Job failure vocabulary shared by the workflows, the adapters, and the API.

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
	// CodeTeardownIncomplete reports a teardown that finished some steps and not
	// others. It is retryable: every cleanup step is idempotent, so a retry
	// finishes what is left, and the message names the steps that did not finish.
	CodeTeardownIncomplete = "teardown_incomplete"
)
