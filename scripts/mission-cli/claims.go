package main

import (
	"crypto/subtle"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func (s *Store) ready(repo string) ([]Work, error) {
	recs, e := s.list()
	if e != nil {
		return nil, e
	}
	out := []Work{}
	for _, r := range recs {
		if repo != "" && r.Mission.Repo != repo {
			continue
		}
		st, e := nextStep(r.Mission, r.State)
		if e != nil {
			continue
		}
		rr, e := s.repo(r.Mission.Repo)
		if e != nil {
			return nil, e
		}
		out = append(out, Work{Handle: r.Handle, Title: r.Mission.Title, Step: st, Goal: r.Mission.Goal, Cwd: rr.Bindings[machine()]})
	}
	return out, nil
}
func (s *Store) claim(h, agent, session, cwd string, managed bool, pi ...*PiAttachment) (Claim, error) {
	var claim Claim
	if agent == "" {
		return claim, problem("agent_required", "--agent identifies the claiming agent")
	}
	token := uid("claim-")
	var attachment *PiAttachment
	if len(pi) > 0 {
		attachment = pi[0]
		token = attachment.Token
	}
	r, e := s.mutate(h, func(r *Record) error {
		st, e := nextStep(r.Mission, r.State)
		if e != nil {
			return e
		}
		if st.Agent != "any" && agent != st.Agent {
			return problem("agent_mismatch", "%s expects agent %s", st.ID, st.Agent)
		}
		idx, _ := stepIndex(r.Mission, st.ID)
		if idx > 0 {
			prev := r.State.Steps[r.Mission.Steps[idx-1].ID]
			if a, e := findAttempt(&r.State, prev.Attempt); e == nil && len(a.Verifications) > 0 && !s.verified(*r, *a) {
				return problem("evidence_changed", "previous step's checked input or evidence changed; reset and rerun that step")
			}
		}
		d, _ := s.dir(h)
		b, e := os.ReadFile(filepath.Join(d, "mission.md"))
		if e != nil {
			return e
		}
		if digest(b) != r.State.SpecHash {
			return problem("brief_changed", "mission brief changed; explicit reconciliation required")
		}
		repo, e := s.repo(r.Mission.Repo)
		if e != nil {
			return e
		}
		if cwd == "" {
			cwd = repo.Bindings[machine()]
		}
		if cwd == "" {
			return problem("no_checkout", "register a checkout binding on this machine")
		}
		cwd, e = filepath.Abs(cwd)
		if e != nil {
			return e
		}
		cwd, e = filepath.EvalSymlinks(cwd)
		if e != nil {
			return e
		}
		branch := ""
		if r.State.Runtime != nil && r.State.Runtime.Machine != machine() {
			return problem("wrong_machine", "mission worktree is bound on %s", r.State.Runtime.Machine)
		}
		allBindings, e := s.list()
		if e != nil {
			return e
		}
		for _, other := range allBindings {
			if other.Handle != h && other.State.Runtime != nil && other.State.Runtime.Machine == machine() && other.State.Runtime.Cwd == cwd {
				return problem("worktree_busy", "worktree belongs to mission %s", other.Handle)
			}
		}
		if r.State.Runtime != nil && r.State.Runtime.Cwd != cwd {
			return problem("worktree_mismatch", "mission is bound to %s", r.State.Runtime.Cwd)
		}
		if r.State.Runtime != nil && r.State.Runtime.SessionID != "" && (attachment == nil || r.State.Runtime.SessionID != session) {
			return problem("session_owned", "mission worktree already has a durable Pi owner")
		}
		if r.Mission.Kind == "implementation" || attachment != nil {
			if !managed {
				return problem("managed_required", "writer missions require mission run so process exit is observed")
			}
			binding := repo.Bindings[machine()]
			a, e := gitCommon(binding)
			if e != nil {
				return e
			}
			b, e := gitCommon(cwd)
			if e != nil || a != b {
				return problem("wrong_repository", "writer cwd must belong to the registered repository")
			}
			o, e := exec.Command("git", "-C", cwd, "branch", "--show-current").Output()
			if e != nil {
				return e
			}
			branch = strings.TrimSpace(string(o))
			if branch == "" || branch == "main" || branch == "master" {
				return problem("isolated_worktree_required", "writer missions require an existing non-main worktree")
			}
			o, e = exec.Command("git", "-C", cwd, "rev-parse", "--absolute-git-dir").Output()
			if e != nil {
				return e
			}
			gd, e := filepath.EvalSymlinks(strings.TrimSpace(string(o)))
			if e != nil {
				return e
			}
			if gd == b {
				return problem("isolated_worktree_required", "use a linked worktree; the primary checkout is reserved")
			}
			o, e = exec.Command("git", "-C", cwd, "rev-parse", "--show-toplevel").Output()
			if e != nil {
				return e
			}
			cwd, e = filepath.EvalSymlinks(strings.TrimSpace(string(o)))
			if e != nil {
				return e
			}
			all, e := s.list()
			if e != nil {
				return e
			}
			for _, other := range all {
				if other.Handle != h && other.State.Runtime != nil && other.State.Runtime.Cwd == cwd {
					return problem("worktree_busy", "worktree belongs to mission %s", other.Handle)
				}
				for _, aa := range other.State.Attempts {
					if active(aa) && aa.Cwd == cwd {
						return problem("worktree_busy", "worktree already owned by active attempt %s", aa.ID)
					}
				}
			}
		}
		seq := len(r.State.Attempts) + 1
		artifact := filepath.ToSlash(filepath.Join("artifacts", fmt.Sprintf("%03d", seq), st.Output))
		if _, e = s.path(r.Mission.Repo, r.Mission.Slug, artifact); e != nil {
			return e
		}
		brief := filepath.Join(d, "artifacts", fmt.Sprintf("%03d", seq), "brief.md")
		if e = atomicWrite(brief, []byte(assignedBrief(r.Mission, st))); e != nil {
			return e
		}
		a := Attempt{ID: uid("attempt-"), Sequence: seq, Step: st.ID, Agent: agent, Status: "running", Started: now(), Updated: now(), Machine: machine(), SessionID: session, Cwd: cwd, Branch: branch, Managed: managed, TokenHash: digest([]byte(token)), SpecHash: r.State.SpecHash, Brief: r.Mission.Body, Artifact: artifact, Events: []Event{}}
		if attachment != nil {
			if e := s.attachBinding(r, *attachment, cwd, branch); e != nil {
				return e
			}
			a.Execution = "pi"
			a.SessionFile = attachment.SessionFile
		}
		a.Definition = &st
		a.Brief = assignedBrief(r.Mission, st)
		r.State.Attempts = append(r.State.Attempts, a)
		r.State.Active = a.ID
		r.State.Current = st.ID
		r.State.Status = "running"
		r.State.Steps[st.ID] = StepState{Status: "running", Attempt: a.ID}
		claim = Claim{Handle: h, Step: st, Attempt: a, Token: token, Environment: map[string]string{"MISSION_VAULT": s.Vault, "MISSION_HANDLE": h, "MISSION_ATTEMPT": a.ID, "MISSION_TOKEN": token, "MISSION_ARTIFACT": filepath.Join(d, filepath.FromSlash(artifact))}}
		claim.Environment["MISSION_BRIEF"] = brief
		claim.Environment["MISSION_STEP"] = st.ID
		exe, _ := os.Executable()
		claim.Environment["MISSION_BIN"] = exe
		return nil
	})
	_ = r
	return claim, e
}
func (s *Store) pickup(repo, agent, session, cwd string) (Claim, error) {
	if agent == "" {
		return Claim{}, problem("agent_required", "pickup requires --agent")
	}
	work, e := s.ready(repo)
	if e != nil {
		return Claim{}, e
	}
	for _, w := range work {
		r, e := s.load(w.Handle)
		if e != nil {
			return Claim{}, e
		}
		if r.Mission.Kind != "research" || (w.Step.Agent != "any" && w.Step.Agent != agent) {
			continue
		}
		c, e := s.claim(w.Handle, agent, session, cwd, false)
		if e == nil {
			return c, nil
		}
		if d, ok := e.(*DomainError); !ok || (d.Code != "busy" && d.Code != "checkpoint_pending" && d.Code != "complete") {
			return c, e
		}
	}
	return Claim{}, problem("no_work", "no ready research work matches this agent; writer missions use run with a worktree")
}
func gitCommon(p string) (string, error) {
	o, e := exec.Command("git", "-C", p, "rev-parse", "--path-format=absolute", "--git-common-dir").Output()
	if e != nil {
		return "", problem("invalid_repository", "%s is not a git checkout", p)
	}
	return filepath.EvalSymlinks(strings.TrimSpace(string(o)))
}
func authorize(a *Attempt, token string) error {
	if token == "" || subtle.ConstantTimeCompare([]byte(a.TokenHash), []byte(digest([]byte(token)))) != 1 {
		return problem("not_owner", "attempt token does not match; use the token returned by claim")
	}
	if a.Machine != machine() {
		return problem("foreign_host", "this attempt belongs to another host")
	}
	return nil
}
