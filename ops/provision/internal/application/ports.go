package application

import (
	"context"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// Clock supplies the current time so the service is testable without sleeping.
type Clock interface {
	Now() time.Time
}

// IDGenerator supplies opaque resource identifiers.
type IDGenerator interface {
	NewID(prefix string) string
}

// Logger is a small structured logging port. Implementations must not add
// credential values; the service only ever passes sanitized fields.
type Logger interface {
	Info(msg string, kv ...any)
	Warn(msg string, kv ...any)
	Error(msg string, kv ...any)
}

// Principal identifies an authenticated API client.
type Principal struct {
	ClientID string
}

// JobHandle locates one Temporal execution.
type JobHandle struct {
	JobID string
	RunID string
}

// JobRef is the durable reference returned when a job is started. The run ID is
// empty when the orchestrator did not report one (offline fakes).
type JobRef struct {
	JobID  string
	RunID  string
	HostID string
}

// JobView is the orchestrator's report of a job. State and stage come from the
// workflow, never from a second source of truth.
type JobView struct {
	JobID     string
	HostID    string
	Kind      domain.JobKind
	State     domain.JobState
	Stage     domain.Stage
	Error     *domain.JobError
	CreatedAt time.Time
	UpdatedAt time.Time
	RunID     string
}

// CreateHostSpec is the non-secret, fully resolved description of a host
// creation. It may be serialized into a workflow input: it holds no credential
// values, only approved secret-bundle references.
type CreateHostSpec struct {
	JobID         string
	HostID        string
	Name          string
	Provider      domain.Provider
	Profile       string
	Region        string
	Size          string
	InstanceType  string
	DiskGB        int
	Tags          map[string]string
	SecretBundles []string
	// FlakeRef is the approved flake target resolved from the profile
	// configuration. It is never client input.
	FlakeRef       string
	IdempotencyKey string
	OwnerClientID  string
}

// DeleteHostSpec is the non-secret description of a teardown.
type DeleteHostSpec struct {
	JobID         string
	HostID        string
	Name          string
	Provider      domain.Provider
	Region        string
	ResourceID    string
	SecretBundles []string
}

// JobOrchestrator starts and inspects durable jobs. Temporal implements it; the
// application layer never imports the Temporal SDK.
type JobOrchestrator interface {
	StartCreateHost(ctx context.Context, spec CreateHostSpec) (JobRef, error)
	StartDeleteHost(ctx context.Context, spec DeleteHostSpec) (JobRef, error)
	DescribeJob(ctx context.Context, handle JobHandle) (JobView, error)
}

// HostInventory is the durable record of owned hosts. It is independent of
// workflow history so a completed or expired execution cannot delete ownership
// information.
type HostInventory interface {
	// CreateHost stores a new host. The bool is false when a host with the same
	// ID already exists (in which case the stored host is returned).
	CreateHost(ctx context.Context, host domain.Host) (domain.Host, bool, error)
	GetHost(ctx context.Context, id string) (domain.Host, error)
	ListHosts(ctx context.Context) ([]domain.Host, error)
	// UpdateHost applies mutate atomically against the stored host.
	UpdateHost(ctx context.Context, id string, mutate func(h *domain.Host) error) (domain.Host, error)
}

// IdempotencyRecord is one durable reservation of an Idempotency-Key.
type IdempotencyRecord struct {
	Key         string
	Fingerprint string
	ResourceID  string
	JobID       string
	Kind        domain.JobKind
	CreatedAt   time.Time
}

// RequestLedger stores idempotency reservations atomically. Reserve must be a
// compare-and-set: concurrent identical requests yield exactly one "created"
// result, while a different fingerprint for the same key is reported as a
// conflict by the caller.
type RequestLedger interface {
	Reserve(ctx context.Context, record IdempotencyRecord) (existing IdempotencyRecord, created bool, err error)
	Lookup(ctx context.Context, key string) (IdempotencyRecord, bool, error)
	Release(ctx context.Context, key string) error
}

// TokenStore holds client token digests. Plaintext tokens never reach it.
type TokenStore interface {
	LookupToken(ctx context.Context, tokenDigestHex string) (TokenRecord, bool, error)
}

// TokenRecord is the server-side record of one client token.
type TokenRecord struct {
	ClientID    string
	Description string
	Revoked     bool
}

// ProviderCreateRequest is what a compute provider adapter receives. It carries
// only approved, server-resolved values. Profile and Size are the approved
// names; the adapter re-resolves instance type and disk size from the catalog
// rather than trusting the values in the request.
type ProviderCreateRequest struct {
	HostID       string
	Name         string
	Provider     domain.Provider
	Profile      string
	Region       string
	Size         string
	InstanceType string
	DiskGB       int
	Tags         map[string]string
}

// ProviderResource is the public identity of an allocated resource.
type ProviderResource struct {
	ResourceID     string
	PrivateAddress string
}

// ProviderDestroyRequest identifies the resource to destroy. Profile and Size
// are required because Terraform needs every variable to plan a destroy, and
// the adapter re-resolves the shape from the catalog instead of trusting a
// caller to remember it.
type ProviderDestroyRequest struct {
	HostID     string
	Name       string
	Provider   domain.Provider
	Profile    string
	Region     string
	Size       string
	ResourceID string
}

// HostProvider is the compute-provider port (implemented for AWS by Terraform
// in S02; a stub that refuses to run ships in S01).
type HostProvider interface {
	CreateHost(ctx context.Context, req ProviderCreateRequest) (ProviderResource, error)
	DestroyHost(ctx context.Context, req ProviderDestroyRequest) error
}

// EnrollRequest carries the trust anchor for SSH bootstrap. The enrollment key
// itself is acquired inside the adapter from OpenBao; it is never a field here.
type EnrollRequest struct {
	HostID         string
	Name           string
	PrivateAddress string
	Profile        string
	SecretBundles  []string
}

// EnrollResult reports the enrolled tailnet identity (no credentials).
type EnrollResult struct {
	DeviceID string
	HostKey  string
}

// HostEnroller is the trusted-SSH bootstrap port.
type HostEnroller interface {
	Enroll(ctx context.Context, req EnrollRequest) (EnrollResult, error)
}

// DeployRequest asks for an approved flake profile to be deployed to a host.
type DeployRequest struct {
	HostID   string
	Name     string
	Profile  string
	FlakeRef string // resolved server-side from configuration, never client input
}

// DeployResult reports the immutable revision that was deployed.
type DeployResult struct {
	FlakeRevision string
	RexURL        string
}

// ProfileDeployer is the Nix flake deployment port.
type ProfileDeployer interface {
	DeployProfile(ctx context.Context, req DeployRequest) (DeployResult, error)
}

// AuthorizeRequest grants a host access to its approved secret bundles.
type AuthorizeRequest struct {
	HostID        string
	Name          string
	Profile       string
	SecretBundles []string
}

// HostAuthorizer is the OpenBao host-identity port.
type HostAuthorizer interface {
	AuthorizeHost(ctx context.Context, req AuthorizeRequest) error
	RevokeHost(ctx context.Context, req AuthorizeRequest) error
}

// RemoveDeviceRequest identifies a tailnet device to remove.
type RemoveDeviceRequest struct {
	HostID   string
	DeviceID string
}

// TailnetDeviceManager is the Tailscale device port.
type TailnetDeviceManager interface {
	RemoveDevice(ctx context.Context, req RemoveDeviceRequest) error
}
