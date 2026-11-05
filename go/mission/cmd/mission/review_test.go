package main

import (
	"strings"
	"testing"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

// pendingFixture finishes S01 so review C01 waits on the owner.
func pendingFixture(t *testing.T) (*App, string, mission.Claim, mission.Record) {
	t.Helper()
	s, h := fixture(t)
	c := claimTest(t, s, h)
	result(t, s, c, "First evidence\n")
	r, e := s.finish(h, c.Attempt.ID, c.Token, false, "", false, 0)
	must(t, e)
	return s, h, c, r
}

func TestDecisionNeedsNoRevision(t *testing.T) {
	s, h, c, _ := pendingFixture(t)
	// The worker keeps working while the owner reads: every hook advances the
	// ledger. A revision the owner read is stale by the time of the decision.
	for i := 0; i < 3; i++ {
		_, e := s.hook(h, c.Attempt.ID, c.Token, mission.Event{ID: mission.UID("event-"), Type: "tool-end", Tool: "bash"})
		must(t, e)
	}
	out, e := s.decide(decisionRequest{Handle: h, Decision: "accept", Note: "Reviewed the evidence", Actor: "aviral"})
	must(t, e)
	if out.Record.State.Status != "ready" || len(out.Record.State.Decisions) != 1 {
		t.Fatal("decision without a revision did not clear the review")
	}
}

func TestDecisionRetriesOnceOnRevisionConflict(t *testing.T) {
	s, h, _, r := pendingFixture(t)
	_, e := s.hook(h, r.State.Attempts[0].ID, r.State.Attempts[0].TokenHash, mission.Event{})
	if e == nil {
		t.Fatal("wrong token accepted")
	}
	stale := r.State.Revision - 1
	out, e := s.decideRetry(decisionRequest{Handle: h, Decision: "accept", Note: "Reviewed", Actor: "aviral", Revision: stale, Legacy: true, Human: true})
	must(t, e)
	if len(out.Record.State.Decisions) != 1 {
		t.Fatal("retried decision not recorded")
	}
}

func TestDecisionErrorListsEveryRequirement(t *testing.T) {
	s, h, _, r := pendingFixture(t)
	_, e := s.decide(decisionRequest{Handle: h, ID: "C01", Decision: "accept", Actor: "aviral"})
	wantCode(t, e, "note_required")
	if !strings.Contains(e.Error(), "--note TEXT") || !strings.Contains(e.Error(), "mission checkpoint accept "+h+" C01 --note") {
		t.Fatalf("one error did not list the requirement and the example: %v", e)
	}
	msg := requirementMessage(h, "C01", "accept", []string{"--note TEXT", "--actor NAME"})
	if !strings.Contains(msg, "--note TEXT") || !strings.Contains(msg, "--actor NAME") || !strings.Contains(msg, "mission checkpoint accept") {
		t.Fatalf("combined requirement message is incomplete: %s", msg)
	}
	if r.State.Checkpoints["C01"].Status != "pending" {
		t.Fatal("refused decision changed the review")
	}
}

func TestShowEmitsRevisionPendingReviewNextCommand(t *testing.T) {
	_, h, _, r := pendingFixture(t)
	v := viewOf(r)
	if v.Revision != r.State.Revision {
		t.Fatal("top-level revision does not mirror state.revision")
	}
	if v.PendingReview == nil || v.PendingReview.ID != "C01" || v.PendingReview.Question != "Proceed?" || v.PendingReview.Evidence != "artifacts/001/result.md" {
		t.Fatalf("pending_review mismatch: %+v", v.PendingReview)
	}
	if v.NextCommand == nil || !strings.HasPrefix(*v.NextCommand, "mission checkpoint accept "+h+" C01 --note") {
		t.Fatalf("next_command mismatch: %v", v.NextCommand)
	}
}

func TestShowNextCommandNullWhenIdle(t *testing.T) {
	s, h := fixture(t)
	r, e := s.load(h)
	must(t, e)
	v := viewOf(r)
	if v.Revision < 1 || v.PendingReview != nil || v.NextCommand != nil {
		t.Fatalf("idle mission view mismatch: %+v", v)
	}
}

func TestDecisionIdempotent(t *testing.T) {
	s, h, _, r := pendingFixture(t)
	req := decisionRequest{Handle: h, ID: "C01", Decision: "accept", Note: "Reviewed", Actor: "aviral"}
	out, e := s.decide(req)
	must(t, e)
	if out.Already {
		t.Fatal("first decision reported as a repeat")
	}
	revision := out.Record.State.Revision
	before := len(out.Record.State.Decisions)
	again, e := s.decide(req)
	must(t, e)
	if !again.Already || again.Record.State.Revision != revision {
		t.Fatalf("repeated decision changed the ledger: already=%v revision=%d", again.Already, again.Record.State.Revision)
	}
	after, e := s.load(h)
	must(t, e)
	if len(after.State.Decisions) != before {
		t.Fatal("repeated decision appended a second entry")
	}
	_ = r
}

func TestReviewReopenRebindsEvidence(t *testing.T) {
	s, h, c, r := pendingFixture(t)
	result(t, s, c, "Fixed evidence\n")
	_, e := s.decide(decisionRequest{Handle: h, ID: "C01", Decision: "accept", Note: "Reviewed", Actor: "aviral"})
	wantCode(t, e, "evidence_changed")
	if !strings.Contains(e.Error(), "mission review reopen "+h+" C01") {
		t.Fatalf("evidence error does not name the repair: %v", e)
	}
	reopened, e := s.reopen(h, "C01", "Refreshed after the worker fix")
	must(t, e)
	if reopened.State.Checkpoints["C01"].Hash == r.State.Checkpoints["C01"].Hash {
		t.Fatal("reopen did not rebind the evidence hash")
	}
	if reopened.State.Checkpoints["C01"].Status != "pending" {
		t.Fatal("reopen decided the review")
	}
	out, e := s.decide(decisionRequest{Handle: h, ID: "C01", Decision: "accept", Note: "Reviewed", Actor: "aviral"})
	must(t, e)
	if out.Record.State.Status != "ready" {
		t.Fatal("accept after reopen did not move the mission")
	}
}

func TestDecisionCommandsParseBothForms(t *testing.T) {
	s, h, _, _ := pendingFixture(t)
	a, e := platform.ParseArgs([]string{"checkpoint", "accept", h, "C01", "--note", "Looks good", "--actor", "aviral"})
	must(t, e)
	v, e := cmdCheckpoint(a, s)
	must(t, e)
	if dv, ok := v.(decisionView); !ok || dv.PendingReview != nil || dv.Revision < 1 {
		t.Fatalf("verb form did not decide: %#v", v)
	}

	s2, h2, _, r2 := pendingFixture(t)
	legacy, e := platform.ParseArgs([]string{"checkpoint", h2, "--id", "C01", "--decision", "accept", "--human", "--actor", "aviral", "--note", "Legacy", "--revision", "99999"})
	must(t, e)
	v2, e := cmdCheckpoint(legacy, s2)
	must(t, e)
	if dv, ok := v2.(decisionView); !ok || dv.PendingReview != nil {
		t.Fatalf("legacy form with a stale revision did not retry: %#v", v2)
	}
	if r2.State.Checkpoints["C01"].Status != "pending" {
		t.Fatal("stale read changed the pending review")
	}
}

func TestListViewsCarryRevisionAndPendingReview(t *testing.T) {
	s, h, _, _ := pendingFixture(t)
	rows, e := s.listViews()
	must(t, e)
	found := false
	for _, row := range rows {
		if row.Handle != h {
			continue
		}
		found = true
		if row.Revision < 1 || row.PendingReview == nil || row.PendingReview.ID != "C01" {
			t.Fatalf("list row missing derived fields: %+v", row)
		}
	}
	if !found {
		t.Fatal("fixture mission missing from list")
	}
}
