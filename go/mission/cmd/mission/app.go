package main

import (
	"strings"

	"mission.local/prototype/internal/domain/mission"
)

// Vault is everything the core needs from the mission store. The domain port
// carries the record reads and writes; the rest are the storage operations the
// CLI has no port for yet — resolving a file inside a mission, registering a
// repository, creating a record, and naming the pending step-edit journal.
type Vault interface {
	mission.Repository
	Path(parts ...string) (string, error)
	Create(m mission.Mission) (mission.Record, error)
	AddRepo(slug, checkout, remote string) (mission.Repo, error)
	Repo(slug string) (mission.Repo, error)
	EditPath(handle string) (string, error)
	UpdatePending(handle, writer string, fn func(*mission.Record) error) (mission.Record, error)
}

// App is the core: every mission policy over one vault. It takes no lock and
// writes no record itself; the store behind Repo owns both.
type App struct {
	Repo Vault
	// writer names the command that produced a save. The revision journal uses
	// it to show which command wrote a revision.
	writer string
}

// newApp wires the core to one store, with the writer every save it makes.
func newApp(v Vault, writer string) *App { return &App{Repo: v, writer: writer} }

// load reads one record and checks it against domain policy: a stored mission
// must still be valid and must name the directory it was read from.
func (s *App) load(handle string) (mission.Record, error) {
	r, e := s.Repo.Read(handle)
	if e != nil {
		return r, e
	}
	if e = checkRecord(r); e != nil {
		return r, e
	}
	return r, nil
}

// list reads every record and checks each one the way load checks one, so a
// corrupt record fails the listing instead of reaching a policy.
func (s *App) list() ([]mission.Record, error) {
	recs, e := s.Repo.List()
	if e != nil {
		return nil, e
	}
	for _, r := range recs {
		if e = checkRecord(r); e != nil {
			return nil, e
		}
	}
	return recs, nil
}

// update runs one write transaction. The record the store read must pass the
// same policy check a plain read does before a policy may change it, and the
// store owns the lock, the revision base, and the increment.
func (s *App) update(handle string, fn func(*mission.Record) error) (mission.Record, error) {
	return s.Repo.Update(handle, s.writer, func(r *mission.Record) error {
		if e := checkRecord(*r); e != nil {
			return e
		}
		return fn(r)
	})
}

// updateThroughEdit runs one write transaction through a pending step edit.
// The journal is the transaction repair replays, so the store reads past it
// here and nowhere else.
func (s *App) updateThroughEdit(handle string, fn func(*mission.Record) error) (mission.Record, error) {
	return s.Repo.UpdatePending(handle, s.writer, fn)
}

// checkRecord is the policy every stored record must still satisfy: a valid
// mission definition that names its own directory, and a state that belongs to
// that same mission.
func checkRecord(r mission.Record) error {
	if e := mission.Validate(r.Mission); e != nil {
		return e
	}
	repo, slug, ok := strings.Cut(r.Handle, "/")
	if !ok || r.Mission.Repo != repo || r.Mission.Slug != slug {
		return mission.Problem("identity_mismatch", "mission metadata does not match its directory")
	}
	if r.State.Mission != r.Mission.ID {
		return mission.Problem("identity_mismatch", "state belongs to another mission")
	}
	return nil
}
