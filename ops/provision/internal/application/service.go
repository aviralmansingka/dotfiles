// Package application holds the provision service use cases and the port
// interfaces they depend on. It imports the domain and token leaf packages and
// the standard library only: Temporal and provider SDKs live in adapters.
package application

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/token"
)

// Deps are the collaborators a Service needs. Every field is required.
type Deps struct {
	Profiles domain.Catalog
	Hosts    HostInventory
	Ledger   RequestLedger
	Jobs     JobOrchestrator
	Tokens   TokenStore
	Clock    Clock
	IDs      IDGenerator
	Logger   Logger
}

// Service implements the API use cases.
type Service struct {
	profiles domain.Catalog
	hosts    HostInventory
	ledger   RequestLedger
	jobs     JobOrchestrator
	tokens   TokenStore
	clock    Clock
	ids      IDGenerator
	log      Logger
}

// New validates dependencies and builds a Service.
func New(deps Deps) (*Service, error) {
	if deps.Hosts == nil {
		return nil, errors.New("application: host inventory is required")
	}
	if deps.Ledger == nil {
		return nil, errors.New("application: request ledger is required")
	}
	if deps.Jobs == nil {
		return nil, errors.New("application: job orchestrator is required")
	}
	if deps.Tokens == nil {
		return nil, errors.New("application: token store is required")
	}
	if deps.Clock == nil {
		return nil, errors.New("application: clock is required")
	}
	if deps.IDs == nil {
		return nil, errors.New("application: id generator is required")
	}
	if deps.Logger == nil {
		return nil, errors.New("application: logger is required")
	}
	return &Service{
		profiles: deps.Profiles,
		hosts:    deps.Hosts,
		ledger:   deps.Ledger,
		jobs:     deps.Jobs,
		tokens:   deps.Tokens,
		clock:    deps.Clock,
		ids:      deps.IDs,
		log:      deps.Logger,
	}, nil
}

// AcceptedIDs is the result of an accepted asynchronous operation.
type AcceptedIDs struct {
	HostID string
	JobID  string
}

// Authorize resolves a bearer token to a principal. Only the SHA-256 digest is
// ever compared or stored.
func (s *Service) Authorize(ctx context.Context, presented string) (Principal, error) {
	if strings.TrimSpace(presented) == "" {
		return Principal{}, domain.ErrUnauthorized
	}
	digest := token.Digest(presented)
	record, found, err := s.tokens.LookupToken(ctx, digest)
	if err != nil {
		return Principal{}, fmt.Errorf("lookup token: %w", err)
	}
	if !found || record.Revoked || record.ClientID == "" {
		return Principal{}, domain.ErrUnauthorized
	}
	return Principal{ClientID: record.ClientID}, nil
}

