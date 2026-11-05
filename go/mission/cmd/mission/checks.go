package main

import (
	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

func attemptDefinition(r mission.Record, a mission.Attempt) mission.Step {
	if a.Definition != nil {
		return *a.Definition
	}
	i, _ := stepIndex(r.Mission, a.Step)
	if i >= 0 {
		return r.Mission.Steps[i]
	}
	return mission.Step{}
}

// subject freezes one attempt's input: the result the ledger holds, read here,
// and the checkout the checker fingerprints. The core reads the result because
// the ledger owns it; the checker adds the repository facts it can only learn
// on this machine.
func (s *App) subject(r mission.Record, a mission.Attempt, st mission.Step) mission.Snapshot {
	var snap mission.Snapshot
	p, e := s.Repo.Path(r.Mission.Repo, r.Mission.Slug, a.Artifact)
	if e == nil {
		snap.Artifact, e = platform.BoundedFile(p, 16<<20)
	}
	snap.ArtifactErr = e
	if e == nil {
		snap.ArtifactHash = mission.Digest(snap.Artifact)
	}
	full, e := s.Checks.Fingerprint(a, st, snap)
	if e != nil {
		// A checker reports an input it cannot fingerprint on the snapshot, so a
		// failed fingerprint never fails the run; it makes the check that needs
		// the checkout inconclusive.
		snap.RepoErr = e
		return snap
	}
	return full
}

// verified is the evidence reuse gate: the attempt's last check run still
// proves its step. The gate rule is the domain's, and the vault read that
// answers it stays here.
func (s *App) verified(r mission.Record, a mission.Attempt) bool {
	if len(a.Verifications) == 0 {
		return false
	}
	st := attemptDefinition(r, a)
	return mission.Verified(a, st, s.subject(r, a, st), func(rel string) ([]byte, error) {
		p, e := s.Repo.Path(r.Mission.Repo, r.Mission.Slug, rel)
		if e != nil {
			return nil, e
		}
		return platform.BoundedFile(p, 16<<20)
	})
}
