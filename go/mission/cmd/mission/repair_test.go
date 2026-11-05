package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"mission.local/prototype/internal/domain/mission"
)

// backdate rewrites every stamp the attempt keeps, so repair sees a stream that
// has been silent for longer than its quiet window. It is the only way a test
// proves the window: no test waits ten minutes for real.
func backdate(t *testing.T, s *Store, h string, d time.Duration) {
	t.Helper()
	at := time.Now().UTC().Add(-d).Format(time.RFC3339Nano)
	_, e := s.mutate(h, func(r *mission.Record) error {
		for i := range r.State.Attempts {
			a := &r.State.Attempts[i]
			a.Updated, a.Started = at, at
			for j := range a.Events {
				a.Events[j].At = at
			}
			for j := range a.Progress {
				a.Progress[j].At = at
			}
			for j := range a.Reports {
				a.Reports[j].At = at
			}
		}
		return nil
	})
	must(t, e)
}

// recordSession writes the attempt's recorded session file, last modified age
// ago, the way a Pi seat records the file its session appends to. The file is
// this host's only heartbeat for an attempt that reports no pid.
func recordSession(t *testing.T, s *Store, h, id string, age time.Duration) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "session.jsonl")
	must(t, os.WriteFile(p, []byte(`{"type":"session_end","stopReason":"stop"}`+"\n"), 0o600))
	at := time.Now().Add(-age)
	must(t, os.Chtimes(p, at, at))
	_, e := s.mutate(h, func(r *mission.Record) error {
		a, e := mission.FindAttempt(&r.State, id)
		if e != nil {
			return e
		}
		a.SessionFile = p
		return nil
	})
	must(t, e)
	return p
}

// recordHost moves the attempt to another machine, with a pid that means
// nothing on this host.
func recordHost(t *testing.T, s *Store, h, id, host string, pid int) {
	t.Helper()
	_, e := s.mutate(h, func(r *mission.Record) error {
		a, e := mission.FindAttempt(&r.State, id)
		if e != nil {
			return e
		}
		a.Machine, a.PID = host, pid
		return nil
	})
	must(t, e)
}

// TestRepairReconcilesGoneProcess pins the callout this reconciliation exists
// for: process_exited stays false because the run wrapper died with its child,
// so repair asks the liveness probe instead. A gone process with a quiet stream
// becomes failed, names its attempt and step, and leaves the step closable by
// retry.
func TestRepairReconcilesGoneProcess(t *testing.T) {
	s, h := ledgerFixture(t)
	c := claimTest(t, s, h)
	pid, stop := liveChild(t)
	recordPID(t, s, h, c.Attempt.ID, pid)
	stop()
	backdate(t, s, h, attemptQuietWindow+time.Minute)
	r, e := s.repair(h)
	must(t, e)
	if r.State.Active != "" || r.State.Status != "failed" {
		t.Fatalf("repair left the ledger owned: active=%q status=%q", r.State.Active, r.State.Status)
	}
	a, e := mission.FindAttempt(&r.State, c.Attempt.ID)
	must(t, e)
	if a.Status != "failed" || a.Ended == "" {
		t.Fatalf("the gone attempt is %s, ended %q", a.Status, a.Ended)
	}
	if a.ProcessExited {
		t.Fatal("repair claimed an observed process exit it never saw")
	}
	last := a.Events[len(a.Events)-1]
	if last.Type != "attempt-reconciled" || !strings.Contains(last.Summary, c.Attempt.ID) || !strings.Contains(last.Summary, "S01") {
		t.Fatalf("the reconciliation event does not name the attempt and the step: %+v", last)
	}
	if !strings.Contains(last.Summary, "is gone") {
		t.Fatalf("the event does not say the process was proven gone: %q", last.Summary)
	}
	if ss := r.State.Steps["S01"]; ss.Status != "failed" || ss.Attempt != c.Attempt.ID {
		t.Fatalf("step record: %+v", ss)
	}
	// The reconciled step stays closable by the existing admin path.
	_, e = s.retry(h)
	must(t, e)
	next, e := s.claim(h, "scout", "", "", false)
	must(t, e)
	if next.Attempt.Step != "S01" || next.Attempt.ID == c.Attempt.ID {
		t.Fatalf("the reconciled step was not claimed again: %+v", next.Attempt)
	}
}

