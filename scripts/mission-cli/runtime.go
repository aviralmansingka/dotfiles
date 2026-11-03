package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func gitText(cwd string, args ...string) (string, error) {
	b, e := exec.Command("git", append([]string{"-C", cwd}, args...)...).CombinedOutput()
	if e != nil {
		return "", problem("git_error", "%s: %s", strings.Join(args, " "), strings.TrimSpace(string(b)))
	}
	return strings.TrimSpace(string(b)), nil
}

func readBounded(path string, max int64) ([]byte, error) {
	f, e := os.Open(path)
	if e != nil {
		return nil, e
	}
	defer f.Close()
	b, e := io.ReadAll(io.LimitReader(f, max+1))
	if e != nil {
		return nil, e
	}
	if int64(len(b)) > max {
		return nil, problem("too_large", "evidence exceeds size limit")
	}
	return b, nil
}

func (s *Store) checkBinding(r Record, cwd, branch string) (string, error) {
	repo, e := s.repo(r.Mission.Repo)
	if e != nil {
		return "", e
	}
	common, e := gitCommon(repo.Bindings[machine()])
	if e != nil {
		return "", e
	}
	actual, e := gitCommon(cwd)
	if e != nil {
		return "", e
	}
	if common != actual {
		return "", problem("wrong_repository", "mission worktree must belong to the registered repository")
	}
	root, e := gitText(cwd, "rev-parse", "--show-toplevel")
	if e != nil {
		return "", e
	}
	root, e = filepath.EvalSymlinks(root)
	if e != nil {
		return "", e
	}
	gd, e := gitText(cwd, "rev-parse", "--absolute-git-dir")
	if e != nil {
		return "", e
	}
	gd, e = filepath.EvalSymlinks(gd)
	if e != nil {
		return "", e
	}
	if root != cwd || gd == common || branch == "" || branch == "main" || branch == "master" {
		return "", problem("isolated_worktree_required", "attach from the root of a non-main linked worktree")
	}
	all, e := s.list()
	if e != nil {
		return "", e
	}
	for _, other := range all {
		if other.Handle == r.Handle {
			continue
		}
		if b := other.State.Runtime; b != nil && b.Machine == machine() && b.Cwd == cwd {
			return "", problem("worktree_busy", "worktree belongs to mission %s", other.Handle)
		}
		for _, a := range other.State.Attempts {
			if active(a) && a.Cwd == cwd {
				return "", problem("worktree_busy", "worktree has active attempt %s", a.ID)
			}
		}
	}
	return common, nil
}

// missionBranch is the mission's branch. Slugs are validated as
// [a-z0-9]+(-[a-z0-9]+)*, so the name is a legal ref component; callers still
// confirm it with `git check-ref-format --branch` because the branch name is a
// durable, user-visible identity that other tooling matches on.
func missionBranch(slug string) string { return "mission/" + slug }

