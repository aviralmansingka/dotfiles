package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestPiTurnDoesNotFinishWithoutReportAndQuietBoundary(t *testing.T) {
	s, h, p := piFixture(t)
	c, e := s.attach(h, p)
	must(t, e)
	quiet := Event{ID: "end-1", Type: "agent-settled", SessionID: p.SessionID, Quiescent: true}
	_, e = s.hook(h, c.Attempt.ID, p.Token, quiet)
	must(t, e)
	_, e = s.settle(h, c.Attempt.ID, p.Token, p.SessionID)
	wantCode(t, e, "completion_required")
	_, e = s.finish(h, c.Attempt.ID, p.Token, false, "ready", false, 0)
	must(t, e)
	_, e = s.hook(h, c.Attempt.ID, p.Token, Event{Type: "agent-end", SessionID: p.SessionID, Quiescent: true})
	must(t, e)
	_, e = s.settle(h, c.Attempt.ID, p.Token, p.SessionID)
	wantCode(t, e, "runtime_busy")
	_, e = s.hook(h, c.Attempt.ID, p.Token, Event{Type: "agent-start", SessionID: p.SessionID})
	must(t, e)
	_, e = s.settle(h, c.Attempt.ID, p.Token, p.SessionID)
	wantCode(t, e, "runtime_busy")
	quiet.ID = "end-2"
	_, e = s.hook(h, c.Attempt.ID, p.Token, quiet)
	must(t, e)
	_, e = s.settle(h, c.Attempt.ID, p.Token, p.SessionID)
	wantCode(t, e, "missing_artifact")
	result(t, s, c, "Step result and evidence")
	r, e := s.settle(h, c.Attempt.ID, p.Token, p.SessionID)
	must(t, e)
	a := r.State.Attempts[0]
	if !a.Settled || a.ProcessExited || a.Status != "succeeded" || r.State.Pending != "C01" {
		t.Fatal("invalid settlement or checkpoint")
	}
	if a.Transcript == "" {
		t.Fatal("transcript not preserved")
	}
	_, e = s.settle(h, c.Attempt.ID, p.Token, p.SessionID)
	must(t, e)
	_, e = s.attach(h, p)
	wantCode(t, e, "checkpoint_pending")
	r, e = s.checkpoint(h, "C01", "accept", "Reviewed", "aviral", true, r.State.Revision)
	must(t, e)
	next, e := s.attach(h, p)
	must(t, e)
	if next.Step.ID != "S02" || next.Attempt.Cwd != c.Attempt.Cwd || next.Attempt.ID == c.Attempt.ID {
		t.Fatal("step lost durable workspace/owner")
	}
}

func TestPiShutdownAndReloadPreserveOwnership(t *testing.T) {
	s, h, p := piFixture(t)
	c, e := s.attach(h, p)
	must(t, e)
	_, e = s.hook(h, c.Attempt.ID, p.Token, Event{Type: "session-end", SessionID: p.SessionID})
	must(t, e)
	s2, e := openStore(s.Vault)
	must(t, e)
	r, e := s2.load(h)
	must(t, e)
	if r.State.Active != c.Attempt.ID || r.State.Status != "waiting" || r.State.Runtime.Cwd != p.Cwd {
		t.Fatal("shutdown released durable owner")
	}
	again, e := s2.attach(h, p)
	must(t, e)
	if again.Attempt.ID != c.Attempt.ID {
		t.Fatal("restart duplicated owner")
	}
}

func TestProgressIsStructuredHashedAndReplaySafe(t *testing.T) {
	s, h, p := piFixture(t)
	c, e := s.attach(h, p)
	must(t, e)
	result(t, s, c, "Evidence")
	progress := Progress{ID: "report-1", Status: "blocked", Summary: "Need design review", Blocker: "Choose retention period", Next: "Implement retention"}
	r, e := s.progress(h, c.Attempt.ID, p.Token, progress, []string{c.Attempt.Artifact})
	must(t, e)
	r, e = s.progress(h, c.Attempt.ID, p.Token, progress, []string{c.Attempt.Artifact})
	must(t, e)
	if r.State.Status != "waiting" || len(r.State.Attempts[0].Progress) != 1 || r.State.Attempts[0].Progress[0].Evidence[0].Hash != digest([]byte("Evidence")) {
		t.Fatal("progress lost or duplicated")
	}
	progress.Summary = "different"
	_, e = s.progress(h, c.Attempt.ID, p.Token, progress, []string{c.Attempt.Artifact})
	wantCode(t, e, "event_conflict")
	progress.ID = "report-2"
	_, e = s.progress(h, c.Attempt.ID, p.Token, progress, []string{"../secret"})
	wantCode(t, e, "invalid_evidence")
	progress.Status = "ready"
	r, e = s.progress(h, c.Attempt.ID, p.Token, progress, nil)
	must(t, e)
	if r.State.Active != c.Attempt.ID || r.State.Steps["S01"].Status != "running" {
		t.Fatal("progress bypassed completion")
	}
}

