package main

import (
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestConcurrentClaimHasOneWinner(t *testing.T) {
	s, h := fixture(t)
	var wg sync.WaitGroup
	var mu sync.Mutex
	wins := 0
	errors := []error{}
	for range 12 {
		wg.Go(func() {
			_, e := s.claim(h, "scout", "", "", false)
			mu.Lock()
			defer mu.Unlock()
			if e == nil {
				wins++
			} else {
				errors = append(errors, e)
			}
		})
	}
	wg.Wait()
	if wins != 1 {
		t.Fatalf("%d winners", wins)
	}
	for _, e := range errors {
		wantCode(t, e, "busy")
	}
	r, e := s.load(h)
	must(t, e)
	if len(r.State.Attempts) != 1 {
		t.Fatal("duplicate attempt committed")
	}
}

func TestPiAttachmentIsIdempotentAndRejectsOtherOwners(t *testing.T) {
	s, h, p := piFixture(t)
	c, e := s.attach(h, p)
	must(t, e)
	replayed, e := s.attach(h, p)
	must(t, e)
	if replayed.Attempt.ID != c.Attempt.ID {
		t.Fatal("attach created duplicate attempt")
	}
	wrong := p
	wrong.Token = strings.Repeat("x", 40)
	_, e = s.attach(h, wrong)
	wantCode(t, e, "not_owner")
	wrong = p
	wrong.SessionID = "other"
	piHeader(t, wrong)
	_, e = s.attach(h, wrong)
	wantCode(t, e, "session_owned")
	piHeader(t, p)
	r, e := s.load(h)
	must(t, e)
	m := r.Mission
	m.Slug = "another-mission"
	other, e := s.create(m)
	must(t, e)
	_, e = s.workspace(other.Handle, p.Cwd, "", "")
	wantCode(t, e, "worktree_busy")
	_, e = s.claim(other.Handle, "scout", "untracked", p.Cwd, false)
	wantCode(t, e, "worktree_busy")
	if len(r.State.Attempts) != 1 || r.State.Runtime.SessionID != p.SessionID {
		t.Fatal("owner changed")
	}
}

func TestLaunchReservationHasSingleWinnerAndPersists(t *testing.T) {
	s, h, p := piFixture(t)
	var wg sync.WaitGroup
	var mu sync.Mutex
	wins := 0
	for range 8 {
		wg.Go(func() {
			r, e := s.launch(h, "", "")
			if e != nil {
				t.Error(e)
				return
			}
			if r["acquired"].(bool) {
				mu.Lock()
				wins++
				mu.Unlock()
			}
		})
	}
	wg.Wait()
	if wins != 1 {
		t.Fatalf("%d launches", wins)
	}
	r, e := s.load(h)
	must(t, e)
	_, e = s.attach(h, p)
	wantCode(t, e, "launch_pending")
	p.LaunchID = r.State.Runtime.LaunchID
	_, e = s.launch(h, p.SessionFile, p.LaunchID)
	must(t, e)
	_, e = s.attach(h, p)
	must(t, e)
	again, e := s.launch(h, "", "")
	must(t, e)
	if again["acquired"].(bool) {
		t.Fatal("reserved duplicate launch")
	}
}

func TestWorkspaceReuseAndSessionHeaderValidation(t *testing.T) {
	s, h, p := piFixture(t)
	r, e := s.workspace(h, "", "main", t.TempDir())
	must(t, e)
	if r.State.Runtime.Cwd != p.Cwd {
		t.Fatal("workspace replaced")
	}
	bad := p
	bad.Cwd = filepath.Dir(p.Cwd)
	_, e = s.attach(h, bad)
	wantCode(t, e, "session_cwd_mismatch")
	bad = p
	bad.SessionID = "mismatch"
	_, e = s.attach(h, bad)
	wantCode(t, e, "invalid_session")
}

func TestMissionsKeepPerWorktreeWorkspaces(t *testing.T) {
	s, h, p := piFixture(t)
	_, e := s.attach(h, p)
	must(t, e)
	r, e := s.load(h)
	must(t, e)
	m := r.Mission
	m.Slug = "second-mission"
	second, e := s.create(m)
	must(t, e)
	second, e = s.workspace(second.Handle, "", "main", t.TempDir())
	must(t, e)
	other := p
	other.Cwd = second.State.Runtime.Cwd
	other.SessionID = "second-session"
	other.SessionFile = filepath.Join(t.TempDir(), "pi.jsonl")
	// Each mission worktree owns its own Herdr worktree workspace.
	other.Workspace = "mission-workspace"
	other.Pane = "mission-workspace:p1"
	piHeader(t, other)
	c, e := s.attach(second.Handle, other)
	must(t, e)
	if c.Attempt.Cwd == p.Cwd {
		t.Fatal("missions share a worktree")
	}
	r, e = s.load(h)
	must(t, e)
	second, e = s.load(second.Handle)
	must(t, e)
	if r.State.Runtime.Workspace == second.State.Runtime.Workspace {
		t.Fatal("missions share a worktree workspace")
	}
	// Missions bound before the worktree-workspace change still share the
	// repository's primary workspace; a later attach must not refuse them.
	m.Slug = "legacy-mission"
	legacy, e := s.create(m)
	must(t, e)
	legacy, e = s.workspace(legacy.Handle, "", "main", t.TempDir())
	must(t, e)
	old := p
	old.Cwd = legacy.State.Runtime.Cwd
	old.SessionID = "legacy-session"
	old.SessionFile = filepath.Join(t.TempDir(), "legacy.jsonl")
	piHeader(t, old)
	if _, e = s.attach(legacy.Handle, old); e != nil {
		t.Fatalf("legacy primary-workspace mission refused: %v", e)
	}
}
