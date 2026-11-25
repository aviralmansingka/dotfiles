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
}

// Clone returns a deep copy so callers cannot mutate stored state by aliasing
// the maps and slices.
func (h Host) Clone() Host {
	out := h
	out.Tags = cloneStringMap(h.Tags)
	out.SecretBundles = append([]string(nil), h.SecretBundles...)
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

// MarkDeleting records that a teardown job owns the host.
func (h *Host) MarkDeleting(now time.Time) {
	if h.State == HostStateDeleted {
		return
	}
	h.State = HostStateDeleting
	h.UpdatedAt = now
}

// MarkDeleted leaves a tombstone with the ownership record intact.
func (h *Host) MarkDeleted(now time.Time) {
	h.State = HostStateDeleted
	h.UpdatedAt = now
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
