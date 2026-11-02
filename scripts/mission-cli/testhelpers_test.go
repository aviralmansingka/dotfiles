package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

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

func claimTest(t *testing.T, s *Store, h string) Claim {
	t.Helper()
	c, e := s.claim(h, "scout", "session-test", "", false)
	must(t, e)
	return c
}

func result(t *testing.T, s *Store, c Claim, text string) {
	t.Helper()
	must(t, atomicWrite(artifactPath(s, c), []byte(text)))
}

// piFixture builds a real Git worktree for a mission and a session file whose
// header matches it.
func piFixture(t *testing.T) (*Store, string, PiAttachment) {
	t.Helper()
	s, h := fixture(t)
	root := t.TempDir()
	_, e := gitText(root, "init", "-b", "main")
	must(t, e)
	_, e = gitText(root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "fixture")
	must(t, e)
	_, e = s.addRepo("dotfiles", root, "")
	must(t, e)
	r, e := s.workspace(h, "", "main", t.TempDir())
	must(t, e)
	p := PiAttachment{SessionID: "pi-session", Cwd: r.State.Runtime.Cwd, Workspace: "repo-workspace", Pane: "repo-workspace:p1", Token: strings.Repeat("private", 8), Agent: "scout"}
	p.SessionFile = filepath.Join(t.TempDir(), "session.jsonl")
	piHeader(t, p)
	return s, h, p
}

func piHeader(t *testing.T, p PiAttachment) {
	t.Helper()
	b, e := json.Marshal(map[string]string{"type": "session", "id": p.SessionID, "cwd": p.Cwd})
	must(t, e)
	must(t, os.WriteFile(p.SessionFile, append(b, 10), 0600))
}
