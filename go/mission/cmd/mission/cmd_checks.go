package main

import (
	"os"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

func cmdChecks(a platform.Args, s *App) (any, error) { return mission.CheckCatalog(), nil }

func cmdVerify(a platform.Args, s *App) (any, error) {
	h := platform.Fallback(a.At(1), os.Getenv("MISSION_HANDLE"))
	id := platform.Fallback(a.Get("attempt"), os.Getenv("MISSION_ATTEMPT"))
	r, e := s.verify(h, id, platform.Fallback(a.Get("token"), os.Getenv("MISSION_TOKEN")))
	if e != nil {
		return nil, e
	}
	attempt, _ := mission.FindAttempt(&r.State, id)
	last := attempt.Verifications[len(attempt.Verifications)-1]
	passed := allPassed(last, attemptDefinition(r, *attempt))
	v := map[string]any{"handle": h, "attempt": id, "passed": passed, "verification": last}
	if !passed {
		return v, mission.Problem("checks_failed", "required checks did not pass: %s", mission.VerificationSummary(last))
	}
	return v, nil
}
