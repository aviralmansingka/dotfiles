package domain

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

// Provider is a compute backend identifier. S01 approves exactly one.
type Provider string

// ProviderAWS is the first and only approved provider.
const ProviderAWS Provider = "aws"

// HostState is the inventory-level state of a host. It is persisted in the
// inventory, not in workflow history, so a completed workflow cannot erase it.
type HostState string

const (
	HostStateProvisioning HostState = "provisioning"
	HostStateReady        HostState = "ready"
	HostStateFailed       HostState = "failed"
	HostStateDeleting     HostState = "deleting"
	HostStateDeleted      HostState = "deleted"
)

// Host is an owned provisioned machine. It carries no credential values: only
// references to approved secret bundles.
type Host struct {
	ID            string            `json:"id"`
	Name          string            `json:"name"`
	Provider      Provider          `json:"provider"`
	Profile       string            `json:"profile"`
	Region        string            `json:"region"`
	Size          string            `json:"size"`
	InstanceType  string            `json:"instance_type"`
	DiskGB        int               `json:"disk_gb"`
	Tags          map[string]string `json:"tags"`
	SecretBundles []string          `json:"secret_bundles"`
	OwnerClientID string            `json:"owner_client_id"`
	JobID         string            `json:"job_id"`
	State         HostState         `json:"state"`
	// ResourceID is the provider's public identity for the allocated compute
	// resource. It is written the moment the provider reports it, before any
	// later step runs, so a worker that dies between allocation and its own
	// milestone still leaves a durable owner for the instance.
	ResourceID string `json:"resource_id,omitempty"`
	// DeviceID is the enrolled tailnet identity. It is written the moment
	// enrollment reports it for the same reason: a resume must be able to tell
	// an already-joined device from a missing one instead of joining twice.
	DeviceID       string    `json:"device_id,omitempty"`
	FlakeRevision  string    `json:"flake_revision,omitempty"`
	PrivateAddress string    `json:"private_address,omitempty"`
	RexURL         string    `json:"rex_url,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
	// Tombstone is written once, when a teardown has finished every cleanup
	// step. It is the record's own proof that the host is gone, and it is
	// sanitized: see TombstonePolicy.
	Tombstone *Tombstone `json:"tombstone,omitempty"`
	// PendingCleanup lists the teardown steps a failed delete has not finished.
	// It is the durable half of "report which cleanup is incomplete": a retry
	// reads it, and an operator who never retries still sees what is left.
	PendingCleanup []CleanupStep `json:"pending_cleanup,omitempty"`
	// DeleteAttempts counts how many teardown jobs have been started. A retry
	// after a partial teardown gets a fresh job id, and this counter is what
	// makes that id unique.
	DeleteAttempts int `json:"delete_attempts,omitempty"`
	// DeleteJobID is the teardown job that owns this record. A repeat DELETE
	// reads it and returns it instead of starting a second teardown, and a
	// tombstoned record answers with it so a caller can look up the run that did
	// the work.
	DeleteJobID string `json:"delete_job_id,omitempty"`
}

// Clone returns a deep copy so callers cannot mutate stored state by aliasing
// the maps and slices.
func (h Host) Clone() Host {
	out := h
	out.Tags = cloneStringMap(h.Tags)
	out.SecretBundles = append([]string(nil), h.SecretBundles...)
	out.PendingCleanup = append([]CleanupStep(nil), h.PendingCleanup...)
	if h.Tombstone != nil {
		tombstone := *h.Tombstone
		tombstone.Released = append([]CleanupStep(nil), h.Tombstone.Released...)
		tombstone.Incomplete = append([]CleanupStep(nil), h.Tombstone.Incomplete...)
		out.Tombstone = &tombstone
	}
	return out
}

// MarkReady records the readiness milestone.
func (h *Host) MarkReady(flakeRevision, privateAddress, rexURL string, now time.Time) {
	h.State = HostStateReady
	h.FlakeRevision = flakeRevision
	h.PrivateAddress = privateAddress
	h.RexURL = rexURL
	h.UpdatedAt = now
}

// MarkFailed keeps the ownership record: a failed host stays visible so its
// resources can be reconciled or torn down. It never turns into "ready".
func (h *Host) MarkFailed(now time.Time) {
	if h.State == HostStateDeleted {
		return
	}
	h.State = HostStateFailed
	h.UpdatedAt = now
}

// MarkResource records the provider resource identity immediately after
// allocation. It is separate from MarkReady on purpose: a record that names a
// resource but is not ready tells the next run to adopt the instance rather than
// create a second one.
func (h *Host) MarkResource(resourceID, privateAddress string, now time.Time) {
	if resourceID != "" {
		h.ResourceID = resourceID
	}
	if privateAddress != "" {
		h.PrivateAddress = privateAddress
	}
	h.UpdatedAt = now.UTC()
}

// MarkDevice records the enrolled tailnet identity immediately after enrollment.
func (h *Host) MarkDevice(deviceID string, now time.Time) {
	if deviceID != "" {
		h.DeviceID = deviceID
	}
	h.UpdatedAt = now.UTC()
}

// MarkDeleting records that a teardown owns the host. It is the milestone-level
// transition, so it counts nothing: the teardown job id and the attempt number are
// set once, by BeginTeardown, when the use case accepts the request.
func (h *Host) MarkDeleting(now time.Time) {
	if h.State == HostStateDeleted {
		return
	}
	h.State = HostStateDeleting
	h.UpdatedAt = now.UTC()
}

// BeginTeardown starts teardown attempt number attempt, owned by jobID. It is the
// only place the attempt counter moves, so a milestone written by the running
// workflow can never inflate the number the next retry derives its job id from.
func (h *Host) BeginTeardown(jobID string, attempt int, now time.Time) {
	if h.State == HostStateDeleted {
		return
	}
	h.State = HostStateDeleting
	h.DeleteAttempts = attempt
	h.DeleteJobID = jobID
	h.UpdatedAt = now.UTC()
}

// MarkDeleted leaves a tombstone with the ownership record intact.
func (h *Host) MarkDeleted(now time.Time) {
	h.State = HostStateDeleted
	h.UpdatedAt = now
}

// CompleteTeardown writes the tombstone and drops every field that described
// infrastructure which no longer exists. The identifiers of what was destroyed
// (the provider resource id, the tailnet device id) and the approved shape that
// drove the cost stay, because "which instance did we delete, and what did it
// cost to run" is the question a tombstone has to answer.
func (h *Host) CompleteTeardown(t Tombstone) error {
	if reason := t.Sanitized(); reason != "" {
		return fmt.Errorf("domain: refusing to tombstone host %s: %s", h.ID, reason)
	}
	if !t.Complete() {
		return fmt.Errorf("domain: refusing to tombstone host %s: cleanup is incomplete (%s)", h.ID, IncompleteCleanup(t.Incomplete))
	}
	h.State = HostStateDeleted
	h.Tombstone = &t
	h.PendingCleanup = nil
	// Everything below described a machine that no longer exists, or a place
	// credentials were written. None of it belongs on a tombstone.
	h.PrivateAddress = ""
	h.RexURL = ""
	h.FlakeRevision = ""
	h.Tags = nil
	h.UpdatedAt = t.DeletedAt.UTC()
	return nil
}

// MarkCleanupIncomplete records a partial teardown. The host stays out of
// "deleted" on purpose: a record that claims to be deleted while a billable
// instance or a live token survives is worse than one that visibly needs work.
func (h *Host) MarkCleanupIncomplete(steps []CleanupStep, now time.Time) {
	if h.State == HostStateDeleted {
		return
	}
	h.State = HostStateFailed
	h.PendingCleanup = dedupeSteps(steps)
	h.UpdatedAt = now.UTC()
}

// NeedsCleanup reports whether a teardown has steps left to finish.
func (h Host) NeedsCleanup() bool {
	return len(h.PendingCleanup) > 0
}

// hostNamePattern is an allow-list, not a deny-list: lowercase alphanumerics
// and inner hyphens only. Shell metacharacters, path separators, dots, spaces,
// and control characters all fail by construction.
var hostNamePattern = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`)

