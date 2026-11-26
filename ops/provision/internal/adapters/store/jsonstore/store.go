// Package jsonstore persists the host inventory and idempotency ledger in a
// single JSON document with atomic rewrites.
//
// It is a database, not a job queue: job execution is Temporal's job, and this
// store only owns the inventory rows and request reservations that must outlive
// workflow history. S06 replaces it with PostgreSQL; the port boundary in
// internal/application is what makes that swap a composition change.
package jsonstore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/ports"
)

const schemaVersion = 1

type snapshot struct {
	Version int                       `json:"version"`
	Hosts   []domain.Host             `json:"hosts"`
	Ledger  []ports.IdempotencyRecord `json:"idempotency"`
}

// Store is the durable inventory and ledger.
type Store struct {
	path string
	mu   sync.RWMutex
	data snapshot
}

// loadLocked refreshes the in-memory document from the file, so the two processes
// that share one store — the API that records a request and the worker that
// records what the provider did — each see the other's writes.
//
// Without this every write used the snapshot the process loaded at startup: the
// worker's first update answered `resource not found` for a host the API had just
// created, and a write that did match would have replaced the whole document with
// the stale copy. Writes are seconds apart and the document is small, so it is
// re-read on every write path rather than watched; a cross-process write lock is
// S06's PostgreSQL store, not this one.
func (s *Store) loadLocked() error {
	empty := func() { s.data = snapshot{Version: schemaVersion, Hosts: []domain.Host{}, Ledger: []ports.IdempotencyRecord{}} }
	raw, err := os.ReadFile(s.path)
	switch {
	case errors.Is(err, os.ErrNotExist):
		empty()
		return nil
	case err != nil:
		return fmt.Errorf("jsonstore: read: %w", err)
	}
	if len(raw) == 0 {
		empty()
		return nil
	}
	var data snapshot
	if err := json.Unmarshal(raw, &data); err != nil {
		return fmt.Errorf("jsonstore: decode %s: %w", s.path, err)
	}
	if data.Version != schemaVersion {
		return fmt.Errorf("jsonstore: unsupported schema version %d in %s", data.Version, s.path)
	}
	if data.Hosts == nil {
		data.Hosts = []domain.Host{}
	}
	if data.Ledger == nil {
		data.Ledger = []ports.IdempotencyRecord{}
	}
	s.data = data
	return nil
}

// Open loads the store at path, creating the parent directory with 0700 when
// missing. A missing file is an empty store.
func Open(path string) (*Store, error) {
	if path == "" {
		return nil, errors.New("jsonstore: path is required")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("jsonstore: create directory: %w", err)
	}
	store := &Store{path: path, data: snapshot{Version: schemaVersion, Hosts: []domain.Host{}, Ledger: []ports.IdempotencyRecord{}}}
	raw, err := os.ReadFile(path)
	switch {
	case errors.Is(err, os.ErrNotExist):
		return store, nil
	case err != nil:
		return nil, fmt.Errorf("jsonstore: read: %w", err)
	}
	if len(raw) == 0 {
		return store, nil
	}
	if err := json.Unmarshal(raw, &store.data); err != nil {
		return nil, fmt.Errorf("jsonstore: decode %s: %w", path, err)
	}
	if store.data.Version != schemaVersion {
		return nil, fmt.Errorf("jsonstore: unsupported schema version %d in %s", store.data.Version, path)
	}
	if store.data.Hosts == nil {
		store.data.Hosts = []domain.Host{}
	}
	if store.data.Ledger == nil {
		store.data.Ledger = []ports.IdempotencyRecord{}
	}
	return store, nil
}

// Path reports the backing file.
func (s *Store) Path() string { return s.path }

// CreateHost implements ports.HostRepository.
func (s *Store) CreateHost(_ context.Context, host domain.Host) (domain.Host, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.loadLocked(); err != nil {
		return domain.Host{}, false, err
	}
	if existing, ok := s.host(host.ID); ok {
		return existing.Clone(), false, nil
	}
	s.data.Hosts = append(s.data.Hosts, host.Clone())
	if err := s.persistLocked(); err != nil {
		return domain.Host{}, false, err
	}
	return host.Clone(), true, nil
}

