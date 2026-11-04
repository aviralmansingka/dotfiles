package main

import (
	"strings"
	"testing"
)

func TestReviewGateNamesTheDecision(t *testing.T) {
	s, h, _, _ := pendingFixture(t)
	_, e := s.claim(h, "worker", "", "", false)
	wantCode(t, e, "review_pending")
	if !strings.Contains(e.Error(), "mission checkpoint accept "+h+" C01 --note") {
		t.Fatalf("gate error does not name the decision line: %v", e)
	}
}

func TestFinishRefusesWhileReviewPending(t *testing.T) {
	s, h, c, _ := pendingFixture(t)
	_, e := s.finish(h, missionAttemptID(), c.Token, false, "", false, 0)
	wantCode(t, e, "review_pending")
	if !strings.Contains(e.Error(), "mission checkpoint accept "+h+" C01 --note") {
		t.Fatalf("finish error does not name the decision line: %v", e)
	}
	// The attempt that opened the review remains a no-op, so settlement is safe.
	r, e := s.finish(h, c.Attempt.ID, c.Token, false, "", false, 0)
	must(t, e)
	if r.State.Checkpoints["C01"].Status != "pending" || r.State.Pending != "C01" {
		t.Fatal("settling the covering attempt changed the review")
	}
}

func TestStepEditRefusesWhileReviewPending(t *testing.T) {
	s, h, _, r := pendingFixture(t)
	st := r.Mission.Steps[1]
	_, e := s.editStep(h, "S02", st, r.State.Revision, false)
	wantCode(t, e, "review_pending")
}

// missionAttemptID is any id that is not the covering attempt.
func missionAttemptID() string { return "attempt-other" }