// TestRepairKeepsLiveProcess pins the other side: a live pid keeps its attempt
// running however quiet its stream, and repair writes no event for it.
func TestRepairKeepsLiveProcess(t *testing.T) {
	s, h := ledgerFixture(t)
	c := claimTest(t, s, h)
	pid, _ := liveChild(t)
	recordPID(t, s, h, c.Attempt.ID, pid)
	backdate(t, s, h, attemptQuietWindow+time.Minute)
	before := len(ledger(t, s, h).State.Attempts[0].Events)
	r, e := s.repair(h)
	must(t, e)
	a, e := mission.FindAttempt(&r.State, c.Attempt.ID)
	must(t, e)
	if !mission.Active(*a) || a.Status != "running" || a.Ended != "" {
		t.Fatalf("repair ended an attempt with a live process: %+v", a)
	}
	if len(a.Events) != before {
		t.Fatalf("repair wrote %d events onto a live attempt", len(a.Events)-before)
	}
	if r.State.Active != c.Attempt.ID || r.State.Status != "running" || r.State.Steps["S01"].Status != "running" {
		t.Fatalf("repair released a live attempt: active=%q status=%q step=%s",
			r.State.Active, r.State.Status, r.State.Steps["S01"].Status)
	}
}

// TestRepairKeepsFreshStreamAfterExit pins the window itself: a process that
// just wrote is not reconciled, so a silent-but-working process is never
// misread as dead.
func TestRepairKeepsFreshStreamAfterExit(t *testing.T) {
	s, h := ledgerFixture(t)
	c := claimTest(t, s, h)
	pid, stop := liveChild(t)
	recordPID(t, s, h, c.Attempt.ID, pid)
	stop()
	r, e := s.repair(h)
	must(t, e)
	a, e := mission.FindAttempt(&r.State, c.Attempt.ID)
	must(t, e)
	if !mission.Active(*a) || r.State.Active != c.Attempt.ID {
		t.Fatalf("repair reconciled a stream inside the quiet window: %+v", a)
	}
}

// TestRepairReconcilesQuietUninspectableAttempt pins the deliberate divergence
// from abandon: a Pi seat reports no pid, so this host cannot prove its process
// gone. Abandon refuses that attempt, but repair ends it once the stream is
// quiet, because a wedged Pi attempt must not stay unclosable.
func TestRepairReconcilesQuietUninspectableAttempt(t *testing.T) {
	s, h := ledgerFixture(t)
	c := claimTest(t, s, h)
	if c.Attempt.PID != 0 {
		t.Fatalf("the fixture recorded a pid: %d", c.Attempt.PID)
	}
	backdate(t, s, h, attemptQuietWindow+time.Minute)
	r, e := s.repair(h)
	must(t, e)
	if r.State.Active != "" || r.State.Status != "failed" {
		t.Fatalf("repair left a quiet uninspectable attempt owned: active=%q status=%q", r.State.Active, r.State.Status)
	}
	a, e := mission.FindAttempt(&r.State, c.Attempt.ID)
	must(t, e)
	last := a.Events[len(a.Events)-1]
	if a.Status != "failed" || last.Type != "attempt-reconciled" || !strings.Contains(last.Summary, "no process this host can inspect") {
		t.Fatalf("the uninspectable attempt was not reconciled honestly: %+v %+v", a, last)
	}
	if _, e = s.retry(h); e != nil {
		t.Fatalf("the step is not closable by retry: %v", e)
	}
}

// TestRepairReconcilesStaleSessionFile pins the incident shape: a Pi attempt
// that records no pid, whose session was recorded but went stale. The session
// file exists, so its modification time is evidence; it is older than the
// window, so the attempt is quiescent and repair releases it.
func TestRepairReconcilesStaleSessionFile(t *testing.T) {
	s, h := ledgerFixture(t)
	c := claimTest(t, s, h)
	recordSession(t, s, h, c.Attempt.ID, attemptQuietWindow+2*time.Minute)
	backdate(t, s, h, attemptQuietWindow+time.Minute)
	r, e := s.repair(h)
	must(t, e)
	a, e := mission.FindAttempt(&r.State, c.Attempt.ID)
	must(t, e)
	if a.Status != "failed" || r.State.Active != "" {
		t.Fatalf("a stale session file did not free the attempt: %+v active=%q", a, r.State.Active)
	}
	last := a.Events[len(a.Events)-1]
	if last.Type != "attempt-reconciled" || !strings.Contains(last.Summary, "session file is stale") {
		t.Fatalf("the event does not name the stale session: %+v", last)
	}
	if _, e = s.retry(h); e != nil {
		t.Fatalf("the reconciled step is not closable by retry: %v", e)
	}
}

