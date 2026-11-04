package main

import (
	"strings"
	"testing"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

// statusOf reads one mission through the status command path.
func statusOf(t *testing.T, s *Store, h string) StatusView {
	t.Helper()
	v, e := s.status(h)
	must(t, e)
	return v
}

func TestStatusReportsPendingCheckpoint(t *testing.T) {
	s, h := fixture(t)
	c := claimTest(t, s, h)
	result(t, s, c, "Inspection evidence\n")
	_, e := s.finish(h, c.Attempt.ID, c.Token, false, "Inspected the hooks", false, 0)
	must(t, e)

	v := statusOf(t, s, h)
	if v.Status != "waiting" || v.Revision == 0 {
		t.Fatalf("unexpected status: %+v", v)
	}
	if v.Checkpoint == nil || v.Checkpoint.ID != "C01" || v.Checkpoint.Question != "Proceed?" {
		t.Fatalf("checkpoint not reported: %+v", v.Checkpoint)
	}
	if !strings.Contains(v.Next, "mission checkpoint "+h+" --id C01") {
		t.Fatalf("next does not accept or revise the checkpoint: %q", v.Next)
	}
	if v.Step == nil || v.Step.ID != "S01" || v.Step.Status != "passed" {
		t.Fatalf("step not reported: %+v", v.Step)
	}
}

func TestStatusReportsRetryAfterFailure(t *testing.T) {
	s, h := fixture(t)
	c := claimTest(t, s, h)
	_, e := s.finish(h, c.Attempt.ID, c.Token, true, "Could not read the hooks", false, 0)
	must(t, e)

	v := statusOf(t, s, h)
	if v.Status != "failed" || v.Next != "mission retry "+h {
		t.Fatalf("failure does not name retry: %+v", v)
	}
	if v.Attempt == nil || v.Attempt.ID != c.Attempt.ID || v.Attempt.Status != "failed" || v.Attempt.Agent != "scout" {
		t.Fatalf("failed attempt not reported: %+v", v.Attempt)
	}
}

func TestStatusReportsStartOfPendingStep(t *testing.T) {
	s, h := fixture(t)
	v := statusOf(t, s, h)
	if v.Status != "ready" || v.Checkpoint != nil || v.Attempt != nil {
		t.Fatalf("new mission is not ready and empty: %+v", v)
	}
	if v.Step == nil || v.Step.ID != "S01" || v.Step.Status != "pending" {
		t.Fatalf("pending step not reported: %+v", v.Step)
	}
	if !strings.Contains(v.Next, "S01") || !strings.Contains(v.Next, "mission claim "+h) {
		t.Fatalf("next does not start the step: %q", v.Next)
	}
}

func TestStatusReportsNothingForDoneMission(t *testing.T) {
	s, h := fixture(t)
	_, e := s.mutate(h, func(r *mission.Record) error {
		r.State.Steps["S01"] = mission.StepState{Status: "passed"}
		r.State.Steps["S02"] = mission.StepState{Status: "passed"}
		r.State.Current = "S02"
		r.State.Status = "done"
		return nil
	})
	must(t, e)

	v := statusOf(t, s, h)
	if v.Status != "done" || v.Next != "nothing, the mission is done" {
		t.Fatalf("done mission still has work: %+v", v)
	}
}

func TestStatusReportsRunningAttemptAndBlocker(t *testing.T) {
	s, h := fixture(t)
	c := claimTest(t, s, h)
	_, e := s.progress(h, c.Attempt.ID, c.Token, mission.Progress{ID: "event-1", Status: "blocked", Summary: "Stopped on a missing token", Blocker: "missing vault token"}, nil)
	must(t, e)

	v := statusOf(t, s, h)
	if v.Attempt == nil || v.Attempt.ID != c.Attempt.ID || v.Attempt.RunningFor == "" {
		t.Fatalf("active attempt not timed: %+v", v.Attempt)
	}
	if v.Blocker != "missing vault token" || v.BlockerAt == "" {
		t.Fatalf("blocker not reported: %q at %q", v.Blocker, v.BlockerAt)
	}
	if !strings.Contains(v.Next, c.Attempt.ID) {
		t.Fatalf("next does not wait for the attempt: %q", v.Next)
	}
}

func TestStatusRejectsUnknownHandleAndMissingArgument(t *testing.T) {
	s, _ := fixture(t)
	_, e := s.status("dotfiles/absent-mission")
	wantCode(t, e, "not_found")
	_, e = s.status("")
	wantCode(t, e, "usage")
}

func TestStatusHandleFallsBackToEnv(t *testing.T) {
	t.Setenv("MISSION_HANDLE", "dotfiles/from-env")
	a, e := platform.ParseArgs([]string{"status"})
	must(t, e)
	if h := statusHandle(a); h != "dotfiles/from-env" {
		t.Fatalf("env handle ignored: %q", h)
	}
	a, e = platform.ParseArgs([]string{"status", "dotfiles/from-arg"})
	must(t, e)
	if h := statusHandle(a); h != "dotfiles/from-env" {
		t.Fatalf("env must win over the positional argument: %q", h)
	}
	a, e = platform.ParseArgs([]string{"status", "--handle", "dotfiles/from-flag"})
	must(t, e)
	if h := statusHandle(a); h != "dotfiles/from-flag" {
		t.Fatalf("--handle ignored: %q", h)
	}
}

func TestStatusTextIsShortAndLabelled(t *testing.T) {
	s, h := fixture(t)
	v := statusOf(t, s, h)
	out := statusText(v)
	lines := strings.Split(out, "\n")
	if len(lines) > 8 {
		t.Fatalf("block is %d lines: %q", len(lines), out)
	}
	for _, want := range []string{h, "READY", "S01", "mission claim " + h} {
		if !strings.Contains(out, want) {
			t.Fatalf("block misses %q: %q", want, out)
		}
	}
	if strings.Contains(out, "\x1b[") {
		t.Fatalf("block keeps ANSI outside a terminal: %q", out)
	}
}
