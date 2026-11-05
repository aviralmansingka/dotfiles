package main

import "mission.local/prototype/internal/platform"

// cmdDeploy seats one mission in its mux: the army session, the mission's
// subagent session, and its captain window. It reads plan first, so the labels
// and the captain brief have one owner, and --mux picks the adapter that seats
// them (rex by default, or herdr).
func cmdDeploy(a platform.Args, s *Store) (any, error) {
	return s.deploy(a.At(1), platform.Fallback(a.Get("mux"), "rex"))
}
