package main

import (
	"encoding/json"
	"fmt"
	"go.yaml.in/yaml/v3"
	"os"
	"path/filepath"
	"strings"
)

type StepView struct {
	Step         Step          `json:"step"`
	Status       string        `json:"status"`
	Attempt      string        `json:"last_attempt,omitempty"`
	Verification *Verification `json:"verification,omitempty"`
}

func stepIndex(m Mission, id string) (int, error) {
	for i, s := range m.Steps {
		if s.ID == id {
			return i, nil
		}
	}
	return -1, problem("not_found", "step %s not found", id)
}
func definitionHash(s Step) string { b, _ := json.Marshal(s); return digest(b) }
func (s *Store) steps(h string) ([]StepView, error) {
	r, e := s.load(h)
	if e != nil {
		return nil, e
	}
	out := []StepView{}
	for _, st := range r.Mission.Steps {
		ss := r.State.Steps[st.ID]
		v := StepView{Step: st, Status: ss.Status, Attempt: ss.Attempt}
		if a, e := findAttempt(&r.State, ss.Attempt); e == nil && len(a.Verifications) > 0 {
			last := a.Verifications[len(a.Verifications)-1]
			v.Verification = &last
		}
		out = append(out, v)
	}
	return out, nil
}
func (s *Store) step(h, id string) (StepView, error) {
	v, e := s.steps(h)
	if e != nil {
		return StepView{}, e
	}
	for _, st := range v {
		if st.Step.ID == id {
			return st, nil
		}
	}
	return StepView{}, problem("not_found", "step %s not found", id)
}

// A small write-ahead record makes the mission.md + state.md edit recoverable.
// Readers refuse an interrupted edit until repair replays this exact transaction.
type pendingEdit struct {
	Handle       string  `yaml:"handle"`
	Mission      Mission `yaml:"mission"`
	Body         string  `yaml:"body"`
	State        State   `yaml:"state"`
	BaseRevision int     `yaml:"base_revision"`
	BaseHash     string  `yaml:"base_hash"`
}

