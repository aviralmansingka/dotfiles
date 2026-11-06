package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mission.local/prototype/internal/adapters/checks"
	"mission.local/prototype/internal/adapters/gitworktree"
	"mission.local/prototype/internal/adapters/vaultfs"
	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

// openApp builds one core over a real vault, with the writer a test command
// makes its saves under.
func openApp(t *testing.T, vault string) (*App, error) {
	t.Helper()
	store, e := vaultfs.Open(vault)
	if e != nil {
		return nil, e
	}
	return newApp(store, checks.New(), hostCatalog{}, gitworktree.Workspace{}, "mission"), nil
}

// fixture builds a vault with one registered repository and one mission.
func fixture(t *testing.T) (*App, string) {
	t.Helper()
	s, e := openApp(t, t.TempDir())
	must(t, e)
	_, e = s.addRepo("dotfiles", t.TempDir(), "")
	must(t, e)
	m := mission.Mission{Repo: "dotfiles", Slug: "test-mission", Title: "Test mission", Goal: "Preserve execution evidence", Kind: "research", Steps: []mission.Step{{Title: "Inspect", Output: "result.md"}, {Title: "Propose", Output: "proposal.md"}}, Checkpoints: []mission.Checkpoint{{ID: "C01", After: "S01", Kind: "human", Question: "Proceed?"}}}
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

// deskOn builds the desk and opens the lane that holds handle, so a test that
// is not about the filter lane still sees the record it seeded. The desk
// itself opens on the lane's first entry, ACTIVE.
func deskOn(t *testing.T, s *App, handle string) *desk {
	t.Helper()
	m := newDesk(s)
	m.refresh()
	selectHandle(t, m, handle)
	return m
}

// selectHandle moves the desk to the lane that holds handle and puts the marker
// on its row. A test that changes a record's state between refreshes calls it
// again, because refresh keeps the lane and drops a record the lane no longer
// matches.
func selectHandle(t *testing.T, m *desk, handle string) {
	t.Helper()
	r, e := m.store.load(handle)
	must(t, e)
	for i, f := range deskFilters {
		if !f.Match(r) {
			continue
		}
		m.setFilter(i)
		for j, v := range m.view {
			if v.Handle == handle {
				m.selected = j
				return
			}
		}
	}
	t.Fatalf("no filter holds %s (status %s)", handle, r.State.Status)
}

func wantCode(t *testing.T, e error, code string) {
	t.Helper()
	d, ok := e.(*mission.DomainError)
	if !ok || d.Code != code {
		t.Fatalf("want error %s, got %v", code, e)
	}
}

func claimTest(t *testing.T, s *App, h string) mission.Claim {
	t.Helper()
	c, e := s.claim(h, "scout", "session-test", "", false)
	must(t, e)
	return c
}

func result(t *testing.T, s *App, c mission.Claim, text string) {
	t.Helper()
	must(t, platform.AtomicWrite(s.Artifacts(c), []byte(text)))
}

// piFixture builds a real Git worktree for a mission and a session file whose
// header matches it.
func piFixture(t *testing.T) (*App, string, mission.PiAttachment) {
	t.Helper()
	s, h := fixture(t)
	root := t.TempDir()
	gitFixture(t, root, "init", "-b", "main")
	gitFixture(t, root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "fixture")
	_, e := s.addRepo("dotfiles", root, "")
	must(t, e)
	r, e := s.workspace(h, "", "main", t.TempDir())
	must(t, e)
	p := mission.PiAttachment{SessionID: "pi-session", Cwd: r.State.Runtime.Cwd, Workspace: "repo-workspace", Pane: "repo-workspace:p1", Token: strings.Repeat("private", 8), Agent: "scout"}
	p.SessionFile = filepath.Join(t.TempDir(), "session.jsonl")
	piHeader(t, p)
	return s, h, p
}

func piHeader(t *testing.T, p mission.PiAttachment) {
	t.Helper()
	b, e := json.Marshal(map[string]string{"type": "session", "id": p.SessionID, "cwd": p.Cwd})
	must(t, e)
	must(t, os.WriteFile(p.SessionFile, append(b, 10), 0600))
}
