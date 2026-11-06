package main

import (
	"testing"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

// fakeCatalog answers the catalog port from a table, so a core policy case runs
// without a Git repository and can answer for a second host. Every field is keyed
// by the path or the branch the core asks about.
type fakeCatalog struct {
	machine string                           // the host every binding is judged against
	common  map[string]string                // repository common directory, by path
	root    map[string]string                // checkout root, by path
	gitDir  map[string]string                // checkout Git directory, by path
	branch  map[string]string                // checked-out branch, by path
	state   map[string]mission.CheckoutState // existing-path state, by path
	holder  map[string]string                // worktree holding a branch, by branch
	refs    map[string]string                // commit of a local branch, by branch
	owners  map[string]string                // ownership marker, by branch
}

func (f fakeCatalog) Common(cwd string) (string, error) {
	if c, ok := f.common[cwd]; ok {
		return c, nil
	}
	return "", mission.Problem("invalid_repository", "%s is not a git checkout", cwd)
}

func (f fakeCatalog) Branch(cwd string) (string, error) { return f.branch[cwd], nil }

func (f fakeCatalog) State(cwd, branch string) (mission.CheckoutState, error) {
	return f.state[cwd], nil
}

func (f fakeCatalog) Holder(checkout, branch string) (string, error) { return f.holder[branch], nil }

func (f fakeCatalog) Ref(checkout, name string) (string, error) {
	if c, ok := f.refs[name]; ok {
		return c, nil
	}
	return "", mission.Problem("git_error", "rev-parse --verify refs/heads/%s: missing", name)
}

func (f fakeCatalog) ValidBranch(checkout, name string) error { return nil }

func (f fakeCatalog) Checkout(cwd string) (string, string, error) {
	root, ok := f.root[cwd]
	if !ok {
		return "", "", mission.Problem("git_error", "rev-parse --show-toplevel: not a checkout")
	}
	return root, f.gitDir[cwd], nil
}

func (f fakeCatalog) Owner(checkout, branch string) (string, error) { return f.owners[branch], nil }

func (f fakeCatalog) SessionHeader(file string) (mission.SessionHeader, error) {
	return mission.SessionHeader{}, nil
}

func (f fakeCatalog) Machine() string { return f.machine }

// TestCheckBindingKeepsItsPolicyOrder pins the binding decisions the core still
// owns, and the order it asks them in: the repository first, then the checkout
// shape, then the writers. A fake catalog answers the facts, so the case needs no
// Git repository at all.
func TestCheckBindingKeepsItsPolicyOrder(t *testing.T) {
	s, h := fixture(t)
	r, e := s.load(h)
	must(t, e)
	repo, e := s.Repo.Repo("dotfiles")
	must(t, e)
	binding := repo.Bindings[platform.Machine()]
	cwd := "/checkouts/mission-order"
	f := fakeCatalog{
		machine: platform.Machine(),
		common:  map[string]string{binding: "/repo/.git", cwd: "/other/.git"},
		root:    map[string]string{cwd: cwd},
		gitDir:  map[string]string{cwd: "/repo/.git/worktrees/mission-order"},
	}
	// Another repository is refused before the checkout shape is even asked for.
	s.Catalog = f
	if _, e := s.checkBinding(r, cwd, "mission/order"); e != nil {
		wantCode(t, e, "wrong_repository")
	}
	// The right repository, but not the root of its own checkout.
	f.common[cwd] = "/repo/.git"
	f.root[cwd] = "/checkouts"
	if _, e := s.checkBinding(r, cwd, "mission/order"); e != nil {
		wantCode(t, e, "isolated_worktree_required")
	}
	// The right root, but the primary checkout instead of a linked worktree.
	f.root[cwd] = cwd
	f.gitDir[cwd] = "/repo/.git"
	if _, e := s.checkBinding(r, cwd, "mission/order"); e != nil {
		wantCode(t, e, "isolated_worktree_required")
	}
	// A linked worktree on a detached HEAD or on the mainline is not isolated.
	f.gitDir[cwd] = "/repo/.git/worktrees/mission-order"
	if _, e := s.checkBinding(r, cwd, ""); e != nil {
		wantCode(t, e, "isolated_worktree_required")
	}
	if _, e := s.checkBinding(r, cwd, "main"); e != nil {
		wantCode(t, e, "isolated_worktree_required")
	}
	// A linked worktree on the mission branch is the checkout a mission binds to.
	if common, e := s.checkBinding(r, cwd, "mission/order"); e != nil || common != "/repo/.git" {
		t.Fatalf("binding = %q %v, want the repository's common directory", common, e)
	}
	// A second mission that records this checkout is a second writer.
	other := addMission(t, s, "other-mission")
	_, e = s.mutate(other, func(r *mission.Record) error {
		r.State.Runtime = &mission.RuntimeBinding{Machine: platform.Machine(), Common: "/repo/.git", Cwd: cwd, Branch: "mission/other-mission"}
		return nil
	})
	must(t, e)
	if _, e := s.checkBinding(r, cwd, "mission/order"); e != nil {
		wantCode(t, e, "worktree_busy")
	}
	// So is another mission's running attempt, even without a runtime binding.
	third := addMission(t, s, "attempt-mission")
	_, e = s.mutate(third, func(r *mission.Record) error {
		r.State.Attempts = []mission.Attempt{{ID: "attempt-other", Status: "running", Cwd: cwd}}
		return nil
	})
	must(t, e)
	if _, e := s.checkBinding(r, cwd, "mission/order"); e != nil {
		wantCode(t, e, "worktree_busy")
	}
}

// TestTheCoreBindsAndRefusesByTheCatalogMachine pins the host the core records
// and compares: it comes from the catalog, so one host can answer for another
// without a second machine.
func TestTheCoreBindsAndRefusesByTheCatalogMachine(t *testing.T) {
	s, h := fixture(t)
	s.Catalog = fakeCatalog{machine: "other-host"}
	c, e := s.claim(h, "scout", "session-other", t.TempDir(), false)
	must(t, e)
	r, e := s.load(h)
	must(t, e)
	if a := r.State.Attempts[0]; a.ID != c.Attempt.ID || a.Machine != "other-host" {
		t.Fatalf("attempt machine = %q, want other-host", a.Machine)
	}
	// A runtime bound to a third host is refused by the same port.
	second, h2 := fixture(t)
	second.Catalog = fakeCatalog{machine: "other-host"}
	_, e = second.mutate(h2, func(r *mission.Record) error {
		r.State.Runtime = &mission.RuntimeBinding{Machine: "third-host", Cwd: "/checkouts/mission-third", Branch: "mission/third"}
		return nil
	})
	must(t, e)
	if _, e := second.launch(h2, "", ""); e != nil {
		wantCode(t, e, "wrong_machine")
	}
}