// ensureWorktree revives the mission checkout on its branch. A checkout that
// was removed from Herdr or deleted on disk stays registered in Git until a
// prune, and a plain add then fails with "missing but already registered
// worktree". The branch stays the mission's identity: never create a second
// branch or a second checkout here.
func ensureWorktree(checkout, cwd, branch string) error {
	if _, e := os.Stat(cwd); e == nil {
		top, te := gitText(cwd, "rev-parse", "--show-toplevel")
		real, re := filepath.EvalSymlinks(cwd)
		if te == nil && re == nil {
			if t, e := filepath.EvalSymlinks(top); e == nil && t == real {
				return nil
			}
		}
		// A leftover empty directory is safe to replace. Anything else may be
		// the user's data, so refuse to delete it.
		entries, e := os.ReadDir(cwd)
		if e != nil {
			return e
		}
		if len(entries) > 0 {
			return problem("worktree_invalid", "%s exists and is not the mission checkout; move it aside first", cwd)
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
		if strings.Contains(e.Error(), "already checked out") {
			return problem("worktree_in_use", "branch %s is checked out in another worktree; inspect that checkout instead of adding a second one", branch)
		}
		return e
	}
	return nil
}

// A mission keeps its worktree across steps, retries, and checkpoint revisions.
// Existing sessions can adopt their current linked worktree with --cwd.
func (s *Store) workspace(h, cwd, base, root string) (Record, error) {
	return s.mutate(h, func(r *Record) error {
		repo, e := s.repo(r.Mission.Repo)
		if e != nil {
			return e
		}
		checkout := repo.Bindings[machine()]
		if checkout == "" {
			return problem("no_checkout", "register this machine's repository checkout")
		}
		if b := r.State.Runtime; b != nil {
			if b.Machine != machine() {
				return problem("wrong_machine", "worktree is bound on %s", b.Machine)
			}
			// A closed Herdr workspace or a deleted checkout revives on the
			// recorded branch instead of failing the relaunch.
			if e = ensureWorktree(checkout, b.Cwd, b.Branch); e != nil {
				return e
			}
			if cwd != "" {
				p, e := filepath.EvalSymlinks(cwd)
				if e != nil {
					return e
				}
				if p != b.Cwd {
					return problem("worktree_mismatch", "mission is bound to %s", b.Cwd)
				}
			}
			branch, e := gitText(b.Cwd, "branch", "--show-current")
			if e != nil {
				return e
			}
			if branch != b.Branch {
				return problem("worktree_mismatch", "mission branch changed")
			}
			_, e = s.checkBinding(*r, b.Cwd, branch)
			return e
		}
		branch, baseCommit := "", ""
		if cwd == "" {
			base = fallback(base, "main")
			if _, e = gitText(checkout, "check-ref-format", "--branch", base); e != nil {
				return e
			}
			baseCommit, e = gitText(checkout, "rev-parse", "--verify", "refs/heads/"+base)
			if e != nil {
				return e
			}
			// Missions own mission/<slug>. The checkout lives in the shared Herdr
			// worktree root so the Herdr worktree registration (done by the Pi
			// extension) finds an existing linked worktree instead of creating one.
			branch = missionBranch(r.Mission.Slug)
			if _, e = gitText(checkout, "check-ref-format", "--branch", branch); e != nil {
				return problem("invalid_branch", "%s is not a valid git branch name for mission slug %s", branch, r.Mission.Slug)
			}
			if root == "" {
				home, _ := os.UserHomeDir()
				root = filepath.Join(home, ".herdr", "worktrees", r.Mission.Repo)
			}
			root, e = filepath.Abs(root)
			if e != nil {
				return e
			}
			cwd = filepath.Join(root, "mission-"+r.Mission.Slug)
			owner := s.Vault + ":" + h
			key := "branch." + branch + ".missionOwner"
			_, exists := gitText(checkout, "rev-parse", "--verify", "refs/heads/"+branch)
			if exists == nil {
				mark, _ := gitText(checkout, "config", "--get", key)
				if mark != owner {
					return problem("unowned_branch", "branch %s already exists without this mission's ownership marker", branch)
				}
				baseCommit, e = gitText(checkout, "rev-parse", "refs/heads/"+branch)
				if e != nil {
					return e
				}
			} else {
				if _, e = gitText(checkout, "branch", branch, base); e != nil {
					return e
				}
				if _, e = gitText(checkout, "config", key, owner); e != nil {
					return e
				}
			}
			if e = ensureWorktree(checkout, cwd, branch); e != nil {
				return e
			}
		}
		cwd, e = filepath.Abs(cwd)
		if e != nil {
			return e
		}
		cwd, e = filepath.EvalSymlinks(cwd)
		if e != nil {
			return e
		}
		actual, e := gitText(cwd, "branch", "--show-current")
		if e != nil {
			return e
		}
		if branch != "" && actual != branch {
			return problem("worktree_mismatch", "existing path is on another branch")
		}
		branch = actual
		common, e := s.checkBinding(*r, cwd, branch)
		if e != nil {
			return e
		}
		r.State.Runtime = &RuntimeBinding{Machine: machine(), Common: common, Cwd: cwd, Branch: branch, Base: base, BaseCommit: baseCommit}
		return nil
	})
}

func (s *Store) attachBinding(r *Record, p PiAttachment, cwd, branch string) error {
	common, e := s.checkBinding(*r, cwd, branch)
	if e != nil {
		return e
	}
	b := r.State.Runtime
	if b == nil {
		b = &RuntimeBinding{Machine: machine(), Common: common, Cwd: cwd, Branch: branch}
		r.State.Runtime = b
	}
	if b.Machine != machine() || b.Common != common || b.Cwd != cwd || b.Branch != branch {
		return problem("worktree_mismatch", "mission runtime binding differs from this worktree")
	}
	if b.SessionID != "" && b.SessionID != p.SessionID {
		return problem("session_owned", "worktree already belongs to session %s; resume that session", b.SessionID)
	}
	if b.LaunchID != "" && b.SessionID == "" && b.LaunchID != p.LaunchID {
		return problem("launch_pending", "attach with the pending launch id; do not launch a duplicate")
	}
	if b.SessionFile != "" && b.SessionFile != p.SessionFile {
		return problem("session_owned", "mission already records a different session file")
	}
	// Workspace identity is per mission worktree, not per repository: the Pi
	// extension registers each mission checkout as its own Herdr worktree
	// workspace, so two missions bound in one repository legitimately record
	// different workspaces. Missions recorded before that change still share the
	// repository's primary workspace, so the CLI accepts both shapes. The pane
	// cwd remains the real binding: checkBinding already refuses a worktree two
	// missions would share.
	b.SessionID, b.SessionFile, b.Workspace, b.Pane = p.SessionID, p.SessionFile, p.Workspace, p.Pane
	return nil
}

func validatePiSession(p *PiAttachment) error {
	if p.SessionID == "" || p.SessionFile == "" || p.Cwd == "" || p.Workspace == "" || p.Pane == "" || len(p.Token) < 32 {
		return problem("usage", "attach needs session-id, session-file, cwd, workspace, pane, and a private token of at least 32 characters")
	}
	var e error
	p.Cwd, e = filepath.Abs(p.Cwd)
	if e != nil {
		return e
	}
	p.Cwd, e = filepath.EvalSymlinks(p.Cwd)
	if e != nil {
		return e
	}
	p.SessionFile, e = filepath.Abs(p.SessionFile)
	if e != nil {
		return e
	}
	p.SessionFile, e = filepath.EvalSymlinks(p.SessionFile)
	if e != nil {
		return e
	}
	f, e := os.Open(p.SessionFile)
	if e != nil {
		return e
	}
	defer f.Close()
	scan := bufio.NewScanner(f)
	scan.Buffer(make([]byte, 4096), 65536)
	if !scan.Scan() {
		return problem("invalid_session", "Pi session file has no header")
	}
	var header struct{ Type, ID, Cwd string }
	if e = json.Unmarshal(scan.Bytes(), &header); e != nil || header.Type != "session" || header.ID != p.SessionID {
		return problem("invalid_session", "Pi header identity does not match")
	}
	actual, e := filepath.EvalSymlinks(header.Cwd)
	if e != nil || actual != p.Cwd {
		return problem("session_cwd_mismatch", "Pi session header must name the mission worktree")
	}
	return nil
}

func (s *Store) attach(h string, p PiAttachment) (Claim, error) {
	if e := validatePiSession(&p); e != nil {
		return Claim{}, e
	}
	// Replaying an attach recovers the same attempt, never a second writer.
	var c Claim
	var found bool
	e := s.locked(func() error {
		r, e := s.load(h)
		if e != nil {
			return e
		}
		if r.State.Active == "" {
			return nil
		}
		a, e := findAttempt(&r.State, r.State.Active)
		if e != nil {
			return e
		}
		if a.Execution != "pi" || a.SessionID != p.SessionID {
			return problem("session_owned", "an active attempt already owns this mission")
		}
		if e = authorize(a, p.Token); e != nil {
			return e
		}
		if e = s.attachBinding(&r, p, p.Cwd, a.Branch); e != nil {
			return e
		}
		r.State.Revision++
		if e = s.save(&r); e != nil {
			return e
		}
		c = s.piClaim(r, *a, p.Token)
		found = true
		return nil
	})
	if e != nil || found {
		return c, e
	}
	return s.claim(h, fallback(p.Agent, "mission-worker"), p.SessionID, p.Cwd, true, &p)
}

func (s *Store) piClaim(r Record, a Attempt, token string) Claim {
	d, _ := s.dir(r.Handle)
	return Claim{Handle: r.Handle, Step: attemptDefinition(r, a), Attempt: a, Token: token, Environment: map[string]string{
		"MISSION_VAULT": s.Vault, "MISSION_HANDLE": r.Handle, "MISSION_ATTEMPT": a.ID, "MISSION_TOKEN": token,
		"MISSION_ARTIFACT": filepath.Join(d, filepath.FromSlash(a.Artifact)), "MISSION_BRIEF": filepath.Join(d, "artifacts", fmt.Sprintf("%03d", a.Sequence), "brief.md"), "MISSION_STEP": a.Step,
	}}
}

func (s *Store) launch(h, file, launchID string) (map[string]any, error) {
	if file != "" {
		p, e := filepath.Abs(file)
		if e != nil {
			return nil, e
		}
		parent, e := filepath.EvalSymlinks(filepath.Dir(p))
		if e != nil {
			return nil, e
		}
		file = filepath.Join(parent, filepath.Base(p))
	}
	acquired := false
	r, e := s.mutate(h, func(r *Record) error {
		b := r.State.Runtime
		if b == nil {
			return problem("worktree_required", "prepare a mission workspace first")
		}
		if b.Machine != machine() {
			return problem("wrong_machine", "runtime belongs to another machine")
		}
		if file != "" {
			if launchID == "" || launchID != b.LaunchID {
				return problem("launch_mismatch", "launch receipt does not match the reserved intent")
			}
			if b.SessionFile != "" && b.SessionFile != file {
				return problem("session_owned", "another session is already recorded")
			}
			b.SessionFile = file
			return nil
		}
		if b.LaunchID == "" && b.SessionID == "" {
			if _, e := nextStep(r.Mission, r.State); e != nil {
				return e
			}
			b.LaunchID = uid("launch-")
			acquired = true
		}
		return nil
	})
	return map[string]any{"acquired": acquired, "runtime": r.State.Runtime}, e
}
