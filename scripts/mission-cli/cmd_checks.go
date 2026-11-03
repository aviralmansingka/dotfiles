package main

import "os"

func cmdChecks(a args, s *Store) (any, error) { return checkCatalog(), nil }

func cmdVerify(a args, s *Store) (any, error) {
	h := fallback(a.at(1), os.Getenv("MISSION_HANDLE"))
	id := fallback(a.get("attempt"), os.Getenv("MISSION_ATTEMPT"))
	r, e := s.verify(h, id, fallback(a.get("token"), os.Getenv("MISSION_TOKEN")))
	if e != nil {
		return nil, e
	}
	attempt, _ := findAttempt(&r.State, id)
	last := attempt.Verifications[len(attempt.Verifications)-1]
	passed := allPassed(last, attemptDefinition(r, *attempt))
	v := map[string]any{"handle": h, "attempt": id, "passed": passed, "verification": last}
	if !passed {
		return v, problem("checks_failed", "required checks did not pass: %s", verificationSummary(last))
	}
	return v, nil
}
