package main

import "os"

// cmdShow returns one mission record, defaulting to the attached mission.
func cmdShow(a args, s *Store) (any, error) {
	return s.load(fallback(a.at(1), os.Getenv("MISSION_HANDLE")))
}
