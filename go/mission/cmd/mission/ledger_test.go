package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mission.local/prototype/internal/domain/mission"
)

// ledgerFixture is a research mission with three steps and no checkpoint, so a
// test can finish one step and claim the next.
func ledgerFixture(t *testing.T) (*Store, string) {
	t.Helper()
	s, e := openStore(t.TempDir())
	must(t, e)
	_, e = s.addRepo("dotfiles", t.TempDir(), "")
	must(t, e)
	m := mission.Mission{Repo: "dotfiles", Slug: "ledger-mission", Title: "Ledger mission", Goal: "Keep every attempt", Kind: "research",
		Steps: []mission.Step{{Title: "First", Output: "first.md"}, {Title: "Second", Output: "second.md"}, {Title: "Third", Output: "third.md"}}}
	r, e := s.create(m)
	must(t, e)
	return s, r.Handle
}

func ledger(t *testing.T, s *Store, h string) mission.Record {
	t.Helper()
	r, e := s.load(h)
	must(t, e)
	return r
}

// clobber writes a state snapshot the way an actor without the compare-and-swap
// did: straight to state.md, with no revision check.
func clobber(t *testing.T, s *Store, r mission.Record) {
	t.Helper()
	d, e := s.dir(r.Handle)
	must(t, e)
	b, e := markdown(r.State, stateBody(r))
	must(t, e)
	must(t, atomicWrite(filepath.Join(d, "state.md"), b))
}

// TestStaleSaveCannotDropClaimedAttempt pins the incident mechanism at the
// commit point: an actor holds a record from before a claim and saves it after.
func TestStaleSaveCannotDropClaimedAttempt(t *testing.T) {
	s, h := ledgerFixture(t)
	stale := ledger(t, s, h)
	claimTest(t, s, h)
	if got := len(ledger(t, s, h).State.Attempts); got != 1 {
		t.Fatalf("claim saved %d attempts", got)
	}
	stale.State.Revision++
	e := s.save(&stale)
	wantCode(t, e, "revision_conflict")
	if got := len(ledger(t, s, h).State.Attempts); got != 1 {
		t.Fatalf("stale save left %d attempts; the claim was lost", got)
	}
}

// TestDivergentLockCannotDropClaimedAttempt reproduces the incident through
// Store.mutate. Two actors use different lock directories (a second TMPDIR), so
// their flocks never meet. One loads a record, the other claims, and the first
// then saves its pre-claim snapshot.
func TestDivergentLockCannotDropClaimedAttempt(t *testing.T) {
	s, h := ledgerFixture(t)
	other := &Store{Vault: s.Vault, LockDir: t.TempDir()}
	loaded, release, done := make(chan struct{}), make(chan struct{}), make(chan error, 1)
	go func() {
		_, e := other.mutate(h, func(r *mission.Record) error {
			close(loaded)
			<-release
			return nil
		})
		done <- e
	}()
	<-loaded
	c := claimTest(t, s, h)
	close(release)
	e := <-done
	wantCode(t, e, "revision_conflict")
	r := ledger(t, s, h)
	if len(r.State.Attempts) != 1 || r.State.Active != c.Attempt.ID {
		t.Fatalf("attempt %s was lost: attempts=%d active=%s", c.Attempt.ID, len(r.State.Attempts), r.State.Active)
	}
}

// TestSharedLockSeesTheClaimedAttempt is the control: with one lock directory a
// second actor loads the claimed ledger, so no attempt can go missing.
func TestSharedLockSeesTheClaimedAttempt(t *testing.T) {
	s, h := ledgerFixture(t)
	c := claimTest(t, s, h)
	var seen mission.Record
	_, e := s.mutate(h, func(r *mission.Record) error { seen = *r; return nil })
	must(t, e)
	if len(seen.State.Attempts) != 1 || seen.State.Active != c.Attempt.ID {
		t.Fatalf("second actor saw %d attempts, active %s", len(seen.State.Attempts), seen.State.Active)
	}
}

