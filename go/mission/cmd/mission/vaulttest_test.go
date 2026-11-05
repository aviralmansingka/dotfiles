package main

import "mission.local/prototype/internal/domain/mission"

// These helpers are the white-box bridge between the package tests and the
// vault they run on. The core keeps no such methods: a command reaches the
// store through the Repository port, and a test that shows the store's own
// behaviour reaches it the same way, or through the adapter package directly.

// commitStore is the store's raw commit point. A command reaches it only through
// the port; a test that holds a stale snapshot writes through it.
type commitStore interface {
	Save(r *mission.Record, writer string) error
}

// save writes one record at the revision it carries, so a test can hold a stale
// snapshot and show the store refusing it.
func (s *App) save(r *mission.Record) error { return s.Repo.(commitStore).Save(r, "mission") }

// mutate runs one write transaction, as a command does.
func (s *App) mutate(handle string, fn func(*mission.Record) error) (mission.Record, error) {
	return s.update(handle, fn)
}

func (s *App) path(parts ...string) (string, error)   { return s.Repo.Path(parts...) }
func (s *App) dir(handle string) (string, error)      { return s.Repo.Dir(handle) }
func (s *App) editPath(handle string) (string, error) { return s.Repo.EditPath(handle) }
func (s *App) repos() ([]mission.Repo, error)         { return s.Repo.Repos() }
func (s *App) repo(slug string) (mission.Repo, error) { return s.Repo.Repo(slug) }
func (s *App) Artifacts(c mission.Claim) string       { return s.Repo.Artifacts(c) }

func (s *App) addRepo(slug, checkout, remote string) (mission.Repo, error) {
	return s.Repo.AddRepo(slug, checkout, remote)
}
