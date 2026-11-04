package main

import (
	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

// artifactPath resolves one attempt artifact inside the mission directory.
func artifactPath(s *Store, c mission.Claim) string {
	d, _ := s.dir(c.Handle)
	return platform.ArtifactPath(d, c.Attempt.Artifact)
}
