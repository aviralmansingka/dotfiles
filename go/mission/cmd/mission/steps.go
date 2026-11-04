package main

import (
	"encoding/json"
	"fmt"
	"go.yaml.in/yaml/v3"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

type StepView struct {
	Step         mission.Step          `json:"step"`
	Status       string                `json:"status"`
	Attempt      string                `json:"last_attempt,omitempty"`
	Verification *mission.Verification `json:"verification,omitempty"`
}

func stepIndex(m mission.Mission, id string) (int, error) {
	for i, s := range m.Steps {
		if s.ID == id {
			return i, nil
		}
	}
	return -1, mission.Problem("not_found", "step %s not found", id)
}
func definitionHash(s mission.Step) string { b, _ := json.Marshal(s); return mission.Digest(b) }
func (s *Store) steps(h string) ([]StepView, error) {
	r, e := s.load(h)
	if e != nil {
		return nil, e
	}
	out := []StepView{}
	for _, st := range r.Mission.Steps {
		ss := r.State.Steps[st.ID]
		v := StepView{Step: st, Status: ss.Status, Attempt: ss.Attempt}
		if a, e := mission.FindAttempt(&r.State, ss.Attempt); e == nil && len(a.Verifications) > 0 {
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
	return StepView{}, mission.Problem("not_found", "step %s not found", id)
}

// A small write-ahead record makes the mission.md + state.md edit recoverable.
// Readers refuse an interrupted edit until repair replays this exact transaction.
type pendingEdit struct {
	Handle       string          `yaml:"handle"`
	Mission      mission.Mission `yaml:"mission"`
	Body         string          `yaml:"body"`
	State        mission.State   `yaml:"state"`
	BaseRevision int             `yaml:"base_revision"`
	BaseHash     string          `yaml:"base_hash"`
}

func (s *Store) editStep(h, id string, updated mission.Step, revision int, reset bool) (mission.Record, error) {
	var result mission.Record
	e := s.locked(func() error {
		r, e := s.load(h)
		if e != nil {
			return e
		}
		if revision != r.State.Revision {
			return mission.Problem("revision_conflict", "step changed since it was read; refresh and retry")
		}
		if r.State.Active != "" {
			return mission.Problem("busy", "finish the active attempt before customizing steps")
		}
		if r.State.Pending != "" {
			return mission.Problem("review_pending", "review %s is waiting. Decide with:\n  mission checkpoint accept %s %s --note \"Reviewed the evidence\"", r.State.Pending, r.Handle, r.State.Pending)
		}
		idx, e := stepIndex(r.Mission, id)
		if e != nil {
			return e
		}
		before := r.Mission.Steps[idx]
		if updated.ID != id {
			return mission.Problem("invalid_step", "step IDs are stable; they cannot be edited")
		}
		started := false
		for _, a := range r.State.Attempts {
			if a.Step == id {
				started = true
			}
		}
		if started && !reset {
			return mission.Problem("step_started", "%s already has attempts; use --reset to invalidate this step and later progress while preserving history", id)
		}
		d, e := s.dir(h)
		if e != nil {
			return e
		}
		old, e := os.ReadFile(filepath.Join(d, "mission.md"))
		if e != nil {
			return e
		}
		if mission.Digest(old) != r.State.SpecHash {
			return mission.Problem("brief_changed", "mission.md changed outside the step editor; reconcile that change first")
		}
		baseRevision, baseHash := r.State.Revision, r.State.SpecHash
		r.Mission.Steps[idx] = updated
		mission.NormalizeMission(&r.Mission)
		if e = validateMission(r.Mission); e != nil {
			return e
		}
		if reset {
			for _, st := range r.Mission.Steps[idx:] {
				r.State.Steps[st.ID] = mission.StepState{Status: "pending", Attempt: r.State.Steps[st.ID].Attempt}
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
		r.State.Edits = append(r.State.Edits, mission.StepEdit{Step: id, At: mission.Now(), Before: before, After: r.Mission.Steps[idx], Reset: reset})
		b, e := markdown(r.Mission, r.Mission.Body)
		if e != nil {
			return e
		}
		r.State.SpecHash = mission.Digest(b)
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
			return mission.Problem("too_large", "step edit exceeds the 16 MiB journal limit")
		}
		if e = atomicWrite(p, b); e != nil {
			return e
		}
		result, e = s.applyEdit(tx)
		return e
	})
	return result, e
}
func (s *Store) applyEdit(tx pendingEdit) (mission.Record, error) {
	r := mission.Record{Handle: tx.Handle, Mission: tx.Mission, State: tx.State}
	r.Mission.Body = tx.Body
	if r.Handle != r.Mission.Repo+"/"+r.Mission.Slug {
		return r, mission.Problem("identity_mismatch", "edit definition belongs to another mission")
	}
	if e := validateMission(r.Mission); e != nil {
		return r, e
	}
	if r.State.Mission != r.Mission.ID {
		return r, mission.Problem("identity_mismatch", "edit state belongs to a different mission")
	}
	d, e := s.dir(r.Handle)
	if e != nil {
		return r, e
	}
	current, e := os.ReadFile(filepath.Join(d, "state.md"))
	if e != nil {
		return r, e
	}
	var st mission.State
	if _, e = parseMarkdown(current, &st); e != nil {
		return r, e
	}
	oldState := st.Revision == tx.BaseRevision && st.SpecHash == tx.BaseHash
	newState := st.Revision == tx.State.Revision && st.SpecHash == tx.State.SpecHash
	if st.Mission != tx.State.Mission || (!oldState && !newState) {
		return r, mission.Problem("revision_conflict", "interrupted edit conflicts with current state; manual reconciliation required")
	}
	current, e = os.ReadFile(filepath.Join(d, "mission.md"))
	if e != nil {
		return r, e
	}
	if mission.Digest(current) != tx.BaseHash && mission.Digest(current) != tx.State.SpecHash {
		return r, mission.Problem("brief_changed", "interrupted edit conflicts with mission.md; manual reconciliation required")
	}
	b, e := markdown(r.Mission, r.Mission.Body)
	if e != nil {
		return r, e
	}
	if mission.Digest(b) != tx.State.SpecHash {
		return r, mission.Problem("invalid_edit", "edit fingerprint does not match its definition")
	}
	if e = atomicWrite(filepath.Join(d, "mission.md"), b); e != nil {
		return r, e
	}
	// A replay that meets its own new revision has nothing left to write.
	if !newState {
		if e = s.save(&r); e != nil {
			return r, e
		}
	}
	p, e := s.editPath(r.Handle)
	if e != nil {
		return r, e
	}
	return r, os.Remove(p)
}

// repair replays an interrupted step edit, re-admits attempt projections the
// ledger lost, and rewrites the commit point.
func (s *Store) repair(h string) (mission.Record, error) {
	var r mission.Record
	e := s.locked(func() error {
		replayed := false
		p, e := s.editPath(h)
		if e != nil {
			return e
		}
		b, e := os.ReadFile(p)
		if e == nil {
			if len(b) > 16<<20 {
				return mission.Problem("too_large", "edit journal exceeds 16 MiB")
			}
			var tx pendingEdit
			if e = yaml.Unmarshal(b, &tx); e != nil {
				return e
			}
			if tx.Handle != h {
				return mission.Problem("identity_mismatch", "edit journal belongs to another mission")
			}
			if r, e = s.applyEdit(tx); e != nil {
				return e
			}
			replayed = true
		} else if os.IsNotExist(e) {
			if r, e = s.load(h); e != nil {
				return e
			}
		} else {
			return e
		}
		adopted, e := s.adoptOrphans(&r)
		if e != nil {
			return e
		}
		if replayed && adopted == 0 {
			return nil
		}
		r.State.Revision++
		return s.save(&r)
	})
	return r, e
}

// adoptOrphans re-admits attempt projections that the ledger no longer lists.
// A claim saves state.md before its projection, so a projection without a
// ledger entry is an attempt that a stale writer dropped.
func (s *Store) adoptOrphans(r *mission.Record) (int, error) {
	d, e := s.dir(r.Handle)
	if e != nil {
		return 0, e
	}
	ents, e := os.ReadDir(filepath.Join(d, "attempts"))
	if os.IsNotExist(e) {
		return 0, nil
	}
	if e != nil {
		return 0, e
	}
	known := map[int]bool{}
	for _, a := range r.State.Attempts {
		known[a.Sequence] = true
	}
	adopted := 0
	for _, ent := range ents {
		name := ent.Name()
		if ent.IsDir() || !strings.HasSuffix(name, ".md") {
			continue
		}
		seq, e := strconv.Atoi(strings.TrimSuffix(name, ".md"))
		if e != nil || seq <= 0 || known[seq] {
			continue
		}
		b, e := os.ReadFile(filepath.Join(d, "attempts", name))
		if e != nil {
			return adopted, e
		}
		var a mission.Attempt
		if _, e = parseMarkdown(b, &a); e != nil {
			return adopted, mission.Problem("invalid_note", "attempt projection %s cannot be read: %v", name, e)
		}
		if a.Sequence != seq || a.ID == "" {
			return adopted, mission.Problem("identity_mismatch", "attempt projection %s does not describe itself", name)
		}
		r.State.Attempts = append(r.State.Attempts, a)
		known[seq] = true
		adopted++
	}
	if adopted == 0 {
		return 0, nil
	}
	sort.Slice(r.State.Attempts, func(i, j int) bool { return r.State.Attempts[i].Sequence < r.State.Attempts[j].Sequence })
	// A re-admitted attempt that passed its checks restores its step, so a
	// completed step is not replayed.
	for _, a := range r.State.Attempts {
		if a.Status != "succeeded" || len(a.Verifications) == 0 || r.State.Steps[a.Step].Status == "passed" {
			continue
		}
		if allPassed(a.Verifications[len(a.Verifications)-1], attemptDefinition(*r, a)) {
			r.State.Steps[a.Step] = mission.StepState{Status: "passed", Attempt: a.ID, Evidence: a.Artifact}
		}
	}
	// The newest open attempt owns the mission again; any other open attempt
	// lost the ledger and cannot own it. A passed step keeps its passed status.
	owner := ""
	for i := len(r.State.Attempts) - 1; i >= 0; i-- {
		a := r.State.Attempts[i]
		if !mission.Active(a) {
			continue
		}
		owner = a.ID
		r.State.Active = a.ID
		r.State.Current = a.Step
		r.State.Status = "running"
		r.State.Steps[a.Step] = mission.StepState{Status: "running", Attempt: a.ID}
		break
	}
	for i := range r.State.Attempts {
		a := &r.State.Attempts[i]
		if !mission.Active(*a) || a.ID == owner || r.State.Steps[a.Step].Status == "passed" {
			continue
		}
		a.Status = "interrupted"
		a.Ended, a.Updated = mission.Now(), mission.Now()
		a.Events = append(a.Events, mission.Event{ID: mission.UID("event-"), Type: "note", At: mission.Now(),
			Summary: "Repair closed this attempt: attempt " + owner + " owns the ledger"})
		r.State.Steps[a.Step] = mission.StepState{Status: "failed", Attempt: a.ID}
	}
	return adopted, nil
}
func assignedBrief(m mission.Mission, st mission.Step) string {
	return fmt.Sprintf("# Assigned step: %s — %s\n\n%s\n\n## Acceptance criteria\n%s\n\n## Required checks\n%s\n\nWrite the result to MISSION_ARTIFACT. Work only on this step.\n\n## Shared mission context\n%s\n", st.ID, st.Title, platform.Fallback(st.Instructions, st.Title), platform.Fallback(st.Acceptance, "Produce a useful result that satisfies this step and the mission goal."), strings.Join(mission.StepChecks(st), ", "), m.Body)
}
