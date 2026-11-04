package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"mission.local/prototype/internal/domain/mission"
)

func TestPiTurnDoesNotFinishWithoutReportAndQuietBoundary(t *testing.T) {
	s, h, p := piFixture(t)
	c, e := s.attach(h, p)
	must(t, e)
	quiet := mission.Event{ID: "end-1", Type: "agent-settled", SessionID: p.SessionID, Quiescent: true}
	_, e = s.hook(h, c.Attempt.ID, p.Token, quiet)
	must(t, e)
	_, e = s.settle(h, c.Attempt.ID, p.Token, p.SessionID)
	wantCode(t, e, "completion_required")
	_, e = s.finish(h, c.Attempt.ID, p.Token, false, "ready", false, 0)
	must(t, e)
	_, e = s.hook(h, c.Attempt.ID, p.Token, mission.Event{Type: "agent-end", SessionID: p.SessionID, Quiescent: true})
	must(t, e)
	_, e = s.settle(h, c.Attempt.ID, p.Token, p.SessionID)
	wantCode(t, e, "runtime_busy")
	_, e = s.hook(h, c.Attempt.ID, p.Token, mission.Event{Type: "agent-start", SessionID: p.SessionID})
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
	wantCode(t, e, "review_pending")
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
	_, e = s.hook(h, c.Attempt.ID, p.Token, mission.Event{Type: "session-end", SessionID: p.SessionID})
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
	progress := mission.Progress{ID: "report-1", Status: "blocked", Summary: "Need design review", Blocker: "Choose retention period", Next: "Implement retention"}
	r, e := s.progress(h, c.Attempt.ID, p.Token, progress, []string{c.Attempt.Artifact})
	must(t, e)
	r, e = s.progress(h, c.Attempt.ID, p.Token, progress, []string{c.Attempt.Artifact})
	must(t, e)
	if r.State.Status != "waiting" || len(r.State.Attempts[0].Progress) != 1 || r.State.Attempts[0].Progress[0].Evidence[0].Hash != mission.Digest([]byte("Evidence")) {
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
	m := mission.Mission{Repo: "dotfiles", Slug: "worktree-branch", Title: "Mission worktree", Goal: "Launch as a Herdr worktree", Kind: "implementation", Steps: []mission.Step{{Title: "Inspect", Output: "result.md"}}}
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
	m := mission.Mission{Repo: "dotfiles", Slug: "revive-checkout", Title: "Revive a deleted checkout", Goal: "Recover the mission worktree", Kind: "implementation", Steps: []mission.Step{{Title: "Inspect", Output: "result.md"}}}
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

// missionRepo registers one repository with a tracked file and returns the
// store, the primary checkout, and the shared worktree root.
func missionRepo(t *testing.T) (*Store, string, string) {
	t.Helper()
	s, e := openStore(t.TempDir())
	must(t, e)
	root := t.TempDir()
	repo := filepath.Join(root, "dotfiles")
	must(t, os.MkdirAll(repo, 0700))
	gitFixture(t, repo, "init", "-b", "main")
	must(t, os.WriteFile(filepath.Join(repo, "README.md"), []byte("base\n"), 0600))
	gitFixture(t, repo, "add", "README.md")
	commitFixture(t, repo)
	_, e = s.addRepo("dotfiles", repo, "")
	must(t, e)
	return s, repo, filepath.Join(root, "worktrees")
}

func commitFixture(t *testing.T, dir string) {
	t.Helper()
	gitFixture(t, dir, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "fixture")
}

func gitFixture(t *testing.T, dir string, args ...string) string {
	t.Helper()
	out, err := exec.Command("git", append([]string{"-C", dir}, args...)...).CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %s %v", args, out, err)
	}
	return strings.TrimSpace(string(out))
}

func addMission(t *testing.T, s *Store, slug string) string {
	t.Helper()
	m := mission.Mission{Repo: "dotfiles", Slug: slug, Title: "Adopt a checkout", Goal: "Reuse the existing mission checkout", Kind: "implementation", Steps: []mission.Step{{Title: "Inspect", Output: "result.md"}}}
	r, e := s.create(m)
	must(t, e)
	return r.Handle
}

// missionCheckout pre-creates mission/<slug> and a linked checkout at the path
// workspace expects. It commits a sentinel file so the tree starts clean and
// adoption is provably in-place.
func missionCheckout(t *testing.T, s *Store, h, repo, worktrees, slug string, mark bool) string {
	t.Helper()
	branch := missionBranch(slug)
	cwd := filepath.Join(worktrees, "mission-"+slug)
	gitFixture(t, repo, "branch", branch, "main")
	gitFixture(t, repo, "worktree", "add", cwd, branch)
	if mark {
		gitFixture(t, repo, "config", "branch."+branch+".missionOwner", s.Vault+":"+h)
	}
	must(t, os.WriteFile(filepath.Join(cwd, "sentinel.txt"), []byte("untouched"), 0600))
	gitFixture(t, cwd, "add", "sentinel.txt")
	commitFixture(t, cwd)
	return cwd
}

func realPath(t *testing.T, p string) string {
	t.Helper()
	r, e := filepath.EvalSymlinks(p)
	must(t, e)
	return r
}

// An existing checkout already on mission/<slug> is adopted in place: no
// recreate, no prune, no second checkout, and the binding stays single.
func TestMissionWorkspaceAdoptsCheckoutOnBranch(t *testing.T) {
	s, repo, worktrees := missionRepo(t)
	h := addMission(t, s, "adopt-same")
	cwd := missionCheckout(t, s, h, repo, worktrees, "adopt-same", true)
	before := gitFixture(t, repo, "worktree", "list", "--porcelain")
	w, e := s.workspace(h, "", "main", worktrees)
	must(t, e)
	b := w.State.Runtime
	if b == nil || b.Cwd != realPath(t, cwd) || b.Branch != missionBranch("adopt-same") {
		t.Fatalf("adoption binding = %+v", b)
	}
	if b.BaseCommit != gitFixture(t, repo, "rev-parse", "refs/heads/"+b.Branch) {
		t.Fatalf("base commit = %q, want the mission branch tip", b.BaseCommit)
	}
	if _, e := os.Stat(filepath.Join(cwd, "sentinel.txt")); e != nil {
		t.Fatal("adoption recreated the existing checkout")
	}
	if list := gitFixture(t, repo, "worktree", "list", "--porcelain"); list != before {
		t.Fatalf("adoption changed the worktree registrations:\n%s\nwant:\n%s", list, before)
	}
	again, e := s.workspace(h, "", "main", worktrees)
	must(t, e)
	if again.State.Runtime.Cwd != b.Cwd || again.State.Runtime.Branch != b.Branch {
		t.Fatalf("second workspace call rebound the mission: %+v", again.State.Runtime)
	}
	if n := strings.Count(gitFixture(t, repo, "worktree", "list", "--porcelain"), "branch refs/heads/"+b.Branch); n != 1 {
		t.Fatalf("mission branch is checked out %d times", n)
	}
}

// A checkout whose HEAD is detached at the branch tip is carried onto the
// branch when it is clean, and refused without touching files when it is dirty.
func TestMissionWorkspaceAdoptsDetachedCheckout(t *testing.T) {
	s, repo, worktrees := missionRepo(t)
	h := addMission(t, s, "adopt-detached")
	cwd := missionCheckout(t, s, h, repo, worktrees, "adopt-detached", true)
	gitFixture(t, cwd, "checkout", "--detach")
	w, e := s.workspace(h, "", "main", worktrees)
	must(t, e)
	b := w.State.Runtime
	if head := gitFixture(t, cwd, "rev-parse", "--abbrev-ref", "HEAD"); head != b.Branch {
		t.Fatalf("adopted HEAD = %q, want %q", head, b.Branch)
	}
	if _, e := os.Stat(filepath.Join(cwd, "sentinel.txt")); e != nil {
		t.Fatal("detached adoption recreated the checkout")
	}

	// The same checkout, detached again with uncommitted work, is refused.
	gitFixture(t, cwd, "checkout", "--detach")
	must(t, os.WriteFile(filepath.Join(cwd, "README.md"), []byte("local edit\n"), 0600))
	_, e = s.workspace(h, "", "main", worktrees)
	wantCode(t, e, "worktree_dirty")
	if head := gitFixture(t, cwd, "rev-parse", "--abbrev-ref", "HEAD"); head != "HEAD" {
		t.Fatalf("dirty checkout was switched to %q", head)
	}
	if got, e := os.ReadFile(filepath.Join(cwd, "README.md")); e != nil || string(got) != "local edit\n" {
		t.Fatalf("dirty file was touched: %q %v", got, e)
	}
}

// A checkout sitting on another branch is reported, never switched over
// uncommitted work.
func TestMissionWorkspaceRefusesOtherBranch(t *testing.T) {
	s, repo, worktrees := missionRepo(t)
	h := addMission(t, s, "other-branch")
	cwd := missionCheckout(t, s, h, repo, worktrees, "other-branch", true)
	gitFixture(t, cwd, "checkout", "-b", "side-work")
	must(t, os.WriteFile(filepath.Join(cwd, "README.md"), []byte("in progress\n"), 0600))
	_, e := s.workspace(h, "", "main", worktrees)
	wantCode(t, e, "worktree_mismatch")
	if head := gitFixture(t, cwd, "rev-parse", "--abbrev-ref", "HEAD"); head != "side-work" {
		t.Fatalf("refusal switched the checkout to %q", head)
	}
	if got, e := os.ReadFile(filepath.Join(cwd, "README.md")); e != nil || string(got) != "in progress\n" {
		t.Fatalf("uncommitted work was touched: %q %v", got, e)
	}
}

// A checkout already on mission/<slug> without this mission's marker is adopted
// and marked, while a branch owned elsewhere or a foreign path still refuses.
func TestMissionWorkspaceAdoptsUnmarkedCheckout(t *testing.T) {
	s, repo, worktrees := missionRepo(t)
	h := addMission(t, s, "unmarked-slug")
	cwd := missionCheckout(t, s, h, repo, worktrees, "unmarked-slug", false)
	w, e := s.workspace(h, "", "main", worktrees)
	must(t, e)
	b := w.State.Runtime
	if b.Cwd != realPath(t, cwd) || b.Branch != missionBranch("unmarked-slug") {
		t.Fatalf("adoption binding = %+v", b)
	}
	if mark := gitFixture(t, repo, "config", "--get", "branch."+b.Branch+".missionOwner"); mark != s.Vault+":"+h {
		t.Fatalf("ownership marker = %q, want %s:%s", mark, s.Vault, h)
	}
	again, e := s.workspace(h, "", "main", worktrees)
	must(t, e)
	if again.State.Runtime.Cwd != b.Cwd || again.State.Runtime.Branch != b.Branch {
		t.Fatalf("second workspace call rebound the mission: %+v", again.State.Runtime)
	}

	// The branch checked out in another worktree is never duplicated.
	second := addMission(t, s, "unmarked-elsewhere")
	gitFixture(t, repo, "branch", missionBranch("unmarked-elsewhere"), "main")
	gitFixture(t, repo, "worktree", "add", filepath.Join(worktrees, "elsewhere"), missionBranch("unmarked-elsewhere"))
	_, e = s.workspace(second, "", "main", worktrees)
	wantCode(t, e, "worktree_in_use")

	// A path that is not the mission checkout is reported, not adopted.
	third := addMission(t, s, "unmarked-foreign")
	gitFixture(t, repo, "branch", missionBranch("unmarked-foreign"), "main")
	foreign := filepath.Join(worktrees, "mission-unmarked-foreign")
	must(t, os.MkdirAll(foreign, 0700))
	must(t, os.WriteFile(filepath.Join(foreign, "notes.txt"), []byte("keep me"), 0600))
	_, e = s.workspace(third, "", "main", worktrees)
	wantCode(t, e, "worktree_invalid")
	if got, e := os.ReadFile(filepath.Join(foreign, "notes.txt")); e != nil || string(got) != "keep me" {
		t.Fatalf("foreign path was touched: %q %v", got, e)
	}
}

// A failed launch must stay retryable. The adapter releases the intent it
// reserved, and the next launch reserves again without a hand edit.
func TestFailedLaunchIntentIsReleased(t *testing.T) {
	s, h, _ := piFixture(t)
	got, e := s.launch(h, "", "")
	must(t, e)
	if got["acquired"] != true {
		t.Fatal("the first launch did not reserve an intent")
	}
	id := got["runtime"].(*mission.RuntimeBinding).LaunchID
	if id == "" {
		t.Fatal("the reservation records no launch id")
	}
	// Only the intent this call reserved can be released.
	_, e = s.release(h, "launch-other")
	wantCode(t, e, "launch_mismatch")
	_, e = s.release(h, "")
	wantCode(t, e, "usage")
	r, e := s.release(h, id)
	must(t, e)
	if r["released"] != true {
		t.Fatal("release did not free the intent")
	}
	if left := r["runtime"].(*mission.RuntimeBinding).LaunchID; left != "" {
		t.Fatalf("launch id survived the release: %q", left)
	}
	again, e := s.launch(h, "", "")
	must(t, e)
	if again["acquired"] != true {
		t.Fatal("a released launch intent must be reservable again")
	}
}

// A live owner keeps its intent. Release never frees a recorded session.
func TestReleaseRefusesARecordedSession(t *testing.T) {
	s, h, p := piFixture(t)
	got, e := s.launch(h, "", "")
	must(t, e)
	id := got["runtime"].(*mission.RuntimeBinding).LaunchID
	_, e = s.launch(h, p.SessionFile, id)
	must(t, e)
	_, e = s.release(h, id)
	wantCode(t, e, "session_owned")
}
