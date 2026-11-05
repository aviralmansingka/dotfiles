package mission

import "errors"

// Repository is the port through which the mission core reaches its ledger.
// It names domain types only, so a vault can be files, a database, or a fake
// without the core knowing which.
//
// The adapter behind it owns the storage facts: the file layout, the bytes,
// the lock, and the revision compare-and-swap. The core owns every policy.
type Repository interface {
	// Read returns one record with its brief and its state, refusing a record
	// whose interrupted step edit has not been replayed.
	Read(handle string) (Record, error)
	// Update reads one record under the store lock, hands it to fn, and saves
	// what fn left. The revision the record was read at is the base, so a
	// concurrent writer wins and Update reports revision_conflict. fn returns
	// ErrNoWrite to leave the ledger exactly as it was read.
	Update(handle, writer string, fn func(*Record) error) (Record, error)
	// List returns every record the store holds.
	List() ([]Record, error)
	// Dir is the directory of one mission record.
	Dir(handle string) (string, error)
	// Artifacts is the path of one attempt's result inside its mission.
	Artifacts(claim Claim) string
	// Repos is every registered repository.
	Repos() ([]Repo, error)
	// VaultPath is the resolved vault root.
	VaultPath() string
}

// ErrNoWrite tells Update that a transaction changed nothing. An idempotent
// replay must not move the revision, so Update returns the record it read and
// writes neither the ledger nor the journal.
var ErrNoWrite = errors.New("mission: no write")