// CreateHost validates, resolves, and durably records a host creation. The same
// Idempotency-Key with the same body returns the same host and job and starts
// exactly one durable operation; a different body for that key is a conflict.
func (s *Service) CreateHost(ctx context.Context, principal Principal, idempotencyKey string, req domain.CreateHostRequest) (AcceptedIDs, error) {
	if err := domain.ValidateIdempotencyKey(idempotencyKey); err != nil {
		return AcceptedIDs{}, err
	}
	spec, err := s.profiles.Resolve(req)
	if err != nil {
		return AcceptedIDs{}, err
	}
	fingerprint, err := domain.Fingerprint(req)
	if err != nil {
		return AcceptedIDs{}, err
	}
	hostID := s.ids.NewID("host")
	jobID := "create-" + hostID
	// The approved bundle templates are rendered against the generated host
	// identity here, so every host gets its own KV paths and no shared literal
	// reference can reach a host record, a workflow payload, or the OpenBao policy.
	bundles, err := spec.Bundles(hostID)
	if err != nil {
		return AcceptedIDs{}, err
	}
	now := s.clock.Now()

	record, created, err := s.ledger.Reserve(ctx, IdempotencyRecord{
		Key:         idempotencyKey,
		Fingerprint: fingerprint,
		ResourceID:  hostID,
		JobID:       jobID,
		Kind:        domain.JobKindCreate,
		CreatedAt:   now,
	})
	if err != nil {
		return AcceptedIDs{}, fmt.Errorf("reserve idempotency key: %w", err)
	}
	if !created {
		if record.Fingerprint != fingerprint {
			return AcceptedIDs{}, domain.ErrIdempotencyConflict
		}
		s.log.Info("host.create.replayed",
			"client_id", principal.ClientID,
			"host_id", record.ResourceID,
			"job_id", record.JobID,
		)
		return AcceptedIDs{HostID: record.ResourceID, JobID: record.JobID}, nil
	}

	host := domain.Host{
		ID:            hostID,
		Name:          spec.Name,
		Provider:      spec.Provider,
		Profile:       spec.Profile,
		Region:        spec.Region,
		Size:          spec.Size,
		InstanceType:  spec.InstanceType,
		DiskGB:        spec.DiskGB,
		Tags:          spec.Tags,
		SecretBundles: bundles,
		OwnerClientID: principal.ClientID,
		JobID:         jobID,
		State:         domain.HostStateProvisioning,
		CreatedAt:     now.UTC(),
		UpdatedAt:     now.UTC(),
	}
	if _, _, err := s.hosts.CreateHost(ctx, host); err != nil {
		_ = s.ledger.Release(ctx, idempotencyKey)
		return AcceptedIDs{}, fmt.Errorf("record host: %w", err)
	}

	if _, err := s.jobs.StartCreateHost(ctx, CreateHostSpec{
		JobID:          jobID,
		HostID:         hostID,
		Name:           spec.Name,
		Provider:       spec.Provider,
		Profile:        spec.Profile,
		Region:         spec.Region,
		Size:           spec.Size,
		InstanceType:   spec.InstanceType,
		DiskGB:         spec.DiskGB,
		Tags:           spec.Tags,
		SecretBundles:  bundles,
		FlakeRef:       spec.FlakeRef,
		IdempotencyKey: idempotencyKey,
		OwnerClientID:  principal.ClientID,
	}); err != nil {
		// No durable operation was started, so release the reservation and let
		// the client retry with the same key.
		_ = s.ledger.Release(ctx, idempotencyKey)
		if _, updateErr := s.hosts.UpdateHost(ctx, hostID, func(h *domain.Host) error {
			h.MarkFailed(s.clock.Now())
			return nil
		}); updateErr != nil {
			s.log.Error("host.create.rollback_failed", "host_id", hostID, "error", domain.SanitizeMessage(updateErr.Error()))
		}
		return AcceptedIDs{}, fmt.Errorf("start create workflow: %w", err)
	}

	s.log.Info("host.create.accepted",
		"client_id", principal.ClientID,
		"host_id", hostID,
		"job_id", jobID,
		"profile", spec.Profile,
		"region", spec.Region,
		"size", spec.Size,
	)
	return AcceptedIDs{HostID: hostID, JobID: jobID}, nil
}