// GetHost implements ports.HostRepository.
func (s *Store) GetHost(_ context.Context, id string) (domain.Host, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	host, ok := s.host(id)
	if !ok {
		return domain.Host{}, domain.ErrNotFound
	}
	return host.Clone(), nil
}

// ListHosts implements ports.HostRepository.
func (s *Store) ListHosts(_ context.Context) ([]domain.Host, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]domain.Host, 0, len(s.data.Hosts))
	for _, host := range s.data.Hosts {
		out = append(out, host.Clone())
	}
	return out, nil
}

// UpdateHost implements ports.HostRepository atomically.
func (s *Store) UpdateHost(_ context.Context, id string, mutate func(h *domain.Host) error) (domain.Host, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.loadLocked(); err != nil {
		return domain.Host{}, err
	}
	index := s.hostIndex(id)
	if index < 0 {
		return domain.Host{}, domain.ErrNotFound
	}
	updated := s.data.Hosts[index].Clone()
	if err := mutate(&updated); err != nil {
		return domain.Host{}, err
	}
	s.data.Hosts[index] = updated.Clone()
	if err := s.persistLocked(); err != nil {
		return domain.Host{}, err
	}
	return updated.Clone(), nil
}

// Reserve implements ports.RequestLedger with compare-and-set semantics.
func (s *Store) Reserve(_ context.Context, record ports.IdempotencyRecord) (ports.IdempotencyRecord, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.loadLocked(); err != nil {
		return ports.IdempotencyRecord{}, false, err
	}
	for _, existing := range s.data.Ledger {
		if existing.Key == record.Key {
			return existing, false, nil
		}
	}
	s.data.Ledger = append(s.data.Ledger, record)
	if err := s.persistLocked(); err != nil {
		return ports.IdempotencyRecord{}, false, err
	}
	return record, true, nil
}

// Lookup implements ports.RequestLedger.
func (s *Store) Lookup(_ context.Context, key string) (ports.IdempotencyRecord, bool, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, record := range s.data.Ledger {
		if record.Key == key {
			return record, true, nil
		}
	}
	return ports.IdempotencyRecord{}, false, nil
}

// Release implements ports.RequestLedger.
func (s *Store) Release(_ context.Context, key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.loadLocked(); err != nil {
		return err
	}
	for i, record := range s.data.Ledger {
		if record.Key == key {
			s.data.Ledger = append(s.data.Ledger[:i], s.data.Ledger[i+1:]...)
			return s.persistLocked()
		}
	}
	return nil
}

func (s *Store) host(id string) (domain.Host, bool) {
	index := s.hostIndex(id)
	if index < 0 {
		return domain.Host{}, false
	}
	return s.data.Hosts[index], true
}

func (s *Store) hostIndex(id string) int {
	for i, host := range s.data.Hosts {
		if host.ID == id {
			return i
		}
	}
	return -1
}

// persistLocked writes the whole document atomically: a temp file in the same
// directory, fsync, then rename.
func (s *Store) persistLocked() error {
	s.data.Version = schemaVersion
	encoded, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return fmt.Errorf("jsonstore: encode: %w", err)
	}
	encoded = append(encoded, '\n')
	dir := filepath.Dir(s.path)
	tmp, err := os.CreateTemp(dir, ".provision-store-*.tmp")
	if err != nil {
		return fmt.Errorf("jsonstore: temp file: %w", err)
	}
	tmpName := tmp.Name()
	defer func() { _ = os.Remove(tmpName) }()
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("jsonstore: chmod temp file: %w", err)
	}
	if _, err := tmp.Write(encoded); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("jsonstore: write temp file: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("jsonstore: sync temp file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("jsonstore: close temp file: %w", err)
	}
	if err := os.Rename(tmpName, s.path); err != nil {
		return fmt.Errorf("jsonstore: replace store: %w", err)
	}
	return nil
}