// TestRepairKeepsFreshSessionFile pins the heartbeat a seat without a pid
// offers: a session file written inside the window keeps its attempt running,
// even when every ledger stamp is old.
func TestRepairKeepsFreshSessionFile(t *testing.T) {
	s, h := ledgerFixture(t)
	c := claimTest(t, s, h)
	recordSession(t, s, h, c.Attempt.ID, 0)
	backdate(t, s, h, attemptQuietWindow+time.Minute)
	before := ledger(t, s, h).State.Attempts[0]
	r, e := s.repair(h)
	must(t, e)
	a, e := mission.FindAttempt(&r.State, c.Attempt.ID)
	must(t, e)
	if !mission.Active(*a) || r.State.Active != c.Attempt.ID {
		t.Fatalf("repair ended an attempt whose session was just written: %+v", a)
	}
	if len(a.Events) != len(before.Events) {
		t.Fatalf("repair wrote an event onto a live attempt: %+v", a.Events[len(before.Events):])
	}
	// The refusal a caller meets names the one command that can help.
	_, e = mission.NextStep(r.Mission, r.State)
	if e == nil || !strings.Contains(e.Error(), "mission repair "+r.Handle) {
		t.Fatalf("the busy refusal does not name repair: %v", e)
	}
}

// TestRepairRefusesForeignHostAttempt pins the refusal: another host's pid and
// session file are not this host's to judge, so repair changes nothing, even
// when the ledger stamps are old and a local file happens to look fresh.
func TestRepairRefusesForeignHostAttempt(t *testing.T) {
	s, h := ledgerFixture(t)
	c := claimTest(t, s, h)
	recordSession(t, s, h, c.Attempt.ID, 0)
	recordHost(t, s, h, c.Attempt.ID, "another-host.local", 424242)
	backdate(t, s, h, attemptQuietWindow+time.Minute)
	before := ledger(t, s, h)
	r, e := s.repair(h)
	must(t, e)
	a, e := mission.FindAttempt(&r.State, c.Attempt.ID)
	must(t, e)
	if !mission.Active(*a) || a.Status != "running" || a.Ended != "" || a.Updated != before.State.Attempts[0].Updated {
		t.Fatalf("repair rewrote an attempt on another host: %+v", a)
	}
	if len(a.Events) != len(before.State.Attempts[0].Events) {
		t.Fatal("repair wrote an event for an attempt it cannot judge")
	}
	if r.State.Revision != before.State.Revision || r.State.Active != c.Attempt.ID || r.State.Steps["S01"].Status != "running" {
		t.Fatalf("repair wrote a record it could not judge: revision %d to %d, active=%q step=%s",
			before.State.Revision, r.State.Revision, r.State.Active, r.State.Steps["S01"].Status)
	}
}

// TestRepairKeepsAnAttemptOnAPassedStep pins the guard that protects a landed
// step: a quiet attempt whose step already passed is left for abandon, never
// demoted by repair.
func TestRepairKeepsAnAttemptOnAPassedStep(t *testing.T) {
	s, h := ledgerFixture(t)
	c := claimTest(t, s, h)
	backdate(t, s, h, attemptQuietWindow+time.Minute)
	_, e := s.mutate(h, func(r *mission.Record) error {
		r.State.Steps["S01"] = mission.StepState{Status: "passed", Attempt: c.Attempt.ID, Evidence: "result.md"}
		return nil
	})
	must(t, e)
	r, e := s.repair(h)
	must(t, e)
	a, e := mission.FindAttempt(&r.State, c.Attempt.ID)
	must(t, e)
	if !mission.Active(*a) || r.State.Steps["S01"].Status != "passed" {
		t.Fatalf("repair demoted a passed step: attempt %s, step %s", a.Status, r.State.Steps["S01"].Status)
	}
}
