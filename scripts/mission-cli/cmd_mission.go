package main

import "os"

// cmdNew creates a mission from flags or a markdown brief. The interactive
// builder arrives with the interactive UI.
func cmdNew(a args, s *Store) (any, error) {
	if a.at(1) == "" {
		return nil, problem("usage", "noninteractive creation needs REPO/SLUG and --title/--goal/--step, or --from")
	}
	m, e := missionFromArgs(a)
	if e != nil {
		return nil, e
	}
	return s.create(m)
}

// cmdShow returns one mission record, defaulting to the attached mission.
func cmdShow(a args, s *Store) (any, error) {
	return s.load(fallback(a.at(1), os.Getenv("MISSION_HANDLE")))
}
