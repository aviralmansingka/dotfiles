package main

import "testing"

// fixture builds a vault with one registered repository and one mission.
func fixture(t *testing.T) (*Store, string) {
	t.Helper()
	s, e := openStore(t.TempDir())
	must(t, e)
	_, e = s.addRepo("dotfiles", t.TempDir(), "")
	must(t, e)
	m := Mission{Repo: "dotfiles", Slug: "test-mission", Title: "Test mission", Goal: "Preserve execution evidence", Kind: "research", Steps: []Step{{Title: "Inspect", Output: "result.md"}, {Title: "Propose", Output: "proposal.md"}}, Checkpoints: []Checkpoint{{"C01", "S01", "human", "Proceed?"}}}
	r, e := s.create(m)
	must(t, e)
	return s, r.Handle
}

func must(t *testing.T, e error) {
	t.Helper()
	if e != nil {
		t.Fatal(e)
	}
}

func wantCode(t *testing.T, e error, code string) {
	t.Helper()
	d, ok := e.(*DomainError)
	if !ok || d.Code != code {
		t.Fatalf("want error %s, got %v", code, e)
	}
}
