package main

import (
	"os/exec"
	"strings"
	"testing"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

// liveChild starts a real child process and returns its pid plus a stop
// function that kills it and reaps it, so the pid is genuinely gone afterwards.
// The cleanup runs stop a second time; Process.Wait then reports the already
// reaped child and does nothing.
func liveChild(t *testing.T) (int, func()) {
	t.Helper()
	c := exec.Command("/bin/sh", "-c", "sleep 60")
	must(t, c.Start())
	stop := func() {
		_ = c.Process.Kill()
		_, _ = c.Process.Wait()
	}
	t.Cleanup(stop)
	return c.Process.Pid, stop
}

// recordPID writes the tracked process onto the attempt, the way the run
// wrapper does after it starts one.
func recordPID(t *testing.T, s *App, h, id string, pid int) {
	t.Helper()
	_, e := s.mutate(h, func(r *mission.Record) error {
		a, e := mission.FindAttempt(&r.State, id)
		if e != nil {
			return e
		}
		a.PID = pid
		return nil
	})
	must(t, e)
}

// TestAbandonRefusesLiveProcess pins the refusal a live process earns: the
// commander may not end work that is still running, and the record keeps its
// owner.
func TestAbandonRefusesLiveProcess(t *testing.T) {
	s, h := ledgerFixture(t)
	c := claimTest(t, s, h)
	pid, _ := liveChild(t)
	recordPID(t, s, h, c.Attempt.ID, pid)
	_, e := s.abandon(h, c.Attempt.ID, "owner tab closed")
	wantCode(t, e, "busy")
	if !strings.Contains(e.Error(), c.Attempt.ID) || !strings.Contains(e.Error(), "live process") {
		t.Fatalf("the refusal does not name the attempt and its process: %v", e)
	}
	r := ledger(t, s, h)
	if r.State.Active != c.Attempt.ID || r.State.Attempts[0].Status != "running" {
		t.Fatalf("a live attempt was released: %+v", r.State.Attempts[0])
	}
	if r.State.Status != "running" || r.State.Steps["S01"].Status != "running" {
		t.Fatalf("the refusal changed the record: %+v", r.State)
	}
}

// TestAbandonReleasesAfterProcessExit pins the success path: once the recorded
// process is gone, abandon ends the attempt without the token, names the
// attempt and its step, and leaves the step revivable.
func TestAbandonReleasesAfterProcessExit(t *testing.T) {
	s, h := ledgerFixture(t)
	c := claimTest(t, s, h)
	pid, stop := liveChild(t)
	recordPID(t, s, h, c.Attempt.ID, pid)
	stop()
	v, e := s.abandon(h, c.Attempt.ID, "trooper process gone; tab closed")
	must(t, e)
	if v.Handle != h || v.Attempt != c.Attempt.ID || v.Step != "S01" || v.Status != abandonedStatus {
		t.Fatalf("abandon did not name the attempt and step: %+v", v)
	}
	if v.Already || v.Note != "trooper process gone; tab closed" || v.EndedAt == "" {
		t.Fatalf("abandon did not record its release: %+v", v)
	}
	r := ledger(t, s, h)
	if r.State.Active != "" || r.State.Status != "failed" {
		t.Fatalf("abandon left the ledger owned: active=%q status=%q", r.State.Active, r.State.Status)
	}
	a := r.State.Attempts[0]
	if a.Status != abandonedStatus || a.Ended == "" || a.ProcessExited {
		t.Fatalf("attempt record: %+v", a)
	}
	if len(a.Events) == 0 || a.Events[len(a.Events)-1].Type != "attempt-abandoned" || a.Events[len(a.Events)-1].Summary != v.Note {
		t.Fatalf("abandon recorded no event: %+v", a.Events)
	}
	if ss := r.State.Steps["S01"]; ss.Status != "failed" || ss.Attempt != c.Attempt.ID {
		t.Fatalf("step record: %+v", ss)
	}
	// The released step is revivable with the existing admin path: retry, then
	// a fresh claim owns the mission again.
	_, e = s.retry(h)
	must(t, e)
	next, e := s.claim(h, "scout", "", "", false)
	must(t, e)
	if next.Attempt.Step != "S01" || next.Attempt.ID == c.Attempt.ID {
		t.Fatalf("the abandoned step was not claimed again: %+v", next.Attempt)
	}
}

// TestAbandonRefusesUninspectableSession pins the second refusal: an attempt
// with no process this host can judge (a Pi seat) is never ended on a guess,
// and the refusal names the command that can reconcile it.
func TestAbandonRefusesUninspectableSession(t *testing.T) {
	s, h := ledgerFixture(t)
	c := claimTest(t, s, h)
	_, e := s.abandon(h, c.Attempt.ID, "owner gone")
	wantCode(t, e, "busy")
	if !strings.Contains(e.Error(), "mission repair") {
		t.Fatalf("the refusal names no way forward: %v", e)
	}
	r := ledger(t, s, h)
	if r.State.Active != c.Attempt.ID || r.State.Attempts[0].Status != "running" {
		t.Fatal("an uninspectable attempt was released")
	}
	// A pid recorded on another host is not this host's pid, so it is not probed.
	_, e = s.mutate(h, func(r *mission.Record) error {
		r.State.Attempts[0].PID = 1
		r.State.Attempts[0].Machine = "another-host"
		return nil
	})
	must(t, e)
	_, e = s.abandon(h, c.Attempt.ID, "owner gone")
	wantCode(t, e, "busy")
}

// TestAbandonRepeatAndTerminal pins the two state refusals: a repeat abandon
// reports the earlier release without writing again, and an attempt that ended
// another way is never rewritten.
func TestAbandonRepeatAndTerminal(t *testing.T) {
	s, h := ledgerFixture(t)
	c := claimTest(t, s, h)
	pid, stop := liveChild(t)
	recordPID(t, s, h, c.Attempt.ID, pid)
	stop()
	_, e := s.abandon(h, c.Attempt.ID, "process gone")
	must(t, e)
	rev := ledger(t, s, h).State.Revision
	again, e := s.abandon(h, c.Attempt.ID, "process gone")
	must(t, e)
	if !again.Already || again.Status != abandonedStatus || again.Attempt != c.Attempt.ID {
		t.Fatalf("a repeat abandon did not report the earlier release: %+v", again)
	}
	if got := ledger(t, s, h).State.Revision; got != rev {
		t.Fatalf("a repeat abandon wrote revision %d over %d", got, rev)
	}
	other, oh := ledgerFixture(t)
	oc := claimTest(t, other, oh)
	_, e = other.mutate(oh, func(r *mission.Record) error {
		r.State.Attempts[0].Status = "succeeded"
		r.State.Active = ""
		return nil
	})
	must(t, e)
	_, e = other.abandon(oh, oc.Attempt.ID, "late")
	wantCode(t, e, "attempt_terminal")
}

// TestAbandonNeedsMissionAttemptAndNote pins the usage refusals, so a typo
// never ends an attempt without its reason.
func TestAbandonNeedsMissionAttemptAndNote(t *testing.T) {
	s, h := ledgerFixture(t)
	c := claimTest(t, s, h)
	if _, e := s.abandon("", c.Attempt.ID, "note"); e == nil {
		t.Fatal("abandon accepted an empty mission")
	} else {
		wantCode(t, e, "usage")
	}
	if _, e := s.abandon(h, "", "note"); e == nil {
		t.Fatal("abandon accepted an empty attempt")
	} else {
		wantCode(t, e, "usage")
	}
	if _, e := s.abandon(h, c.Attempt.ID, "  \n "); e == nil {
		t.Fatal("abandon accepted an empty note")
	} else {
		wantCode(t, e, "usage")
	}
	if _, e := s.abandon(h, "attempt-missing", "note"); e == nil {
		t.Fatal("abandon accepted an unknown attempt")
	} else {
		wantCode(t, e, "not_found")
	}
}

// TestAbandonRefusesClosedMission pins that a retired record refuses the
// escape as well, like every other live-work command.
func TestAbandonRefusesClosedMission(t *testing.T) {
	s, h := ledgerFixture(t)
	c := claimTest(t, s, h)
	_, e := s.close(h, "retired", true)
	must(t, e)
	_, e = s.abandon(h, c.Attempt.ID, "process gone")
	wantCode(t, e, "closed")
}

// TestAbandonThroughDispatch pins the command name and its two flags, so the
// documented usage string and the dispatch table cannot drift apart.
func TestAbandonThroughDispatch(t *testing.T) {
	s, h := ledgerFixture(t)
	c := claimTest(t, s, h)
	pid, stop := liveChild(t)
	recordPID(t, s, h, c.Attempt.ID, pid)
	stop()
	a := platform.Args{Pos: []string{"abandon", h}, Flags: map[string][]string{"attempt": {c.Attempt.ID}, "note": {"owner gone"}}}
	v, e := dispatch("abandon", a, s)
	must(t, e)
	view, ok := v.(abandonedView)
	if !ok || view.Attempt != c.Attempt.ID || view.Step != "S01" || view.Status != abandonedStatus {
		t.Fatalf("dispatch returned %#v", v)
	}
}
