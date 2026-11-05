package main

import (
	"mission.local/prototype/internal/domain/mission"
)

// create writes one new mission record. It owns the policy: the definition is
// normalized and validated, the repository must be registered, and the record
// is stamped here. The store writes the bytes and refuses an existing mission.
func (s *App) create(m mission.Mission) (mission.Record, error) {
	var rec mission.Record
	mission.NormalizeMission(&m)
	if e := mission.Validate(m); e != nil {
		return rec, e
	}
	if _, e := s.Repo.Repo(m.Repo); e != nil {
		return rec, e
	}
	m.ID = mission.UID("mission-")
	m.Schema = 1
	m.Created = mission.Now()
	if m.Body == "" {
		m.Body = "# " + m.Title + "\n\n## Goal\n" + m.Goal + "\n\nStep instructions, acceptance criteria and checks are defined in frontmatter.\n"
	}
	return s.Repo.Create(m)
}
