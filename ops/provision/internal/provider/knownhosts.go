package provider

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// HostKeyStore is a file-backed HostKeySource.
//
// The file is a JSON object keyed by host id. It holds public key material only —
// an algorithm and a SHA256 fingerprint — so it is not a secret store and reading
// it grants nothing. It is written mode 0600 all the same: the fingerprints name
// which machines exist, which is inventory.
//
// The location is outside the Nix store, Git, Terraform state, and every job
// record, because it is host state that changes at runtime.
type HostKeyStore struct {
	path string

	mu        sync.Mutex
	keys      map[string]HostKey
	resources map[string]string
}

// recordedHostKey is one entry as it appears on disk. Known is not stored: a record
// that exists is known by construction.
type recordedHostKey struct {
	Algorithm   string `json:"algorithm"`
	Fingerprint string `json:"fingerprint"`
	ResourceID  string `json:"resource_id,omitempty"`
}

// OpenHostKeyStore loads the file, creating an empty store when it does not exist
// yet. A malformed file is refused rather than treated as empty: silently dropping
// recorded keys would make every host look unverified.
func OpenHostKeyStore(path string) (*HostKeyStore, error) {
	if path == "" {
		return nil, errors.New("provider: host key store path is required")
	}
	store := &HostKeyStore{path: path, keys: map[string]HostKey{}, resources: map[string]string{}}
	raw, err := os.ReadFile(path)
	switch {
	case errors.Is(err, os.ErrNotExist):
		return store, nil
	case err != nil:
		return nil, fmt.Errorf("provider: read host key store: %w", err)
	}
	if len(raw) == 0 {
		return store, nil
	}
	var entries map[string]recordedHostKey
	if err := json.Unmarshal(raw, &entries); err != nil {
		return nil, fmt.Errorf("provider: host key store is not valid JSON: %w", err)
	}
	for hostID, entry := range entries {
		store.keys[hostID] = HostKey{
			Algorithm:   entry.Algorithm,
			Fingerprint: entry.Fingerprint,
			Known:       true,
		}
		store.resources[hostID] = entry.ResourceID
	}
	return store, nil
}

// TrustedHostKey implements HostKeySource.
//
// A record whose resource id disagrees with the caller's is reported as not found.
// The key belongs to a machine; when the machine changed, the old key must not be
// reused to verify the new one.
func (s *HostKeyStore) TrustedHostKey(_ context.Context, hostID, resourceID string) (HostKey, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key, ok := s.keys[hostID]
	if !ok {
		return HostKey{}, false, nil
	}
	// The peer resource id is checked against the stored entry, not the other way
	// round: an entry that names a different machine is a stale key.
	if recorded, hasResource := s.resources[hostID]; hasResource && resourceID != "" && recorded != resourceID {
		return HostKey{}, false, nil
	}
	return key, true, nil
}

// Record stores the host key a bootstrap step observed. It is the write half of
// the source; the operation itself is not part of the contract, because only the
// bootstrap step produces a key.
func (s *HostKeyStore) Record(ctx context.Context, hostID, resourceID string, key HostKey) error {
	if hostID == "" {
		return errors.New("provider: host id is required to record a host key")
	}
	if key.Algorithm == "" || key.Fingerprint == "" {
		return errors.New("provider: a recorded host key needs an algorithm and a fingerprint")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.keys[hostID] = HostKey{Algorithm: key.Algorithm, Fingerprint: key.Fingerprint, Known: true}
	s.resources[hostID] = resourceID
	return s.flushLocked()
}

// Path reports where the store lives, which is safe to log: it is a location, not a
// value.
func (s *HostKeyStore) Path() string { return s.path }

// flushLocked writes the store atomically with mode 0600. A partial write would
// lose keys, so the file is written beside the target and renamed into place.
func (s *HostKeyStore) flushLocked() error {
	entries := make(map[string]recordedHostKey, len(s.keys))
	for hostID, key := range s.keys {
		entries[hostID] = recordedHostKey{
			Algorithm:   key.Algorithm,
			Fingerprint: key.Fingerprint,
			ResourceID:  s.resources[hostID],
		}
	}
	encoded, err := json.MarshalIndent(entries, "", "  ")
	if err != nil {
		return fmt.Errorf("provider: encode host key store: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return fmt.Errorf("provider: create host key store directory: %w", err)
	}
	temp, err := os.CreateTemp(filepath.Dir(s.path), ".hostkeys-*")
	if err != nil {
		return fmt.Errorf("provider: create host key store: %w", err)
	}
	tempName := temp.Name()
	defer func() { _ = os.Remove(tempName) }()
	if err := temp.Chmod(0o600); err != nil {
		_ = temp.Close()
		return fmt.Errorf("provider: set host key store mode: %w", err)
	}
	if _, err := temp.Write(append(encoded, '\n')); err != nil {
		_ = temp.Close()
		return fmt.Errorf("provider: write host key store: %w", err)
	}
	if err := temp.Close(); err != nil {
		return fmt.Errorf("provider: close host key store: %w", err)
	}
	if err := os.Rename(tempName, s.path); err != nil {
		return fmt.Errorf("provider: install host key store: %w", err)
	}
	return nil
}