// DeleteHost starts an asynchronous teardown, or reports the one that already
// exists.
//
// Three rules govern it, and they are the rules that make teardown safe to call
// twice and possible to retry:
//
//   - an already-tombstoned host is answered with its tombstone job. Nothing is
//     reserved, nothing is started, and no cleanup step runs again;
//   - a host whose teardown is still running is answered with that job. The
//     ledger reservation is keyed by the attempt number, so two concurrent
//     DELETEs compute the same key and exactly one durable operation starts;
//   - a host whose teardown failed part-way gets a new attempt. The previous job
//     id is not reused, because Temporal refuses to re-run a closed execution
//     under the same id, and reusing it would make a partial teardown
//     unrecoverable.
//
// The spec carries every field the workflow needs to finish the job: the
// resolved shape (so Terraform runs with the identical variable set the create
// used), the recorded provider resource id (the ownership proof the destroy
// checks), and the recorded device id. A teardown that had to guess any of them
// would either destroy nothing or destroy the wrong thing.
func (s *Service) DeleteHost(ctx context.Context, principal Principal, hostID string) (AcceptedIDs, error) {
	host, err := s.getOwnedHost(ctx, principal, hostID)
	if err != nil {
		return AcceptedIDs{}, err
	}
	if host.State == domain.HostStateDeleted {
		// Repeat deletion is a read. Nothing is reserved and no operation starts.
		s.log.Info("host.delete.replayed",
			"client_id", principal.ClientID,
			"host_id", hostID,
			"job_id", host.DeleteJobID,
			"reason", "the host is already tombstoned",
		)
		return AcceptedIDs{HostID: hostID, JobID: host.DeleteJobID}, nil
	}
	if running, ok := s.teardownInFlight(ctx, host); ok {
		s.log.Info("host.delete.in_flight",
			"client_id", principal.ClientID,
			"host_id", hostID,
			"job_id", running,
		)
		return AcceptedIDs{HostID: hostID, JobID: running}, nil
	}

	attempt := host.DeleteAttempts + 1
	jobID := deleteJobID(host.ID, attempt)
	key := fmt.Sprintf("delete:%s:%d", host.ID, attempt)
	fingerprint := "delete:" + host.ID
	now := s.clock.Now()
	record, created, err := s.ledger.Reserve(ctx, IdempotencyRecord{
		Key:         key,
		Fingerprint: fingerprint,
		ResourceID:  hostID,
		JobID:       jobID,
		Kind:        domain.JobKindDelete,
		CreatedAt:   now,
	})
	if err != nil {
		return AcceptedIDs{}, fmt.Errorf("reserve delete idempotency key: %w", err)
	}
	if !created {
		if record.Fingerprint != fingerprint {
			return AcceptedIDs{}, domain.ErrIdempotencyConflict
		}
		return AcceptedIDs{HostID: record.ResourceID, JobID: record.JobID}, nil
	}

	marked, err := s.hosts.UpdateHost(ctx, hostID, func(h *domain.Host) error {
		if h.State == domain.HostStateDeleted {
			return domain.ErrHostDeleted
		}
		h.BeginTeardown(jobID, attempt, now)
		return nil
	})
	if err != nil {
		_ = s.ledger.Release(ctx, key)
		if errors.Is(err, domain.ErrHostDeleted) {
			// Another caller tombstoned the host between the read and this write.
			// Answer with the record that now exists rather than with the stale
			// copy, so the response names the job that did the work.
			if current, readErr := s.hosts.GetHost(ctx, hostID); readErr == nil {
				return AcceptedIDs{HostID: hostID, JobID: current.DeleteJobID}, nil
			}
			return AcceptedIDs{HostID: hostID, JobID: jobID}, nil
		}
		return AcceptedIDs{}, fmt.Errorf("mark host deleting: %w", err)
	}

	spec := DeleteHostSpec{
		JobID:         jobID,
		HostID:        marked.ID,
		Name:          marked.Name,
		Provider:      marked.Provider,
		Profile:       marked.Profile,
		Region:        marked.Region,
		Size:          marked.Size,
		ResourceID:    marked.ResourceID,
		DeviceID:      marked.DeviceID,
		SecretBundles: marked.SecretBundles,
		Attempt:       attempt,
	}
	if _, err := s.jobs.StartDeleteHost(ctx, spec); err != nil {
		_ = s.ledger.Release(ctx, key)
		return AcceptedIDs{}, fmt.Errorf("start delete workflow: %w", err)
	}
	s.log.Info("host.delete.accepted",
		"client_id", principal.ClientID,
		"host_id", hostID,
		"job_id", jobID,
		"attempt", attempt,
		"pending_cleanup", domain.IncompleteCleanup(marked.PendingCleanup),
	)
	return AcceptedIDs{HostID: hostID, JobID: jobID}, nil
}

