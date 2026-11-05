package main

import (
	"crypto/subtle"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

func (s *App) ready(repo string) ([]mission.Work, error) {
	recs, e := s.list()
	if e != nil {
		return nil, e
	}
	out := []mission.Work{}
	for _, r := range recs {
		if repo != "" && r.Mission.Repo != repo {
			continue
		}
		// A closed mission is retired work: `/cleanup` closed its record, so it
		// never appears as ready work again.
		if r.State.Status == closedStatus {
			continue
		}
		st, e := mission.NextStep(r.Mission, r.State)
		if e != nil {
			continue
		}
		rr, e := s.Repo.Repo(r.Mission.Repo)
		if e != nil {
			return nil, e
		}
		out = append(out, mission.Work{Handle: r.Handle, Title: r.Mission.Title, Step: st, Goal: r.Mission.Goal, Cwd: rr.Bindings[platform.Machine()]})
	}
	return out, nil
}
func (s *App) claim(h, agent, session, cwd string, managed bool, pi ...*mission.PiAttachment) (mission.Claim, error) {
	var claim mission.Claim
	if agent == "" {
		return claim, mission.Problem("agent_required", "--agent identifies the claiming agent")
	}
	token := mission.UID("claim-")
	var attachment *mission.PiAttachment
	if len(pi) > 0 {
		attachment = pi[0]
		token = attachment.Token
	}
	r, e := s.update(h, func(r *mission.Record) error {
		if e := requireOpen(*r); e != nil {
			return e
		}
		st, e := mission.NextStep(r.Mission, r.State)
		if e != nil {
			return e
		}
		if st.Agent != "any" && agent != st.Agent {
			return mission.Problem("agent_mismatch", "%s expects agent %s", st.ID, st.Agent)
		}
		idx, _ := stepIndex(r.Mission, st.ID)
		if idx > 0 {
			prev := r.State.Steps[r.Mission.Steps[idx-1].ID]
			if a, e := mission.FindAttempt(&r.State, prev.Attempt); e == nil && len(a.Verifications) > 0 && !s.verified(*r, *a) {
				return mission.Problem("evidence_changed", "previous step's checked input or evidence changed; reset and rerun that step")
			}
		}
		d, _ := s.Repo.Dir(h)
		b, e := os.ReadFile(filepath.Join(d, "mission.md"))
		if e != nil {
			return e
		}
		if mission.Digest(b) != r.State.SpecHash {
			return mission.Problem("brief_changed", "mission brief changed; explicit reconciliation required")
		}
		repo, e := s.Repo.Repo(r.Mission.Repo)
		if e != nil {
			return e
		}
		if cwd == "" {
			cwd = repo.Bindings[platform.Machine()]
		}
		if cwd == "" {
			return mission.Problem("no_checkout", "register a checkout binding on this machine")
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
		if r.State.Runtime != nil && r.State.Runtime.Machine != platform.Machine() {
			return mission.Problem("wrong_machine", "mission worktree is bound on %s", r.State.Runtime.Machine)
		}
		allBindings, e := s.list()
		if e != nil {
			return e
		}
		for _, other := range allBindings {
			if other.Handle != h && other.State.Runtime != nil && other.State.Runtime.Machine == platform.Machine() && other.State.Runtime.Cwd == cwd {
				return mission.Problem("worktree_busy", "worktree belongs to mission %s", other.Handle)
			}
		}
		if r.State.Runtime != nil && r.State.Runtime.Cwd != cwd {
			return mission.Problem("worktree_mismatch", "mission is bound to %s", r.State.Runtime.Cwd)
		}
		if r.State.Runtime != nil && r.State.Runtime.SessionID != "" && (attachment == nil || r.State.Runtime.SessionID != session) {
			return mission.Problem("session_owned", "mission worktree already has a durable Pi owner")
		}
		if r.Mission.Kind == "implementation" || attachment != nil {
			if !managed {
				return mission.Problem("managed_required", "writer missions require mission run so process exit is observed")
			}
			binding := repo.Bindings[platform.Machine()]
			a, e := gitCommon(binding)
			if e != nil {
				return e
			}
			b, e := gitCommon(cwd)
			if e != nil || a != b {
				return mission.Problem("wrong_repository", "writer cwd must belong to the registered repository")
			}
			o, e := exec.Command("git", "-C", cwd, "branch", "--show-current").Output()
			if e != nil {
				return e
			}
			branch = strings.TrimSpace(string(o))
			if branch == "" || branch == "main" || branch == "master" {
				return mission.Problem("isolated_worktree_required", "writer missions require an existing non-main worktree")
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
				return mission.Problem("isolated_worktree_required", "use a linked worktree; the primary checkout is reserved")
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
					return mission.Problem("worktree_busy", "worktree belongs to mission %s", other.Handle)
				}
				for _, aa := range other.State.Attempts {
					if mission.Active(aa) && aa.Cwd == cwd {
						return mission.Problem("worktree_busy", "worktree already owned by active attempt %s", aa.ID)
					}
				}
			}
		}
		seq := len(r.State.Attempts) + 1
		artifact := filepath.ToSlash(filepath.Join("artifacts", fmt.Sprintf("%03d", seq), st.Output))
		if _, e = s.Repo.Path(r.Mission.Repo, r.Mission.Slug, artifact); e != nil {
			return e
		}
		a := mission.Attempt{ID: mission.UID("attempt-"), Sequence: seq, Step: st.ID, Agent: agent, Status: "running", Started: mission.Now(), Updated: mission.Now(), Machine: platform.Machine(), SessionID: session, Cwd: cwd, Branch: branch, Managed: managed, TokenHash: mission.Digest([]byte(token)), SpecHash: r.State.SpecHash, Brief: r.Mission.Body, Artifact: artifact, Events: []mission.Event{}}
		if attachment != nil {
			if e := s.attachBinding(r, *attachment, cwd, branch); e != nil {
				return e
			}
			a.Execution = "pi"
			a.SessionFile = attachment.SessionFile
		}
		a.Definition = &st
		// The snapshot stays the step definition alone: the attempt line the
		// seat reads is rendered from this record, never stored here.
		a.Brief = assignedBrief(r.Mission, st)
		// One version event per attempt: the build that claims and the Herdr it
		// runs on, read here so a later reader never has to infer either from
		// timing.
		a.Events = append(a.Events, mission.Event{ID: mission.UID("event-"), Type: "version", At: mission.Now(), Tool: "mission", Summary: versionSummary(herdrVersionRead())})
		r.State.Attempts = append(r.State.Attempts, a)
		r.State.Active = a.ID
		r.State.Current = st.ID
		r.State.Status = "running"
		r.State.Steps[st.ID] = mission.StepState{Status: "running", Attempt: a.ID}
		claim, e = s.emitClaim(*r, a, token)
		if e != nil {
			return e
		}
		exe, _ := os.Executable()
		claim.Environment["MISSION_BIN"] = exe
		return nil
	})
	_ = r
	return claim, e
}
func (s *App) pickup(repo, agent, session, cwd string) (mission.Claim, error) {
	if agent == "" {
		return mission.Claim{}, mission.Problem("agent_required", "pickup requires --agent")
	}
	work, e := s.ready(repo)
	if e != nil {
		return mission.Claim{}, e
	}
	for _, w := range work {
		r, e := s.load(w.Handle)
		if e != nil {
			return mission.Claim{}, e
		}
		if r.Mission.Kind != "research" || (w.Step.Agent != "any" && w.Step.Agent != agent) {
			continue
		}
		c, e := s.claim(w.Handle, agent, session, cwd, false)
		if e == nil {
			return c, nil
		}
		if d, ok := e.(*mission.DomainError); !ok || (d.Code != "busy" && d.Code != "checkpoint_pending" && d.Code != "review_pending" && d.Code != "complete") {
			return c, e
		}
	}
	return mission.Claim{}, mission.Problem("no_work", "no ready research work matches this agent; writer missions use run with a worktree")
}
func gitCommon(p string) (string, error) {
	o, e := exec.Command("git", "-C", p, "rev-parse", "--path-format=absolute", "--git-common-dir").Output()
	if e != nil {
		return "", mission.Problem("invalid_repository", "%s is not a git checkout", p)
	}
	return filepath.EvalSymlinks(strings.TrimSpace(string(o)))
}
func authorize(a *mission.Attempt, token string) error {
	if token == "" || subtle.ConstantTimeCompare([]byte(a.TokenHash), []byte(mission.Digest([]byte(token)))) != 1 {
		return mission.Problem("not_owner", "attempt token does not match; use the token returned by claim")
	}
	if a.Machine != platform.Machine() {
		return mission.Problem("foreign_host", "this attempt belongs to another host")
	}
	return nil
}