// Every mission launch owns `mission/<slug>` in a linked checkout under the
// shared Herdr worktree root, marked with this mission's ownership key.
func TestMissionWorkspaceOwnsMissionSlugBranch(t *testing.T) {
	root := t.TempDir()
	s, e := openStore(t.TempDir())
	must(t, e)
	repo := filepath.Join(root, "dotfiles")
	must(t, os.MkdirAll(repo, 0700))
	git := func(dir string, args ...string) string {
		t.Helper()
		out, err := exec.Command("git", append([]string{"-C", dir}, args...)...).CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %s %v", args, out, err)
		}
		return strings.TrimSpace(string(out))
	}
	git(repo, "init", "-b", "main")
	git(repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "fixture")
	_, e = s.addRepo("dotfiles", repo, "")
	must(t, e)
	m := Mission{Repo: "dotfiles", Slug: "worktree-branch", Title: "Mission worktree", Goal: "Launch as a Herdr worktree", Kind: "implementation", Steps: []Step{{Title: "Inspect", Output: "result.md"}}}
	r, e := s.create(m)
	must(t, e)
	w, e := s.workspace(r.Handle, "", "main", filepath.Join(root, "worktrees"))
	must(t, e)
	b := w.State.Runtime
	if b.Branch != "mission/worktree-branch" {
		t.Fatalf("mission branch = %q, want mission/worktree-branch", b.Branch)
	}
	if base := filepath.Base(b.Cwd); base != "mission-worktree-branch" {
		t.Fatalf("checkout = %q, want a mission-worktree-branch directory", b.Cwd)
	}
	if head := git(b.Cwd, "rev-parse", "--abbrev-ref", "HEAD"); head != "mission/worktree-branch" {
		t.Fatalf("checkout HEAD = %q", head)
	}
	if gd := git(b.Cwd, "rev-parse", "--absolute-git-dir"); filepath.Dir(filepath.Dir(gd)) == repo {
		t.Fatal("mission checkout is the primary repository checkout")
	}
	if b.BaseCommit == "" {
		t.Fatal("base commit not recorded")
	}
	if mark := git(repo, "config", "--get", "branch.mission/worktree-branch.missionOwner"); mark != s.Vault+":"+r.Handle {
		t.Fatalf("ownership marker = %q", mark)
	}
	// A second visit reuses the same checkout and branch instead of creating one.
	again, e := s.workspace(r.Handle, "", "main", filepath.Join(root, "worktrees"))
	must(t, e)
	if again.State.Runtime.Cwd != b.Cwd || again.State.Runtime.Branch != b.Branch {
		t.Fatal("relaunch replaced the mission checkout")
	}
	// An existing mission/<slug> branch without this mission's marker is refused.
	git(repo, "branch", "mission/taken-slug", "main")
	m.Slug = "taken-slug"
	second, e := s.create(m)
	must(t, e)
	_, e = s.workspace(second.Handle, "", "main", filepath.Join(root, "worktrees"))
	wantCode(t, e, "unowned_branch")
}

func TestMissionWorkspaceRevivesDeletedCheckout(t *testing.T) {
	root := t.TempDir()
	s, e := openStore(t.TempDir())
	must(t, e)
	repo := filepath.Join(root, "dotfiles")
	must(t, os.MkdirAll(repo, 0700))
	git := func(dir string, args ...string) string {
		t.Helper()
		out, err := exec.Command("git", append([]string{"-C", dir}, args...)...).CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %s %v", args, out, err)
		}
		return strings.TrimSpace(string(out))
	}
	git(repo, "init", "-b", "main")
	git(repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "fixture")
	_, e = s.addRepo("dotfiles", repo, "")
	must(t, e)
	m := Mission{Repo: "dotfiles", Slug: "revive-checkout", Title: "Revive a deleted checkout", Goal: "Recover the mission worktree", Kind: "implementation", Steps: []Step{{Title: "Inspect", Output: "result.md"}}}
	r, e := s.create(m)
	must(t, e)
	worktrees := filepath.Join(root, "worktrees")
	w, e := s.workspace(r.Handle, "", "main", worktrees)
	must(t, e)
	b := w.State.Runtime

	// The user removed the checkout (Herdr worktree remove, or a manual delete).
	// Git still lists it as prunable, so the revive must prune before adding.
	must(t, os.RemoveAll(b.Cwd))
	revived, e := s.workspace(r.Handle, "", "main", worktrees)
	must(t, e)
	if revived.State.Runtime.Cwd != b.Cwd || revived.State.Runtime.Branch != b.Branch {
		t.Fatalf("revive changed the binding: %+v", revived.State.Runtime)
	}
	if head := git(revived.State.Runtime.Cwd, "rev-parse", "--abbrev-ref", "HEAD"); head != b.Branch {
		t.Fatalf("revived HEAD = %q, want %q", head, b.Branch)
	}
	if list := git(repo, "worktree", "list"); strings.Contains(list, "prunable") {
		t.Fatalf("revive left a prunable registration: %s", list)
	}

	// A leftover empty directory is replaced by the checkout.
	must(t, os.RemoveAll(b.Cwd))
	must(t, os.MkdirAll(b.Cwd, 0700))
	revived, e = s.workspace(r.Handle, "", "main", worktrees)
	must(t, e)
	if head := git(revived.State.Runtime.Cwd, "rev-parse", "--abbrev-ref", "HEAD"); head != b.Branch {
		t.Fatalf("empty-directory revive HEAD = %q, want %q", head, b.Branch)
	}

	// Foreign content at the path is never deleted.
	must(t, os.RemoveAll(b.Cwd))
	must(t, os.MkdirAll(b.Cwd, 0700))
	must(t, os.WriteFile(filepath.Join(b.Cwd, "notes.txt"), []byte("keep me"), 0600))
	_, e = s.workspace(r.Handle, "", "main", worktrees)
	wantCode(t, e, "worktree_invalid")
	must(t, os.RemoveAll(b.Cwd))

	// The branch checked out elsewhere is reported, never duplicated.
	revived, e = s.workspace(r.Handle, "", "main", worktrees)
	must(t, e)
	git(repo, "worktree", "remove", "--force", revived.State.Runtime.Cwd)
	other := filepath.Join(root, "other-checkout")
	git(repo, "worktree", "add", other, b.Branch)
	_, e = s.workspace(r.Handle, "", "main", worktrees)
	wantCode(t, e, "worktree_in_use")
}
