// Package gitworktree is the mission catalog and the mission worktree commands
// as this machine answers them with Git.
//
// It owns every Git fact the core cannot decide for itself: the repository a
// path belongs to, the root and Git directory of a checkout, the branch a
// checkout has, how an existing path relates to a mission branch, the worktree
// that already holds a branch, the refs and branch names Git is asked about, and
// the ownership marker a branch carries. It also owns the two commands that
// create and keep a mission checkout.
//
// The core owns every policy: which branch a mission owns, where its checkout
// lives, what the ownership marker says, when a checkout may be adopted, and the
// code and text of every refusal.
package gitworktree

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

// Catalog answers the Git and host facts a mission binds a worktree on.
type Catalog struct{}

// Workspace runs the Git commands that create a mission branch and keep its
// checkout.
type Workspace struct{}

// gitText runs one Git command in cwd and returns its trimmed output. A failure
// reports the command and Git's own words, so a caller never has to re-run the
// command to explain it.
func gitText(cwd string, args ...string) (string, error) {
	b, e := exec.Command("git", append([]string{"-C", cwd}, args...)...).CombinedOutput()
	if e != nil {
		return "", mission.Problem("git_error", "%s: %s", strings.Join(args, " "), strings.TrimSpace(string(b)))
	}
	return strings.TrimSpace(string(b)), nil
}

// gitCommon is the repository's common Git directory, which every worktree of
// that repository shares. It answers invalid_repository for a path that is not a
// Git checkout at all, because that is the one fact every binding starts from.
func gitCommon(p string) (string, error) {
	o, e := exec.Command("git", "-C", p, "rev-parse", "--path-format=absolute", "--git-common-dir").Output()
	if e != nil {
		return "", mission.Problem("invalid_repository", "%s is not a git checkout", p)
	}
	return filepath.EvalSymlinks(strings.TrimSpace(string(o)))
}

// Common is gitCommon.
func (Catalog) Common(cwd string) (string, error) { return gitCommon(cwd) }

// Branch is the branch a checkout has, and "" at a detached HEAD.
func (Catalog) Branch(cwd string) (string, error) {
	return gitText(cwd, "branch", "--show-current")
}

// Ref is one local branch's commit id. The ref is named in full, so a tag or a
// file of the same name can never answer instead.
func (Catalog) Ref(checkout, name string) (string, error) {
	return gitText(checkout, "rev-parse", "--verify", "refs/heads/"+name)
}

// ValidBranch is Git's verdict on one branch name.
func (Catalog) ValidBranch(checkout, name string) error {
	_, e := gitText(checkout, "check-ref-format", "--branch", name)
	return e
}

// Checkout is the root of cwd's working tree and the Git directory that
// checkout uses, both symlink-resolved. The two paths are what tell a linked
// worktree from the primary checkout.
func (Catalog) Checkout(cwd string) (string, string, error) {
	root, e := gitText(cwd, "rev-parse", "--show-toplevel")
	if e != nil {
		return "", "", e
	}
	root, e = filepath.EvalSymlinks(root)
	if e != nil {
		return "", "", e
	}
	gd, e := gitText(cwd, "rev-parse", "--absolute-git-dir")
	if e != nil {
		return "", "", e
	}
	gd, e = filepath.EvalSymlinks(gd)
	if e != nil {
		return "", "", e
	}
	return root, gd, nil
}

// Owner is the ownership marker a branch carries, and "" when it carries none.
// The marker is a Git config entry under the branch's own name, so a pruned
// branch never leaves an owner behind for a later mission to inherit.
func (Catalog) Owner(checkout, branch string) (string, error) {
	return gitText(checkout, "config", "--get", "branch."+branch+".missionOwner")
}

// State classifies an existing path against the mission branch without touching
// its working tree.
func (Catalog) State(cwd, branch string) (mission.CheckoutState, error) {
	return checkoutState(cwd, branch), nil
}

// Holder is the checkout that has branch checked out, and "" when the branch is
// free.
func (Catalog) Holder(checkout, branch string) (string, error) {
	return branchWorktree(checkout, branch)
}

// Machine is the host name that binds a record to one machine.
func (Catalog) Machine() string { return platform.Machine() }

// CreateBranch creates one branch at one base.
func (Workspace) CreateBranch(checkout, branch, base string) error {
	_, e := gitText(checkout, "branch", branch, base)
	return e
}

// MarkOwner records which mission owns a branch. The key is Git's config form of
// the branch name, so the marker travels with the branch and no second registry
// can drift from it.
func (Workspace) MarkOwner(checkout, branch, owner string) error {
	_, e := gitText(checkout, "config", "branch."+branch+".missionOwner", owner)
	return e
}

