package main

import (
	"testing"

	"mission.local/prototype/internal/domain/mission"
)

func lastAttempt(t *testing.T, s *Store, h string) (*mission.Record, *mission.Attempt) {
	t.Helper()
	r, e := s.load(h)
	must(t, e)
	a, e := mission.FindAttempt(&r.State, r.State.Active)
	must(t, e)
	return &r, a
}

func TestVerifyFailsUntilTheArtifactIsWritten(t *testing.T) {
	s, h := fixture(t)
	c := claimTest(t, s, h)
	r, e := s.verify(h, c.Attempt.ID, c.Token)
	must(t, e)
	if s.verified(r, *lastRun(t, r)) {
		t.Fatal("verified without an artifact")
	}
	result(t, s, c, "# Evidence\n\nThe suite reached the vault.\n")
	r, e = s.verify(h, c.Attempt.ID, c.Token)
	must(t, e)
	if !s.verified(r, *lastRun(t, r)) {
		t.Fatalf("valid artifact not verified: %+v", lastVerification(t, r).Results)
	}
}

func TestVerifyRefusesForeignTokensAndStaleEvidence(t *testing.T) {
	s, h := fixture(t)
	c := claimTest(t, s, h)
	if _, e := s.verify(h, c.Attempt.ID, "wrong-token"); e == nil {
		t.Fatal("foreign token accepted")
	} else {
		wantCode(t, e, "not_owner")
	}
	result(t, s, c, "{\"ok\":true}\n")
	r, e := s.verify(h, c.Attempt.ID, c.Token)
	must(t, e)
	a := lastRun(t, r)
	if !s.verified(r, *a) {
		t.Fatal("valid artifact not verified")
	}
	// The proof binds to the evidence bytes: a later edit invalidates it.
	result(t, s, c, "{\"ok\":false}\n")
	if s.verified(r, *a) {
		t.Fatal("stale evidence still counts as verified")
	}
}

func TestVerifyRunsRegisteredChecksInOrder(t *testing.T) {
	s, h := fixture(t)
	r, e := s.load(h)
	must(t, e)
	view, e := s.step(h, "S01")
	must(t, e)
	st := view.Step
	st.Checks = []string{"json-valid", "nonempty-artifact"}
	_, e = s.editStep(h, "S01", st, r.State.Revision, false)
	must(t, e)
	c := claimTest(t, s, h)
	result(t, s, c, "not json\n")
	r, e = s.verify(h, c.Attempt.ID, c.Token)
	must(t, e)
	res := lastVerification(t, r).Results
	verdict := map[string]string{}
	for _, c := range res {
		verdict[c.Check] = c.Verdict
	}
	if len(res) != 2 || verdict["json-valid"] != "failed" || verdict["nonempty-artifact"] != "passed" {
		t.Fatalf("unexpected results: %+v", res)
	}
}

func lastVerification(t *testing.T, r mission.Record) mission.Verification {
	t.Helper()
	a := lastRun(t, r)
	if len(a.Verifications) == 0 {
		t.Fatal("no verification recorded")
	}
	return a.Verifications[len(a.Verifications)-1]
}

func lastRun(t *testing.T, r mission.Record) *mission.Attempt {
	t.Helper()
	a, e := mission.FindAttempt(&r.State, r.State.Active)
	if e != nil {
		t.Fatal(e)
	}
	return a
}
