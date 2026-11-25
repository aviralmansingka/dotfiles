// Package workflows owns the deterministic Temporal workflows and the payload
// shapes exchanged with activities. Nothing here touches a network, a clock, a
// provider SDK, or a credential value: inputs are fully resolved non-secret
// values, and every timestamp comes from workflow.Now.
package workflows

import (
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// Registered workflow names. The adapter registers with these exact names.
const (
	CreateHostWorkflowName = "CreateHostWorkflow"
	DeleteHostWorkflowName = "DeleteHostWorkflow"
)

// StatusQueryName is the deterministic, side-effect-free status query.
const StatusQueryName = "status"

// Registered activity names. The registry adapter uses these exact names, so a
// rename cannot silently desynchronize a workflow from its activity.
const (
	ActivityCreateHostResource    = "CreateHostResource"
	ActivityCheckSSMAgent         = "CheckSSMAgent"
	ActivityEnrollHost            = "EnrollHost"
	ActivityDeployProfile         = "DeployProfile"
	ActivityAuthorizeHost         = "AuthorizeHost"
	ActivityRevokeHostTokens      = "RevokeHostTokens"
	ActivityRevokeHostCredentials = "RevokeHostCredentials"
	ActivityRemoveDevice          = "RemoveDevice"
	ActivityDestroyHostResource   = "DestroyHostResource"
	ActivityRecordHostMilestone   = "RecordHostMilestone"
)

// Activity failure types used to carry retryability without leaking error
// details. The adapter maps these back to a JobError.Retryable flag.
const (
	FailureTypeRetryable = "ProvisioningFailedRetryable"
	FailureTypePermanent = "ProvisioningFailedPermanent"
)

// HostSpec is the non-secret, server-resolved host description that travels in
// workflow inputs and activity payloads.
type HostSpec struct {
	HostID       string            `json:"host_id"`
	Name         string            `json:"name"`
	Provider     string            `json:"provider"`
	Profile      string            `json:"profile"`
	Region       string            `json:"region"`
	Size         string            `json:"size"`
	InstanceType string            `json:"instance_type"`
	DiskGB       int               `json:"disk_gb"`
	Tags         map[string]string `json:"tags"`
	// SecretBundles holds approved OpenBao path references only. Values are
	// acquired inside activities and never appear in a payload.
	SecretBundles []string `json:"secret_bundles"`
	// FlakeRef is the approved flake target resolved from server configuration.
	FlakeRef string `json:"flake_ref"`
}

// CreateHostInput starts a host creation.
type CreateHostInput struct {
	Spec           HostSpec `json:"spec"`
	JobID          string   `json:"job_id"`
	IdempotencyKey string   `json:"idempotency_key"`
	OwnerClientID  string   `json:"owner_client_id"`
}

// DeleteHostInput starts a host teardown. Profile and Size travel because
// Terraform needs every declared variable to plan a destroy, and the adapter
// re-resolves the shape from the catalog instead of trusting a remembered value.
type DeleteHostInput struct {
	Spec          HostSpec `json:"spec"`
	JobID         string   `json:"job_id"`
	ResourceID    string   `json:"resource_id"`
	DeviceID      string   `json:"device_id"`
	FlakeRevision string   `json:"flake_revision"`
	// Attempt counts the teardown job so workflow history and the inventory record
	// agree on which run did the work.
	Attempt int `json:"attempt"`
}

// CreateHostResourceInput allocates the compute resource.
type CreateHostResourceInput struct {
	HostID       string            `json:"host_id"`
	Name         string            `json:"name"`
	Provider     string            `json:"provider"`
	Profile      string            `json:"profile"`
	Region       string            `json:"region"`
	Size         string            `json:"size"`
	InstanceType string            `json:"instance_type"`
	DiskGB       int               `json:"disk_gb"`
	Tags         map[string]string `json:"tags"`
}

// CreateHostResourceOutput reports the public resource identity. Resumed is true
// when the activity adopted a resource an earlier attempt had already allocated
// instead of asking the provider for a new one.
type CreateHostResourceOutput struct {
	ResourceID     string `json:"resource_id"`
	PrivateAddress string `json:"private_address"`
	Resumed        bool   `json:"resumed"`
}

// EnrollHostInput asks for a tailnet enrollment. It carries the provider resource
// id because every control-plane call is addressed to exactly that instance. It
// carries no tailnet tag: the tag is resolved server-side from the approved
// profile.
type EnrollHostInput struct {
	HostID         string   `json:"host_id"`
	Name           string   `json:"name"`
	ResourceID     string   `json:"resource_id"`
	PrivateAddress string   `json:"private_address"`
	Profile        string   `json:"profile"`
	SecretBundles  []string `json:"secret_bundles"`
}

// CheckSSMAgentInput asks whether a host's SSM agent registered. It carries the
// provider resource id only: the check is one control-plane query, and it decides
// whether an enrollment may start.
type CheckSSMAgentInput struct {
	HostID     string `json:"host_id"`
	InstanceID string `json:"instance_id"`
}

// CheckSSMAgentOutput records the agent check in workflow history: the ping
// status the control plane reported, and whether the agent is online. It is an
// explicit activity because the answer is the gate in front of enrollment — with
// no agent there is no transport, and enrollment fails instead of reaching for
// SSH.
type CheckSSMAgentOutput struct {
	InstanceID string `json:"instance_id"`
	PingStatus string `json:"ping_status"`
	Online     bool   `json:"online"`
}

// EnrollHostOutput reports the enrolled identity without credentials. No
// enrollment key can appear here: the key is never a field of any payload, and it
// reaches the host as an encrypted parameter the command only names.
type EnrollHostOutput struct {
	DeviceID   string `json:"device_id"`
	TailnetTag string `json:"tailnet_tag"`
	Resumed    bool   `json:"resumed"`
}

// DeployProfileInput asks for the approved flake profile deployment.
type DeployProfileInput struct {
	HostID     string `json:"host_id"`
	Name       string `json:"name"`
	Profile    string `json:"profile"`
	ResourceID string `json:"resource_id"`
	FlakeRef   string `json:"flake_ref"`
}

// DeployProfileOutput reports the deployed immutable revision.
type DeployProfileOutput struct {
	FlakeRevision string `json:"flake_revision"`
	RexURL        string `json:"rex_url"`
}

// AuthorizeHostInput grants the host its approved secret bundles.
type AuthorizeHostInput struct {
	HostID        string   `json:"host_id"`
	Name          string   `json:"name"`
	Profile       string   `json:"profile"`
	SecretBundles []string `json:"secret_bundles"`
}

// RevokeHostTokensInput asks for every already-issued token carrying the host's
// policy to be invalidated. It is its own activity, not a step inside the
// credential revocation, because it is the only step that cuts off a session that
// already exists — and because a failure here has to be reportable on its own.
type RevokeHostTokensInput struct {
	HostID string `json:"host_id"`
	Name   string `json:"name"`
}

// RevokeHostTokensOutput reports how many issued tokens were invalidated and how
// many still carry the host's policy afterwards. A non-zero Remaining is a partial
// revocation, and the workflow reports the step as incomplete.
type RevokeHostTokensOutput struct {
	Revoked   int `json:"revoked"`
	Remaining int `json:"remaining"`
}

// RevokeHostCredentialsInput asks for the AppRole and the ACL policy to be
// deleted, so no SecretID can produce a new login. Deleting the AppRole does not
// touch an issued token; that is what RevokeHostTokensInput is for.
type RevokeHostCredentialsInput struct {
	HostID        string   `json:"host_id"`
	Name          string   `json:"name"`
	Profile       string   `json:"profile"`
	SecretBundles []string `json:"secret_bundles"`
}

// RemoveDeviceInput removes a tailnet device. HostName travels with the recorded
// device id so a refusal names the host it is about.
type RemoveDeviceInput struct {
	HostID   string `json:"host_id"`
	HostName string `json:"host_name"`
	DeviceID string `json:"device_id"`
}

// DestroyHostResourceInput destroys the provider resource. Profile and Size
// come from the same resolved host spec that created it, so the destroy runs
// with the identical variable set.
type DestroyHostResourceInput struct {
	HostID     string `json:"host_id"`
	Name       string `json:"name"`
	Provider   string `json:"provider"`
	Profile    string `json:"profile"`
	Region     string `json:"region"`
	Size       string `json:"size"`
	ResourceID string `json:"resource_id"`
}

// RecordHostMilestoneInput persists progress outside workflow history so
// inventory survives workflow expiry.
type RecordHostMilestoneInput struct {
	HostID         string           `json:"host_id"`
	JobID          string           `json:"job_id"`
	Kind           string           `json:"kind"`
	Stage          string           `json:"stage"`
	State          string           `json:"state"`
	ResourceID     string           `json:"resource_id"`
	DeviceID       string           `json:"device_id"`
	PrivateAddress string           `json:"private_address"`
	FlakeRevision  string           `json:"flake_revision"`
	RexURL         string           `json:"rex_url"`
	TokensRevoked  int              `json:"tokens_revoked,omitempty"`
	Released       []string         `json:"released,omitempty"`
	Incomplete     []string         `json:"incomplete,omitempty"`
	Error          *domain.JobError `json:"error,omitempty"`
}

// CleanupOutcome records one teardown step's result. The reason is sanitized: no
// credential, address, or provider payload reaches it.
type CleanupOutcome struct {
	Step      string `json:"step"`
	Completed bool   `json:"completed"`
	Reason    string `json:"reason,omitempty"`
}

// Status is the deterministic snapshot returned by the status query and by a
// completed workflow.
type Status struct {
	HostID         string          `json:"host_id"`
	JobID          string          `json:"job_id"`
	Kind           domain.JobKind  `json:"kind"`
	State          domain.JobState `json:"state"`
	Stage          domain.Stage    `json:"stage"`
	ResourceID     string          `json:"resource_id"`
	DeviceID       string          `json:"device_id"`
	PrivateAddress string          `json:"private_address"`
	FlakeRevision  string          `json:"flake_revision"`
	RexURL         string          `json:"rex_url"`
	// Cleanup is the outcome of every teardown step, in ladder order. A teardown
	// that failed part-way reports exactly which steps did not finish.
	Cleanup []CleanupOutcome `json:"cleanup,omitempty"`
	// TokensRevoked counts already-issued credentials this teardown invalidated.
	TokensRevoked int              `json:"tokens_revoked,omitempty"`
	Error         *domain.JobError `json:"error,omitempty"`
	UpdatedAt     time.Time        `json:"updated_at"`
	Attempt       int              `json:"attempt"`
}

// Snapshot returns a copy that a query caller cannot use to mutate workflow
// state.
func (s Status) Snapshot() Status {
	out := s
	if s.Error != nil {
		errCopy := *s.Error
		out.Error = &errCopy
	}
	out.Cleanup = append([]CleanupOutcome(nil), s.Cleanup...)
	return out
}

// IncompleteSteps returns the cleanup steps that did not finish, in order.
func (s Status) IncompleteSteps() []string {
	steps := make([]string, 0, len(s.Cleanup))
	for _, outcome := range s.Cleanup {
		if !outcome.Completed {
			steps = append(steps, outcome.Step)
		}
	}
	return steps
}

// ReleasedSteps returns the cleanup steps that completed, in order.
func (s Status) ReleasedSteps() []string {
	steps := make([]string, 0, len(s.Cleanup))
	for _, outcome := range s.Cleanup {
		if outcome.Completed {
			steps = append(steps, outcome.Step)
		}
	}
	return steps
}
