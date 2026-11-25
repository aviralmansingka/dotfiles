// Package application holds the provision service use cases and the port
// interfaces they depend on. It imports the domain package and the standard
// library only: Temporal and provider SDKs live in adapters.
package application

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
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
func (s *Service) Authorize(ctx context.Context, token string) (Principal, error) {
	if strings.TrimSpace(token) == "" {
		return Principal{}, domain.ErrUnauthorized
	}
	digest := TokenDigest(token)
	record, found, err := s.tokens.LookupToken(ctx, digest)
	if err != nil {
		return Principal{}, fmt.Errorf("lookup token: %w", err)
	}
	if !found || record.Revoked || record.ClientID == "" {
		return Principal{}, domain.ErrUnauthorized
	}
	return Principal{ClientID: record.ClientID}, nil
}

// TokenDigest is the server-side representation of a client token.
func TokenDigest(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
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

// DeleteHost starts an asynchronous teardown. Repeated requests reuse the same
// deletion job: the ledger holds exactly one reservation per host.
func (s *Service) DeleteHost(ctx context.Context, principal Principal, hostID string) (AcceptedIDs, error) {
	host, err := s.getOwnedHost(ctx, principal, hostID)
	if err != nil {
		return AcceptedIDs{}, err
	}
	key := "delete:" + hostID
	fingerprint := "delete:" + hostID
	now := s.clock.Now()
	record, created, err := s.ledger.Reserve(ctx, IdempotencyRecord{
		Key:         key,
		Fingerprint: fingerprint,
		ResourceID:  hostID,
		JobID:       s.ids.NewID("delete"),
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
	if host.State == domain.HostStateDeleted {
		// Already tombstoned; nothing destructive to do.
		_ = s.ledger.Release(ctx, key)
		return AcceptedIDs{}, domain.ErrNotFound
	}

	if _, err := s.hosts.UpdateHost(ctx, hostID, func(h *domain.Host) error {
		h.MarkDeleting(now)
		return nil
	}); err != nil {
		_ = s.ledger.Release(ctx, key)
		return AcceptedIDs{}, fmt.Errorf("mark host deleting: %w", err)
	}

	spec := DeleteHostSpec{
		JobID:         record.JobID,
		HostID:        host.ID,
		Name:          host.Name,
		Provider:      host.Provider,
		Region:        host.Region,
		SecretBundles: host.SecretBundles,
	}
	if _, err := s.jobs.StartDeleteHost(ctx, spec); err != nil {
		_ = s.ledger.Release(ctx, key)
		return AcceptedIDs{}, fmt.Errorf("start delete workflow: %w", err)
	}
	s.log.Info("host.delete.accepted",
		"client_id", principal.ClientID,
		"host_id", hostID,
		"job_id", record.JobID,
	)
	return AcceptedIDs{HostID: hostID, JobID: record.JobID}, nil
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