// Ensure is ensureWorktree.
func (Workspace) Ensure(checkout, cwd, branch string) error {
	return ensureWorktree(checkout, cwd, branch)
}

// checkoutBranch reports the branch checked out at cwd when cwd is the root of
// its own Git checkout. A detached HEAD reports "", and an error means cwd is
// not a checkout at all.
func checkoutBranch(cwd string) (string, error) {
	top, e := gitText(cwd, "rev-parse", "--show-toplevel")
	if e != nil {
		return "", e
	}
	real, e := filepath.EvalSymlinks(cwd)
	if e != nil {
		return "", e
	}
	t, e := filepath.EvalSymlinks(top)
	if e != nil {
		return "", e
	}
	if t != real {
		return "", mission.Problem("worktree_invalid", "%s is not the root of its own checkout", cwd)
	}
	return gitText(cwd, "branch", "--show-current")
}

// branchWorktree reports the checkout that has branch checked out, and "" when
// the branch is free. A branch has at most one worktree; a second checkout
// would mean a second writer, so callers report it instead of creating one.
func branchWorktree(checkout, branch string) (string, error) {
	out, e := gitText(checkout, "worktree", "list", "--porcelain")
	if e != nil {
		return "", e
	}
	dir := ""
	for _, line := range strings.Split(out, "\n") {
		if p, ok := strings.CutPrefix(line, "worktree "); ok {
			dir = p
			continue
		}
		if dir != "" && line == "branch refs/heads/"+branch {
			return dir, nil
		}
	}
	return "", nil
}

// checkoutState classifies an existing path against the mission branch without
// touching the working tree.
func checkoutState(cwd, branch string) mission.CheckoutState {
	head, e := checkoutBranch(cwd)
	if e != nil {
		return mission.CheckoutNone
	}
	if head != "" {
		if head == branch {
			return mission.CheckoutSame
		}
		return mission.CheckoutOther
	}
	tip, e := gitText(cwd, "rev-parse", "--verify", "refs/heads/"+branch)
	if e != nil {
		return mission.CheckoutOther
	}
	at, e := gitText(cwd, "rev-parse", "HEAD")
	if e != nil || at != tip {
		return mission.CheckoutOther
	}
	dirty, e := gitText(cwd, "status", "--porcelain")
	if e != nil {
		return mission.CheckoutOther
	}
	if dirty != "" {
		return mission.CheckoutDirty
	}
	return mission.CheckoutDetached
}

// ensureWorktree keeps an existing mission checkout, or revives a deleted one.
// A checkout that was removed from Herdr or deleted on disk stays registered in
// Git until a prune, and a plain add then fails with "missing but already
// registered worktree". The branch stays the mission's identity: never create a
// second branch or a second checkout, and never switch a checkout that carries
// someone else's work.
func ensureWorktree(checkout, cwd, branch string) error {
	if _, e := os.Stat(cwd); e == nil {
		switch checkoutState(cwd, branch) {
		case mission.CheckoutSame:
			return nil
		case mission.CheckoutDetached:
			// The detached HEAD already is the branch tip, so carrying the
			// checkout over to its branch moves no work.
			_, e := gitText(cwd, "checkout", branch)
			return e
		case mission.CheckoutDirty:
			return mission.Problem("worktree_dirty", "%s has a detached HEAD with uncommitted changes; commit or stash them before adopting %s", cwd, branch)
		case mission.CheckoutOther:
			head, _ := checkoutBranch(cwd)
			return mission.Problem("worktree_mismatch", "%s is on branch %s, not %s; move it aside first", cwd, platform.Fallback(head, "a detached HEAD"), branch)
		}
		// A leftover empty directory is safe to replace. Anything else may be
		// the user's data, so refuse to delete it.
		entries, e := os.ReadDir(cwd)
		if e != nil {
			return e
		}
		if len(entries) > 0 {
			return mission.Problem("worktree_invalid", "%s exists and is not the mission checkout; move it aside first", cwd)
		}
		if e = os.RemoveAll(cwd); e != nil {
			return e
		}
	} else if !os.IsNotExist(e) {
		return e
	}
	if _, e := gitText(checkout, "worktree", "prune"); e != nil {
		return e
	}
	if e := os.MkdirAll(filepath.Dir(cwd), 0700); e != nil {
		return e
	}
	if _, e := gitText(checkout, "worktree", "add", cwd, branch); e != nil {
		// Git versions phrase this two ways: "already checked out" and
		// "is already used by worktree". Both mean the branch has an owner.
		msg := e.Error()
		if strings.Contains(msg, "already checked out") || strings.Contains(msg, "already used by worktree") {
			return mission.Problem("worktree_in_use", "branch %s is checked out in another worktree; inspect that checkout instead of adding a second one", branch)
		}
		return e
	}
	return nil
}
