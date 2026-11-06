package gitworktree

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"mission.local/prototype/internal/domain/mission"
)

// git runs one Git command in dir, failing the test on an error.
func git(t *testing.T, dir string, args ...string) string {
	t.Helper()
	b, e := exec.Command("git", append([]string{"-C", dir}, args...)...).CombinedOutput()
	if e != nil {
		t.Fatalf("git %s: %s %v", strings.Join(args, " "), b, e)
	}
	return strings.TrimSpace(string(b))
}

// commit commits whatever is staged or allowed empty, with a fixed identity.
func commit(t *testing.T, dir, message string) {
	t.Helper()
	git(t, dir, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", message)
}

// tempDir is a temporary directory with its symlinks resolved, so a path a test
// builds and a path Git answers compare as one.
func tempDir(t *testing.T) string {
	t.Helper()
	dir, e := filepath.EvalSymlinks(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	return dir
}

// repo builds a repository with one commit on main and returns its path, with
// symlinks resolved so a comparison with a Git answer never depends on /tmp.
func repo(t *testing.T) string {
	t.Helper()
	dir := tempDir(t)
	git(t, dir, "init", "-b", "main")
	commit(t, dir, "fixture")
	return dir
}

// wantCode fails unless e is a domain error with the given code.
func wantCode(t *testing.T, e error, code string) {
	t.Helper()
	d, ok := e.(*mission.DomainError)
	if !ok || d.Code != code {
		t.Fatalf("want error %s, got %v", code, e)
	}
}

// TestCatalogClassifiesMissionCheckouts pins the classification the core adopts
// on: a clean mission branch or a clean detached HEAD at its tip is work this
// mission may take, and anything else is not.
func TestCatalogClassifiesMissionCheckouts(t *testing.T) {
	c, root := Catalog{}, repo(t)
	branch := "mission/classify"
	git(t, root, "branch", branch, "main")
	cwd := filepath.Join(tempDir(t), "mission-classify")
	git(t, root, "worktree", "add", cwd, branch)

	if state, e := c.State(cwd, branch); e != nil || state != mission.CheckoutSame {
		t.Fatalf("state on the branch = %q %v, want same", state, e)
	}
	git(t, cwd, "checkout", "--detach")
	if state, e := c.State(cwd, branch); e != nil || state != mission.CheckoutDetached {
		t.Fatalf("state detached at the tip = %q %v, want detached", state, e)
	}
	if e := os.WriteFile(filepath.Join(cwd, "README.md"), []byte("local edit\n"), 0o600); e != nil {
		t.Fatal(e)
	}
	if state, e := c.State(cwd, branch); e != nil || state != mission.CheckoutDirty {
		t.Fatalf("state detached with work = %q %v, want dirty", state, e)
	}
	git(t, cwd, "checkout", "-b", "side-work")
	if state, e := c.State(cwd, branch); e != nil || state != mission.CheckoutOther {
		t.Fatalf("state on another branch = %q %v, want other", state, e)
	}
	// A path that is not a checkout at all classifies as none, never as an error.
	if state, e := c.State(tempDir(t), branch); e != nil || state != mission.CheckoutNone {
		t.Fatalf("state outside a checkout = %q %v, want none", state, e)
	}
}

// TestCatalogReportsRepositoryAndCheckoutShape pins the three paths a binding
// compares: the shared common directory, the checkout root, and the Git
// directory that tells a linked worktree from the primary one.
func TestCatalogReportsRepositoryAndCheckoutShape(t *testing.T) {
	c, root := Catalog{}, repo(t)
	cwd := filepath.Join(tempDir(t), "linked")
	git(t, root, "worktree", "add", "-b", "linked", cwd)

	common, e := c.Common(root)
	if e != nil {
		t.Fatal(e)
	}
	// A linked worktree answers the same common directory, which is what makes
	// two checkouts one repository.
	if got, e := c.Common(cwd); e != nil || got != common {
		t.Fatalf("worktree common = %q %v, want %q", got, e, common)
	}
	// The primary checkout holds the common directory itself, so the core refuses
	// to bind a mission there.
	if top, gitDir, e := c.Checkout(root); e != nil || top != root || gitDir != common {
		t.Fatalf("primary checkout = %q %q %v", top, gitDir, e)
	}
	top, gitDir, e := c.Checkout(cwd)
	if e != nil || top != cwd || gitDir == common {
		t.Fatalf("linked checkout = %q %q %v", top, gitDir, e)
	}
	// A subdirectory of a worktree is not its root, which is the other half of
	// isolated_worktree_required.
	sub := filepath.Join(cwd, "nested")
	if e := os.MkdirAll(sub, 0o700); e != nil {
		t.Fatal(e)
	}
	if got, _, e := c.Checkout(sub); e != nil || got != cwd {
		t.Fatalf("subdirectory root = %q %v, want %q", got, e, cwd)
	}
	// A path outside a repository is invalid_repository.
	if _, e := c.Common(tempDir(t)); e == nil {
		t.Fatal("a plain directory was accepted as a checkout")
	} else {
		wantCode(t, e, "invalid_repository")
	}
}

// TestCatalogAnswersRefsNamesBranchesAndOwners pins the probes the core decides
// on: a branch's commit, Git's verdict on a name, the worktree that holds a
// branch, and the ownership marker.
func TestCatalogAnswersRefsNamesBranchesAndOwners(t *testing.T) {
	c, root := Catalog{}, repo(t)
	branch := "mission/probe"

	if e := c.ValidBranch(root, branch); e != nil {
		t.Fatalf("valid branch refused: %v", e)
	}
	if e := c.ValidBranch(root, "not a branch"); e == nil {
		t.Fatal("an invalid branch name was accepted")
	}
	// A branch that does not exist is an error, because callers read a failed
	// probe as "absent".
	if _, e := c.Ref(root, branch); e == nil {
		t.Fatal("a missing branch answered a commit")
	}
	w := Workspace{}
	if e := w.CreateBranch(root, branch, "main"); e != nil {
		t.Fatal(e)
	}
	if got, e := c.Ref(root, branch); e != nil || got != git(t, root, "rev-parse", "main") {
		t.Fatalf("ref = %q %v, want main's commit", got, e)
	}
	// An unmarked branch owns nobody, and the marker round-trips.
	if got, _ := c.Owner(root, branch); got != "" {
		t.Fatalf("unmarked branch reports owner %q", got)
	}
	owner := "vault:/dotfiles/probe"
	if e := w.MarkOwner(root, branch, owner); e != nil {
		t.Fatal(e)
	}
	if got, e := c.Owner(root, branch); e != nil || got != owner {
		t.Fatalf("owner = %q %v, want %q", got, e, owner)
	}
	// A free branch has no holder, and the checkout that carries it is reported.
	if got, e := c.Holder(root, branch); e != nil || got != "" {
		t.Fatalf("free branch holder = %q %v", got, e)
	}
	cwd := filepath.Join(tempDir(t), "held")
	git(t, root, "worktree", "add", cwd, branch)
	if got, e := c.Holder(root, branch); e != nil || got != cwd {
		t.Fatalf("holder = %q %v, want %q", got, e, cwd)
	}
}

// TestWorkspaceEnsureKeepsAdoptsAndRevives pins the checkout command side: an
// existing mission checkout is kept, a deleted one is revived across its stale
// registration, and a path or branch that carries someone else's work is
// refused without touching it.
func TestWorkspaceEnsureKeepsAdoptsAndRevives(t *testing.T) {
	c, w := repo(t), Workspace{}
	branch := "mission/ensure"
	cwd := filepath.Join(tempDir(t), "mission-ensure")
	if e := w.CreateBranch(c, branch, "main"); e != nil {
		t.Fatal(e)
	}
	if e := w.Ensure(c, cwd, branch); e != nil {
		t.Fatal(e)
	}
	if head := git(t, cwd, "rev-parse", "--abbrev-ref", "HEAD"); head != branch {
		t.Fatalf("checkout HEAD = %q, want %q", head, branch)
	}
	if e := w.Ensure(c, cwd, branch); e != nil {
		t.Fatalf("second ensure failed: %v", e)
	}
	// A clean detached HEAD at the branch tip is carried onto the branch, so no
	// work moves.
	git(t, cwd, "checkout", "--detach")
	if e := w.Ensure(c, cwd, branch); e != nil {
		t.Fatal(e)
	}
	if head := git(t, cwd, "rev-parse", "--abbrev-ref", "HEAD"); head != branch {
		t.Fatalf("adopted HEAD = %q, want %q", head, branch)
	}
	// A detached checkout with uncommitted work is refused untouched. The edit is
	// an untracked file, and removing it cleans the tree again without moving
	// the detached HEAD.
	git(t, cwd, "checkout", "--detach")
	if e := os.WriteFile(filepath.Join(cwd, "README.md"), []byte("local edit\n"), 0o600); e != nil {
		t.Fatal(e)
	}
	wantCode(t, w.Ensure(c, cwd, branch), "worktree_dirty")
	if got, e := os.ReadFile(filepath.Join(cwd, "README.md")); e != nil || string(got) != "local edit\n" {
		t.Fatalf("dirty file was touched: %q %v", got, e)
	}
	if e := os.Remove(filepath.Join(cwd, "README.md")); e != nil {
		t.Fatal(e)
	}
	git(t, cwd, "checkout", branch)
	// A deleted checkout revives: Git still lists it, so a plain add would fail
	// until the prune.
	if e := os.RemoveAll(cwd); e != nil {
		t.Fatal(e)
	}
	if e := w.Ensure(c, cwd, branch); e != nil {
		t.Fatalf("revive failed: %v", e)
	}
	if list := git(t, c, "worktree", "list"); strings.Contains(list, "prunable") {
		t.Fatalf("revive left a prunable registration: %s", list)
	}
	// Foreign content at the mission path is never deleted.
	if e := os.RemoveAll(cwd); e != nil {
		t.Fatal(e)
	}
	if e := os.MkdirAll(cwd, 0o700); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(filepath.Join(cwd, "notes.txt"), []byte("keep me"), 0o600); e != nil {
		t.Fatal(e)
	}
	wantCode(t, w.Ensure(c, cwd, branch), "worktree_invalid")
	if got, e := os.ReadFile(filepath.Join(cwd, "notes.txt")); e != nil || string(got) != "keep me" {
		t.Fatalf("foreign path was touched: %q %v", got, e)
	}
	// The branch checked out elsewhere is reported, never duplicated.
	if e := os.RemoveAll(cwd); e != nil {
		t.Fatal(e)
	}
	git(t, c, "worktree", "remove", "--force", cwd)
	other := filepath.Join(tempDir(t), "elsewhere")
	git(t, c, "worktree", "add", other, branch)
	wantCode(t, w.Ensure(c, cwd, branch), "worktree_in_use")
}

// TestCatalogReportsTheHost pins the host name a binding records: the adapter
// answers with this machine's, which is what the core compares a stored runtime
// against.
func TestCatalogReportsTheHost(t *testing.T) {
	host, e := os.Hostname()
	if e != nil {
		t.Fatal(e)
	}
	if got := (Catalog{}).Machine(); got != host {
		t.Fatalf("machine = %q, want %q", got, host)
	}
}
