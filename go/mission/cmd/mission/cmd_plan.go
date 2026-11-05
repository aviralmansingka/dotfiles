package main

import "mission.local/prototype/internal/platform"

// cmdPlan is the read-only launch description. --mux is accepted so a caller can
// say which surface it will deploy to, but the description itself stays
// mux-neutral. --launch-id renders the brief for an intent an adapter already
// reserved; without it the brief names the plan's own ack token.
func cmdPlan(a platform.Args, s *Store) (any, error) {
	return s.plan(a.At(1), platform.Fallback(a.Get("mux"), "rex"), a.Get("launch-id"))
}
