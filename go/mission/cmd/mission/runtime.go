package main

import (
	"errors"
	"io"
	"os"
	"path/filepath"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

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
		return nil, mission.Problem("too_large", "evidence exceeds size limit")
	}
	return b, nil
}

// checkBinding is the binding policy: an attempt runs only inside a checkout of
// the registered repository, at the root of its own linked worktree, on a branch
// that is not the mainline, and no other mission or attempt writes there. It
// answers the repository's common Git directory that the binding records.
func (s *App) checkBinding(r mission.Record, cwd, branch string) (string, error) {
	repo, e := s.Repo.Repo(r.Mission.Repo)
	if e != nil {
		return "", e
	}
	common, e := s.Catalog.Common(repo.Bindings[s.Catalog.Machine()])
	if e != nil {
		return "", e
	}
	actual, e := s.Catalog.Common(cwd)
	if e != nil {
		return "", e
	}
	if common != actual {
		return "", mission.Problem("wrong_repository", "mission worktree must belong to the registered repository")
	}
	root, gitDir, e := s.Catalog.Checkout(cwd)
	if e != nil {
		return "", e
	}
	if root != cwd || gitDir == common || branch == "" || branch == "main" || branch == "master" {
		return "", mission.Problem("isolated_worktree_required", "attach from the root of a non-main linked worktree")
	}
	all, e := s.list()
	if e != nil {
		return "", e
	}
	for _, other := range all {
		if other.Handle == r.Handle {
			continue
		}
		if b := other.State.Runtime; b != nil && b.Machine == s.Catalog.Machine() && b.Cwd == cwd {
			return "", mission.Problem("worktree_busy", "worktree belongs to mission %s", other.Handle)
		}
		for _, a := range other.State.Attempts {
			if mission.Active(a) && a.Cwd == cwd {
				return "", mission.Problem("worktree_busy", "worktree has active attempt %s", a.ID)
			}
		}
	}
	return common, nil
}