// teardownInFlight reports the job id of a teardown that has not finished, so a
// repeated request answers with it rather than starting a second teardown of the
// same host. A job that is finished — deleted, failed, or cancelled — does not
// count: that is exactly the case a retry is for.
func (s *Service) teardownInFlight(ctx context.Context, host domain.Host) (string, bool) {
	if host.State != domain.HostStateDeleting || host.DeleteJobID == "" {
		return "", false
	}
	view, err := s.jobs.DescribeJob(ctx, JobHandle{JobID: host.DeleteJobID})
	if err != nil {
		// No execution to describe: it expired or never started. A retry is the
		// right answer, so this is not "in flight".
		s.log.Warn("host.delete.describe_failed",
			"host_id", host.ID,
			"job_id", host.DeleteJobID,
			"error", domain.SanitizeMessage(err.Error()),
		)
		return "", false
	}
	switch view.State {
	case domain.JobDeleted, domain.JobFailed, domain.JobCanceled, domain.JobReady:
		return "", false
	default:
		return host.DeleteJobID, true
	}
}

// deleteJobID derives the teardown job id from the host and the attempt. The
// first attempt keeps the historical `delete-<host>` shape; a retry appends the
// attempt, because Temporal rejects a duplicate id and a retry must be a new
// execution.
func deleteJobID(hostID string, attempt int) string {
	if attempt <= 1 {
		return "delete-" + hostID
	}
	return fmt.Sprintf("delete-%s-r%d", hostID, attempt)
}

// GetJob reports one job after checking that the caller owns its host.
func (s *Service) GetJob(ctx context.Context, principal Principal, jobID string) (JobView, error) {
	if strings.TrimSpace(jobID) == "" {
		return JobView{}, domain.Invalid("job_id", "is required")
	}
	view, err := s.jobs.DescribeJob(ctx, JobHandle{JobID: jobID})
	if err != nil {
		return JobView{}, err
	}
	if view.HostID == "" {
		return JobView{}, domain.ErrNotFound
	}
	if _, err := s.getOwnedHost(ctx, principal, view.HostID); err != nil {
		return JobView{}, err
	}
	return view, nil
}

// GetHost returns one owned host.
func (s *Service) GetHost(ctx context.Context, principal Principal, hostID string) (domain.Host, error) {
	return s.getOwnedHost(ctx, principal, hostID)
}

// ListHosts returns the hosts owned by the caller, newest first. An empty
// result is an empty slice, never nil, so the API renders [] rather than null.
func (s *Service) ListHosts(ctx context.Context, principal Principal) ([]domain.Host, error) {
	all, err := s.hosts.ListHosts(ctx)
	if err != nil {
		return nil, fmt.Errorf("list hosts: %w", err)
	}
	owned := make([]domain.Host, 0, len(all))
	for _, host := range all {
		if host.OwnerClientID == principal.ClientID {
			owned = append(owned, host)
		}
	}
	sort.Slice(owned, func(i, j int) bool {
		if owned[i].CreatedAt.Equal(owned[j].CreatedAt) {
			return owned[i].ID < owned[j].ID
		}
		return owned[i].CreatedAt.After(owned[j].CreatedAt)
	})
	return owned, nil
}

// getOwnedHost loads a host and hides hosts owned by another client behind a
// not-found error.
func (s *Service) getOwnedHost(ctx context.Context, principal Principal, hostID string) (domain.Host, error) {
	if strings.TrimSpace(hostID) == "" {
		return domain.Host{}, domain.Invalid("host_id", "is required")
	}
	host, err := s.hosts.GetHost(ctx, hostID)
	if err != nil {
		return domain.Host{}, err
	}
	if host.OwnerClientID != principal.ClientID {
		return domain.Host{}, domain.ErrNotFound
	}
	return host, nil
}

// WallClock is the production Clock.
type WallClock struct{}

// Now implements Clock.
func (WallClock) Now() time.Time { return time.Now().UTC() }