func (s *Store) editStep(h, id string, updated Step, revision int, reset bool) (Record, error) {
	var result Record
	e := s.locked(func() error {
		r, e := s.load(h)
		if e != nil {
			return e
		}
		if revision != r.State.Revision {
			return problem("revision_conflict", "step changed since it was read; refresh and retry")
		}
		if r.State.Active != "" {
			return problem("busy", "finish the active attempt before customizing steps")
		}
		idx, e := stepIndex(r.Mission, id)
		if e != nil {
			return e
		}
		before := r.Mission.Steps[idx]
		if updated.ID != id {
			return problem("invalid_step", "step IDs are stable; they cannot be edited")
		}
		started := false
		for _, a := range r.State.Attempts {
			if a.Step == id {
				started = true
			}
		}
		if started && !reset {
			return problem("step_started", "%s already has attempts; use --reset to invalidate this step and later progress while preserving history", id)
		}
		d, e := s.dir(h)
		if e != nil {
			return e
		}
		old, e := os.ReadFile(filepath.Join(d, "mission.md"))
		if e != nil {
			return e
		}
		if digest(old) != r.State.SpecHash {
			return problem("brief_changed", "mission.md changed outside the step editor; reconcile that change first")
		}
		baseRevision, baseHash := r.State.Revision, r.State.SpecHash
		r.Mission.Steps[idx] = updated
		normalizeMission(&r.Mission)
		if e = validateMission(r.Mission); e != nil {
			return e
		}
		if reset {
			for _, st := range r.Mission.Steps[idx:] {
				r.State.Steps[st.ID] = StepState{Status: "pending", Attempt: r.State.Steps[st.ID].Attempt}
				for _, cp := range r.Mission.Checkpoints {
					if cp.After == st.ID {
						cs := r.State.Checkpoints[cp.ID]
						cs.Status = "invalidated"
						r.State.Checkpoints[cp.ID] = cs
						if r.State.Pending == cp.ID {
							r.State.Pending = ""
						}
					}
				}
			}
			r.State.Current = id
			r.State.Status = "ready"
			if r.State.Pending != "" {
				r.State.Status = "waiting"
			}
		}
		r.State.Revision++
		r.State.Edits = append(r.State.Edits, StepEdit{Step: id, At: now(), Before: before, After: r.Mission.Steps[idx], Reset: reset})
		b, e := markdown(r.Mission, r.Mission.Body)
		if e != nil {
			return e
		}
		r.State.SpecHash = digest(b)
		tx := pendingEdit{Handle: h, Mission: r.Mission, Body: r.Mission.Body, State: r.State, BaseRevision: baseRevision, BaseHash: baseHash}
		p, e := s.editPath(h)
		if e != nil {
			return e
		}
		b, e = yaml.Marshal(tx)
		if e != nil {
			return e
		}
		if len(b) > 16<<20 {
			return problem("too_large", "step edit exceeds the 16 MiB journal limit")
		}
		if e = atomicWrite(p, b); e != nil {
			return e
		}
		result, e = s.applyEdit(tx)
		return e
	})
	return result, e
}
func (s *Store) applyEdit(tx pendingEdit) (Record, error) {
	r := Record{Handle: tx.Handle, Mission: tx.Mission, State: tx.State}
	r.Mission.Body = tx.Body
	if r.Handle != r.Mission.Repo+"/"+r.Mission.Slug {
		return r, problem("identity_mismatch", "edit definition belongs to another mission")
	}
	if e := validateMission(r.Mission); e != nil {
		return r, e
	}
	if r.State.Mission != r.Mission.ID {
		return r, problem("identity_mismatch", "edit state belongs to a different mission")
	}
	d, e := s.dir(r.Handle)
	if e != nil {
		return r, e
	}
	current, e := os.ReadFile(filepath.Join(d, "state.md"))
	if e != nil {
		return r, e
	}
	var st State
	if _, e = parseMarkdown(current, &st); e != nil {
		return r, e
	}
	oldState := st.Revision == tx.BaseRevision && st.SpecHash == tx.BaseHash
	newState := st.Revision == tx.State.Revision && st.SpecHash == tx.State.SpecHash
	if st.Mission != tx.State.Mission || (!oldState && !newState) {
		return r, problem("revision_conflict", "interrupted edit conflicts with current state; manual reconciliation required")
	}
	current, e = os.ReadFile(filepath.Join(d, "mission.md"))
	if e != nil {
		return r, e
	}
	if digest(current) != tx.BaseHash && digest(current) != tx.State.SpecHash {
		return r, problem("brief_changed", "interrupted edit conflicts with mission.md; manual reconciliation required")
	}
	b, e := markdown(r.Mission, r.Mission.Body)
	if e != nil {
		return r, e
	}
	if digest(b) != tx.State.SpecHash {
		return r, problem("invalid_edit", "edit fingerprint does not match its definition")
	}
	if e = atomicWrite(filepath.Join(d, "mission.md"), b); e != nil {
		return r, e
	}
	if e = s.save(&r); e != nil {
		return r, e
	}
	p, e := s.editPath(r.Handle)
	if e != nil {
		return r, e
	}
	return r, os.Remove(p)
}
func (s *Store) repair(h string) (Record, error) {
	var r Record
	e := s.locked(func() error {
		p, e := s.editPath(h)
		if e != nil {
			return e
		}
		b, e := os.ReadFile(p)
		if e == nil {
			if len(b) > 16<<20 {
				return problem("too_large", "edit journal exceeds 16 MiB")
			}
			var tx pendingEdit
			if e = yaml.Unmarshal(b, &tx); e != nil {
				return e
			}
			if tx.Handle != h {
				return problem("identity_mismatch", "edit journal belongs to another mission")
			}
			r, e = s.applyEdit(tx)
			return e
		}
		if !os.IsNotExist(e) {
			return e
		}
		r, e = s.load(h)
		if e != nil {
			return e
		}
		r.State.Revision++
		return s.save(&r)
	})
	return r, e
}
func assignedBrief(m Mission, st Step) string {
	return fmt.Sprintf("# Assigned step: %s — %s\n\n%s\n\n## Acceptance criteria\n%s\n\n## Required checks\n%s\n\nWrite the result to MISSION_ARTIFACT. Work only on this step.\n\n## Shared mission context\n%s\n", st.ID, st.Title, fallback(st.Instructions, st.Title), fallback(st.Acceptance, "Produce a useful result that satisfies this step and the mission goal."), strings.Join(stepChecks(st), ", "), m.Body)
}
