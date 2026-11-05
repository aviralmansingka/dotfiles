package main

import (
	"strings"
	"testing"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

// completeFixture drives one mission through both steps and its checkpoint, so
// its ledger ends in `done` exactly as a shipped mission does.
func completeFixture(t *testing.T) (*App, string) {
	t.Helper()
	s, h := fixture(t)
	c := claimTest(t, s, h)
	result(t, s, c, "First evidence")
	r, e := s.finish(h, c.Attempt.ID, c.Token, false, "", false, 0)
	must(t, e)
	r, e = s.checkpoint(h, "C01", "accept", "Reviewed the evidence", "aviral", true, r.State.Revision)
	must(t, e)
	next, e := s.claim(h, "scout", "", "", false)
	must(t, e)
	if next.Step.ID != "S02" {
		t.Fatalf("want S02, got %s", next.Step.ID)
	}
	result(t, s, next, "Second evidence")
	r, e = s.finish(h, next.Attempt.ID, next.Token, false, "", false, 0)
	must(t, e)
	if r.State.Status != "done" {
		t.Fatalf("fixture did not finish: %s", r.State.Status)
	}
	return s, h
}

func TestCloseAfterAllStepsPass(t *testing.T) {
	s, h := completeFixture(t)
	v, e := s.close(h, "worktree retired by /cleanup", false)
	must(t, e)
	if v.Handle != h || v.Status != closedStatus || v.Already {
		t.Fatalf("wrong close view: %+v", v)
	}
	r, e := s.load(h)
	must(t, e)
	if r.State.Status != closedStatus || r.State.ClosedAt == "" || r.State.CloseNote != "worktree retired by /cleanup" {
		t.Fatalf("close was not recorded: %+v", r.State)
	}
	if v.ClosedAt != r.State.ClosedAt {
		t.Fatal("close view disagrees with the committed record")
	}
	// The record stays: closing keeps history, it does not delete the vault entry.
	if len(r.State.Attempts) != 2 || r.Mission.Title == "" {
		t.Fatal("close dropped mission history")
	}
}

func TestCloseRefusesUnfinishedWork(t *testing.T) {
	s, h := fixture(t)
	_, e := s.close(h, "", false)
	wantCode(t, e, "unfinished")
	for _, want := range []string{"S01", "S02", "--force"} {
		if !strings.Contains(e.Error(), want) {
			t.Fatalf("refusal should name %q: %s", want, e.Error())
		}
	}
	r, e := s.load(h)
	must(t, e)
	if r.State.Status == closedStatus {
		t.Fatal("refused close still closed the record")
	}

	// A live attempt is open work too, and the refusal names it.
	c := claimTest(t, s, h)
	_, e = s.close(h, "", false)
	wantCode(t, e, "unfinished")
	if !strings.Contains(e.Error(), c.Attempt.ID) {
		t.Fatalf("refusal should name the active attempt: %s", e.Error())
	}
}

func TestForceCloseRecordsNote(t *testing.T) {
	s, h := fixture(t)
	v, e := s.close(h, "abandoned; worktree deleted", true)
	must(t, e)
	if v.Status != closedStatus || v.Already || v.CloseNote != "abandoned; worktree deleted" || v.ClosedAt == "" {
		t.Fatalf("wrong close view: %+v", v)
	}
	r, e := s.load(h)
	must(t, e)
	if r.State.Status != closedStatus || r.State.CloseNote != "abandoned; worktree deleted" || r.State.ClosedAt == "" {
		t.Fatalf("forced close not recorded: %+v", r.State)
	}
}

func TestCloseIsIdempotent(t *testing.T) {
	s, h := fixture(t)
	first, e := s.close(h, "retired", true)
	must(t, e)
	// The second close reports the earlier one instead of failing, and it keeps
	// the first note and timestamp.
	second, e := cmdClose(platform.Args{Pos: []string{"close", h}, Flags: map[string][]string{}}, s)
	if e != nil {
		t.Fatal(e)
	}
	v, ok := second.(closedView)
	if !ok || !v.Already || v.Status != closedStatus || v.Handle != h {
		t.Fatalf("second close is not idempotent: %+v", second)
	}
	if v.ClosedAt != first.ClosedAt || v.CloseNote != "retired" {
		t.Fatalf("second close overwrote the record: %+v", v)
	}
}

// A closed mission refuses every command that needs live work, and it never
// appears as ready work or revives its deleted checkout.
func TestClosedMissionRefusesWork(t *testing.T) {
	s, h := fixture(t)
	_, e := s.close(h, "retired", true)
	must(t, e)

	_, e = s.claim(h, "scout", "", "", false)
	wantCode(t, e, "closed")
	if !strings.Contains(e.Error(), "start a new mission") {
		t.Fatalf("refusal should point at a new mission: %s", e.Error())
	}
	_, e = s.workspace(h, "", "main", t.TempDir())
	wantCode(t, e, "closed")
	_, e = s.launch(h, "", "")
	wantCode(t, e, "closed")
	_, e = s.release(h, "launch-1")
	wantCode(t, e, "closed")
	_, e = s.retry(h)
	wantCode(t, e, "closed")
	_, e = s.repair(h)
	wantCode(t, e, "closed")
	_, e = s.finish(h, "attempt-missing", "token", false, "", false, 0)
	wantCode(t, e, "closed")
	_, e = s.attach(h, mission.PiAttachment{SessionID: "pi", SessionFile: "/tmp/pi.jsonl", Cwd: t.TempDir(), Workspace: "w1", Pane: "w1:p1", Token: strings.Repeat("private", 2)})
	wantCode(t, e, "closed")

	work, e := s.ready("dotfiles")
	must(t, e)
	if len(work) != 0 {
		t.Fatalf("closed mission offered as ready work: %+v", work)
	}
}