// TestJournalNamesEveryWriter shows the forensic record a lost revision leaves
// behind: one line per save, refused writes included.
func TestJournalNamesEveryWriter(t *testing.T) {
	s, h := ledgerFixture(t)
	stale := ledger(t, s, h)
	claimTest(t, s, h)
	stale.State.Revision++
	_ = s.save(&stale)
	p, e := s.path("dotfiles", "ledger-mission", "journal.jsonl")
	must(t, e)
	b, e := os.ReadFile(p)
	must(t, e)
	lines := strings.Split(strings.TrimSpace(string(b)), "\n")
	if len(lines) != 2 {
		t.Fatalf("want one line per save, got %d: %s", len(lines), b)
	}
	var refused journalEntry
	must(t, json.Unmarshal([]byte(lines[1]), &refused))
	if refused.Result != "refused" || refused.Attempts != 0 || refused.Base != stale.State.Revision-1 || refused.Writer == "" {
		t.Fatalf("refused line does not name the writer: %+v", refused)
	}
}

// TestRepairAdmitsOrphanedAttempt restores a dropped claim from its projection.
func TestRepairAdmitsOrphanedAttempt(t *testing.T) {
	s, h := ledgerFixture(t)
	first := claimTest(t, s, h)
	stale := ledger(t, s, h)
	result(t, s, first, "First result")
	_, e := s.finish(h, first.Attempt.ID, first.Token, false, "Done", false, 0)
	must(t, e)
	second := claimTest(t, s, h)
	// The incident shape: a pre-claim snapshot replaces the ledger after the
	// claim. Its projection survives as an orphan.
	clobber(t, s, stale)
	if got := len(ledger(t, s, h).State.Attempts); got != 1 {
		t.Fatalf("clobber left %d attempts", got)
	}
	r, e := s.repair(h)
	must(t, e)
	if len(r.State.Attempts) != 2 {
		t.Fatalf("repair re-admitted %d attempts, want 2", len(r.State.Attempts))
	}
	restored, e := mission.FindAttempt(&r.State, second.Attempt.ID)
	must(t, e)
	if !mission.Active(*restored) || restored.Step != "S02" {
		t.Fatalf("restored attempt is %s on %s", restored.Status, restored.Step)
	}
	if r.State.Active != second.Attempt.ID || r.State.Current != "S02" || r.State.Steps["S02"].Status != "running" || r.State.Status != "running" {
		t.Fatalf("repair did not restore ownership: active=%s current=%s step=%s status=%s",
			r.State.Active, r.State.Current, r.State.Steps["S02"].Status, r.State.Status)
	}
	// The pre-claim attempt cannot own the mission, and its step has no pass.
	if a, _ := mission.FindAttempt(&r.State, first.Attempt.ID); a.Status != "interrupted" || r.State.Steps["S01"].Status != "failed" {
		t.Fatalf("older open attempt kept %s and step %s", a.Status, r.State.Steps["S01"].Status)
	}
	if got := len(r.State.Attempts); got != 2 || r.State.Attempts[1].ID != second.Attempt.ID {
		t.Fatal("re-admitted attempts are not in sequence order")
	}
	// A second repair changes nothing.
	again, e := s.repair(h)
	must(t, e)
	if len(again.State.Attempts) != 2 {
		t.Fatalf("second repair re-admitted again: %d attempts", len(again.State.Attempts))
	}
}

// TestRepairKeepsAPassedStep covers a clobber that rewinds a finished attempt:
// its step already passed, so repair never demotes it.
func TestRepairKeepsAPassedStep(t *testing.T) {
	s, h := ledgerFixture(t)
	stale := ledger(t, s, h)
	first := claimTest(t, s, h)
	result(t, s, first, "First result")
	if _, e := s.finish(h, first.Attempt.ID, first.Token, false, "Done", false, 0); e != nil {
		t.Fatal(e)
	}
	second := claimTest(t, s, h)
	clobber(t, s, stale)
	r, e := s.repair(h)
	must(t, e)
	if len(r.State.Attempts) != 2 || r.State.Active != second.Attempt.ID {
		t.Fatalf("repair left %d attempts, active %s", len(r.State.Attempts), r.State.Active)
	}
	if r.State.Steps["S01"].Status != "passed" {
		t.Fatalf("repair demoted a passed step to %s", r.State.Steps["S01"].Status)
	}
}
