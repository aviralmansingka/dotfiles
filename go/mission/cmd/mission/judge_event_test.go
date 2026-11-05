package main

import (
	"encoding/json"
	"path/filepath"
	"testing"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

// judgeEventsOf returns every judge event the attempt carries.
func judgeEventsOf(t *testing.T, s *Store, handle, attempt string) []mission.Event {
	t.Helper()
	r, e := s.load(handle)
	must(t, e)
	a, e := mission.FindAttempt(&r.State, attempt)
	must(t, e)
	out := []mission.Event{}
	for _, ev := range a.Events {
		if ev.Type == "judge" {
			out = append(out, ev)
		}
	}
	return out
}

// judgeProgress runs one CLI progress call with a judge actor, so the test
// proves the flags reach the store and not only the store method.
func judgeProgress(t *testing.T, s *Store, argv ...string) (any, error) {
	t.Helper()
	a, e := platform.ParseArgs(argv)
	must(t, e)
	return cmdProgress(a, s)
}

// TestJudgeSessionRecorded is the acceptance line for S03, both halves. A judge
// that names its session leaves exactly one judge event with that session id
// and file beside the verdict row, which keeps its own status and summary; a
// judge that names no session is refused and records nothing.
func TestJudgeSessionRecorded(t *testing.T) {
	s, h := fixture(t)
	c := claimTest(t, s, h)
	file := filepath.Join(t.TempDir(), "judge-session.jsonl")

	// The judge reports the verdict through the CLI flags, the way an adapter
	// does.
	_, e := judgeProgress(t, s, "progress", h,
		"--attempt", c.Attempt.ID, "--token", c.Token,
		"--actor", "judge-S03", "--event-id", "verdict-1", "--status", "ready",
		"--summary", "Verdict: passed; both halves hold", "--session-id", "pi-judge-1",
		"--session-file", file)
	must(t, e)

	events := judgeEventsOf(t, s, h, c.Attempt.ID)
	if len(events) != 1 {
		t.Fatalf("%d judge events, want exactly 1", len(events))
	}
	ev := events[0]
	if ev.SessionID != "pi-judge-1" {
		t.Fatalf("judge event session id = %q, want pi-judge-1", ev.SessionID)
	}
	if ev.SessionFile != file {
		t.Fatalf("judge event session file = %q, want %q", ev.SessionFile, file)
	}
	if ev.ID == "" || ev.At == "" {
		t.Fatalf("judge event has no identity: %+v", ev)
	}
	if ev.Summary != "verdict row verdict-1" {
		t.Fatalf("judge event summary = %q, want it to name the verdict row and keep the verdict out", ev.Summary)
	}

	// The verdict row is untouched: the judge event sits beside it, not in place
	// of it.
	r, e := s.load(h)
	must(t, e)
	a, e := mission.FindAttempt(&r.State, c.Attempt.ID)
	must(t, e)
	var row *mission.Progress
	for i := range a.Progress {
		if a.Progress[i].ID == "verdict-1" {
			row = &a.Progress[i]
		}
	}
	if row == nil {
		t.Fatal("no verdict progress row on the attempt")
	}
	if row.Status != "ready" || row.Summary != "Verdict: passed; both halves hold" {
		t.Fatalf("verdict row = %+v, want the status and summary the judge reported", row)
	}

	// A replay of the same event id adds nothing back.
	_, e = judgeProgress(t, s, "progress", h,
		"--attempt", c.Attempt.ID, "--token", c.Token,
		"--actor", "judge-S03", "--event-id", "verdict-1", "--status", "ready",
		"--summary", "Verdict: passed; both halves hold", "--session-id", "pi-judge-1",
		"--session-file", file)
	must(t, e)
	if events = judgeEventsOf(t, s, h, c.Attempt.ID); len(events) != 1 {
		t.Fatalf("%d judge events after a replay, want exactly 1", len(events))
	}

	// A non-judge actor names no session and appends no judge event, so the gate
	// is the actor and not the flag.
	_, e = judgeProgress(t, s, "progress", h,
		"--attempt", c.Attempt.ID, "--token", c.Token,
		"--actor", "scout-1", "--event-id", "report-1", "--status", "ready",
		"--summary", "Trooper finished", "--session-id", "pi-scout-1")
	must(t, e)
	if events = judgeEventsOf(t, s, h, c.Attempt.ID); len(events) != 1 {
		t.Fatalf("%d judge events after a trooper report, want exactly 1", len(events))
	}

	// Half two: a judge with no session id is refused, and the refusal leaves
	// the attempt exactly as it was.
	_, err := judgeProgress(t, s, "progress", h,
		"--attempt", c.Attempt.ID, "--token", c.Token,
		"--actor", "judge-S03", "--event-id", "verdict-2", "--status", "ready",
		"--summary", "Verdict: passed")
	wantCode(t, err, "usage")
	if events = judgeEventsOf(t, s, h, c.Attempt.ID); len(events) != 1 {
		t.Fatalf("%d judge events after a refused call, want exactly 1", len(events))
	}
	r, e = s.load(h)
	must(t, e)
	a, e = mission.FindAttempt(&r.State, c.Attempt.ID)
	must(t, e)
	for _, p := range a.Progress {
		if p.ID == "verdict-2" {
			t.Fatal("a refused judge call recorded its progress row")
		}
	}

	// The record itself, quoted in the step artifact.
	b, m := json.MarshalIndent(map[string]any{"judge_event": events[0], "verdict_row": *row, "refused": err.Error()}, "", "  ")
	must(t, m)
	t.Logf("judge record:\n%s", b)
}