// hostNameForbidden lists characters that must never appear even if a future
// pattern change slipped: defense in depth for names interpolated into tags,
// file paths, or provider arguments.
const hostNameForbidden = "/\\;|&$`'\"(){}[]<>\n\r\t*?!#~=+ ,:"

// ValidateHostName enforces the approved host-name shape. A valid name is
// 3..32 lowercase characters, starts and ends alphanumeric, and may contain
// inner hyphens.
func ValidateHostName(name string) error {
	if name == "" {
		return Invalid("name", "is required")
	}
	if len(name) < 3 || len(name) > 32 {
		return Invalid("name", "must be 3 to 32 characters")
	}
	if strings.ContainsAny(name, hostNameForbidden) {
		return Invalid("name", "must contain only lowercase letters, digits, and inner hyphens")
	}
	if strings.Contains(name, "..") {
		return Invalid("name", "must not contain path traversal")
	}
	if !hostNamePattern.MatchString(name) {
		return Invalid("name", "must start and end with a lowercase letter or digit")
	}
	return nil
}

// ValidateProvider enforces the approved provider set.
func ValidateProvider(p string) (Provider, error) {
	provider := Provider(p)
	if provider != ProviderAWS {
		return "", Invalid("provider", fmt.Sprintf("must be %q", ProviderAWS))
	}
	return provider, nil
}
