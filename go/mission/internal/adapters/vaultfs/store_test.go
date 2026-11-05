package vaultfs

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

func must(t *testing.T, e error) {
	t.Helper()
	if e != nil {
		t.Fatal(e)
	}
}

func wantCode(t *testing.T, e error, code string) {
	t.Helper()
	d, ok := e.(*mission.DomainError)
	if !ok || d.Code != code {
		t.Fatalf("want error %s, got %v", code, e)
	}
}

// fixture opens a vault with one registered repository and one stored mission.
func fixture(t *testing.T) (*Store, string) {
	t.Helper()
	s, e := Open(t.TempDir())
	must(t, e)
	_, e = s.AddRepo("dotfiles", t.TempDir(), "")
	must(t, e)
	m := mission.Mission{Repo: "dotfiles", Slug: "test-mission", Title: "Test mission", Goal: "Preserve execution evidence", Kind: "research",
		Steps: []mission.Step{{ID: "S01", Title: "Inspect", Agent: "any", Output: "result.md", Checks: []string{"nonempty-artifact"}}}}
	r, e := s.Create(m)
	must(t, e)
	return s, r.Handle
}

func TestRepoRegistryRoundTrip(t *testing.T) {
	s, _ := fixture(t)
	repos, e := s.Repos()
	must(t, e)
	if len(repos) != 1 || repos[0].Slug != "dotfiles" {
		t.Fatalf("unexpected registry: %+v", repos)
	}
	r, e := s.Repo("dotfiles")
	must(t, e)
	if r.Bindings[platform.Machine()] == "" || r.ID != "repo-dotfiles" {
		t.Fatalf("missing machine binding: %+v", r)
	}
	// A second add for the same slug refreshes the binding instead of failing.
	checkout := t.TempDir()
	r, e = s.AddRepo("dotfiles", checkout, "git@example.com:dotfiles.git")
	must(t, e)
	if r.Remote != "git@example.com:dotfiles.git" {
		t.Fatalf("remote not stored: %+v", r)
	}
}

func TestRepoRegistrationRejectsUnsafeInput(t *testing.T) {
	s, _ := fixture(t)
	_, e := s.AddRepo("No Spaces", t.TempDir(), "")
	wantCode(t, e, "invalid_slug")
	if _, e = s.AddRepo("missing", filepath.Join(t.TempDir(), "absent"), ""); e == nil {
		t.Fatal("missing checkout accepted")
	}
	_, e = s.Repo("absent")
	wantCode(t, e, "repo_not_registered")
}

func TestVaultRefusesPathTraversal(t *testing.T) {
	s, _ := fixture(t)
	if _, _, e := mission.SplitHandle("../escape"); e == nil {
		t.Fatal("traversal handle accepted")
	}
	if _, e := s.Dir("../../etc/passwd"); e == nil {
		t.Fatal("traversal path accepted")
	}
	if _, e := s.Path(".."); e == nil {
		t.Fatal("traversal component accepted")
	}
	entries, e := os.ReadDir(s.Vault)
	must(t, e)
	for _, v := range entries {
		if strings.HasSuffix(v.Name(), ".tmp") {
			t.Fatalf("temporary file left behind: %s", v.Name())
		}
	}
}

// TestStaleSaveCannotDropAWrite pins the commit point: an actor holding a
// record from before another write cannot replace the ledger afterwards.
func TestStaleSaveCannotDropAWrite(t *testing.T) {
	s, h := fixture(t)
	stale, e := s.Read(h)
	must(t, e)
	_, e = s.Update(h, "mission", func(r *mission.Record) error {
		r.State.Attempts = append(r.State.Attempts, mission.Attempt{ID: "attempt-one", Sequence: 1, Step: "S01", Status: "running"})
		r.State.Active = "attempt-one"
		return nil
	})
	must(t, e)
	stale.State.Revision++
	e = s.Save(&stale, "mission")
	wantCode(t, e, "revision_conflict")
	if got, e := s.Read(h); e != nil || len(got.State.Attempts) != 1 {
		t.Fatalf("stale save left %d attempts (err %v); the write was lost", len(got.State.Attempts), e)
	}
}

// TestJournalNamesEveryWriter shows the forensic record a lost revision leaves
// behind: one line per save, refused writes included.
func TestJournalNamesEveryWriter(t *testing.T) {
	s, h := fixture(t)
	stale, e := s.Read(h)
	must(t, e)
	_, e = s.Update(h, "mission claim", func(r *mission.Record) error {
		r.State.Attempts = append(r.State.Attempts, mission.Attempt{ID: "attempt-one", Sequence: 1, Step: "S01", Status: "running"})
		return nil
	})
	must(t, e)
	stale.State.Revision++
	_ = s.Save(&stale, "mission abandon")
	p, e := s.Path("dotfiles", "test-mission", "journal.jsonl")
	must(t, e)
	b, e := os.ReadFile(p)
	must(t, e)
	lines := strings.Split(strings.TrimSpace(string(b)), "\n")
	if len(lines) != 2 {
		t.Fatalf("want one line per save, got %d: %s", len(lines), b)
	}
	var refused journalEntry
	must(t, json.Unmarshal([]byte(lines[1]), &refused))
	if refused.Result != "refused" || refused.Attempts != 0 || refused.Base != stale.State.Revision-1 || refused.Writer != "mission abandon" {
		t.Fatalf("refused line does not name the writer: %+v", refused)
	}
}

// TestUpdateReportsNoWrite pins the escape a replay needs: a transaction that
// changed nothing leaves the revision and the journal alone.
func TestUpdateReportsNoWrite(t *testing.T) {
	s, h := fixture(t)
	before, e := s.Read(h)
	must(t, e)
	rec, e := s.Update(h, "mission", func(r *mission.Record) error { return mission.ErrNoWrite })
	must(t, e)
	if rec.State.Revision != before.State.Revision {
		t.Fatalf("no-write transaction moved the revision to %d", rec.State.Revision)
	}
	p, e := s.Path("dotfiles", "test-mission", "journal.jsonl")
	must(t, e)
	if _, e = os.Stat(p); !os.IsNotExist(e) {
		t.Fatalf("no-write transaction wrote a journal line: %v", e)
	}
}
