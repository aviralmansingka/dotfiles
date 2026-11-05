package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"go.yaml.in/yaml/v3"

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
func (s *App) steps(h string) ([]StepView, error) {
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
func (s *App) step(h, id string) (StepView, error) {
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

func (s *App) editStep(h, id string, updated mission.Step, revision int, reset bool) (mission.Record, error) {
	var tx pendingEdit
	r, e := s.update(h, func(r *mission.Record) error {
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
		d, e := s.Repo.Dir(h)
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
		if e = mission.Validate(r.Mission); e != nil {
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
		r.State.Edits = append(r.State.Edits, mission.StepEdit{Step: id, At: mission.Now(), Before: before, After: r.Mission.Steps[idx], Reset: reset})
		b, e := platform.Markdown(r.Mission, r.Mission.Body)
		if e != nil {
			return e
		}
		r.State.SpecHash = mission.Digest(b)
		// The journal carries the state this edit commits, one revision on, so
		// repair replays exactly this transaction.
		next := r.State
		next.Revision = baseRevision + 1
		tx = pendingEdit{Handle: h, Mission: r.Mission, Body: r.Mission.Body, State: next, BaseRevision: baseRevision, BaseHash: baseHash}
		p, e := s.Repo.EditPath(h)
		if e != nil {
			return e
		}
		jb, e := yaml.Marshal(tx)
		if e != nil {
			return e
		}
		if len(jb) > 16<<20 {
			return mission.Problem("too_large", "step edit exceeds the 16 MiB journal limit")
		}
		if e = platform.AtomicWrite(p, jb); e != nil {
			return e
		}
		// The brief is written before the state it is paired with: a crash
		// between the two leaves the journal for repair to replay.
		return platform.AtomicWrite(filepath.Join(d, "mission.md"), b)
	})
	if e != nil {
		return r, e
	}
	// The state this journal describes is committed, so the journal can go.
	p, e := s.Repo.EditPath(h)
	if e != nil {
		return r, e
	}
	return r, os.Remove(p)
}

// replayEdit applies one interrupted step edit inside a write transaction. The
// store read through the journal, so the check below is against the state on
// disk: a transaction that meets neither its base nor its own result is a
// conflict, not a replay.
func (s *App) replayEdit(r *mission.Record, tx pendingEdit) error {
	rec := mission.Record{Handle: tx.Handle, Mission: tx.Mission, State: tx.State}
	rec.Mission.Body = tx.Body
	if rec.Handle != rec.Mission.Repo+"/"+rec.Mission.Slug {
		return mission.Problem("identity_mismatch", "edit definition belongs to another mission")
	}
	if e := mission.Validate(rec.Mission); e != nil {
		return e
	}
	if rec.State.Mission != rec.Mission.ID {
		return mission.Problem("identity_mismatch", "edit state belongs to a different mission")
	}
	d, e := s.Repo.Dir(rec.Handle)
	if e != nil {
		return e
	}
	current, e := os.ReadFile(filepath.Join(d, "state.md"))
	if e != nil {
		return e
	}
	var st mission.State
	if _, e = platform.ParseMarkdown(current, &st); e != nil {
		return e
	}
	oldState := st.Revision == tx.BaseRevision && st.SpecHash == tx.BaseHash
	newState := st.Revision == tx.State.Revision && st.SpecHash == tx.State.SpecHash
	if st.Mission != tx.State.Mission || (!oldState && !newState) {
		return mission.Problem("revision_conflict", "interrupted edit conflicts with current state; manual reconciliation required")
	}
	current, e = os.ReadFile(filepath.Join(d, "mission.md"))
	if e != nil {
		return e
	}
	if mission.Digest(current) != tx.BaseHash && mission.Digest(current) != tx.State.SpecHash {
		return mission.Problem("brief_changed", "interrupted edit conflicts with mission.md; manual reconciliation required")
	}
	b, e := platform.Markdown(rec.Mission, rec.Mission.Body)
	if e != nil {
		return e
	}
	if mission.Digest(b) != tx.State.SpecHash {
		return mission.Problem("invalid_edit", "edit fingerprint does not match its definition")
	}
	if e = platform.AtomicWrite(filepath.Join(d, "mission.md"), b); e != nil {
		return e
	}
	// The transaction writes the revision after the base, which is the one the
	// interrupted edit meant to write itself. A replay that meets its own new
	// revision has nothing left to write: the transaction commits it and only
	// removes the journal.
	if newState {
		*r = rec
		return mission.ErrNoWrite
	}
	rec.State.Revision = tx.BaseRevision
	*r = rec
	return nil
}

// repair replays an interrupted step edit, re-admits attempt projections the
// ledger lost, reconciles an active attempt whose process is gone, and rewrites
// the commit point.
func (s *App) repair(h string) (mission.Record, error) {
	var r mission.Record
	p, e := s.Repo.EditPath(h)
	if e != nil {
		return r, e
	}
	b, e := os.ReadFile(p)
	switch {
	case e == nil:
		if len(b) > 16<<20 {
			return r, mission.Problem("too_large", "edit journal exceeds 16 MiB")
		}
		var tx pendingEdit
		if e = yaml.Unmarshal(b, &tx); e != nil {
			return r, e
		}
		if tx.Handle != h {
			return r, mission.Problem("identity_mismatch", "edit journal belongs to another mission")
		}
		// A retired mission never replays an edit, even an interrupted one.
		if e = requireOpen(mission.Record{Handle: h, Mission: tx.Mission, State: tx.State}); e != nil {
			return r, e
		}
		if r, e = s.updateThroughEdit(h, func(rec *mission.Record) error { return s.replayEdit(rec, tx) }); e != nil {
			return r, e
		}
		// The journal goes only after the state it describes is committed.
		if e = os.Remove(p); e != nil {
			return r, e
		}
	case os.IsNotExist(e):
		if r, e = s.load(h); e != nil {
			return r, e
		}
		if e = requireOpen(r); e != nil {
			return r, e
		}
	default:
		return r, e
	}
	// A dead attempt keeps its step unclosable until something ends it, so
	// repair reconciles one whose process is gone and whose stream is quiet. A
	// live process is never touched. Nothing to re-admit and nothing to
	// reconcile leaves the record exactly as repair found it.
	rec, e := s.update(h, func(r *mission.Record) error {
		if e := requireOpen(*r); e != nil {
			return e
		}
		adopted, e := s.adoptOrphans(r)
		if e != nil {
			return e
		}
		if adopted == 0 && s.reconcileAttempts(r) == 0 {
			return mission.ErrNoWrite
		}
		return nil
	})
	if e != nil {
		return r, e
	}
	return rec, nil
}

// adoptOrphans re-admits attempt projections that the ledger no longer lists.
// A claim saves state.md before its projection, so a projection without a
// ledger entry is an attempt that a stale writer dropped.
func (s *App) adoptOrphans(r *mission.Record) (int, error) {
	d, e := s.Repo.Dir(r.Handle)
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
		if _, e = platform.ParseMarkdown(b, &a); e != nil {
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
		if mission.AllPassed(a.Verifications[len(a.Verifications)-1], attemptDefinition(*r, a)) {
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