// A mission keeps its worktree across steps, retries, and checkpoint revisions.
// Existing sessions can adopt their current linked worktree with --cwd.
func (s *App) workspace(h, cwd, base, root string) (mission.Record, error) {
	return s.update(h, func(r *mission.Record) error {
		if e := requireOpen(*r); e != nil {
			return e
		}
		repo, e := s.Repo.Repo(r.Mission.Repo)
		if e != nil {
			return e
		}
		checkout := repo.Bindings[s.Catalog.Machine()]
		if checkout == "" {
			return mission.Problem("no_checkout", "register this machine's repository checkout")
		}
		if b := r.State.Runtime; b != nil {
			if b.Machine != s.Catalog.Machine() {
				return mission.Problem("wrong_machine", "worktree is bound on %s", b.Machine)
			}
			// A closed Herdr workspace or a deleted checkout revives on the
			// recorded branch instead of failing the relaunch.
			if e = s.Worktrees.Ensure(checkout, b.Cwd, b.Branch); e != nil {
				return e
			}
			if cwd != "" {
				p, e := filepath.EvalSymlinks(cwd)
				if e != nil {
					return e
				}
				if p != b.Cwd {
					return mission.Problem("worktree_mismatch", "mission is bound to %s", b.Cwd)
				}
			}
			branch, e := s.Catalog.Branch(b.Cwd)
			if e != nil {
				return e
			}
			if branch != b.Branch {
				return mission.Problem("worktree_mismatch", "mission branch changed")
			}
			_, e = s.checkBinding(*r, b.Cwd, branch)
			return e
		}
		branch, baseCommit := "", ""
		if cwd == "" {
			base = platform.Fallback(base, "main")
			if e = s.Catalog.ValidBranch(checkout, base); e != nil {
				return e
			}
			baseCommit, e = s.Catalog.Ref(checkout, base)
			if e != nil {
				return e
			}
			// Missions own mission/<slug>. The checkout lives in the shared Herdr
			// worktree root so the Herdr worktree registration (done by the Pi
			// extension) finds an existing linked worktree instead of creating one.
			branch = mission.MissionBranch(r.Mission.Slug)
			if e = s.Catalog.ValidBranch(checkout, branch); e != nil {
				return mission.Problem("invalid_branch", "%s is not a valid git branch name for mission slug %s", branch, r.Mission.Slug)
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
			owner := s.Repo.VaultPath() + ":" + h
			claim := false // the branch is ours but its marker still needs writing
			if _, exists := s.Catalog.Ref(checkout, branch); exists == nil {
				mark, _ := s.Catalog.Owner(checkout, branch)
				if mark != owner {
					// The checkout already sitting at the mission path is this
					// mission's work in practice: adopt it and record the marker a
					// fresh binding would have written instead of refusing.
					state, e := s.Catalog.State(cwd, branch)
					if e != nil {
						return e
					}
					switch state {
					case mission.CheckoutSame, mission.CheckoutDetached:
						claim = true
					case mission.CheckoutDirty:
						return mission.Problem("worktree_dirty", "%s has a detached HEAD with uncommitted changes; commit or stash them before adopting %s", cwd, branch)
					case mission.CheckoutOther:
						head, _ := s.Catalog.Branch(cwd)
						return mission.Problem("worktree_mismatch", "%s is on branch %s, not %s; move it aside first", cwd, platform.Fallback(head, "a detached HEAD"), branch)
					default:
						other, e := s.Catalog.Holder(checkout, branch)
						if e != nil {
							return e
						}
						if other != "" {
							return mission.Problem("worktree_in_use", "branch %s is checked out at %s; inspect that checkout instead of adding a second one", branch, other)
						}
						if _, e := os.Stat(cwd); e == nil {
							return mission.Problem("worktree_invalid", "%s exists and is not the mission checkout; move it aside first", cwd)
						}
						return mission.Problem("unowned_branch", "branch %s already exists without this mission's ownership marker", branch)
					}
				}
				baseCommit, e = s.Catalog.Ref(checkout, branch)
				if e != nil {
					return e
				}
			} else {
				if e = s.Worktrees.CreateBranch(checkout, branch, base); e != nil {
					return e
				}
				if e = s.Worktrees.MarkOwner(checkout, branch, owner); e != nil {
					return e
				}
			}
			if e = s.Worktrees.Ensure(checkout, cwd, branch); e != nil {
				return e
			}
			if claim {
				if e = s.Worktrees.MarkOwner(checkout, branch, owner); e != nil {
					return e
				}
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
		actual, e := s.Catalog.Branch(cwd)
		if e != nil {
			return e
		}
		if branch != "" && actual != branch {
			return mission.Problem("worktree_mismatch", "existing path is on another branch")
		}
		branch = actual
		common, e := s.checkBinding(*r, cwd, branch)
		if e != nil {
			return e
		}
		r.State.Runtime = &mission.RuntimeBinding{Machine: s.Catalog.Machine(), Common: common, Cwd: cwd, Branch: branch, Base: base, BaseCommit: baseCommit}
		return nil
	})
}

func (s *App) attachBinding(r *mission.Record, p mission.PiAttachment, cwd, branch string) error {
	common, e := s.checkBinding(*r, cwd, branch)
	if e != nil {
		return e
	}
	b := r.State.Runtime
	if b == nil {
		b = &mission.RuntimeBinding{Machine: s.Catalog.Machine(), Common: common, Cwd: cwd, Branch: branch}
		r.State.Runtime = b
	}
	if b.Machine != s.Catalog.Machine() || b.Common != common || b.Cwd != cwd || b.Branch != branch {
		return mission.Problem("worktree_mismatch", "mission runtime binding differs from this worktree")
	}
	if b.SessionID != "" && b.SessionID != p.SessionID {
		return mission.Problem("session_owned", "worktree already belongs to session %s; resume that session", b.SessionID)
	}
	if b.LaunchID != "" && b.SessionID == "" && b.LaunchID != p.LaunchID {
		return mission.Problem("launch_pending", "attach with the pending launch id; do not launch a duplicate")
	}
	if b.SessionFile != "" && b.SessionFile != p.SessionFile {
		return mission.Problem("session_owned", "mission already records a different session file")
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

// validatePiSession is the attachment policy: a named session, in a session file
// whose header names that same session and the worktree it claims.
func (s *App) validatePiSession(p *mission.PiAttachment) error {
	if p.SessionID == "" || p.SessionFile == "" || p.Cwd == "" || p.Workspace == "" || p.Pane == "" || len(p.Token) < 32 {
		return mission.Problem("usage", "attach needs session-id, session-file, cwd, workspace, pane, and a private token of at least 32 characters")
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
	h, e := s.Catalog.SessionHeader(p.SessionFile)
	if e != nil {
		return e
	}
	if errors.Is(h.HeaderErr, io.EOF) {
		return mission.Problem("invalid_session", "Pi session file has no header")
	}
	if h.HeaderErr != nil || h.Type != "session" || h.ID != p.SessionID {
		return mission.Problem("invalid_session", "Pi header identity does not match")
	}
	actual, e := filepath.EvalSymlinks(h.Cwd)
	if e != nil || actual != p.Cwd {
		return mission.Problem("session_cwd_mismatch", "Pi session header must name the mission worktree")
	}
	return nil
}

func (s *App) attach(h string, p mission.PiAttachment) (mission.Claim, error) {
	if r, e := s.load(h); e != nil {
		return mission.Claim{}, e
	} else if e = requireOpen(r); e != nil {
		return mission.Claim{}, e
	}
	if e := s.validatePiSession(&p); e != nil {
		return mission.Claim{}, e
	}
	// Replaying an attach recovers the same attempt, never a second writer.
	var c mission.Claim
	var found bool
	_, e := s.update(h, func(r *mission.Record) error {
		if e := requireOpen(*r); e != nil {
			return e
		}
		if r.State.Active == "" {
			return mission.ErrNoWrite
		}
		a, e := mission.FindAttempt(&r.State, r.State.Active)
		if e != nil {
			return e
		}
		if a.Execution != "pi" || a.SessionID != p.SessionID {
			return mission.Problem("session_owned", "an active attempt already owns this mission; resume that session, or run mission repair %s if its session is gone", h)
		}
		if e = authorize(a, p.Token); e != nil {
			return e
		}
		if e = s.attachBinding(r, p, p.Cwd, a.Branch); e != nil {
			return e
		}
		c, e = s.emitClaim(*r, *a, p.Token)
		if e != nil {
			return e
		}
		found = true
		return nil
	})
	if e != nil || found {
		return c, e
	}
	return s.claim(h, platform.Fallback(p.Agent, "mission-worker"), p.SessionID, p.Cwd, true, &p)
}

// release drops one launch intent that its adapter could not use, so a later
// launch may reserve again. A recorded session or session file keeps the
// intent: a live owner is never taken over, and an intent this call did not
// reserve is never released.
func (s *App) release(h, launchID string) (map[string]any, error) {
	released := false
	r, e := s.update(h, func(r *mission.Record) error {
		if e := requireOpen(*r); e != nil {
			return e
		}
		b := r.State.Runtime
		if b == nil {
			return mission.Problem("worktree_required", "prepare a mission workspace first")
		}
		if launchID == "" {
			return mission.Problem("usage", "release needs the launch id of the failed intent")
		}
		if b.SessionID != "" || b.SessionFile != "" {
			return mission.Problem("session_owned", "mission already records a session; resume it instead of launching again")
		}
		if b.LaunchID == "" || b.LaunchID != launchID {
			return mission.Problem("launch_mismatch", "launch intent does not match the reservation")
		}
		b.LaunchID = ""
		released = true
		return nil
	})
	return map[string]any{"released": released, "runtime": r.State.Runtime}, e
}

// ack records that an adapter deployed the mission its plan described. The ack
// token is derived, so a reader finds the same token in the plan and in the
// record; it is never written as the launch intent, because the intent is the
// reservation a captain consumes, not a value a plan can derive. A second ack
// writes nothing and says so, so a repeated deploy is harmless.
func (s *App) ack(h string) (map[string]any, error) {
	acknowledged, token := false, ""
	r, e := s.update(h, func(r *mission.Record) error {
		if e := requireOpen(*r); e != nil {
			return e
		}
		b := r.State.Runtime
		if b == nil {
			return mission.Problem("worktree_required", "prepare a mission workspace first")
		}
		token = ackToken(s.Repo.VaultPath(), h, b.Branch)
		if b.LaunchAck == "" {
			acknowledged = true
			b.LaunchAck = token
		}
		return nil
	})
	if e != nil {
		return nil, e
	}
	return map[string]any{"acknowledged": acknowledged, "ack": token, "runtime": r.State.Runtime}, nil
}

// launch reserves one launch intent, or records the session file an adapter got.
func (s *App) launch(h, file, launchID string) (map[string]any, error) {
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
	r, e := s.update(h, func(r *mission.Record) error {
		if e := requireOpen(*r); e != nil {
			return e
		}
		b := r.State.Runtime
		if b == nil {
			return mission.Problem("worktree_required", "prepare a mission workspace first")
		}
		if b.Machine != s.Catalog.Machine() {
			return mission.Problem("wrong_machine", "runtime belongs to another machine")
		}
		if file != "" {
			if launchID == "" || launchID != b.LaunchID {
				return mission.Problem("launch_mismatch", "launch receipt does not match the reserved intent")
			}
			if b.SessionFile != "" && b.SessionFile != file {
				return mission.Problem("session_owned", "another session is already recorded")
			}
			b.SessionFile = file
			return nil
		}
		if b.LaunchID == "" && b.SessionID == "" {
			if _, e := mission.NextStep(r.Mission, r.State); e != nil {
				return e
			}
			b.LaunchID = mission.UID("launch-")
			acquired = true
		}
		return nil
	})
	return map[string]any{"acquired": acquired, "runtime": r.State.Runtime}, e
}
