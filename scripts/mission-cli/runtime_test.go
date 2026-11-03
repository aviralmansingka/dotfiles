package main

import (
	"testing"
)

func TestPiTurnDoesNotFinishWithoutReportAndQuietBoundary(t *testing.T) {
	s, h, p := piFixture(t)
	c, e := s.attach(h, p)
	must(t, e)
	quiet := Event{ID: "end-1", Type: "agent-settled", SessionID: p.SessionID, Quiescent: true}
	_, e = s.hook(h, c.Attempt.ID, p.Token, quiet)
	must(t, e)
	_, e = s.settle(h, c.Attempt.ID, p.Token, p.SessionID)
	wantCode(t, e, "completion_required")
	_, e = s.finish(h, c.Attempt.ID, p.Token, false, "ready", false, 0)
	must(t, e)
	_, e = s.hook(h, c.Attempt.ID, p.Token, Event{Type: "agent-end", SessionID: p.SessionID, Quiescent: true})
	must(t, e)
	_, e = s.settle(h, c.Attempt.ID, p.Token, p.SessionID)
	wantCode(t, e, "runtime_busy")
	_, e = s.hook(h, c.Attempt.ID, p.Token, Event{Type: "agent-start", SessionID: p.SessionID})
	must(t, e)
	_, e = s.settle(h, c.Attempt.ID, p.Token, p.SessionID)
	wantCode(t, e, "runtime_busy")
	quiet.ID = "end-2"
	_, e = s.hook(h, c.Attempt.ID, p.Token, quiet)
	must(t, e)
	_, e = s.settle(h, c.Attempt.ID, p.Token, p.SessionID)
	wantCode(t, e, "missing_artifact")
	result(t, s, c, "Step result and evidence")
	r, e := s.settle(h, c.Attempt.ID, p.Token, p.SessionID)
	must(t, e)
	a := r.State.Attempts[0]
	if !a.Settled || a.ProcessExited || a.Status != "succeeded" || r.State.Pending != "C01" {
		t.Fatal("invalid settlement or checkpoint")
	}
	if a.Transcript == "" {
		t.Fatal("transcript not preserved")
	}
	_, e = s.settle(h, c.Attempt.ID, p.Token, p.SessionID)
	must(t, e)
	_, e = s.attach(h, p)
	wantCode(t, e, "checkpoint_pending")
	r, e = s.checkpoint(h, "C01", "accept", "Reviewed", "aviral", true, r.State.Revision)
	must(t, e)
	next, e := s.attach(h, p)
	must(t, e)
	if next.Step.ID != "S02" || next.Attempt.Cwd != c.Attempt.Cwd || next.Attempt.ID == c.Attempt.ID {
		t.Fatal("step lost durable workspace/owner")
	}
}

func TestPiShutdownAndReloadPreserveOwnership(t *testing.T) {
	s, h, p := piFixture(t)
	c, e := s.attach(h, p)
	must(t, e)
	_, e = s.hook(h, c.Attempt.ID, p.Token, Event{Type: "session-end", SessionID: p.SessionID})
	must(t, e)
	s2, e := openStore(s.Vault)
	must(t, e)
	r, e := s2.load(h)
	must(t, e)
	if r.State.Active != c.Attempt.ID || r.State.Status != "waiting" || r.State.Runtime.Cwd != p.Cwd {
		t.Fatal("shutdown released durable owner")
	}
	again, e := s2.attach(h, p)
	must(t, e)
	if again.Attempt.ID != c.Attempt.ID {
		t.Fatal("restart duplicated owner")
	}
}

func TestProgressIsStructuredHashedAndReplaySafe(t *testing.T) {
	s, h, p := piFixture(t)
	c, e := s.attach(h, p)
	must(t, e)
	result(t, s, c, "Evidence")
	progress := Progress{ID: "report-1", Status: "blocked", Summary: "Need design review", Blocker: "Choose retention period", Next: "Implement retention"}
	r, e := s.progress(h, c.Attempt.ID, p.Token, progress, []string{c.Attempt.Artifact})
	must(t, e)
	r, e = s.progress(h, c.Attempt.ID, p.Token, progress, []string{c.Attempt.Artifact})
	must(t, e)
	if r.State.Status != "waiting" || len(r.State.Attempts[0].Progress) != 1 || r.State.Attempts[0].Progress[0].Evidence[0].Hash != digest([]byte("Evidence")) {
		t.Fatal("progress lost or duplicated")
	}
	progress.Summary = "different"
	_, e = s.progress(h, c.Attempt.ID, p.Token, progress, []string{c.Attempt.Artifact})
	wantCode(t, e, "event_conflict")
	progress.ID = "report-2"
	_, e = s.progress(h, c.Attempt.ID, p.Token, progress, []string{"../secret"})
	wantCode(t, e, "invalid_evidence")
	progress.Status = "ready"
	r, e = s.progress(h, c.Attempt.ID, p.Token, progress, nil)
	must(t, e)
	if r.State.Active != c.Attempt.ID || r.State.Steps["S01"].Status != "running" {
		t.Fatal("progress bypassed completion")
	}
}
