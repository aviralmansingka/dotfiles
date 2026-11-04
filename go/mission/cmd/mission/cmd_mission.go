package main

import (
	"os"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

// cmdNew creates a mission from flags or a markdown brief. The interactive
// builder arrives with the interactive UI.
func cmdNew(a platform.Args, s *Store) (any, error) {
	if a.At(1) == "" {
		if a.Has("json") || !platform.Terminal() {
			return nil, mission.Problem("usage", "noninteractive creation needs REPO/SLUG and --title/--goal/--step, or --from")
		}
		return nil, runUIBuilder(s)
	}
	m, e := missionFromArgs(a)
	if e != nil {
		return nil, e
	}
	return s.create(m)
}

// cmdShow returns one mission record, defaulting to the attached mission.
func cmdShow(a platform.Args, s *Store) (any, error) {
	return s.load(platform.Fallback(a.At(1), os.Getenv("MISSION_HANDLE")))
}
