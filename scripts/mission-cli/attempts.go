package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

func (s *Store) hook(h, id, token string, ev Event) (Record, error) {
	allowed := map[string]bool{"session-start": true, "agent-start": true, "agent-end": true, "agent-settled": true, "tool-start": true, "tool-end": true, "session-end": true, "process-start": true, "process-exit": true, "note": true, "question": true}
	if !allowed[ev.Type] {
		return Record{}, problem("invalid_event", "unsupported lifecycle event %s", ev.Type)
	}
	if len(ev.Summary) > 4000 {
		return Record{}, problem("too_large", "event summary exceeds 4000 characters")
	}
	if ev.ID == "" {
		ev.ID = uid("event-")
	}
	ev.At = ""
	ev.Fingerprint = ""
	b, _ := json.Marshal(ev)
	finger := digest(b)
	return s.mutate(h, func(r *Record) error {
		a, e := findAttempt(&r.State, id)
		if e != nil {
			return e
		}
		if e = authorize(a, token); e != nil {
			return e
		}
		for _, old := range a.Events {
			if old.ID == ev.ID {
				if old.Fingerprint != finger {
					return problem("event_conflict", "event id reused with different content")
				}
				return nil
			}
		}
		if len(a.Events) >= 4096 {
			return problem("event_limit", "attempt event limit reached")
		}
		if ev.Type == "process-start" || ev.Type == "process-exit" {
			return problem("reserved_event", "process events are reserved for the run wrapper")
		}
		if ev.SessionID != "" {
			if a.SessionID != "" && a.SessionID != ev.SessionID {
				return problem("session_mismatch", "event session does not match claimed session")
			}
			a.SessionID = ev.SessionID
		}
		if a.Execution == "pi" && ev.Type == "session-start" {
			if r.State.Runtime == nil || r.State.Runtime.Workspace != ev.Workspace || ev.Pane == "" {
				return problem("workspace_mismatch", "restore the Pi owner in the repository workspace")
			}
			r.State.Runtime.Pane = ev.Pane
		}
		if ev.SessionFile != "" {
			a.SessionFile = ev.SessionFile
		}
		ev.At = now()
		ev.Fingerprint = finger
		a.Events = append(a.Events, ev)
		a.Updated = ev.At
		if ev.Type == "question" && r.State.Active == id {
			r.State.Status = "waiting"
		}
		if ev.Type == "agent-start" && r.State.Active == id {
			r.State.Status = "running"
		}
		if ev.Type == "agent-end" || ev.Type == "agent-settled" || ev.Type == "session-end" {
			if e = s.snapshotTranscript(r, a); e != nil {
				return e
			}
			if ev.Type != "session-end" {
				return nil
			}
			if a.Execution == "pi" && active(*a) {
				r.State.Status = "waiting"
			} else if !a.Managed && active(*a) && a.Verifying != "" {
				a.ReportedFailure = true
				a.Status = "reported"
				r.State.Status = "waiting"
			} else if !a.Managed && active(*a) {
				a.Status = "interrupted"
				a.Ended = now()
				r.State.Active = ""
				r.State.Status = "failed"
				ss := r.State.Steps[a.Step]
				ss.Status = "failed"
				r.State.Steps[a.Step] = ss
			}
		}
		return nil
	})
}
func (s *Store) snapshotTranscript(r *Record, a *Attempt) error {
	if a.SessionFile == "" {
		return nil
	}
	f, e := os.Open(a.SessionFile)
	if e != nil {
		return problem("transcript_unavailable", "cannot preserve session transcript: %v", e)
	}
	defer f.Close()
	b, e := io.ReadAll(io.LimitReader(f, (16<<20)+1))
	if e != nil {
		return e
	}
	if len(b) > 16<<20 {
		return problem("transcript_too_large", "transcript exceeds prototype's 16 MiB preservation limit")
	}
	rel := filepath.ToSlash(filepath.Join("artifacts", fmt.Sprintf("%03d", a.Sequence), "session.jsonl"))
	p, e := s.path(r.Mission.Repo, r.Mission.Slug, rel)
	if e != nil {
		return e
	}
	if e = atomicWrite(p, b); e != nil {
		return e
	}
	a.Transcript = rel
	return nil
}
func (s *Store) finish(h, id, token string, failed bool, note string, observedExit bool, code int, piSettlement ...bool) (Record, error) {
	settled := len(piSettlement) > 0 && piSettlement[0]
	if !failed {
		r, e := s.load(h)
		if e != nil {
			return r, e
		}
		a, e := findAttempt(&r.State, id)
		if e != nil {
			return r, e
		}
		if e = authorize(a, token); e != nil {
			return r, e
		}
		if active(*a) && (!a.Managed || observedExit || settled) && !a.ReportedFailure {
			if !s.verified(r, *a) {
				r, e = s.verify(h, id, token)
				if e != nil {
					return r, e
				}
				a, _ = findAttempt(&r.State, id)
			}
			v := a.Verifications[len(a.Verifications)-1]
			if !allPassed(v, attemptDefinition(r, *a)) {
				if len(v.Results) > 0 && v.Results[0].Verdict == "failed" {
					return r, problem("missing_artifact", "required result check failed; inspect verification evidence")
				}
				return r, problem("checks_failed", "required checks did not pass: %s", verificationSummary(v))
			}
		}
	}
	return s.mutate(h, func(r *Record) error {
		a, e := findAttempt(&r.State, id)
		if e != nil {
			return e
		}
		if e = authorize(a, token); e != nil {
			return e
		}
		if !active(*a) {
			if a.Status == "succeeded" && !failed {
				return nil
			}
			return problem("attempt_terminal", "attempt is already %s", a.Status)
		}
		if r.State.Active != id {
			return problem("stale_attempt", "attempt is not the current owner")
		}
		if a.Managed && !observedExit && !settled {
			a.Status = "reported"
			a.ReportedFailure = a.ReportedFailure || failed
			a.Events = append(a.Events, Event{ID: uid("event-"), Type: "completion-reported", At: now(), Summary: note})
			a.Updated = now()
			return nil
		}
		if a.Verifying != "" {
			return problem("verification_busy", "checks are still running; attempt ownership retained")
		}
		failed = failed || a.ReportedFailure
		if settled {
			if a.Execution != "pi" || a.Status != "reported" || !piQuiet(*a) {
				return problem("runtime_busy", "Pi resumed during settlement; ownership retained")
			}
			a.Settled = true
		}
		if observedExit {
			a.ProcessExited = true
			a.ExitCode = code
		}
		if e = s.snapshotTranscript(r, a); e != nil {
			return e
		}
		if !failed {
			if !s.verified(*r, *a) {
				return problem("evidence_changed", "checked input changed; run checks again before finishing")
			}
			d, _ := s.dir(h)
			spec, e := os.ReadFile(filepath.Join(d, "mission.md"))
			if e != nil {
				return e
			}
			if digest(spec) != a.SpecHash {
				return problem("brief_changed", "brief changed during this attempt; successful completion refused")
			}
			p, e := s.path(r.Mission.Repo, r.Mission.Slug, a.Artifact)
			if e != nil {
				return e
			}
			b, e := os.ReadFile(p)
			if e != nil || len(bytes.TrimSpace(b)) == 0 {
				return problem("missing_artifact", "write the nonempty artifact before finishing: %s", a.Artifact)
			}
			if len(b) > 16<<20 {
				return problem("too_large", "artifact exceeds 16 MiB")
			}
			a.ArtifactHash = digest(b)
		}
		a.Status = "succeeded"
		if failed {
			a.Status = "failed"
		}
		a.Ended = now()
		a.Updated = a.Ended
		a.Events = append(a.Events, Event{ID: uid("event-"), Type: "attempt-finished", At: now(), Summary: note})
		ss := r.State.Steps[a.Step]
		ss.Status = "passed"
		ss.Evidence = a.Artifact
		if failed {
			ss.Status = "failed"
			ss.Evidence = ""
		}
		r.State.Steps[a.Step] = ss
		r.State.Active = ""
		r.State.Status = "ready"
		if failed {
			r.State.Status = "failed"
			return nil
		}
		for _, cp := range r.Mission.Checkpoints {
			if cp.After == a.Step {
				r.State.Checkpoints[cp.ID] = CheckState{Status: "pending", Attempt: a.ID, Evidence: a.Artifact, Hash: a.ArtifactHash}
				r.State.Pending = cp.ID
				r.State.Status = "waiting"
				if cp.After == r.Mission.Steps[len(r.Mission.Steps)-1].ID {
					r.State.Status = "review"
				}
				return nil
			}
		}
		if _, e := nextStep(r.Mission, r.State); e != nil {
			if de, ok := e.(*DomainError); ok && de.Code == "complete" {
				r.State.Status = "done"
			} else {
				return e
			}
		}
		return nil
	})
}
func (s *Store) checkpoint(h, id, decision, note, actor string, human bool, revision int) (Record, error) {
	if !human || actor == "" || note == "" {
		return Record{}, problem("human_required", "checkpoint decisions require --human, --actor, and --note; this records a human attestation")
	}
	return s.mutate(h, func(r *Record) error {
		if revision > 0 && r.State.Revision != revision {
			return problem("revision_conflict", "expected revision %d, current %d", revision, r.State.Revision)
		}
		cp, ok := r.State.Checkpoints[id]
		if !ok || r.State.Pending != id || cp.Status != "pending" {
			return problem("checkpoint_not_pending", "checkpoint %s is not pending", id)
		}
		d, _ := s.dir(h)
		b, e := os.ReadFile(filepath.Join(d, "mission.md"))
		if e != nil {
			return e
		}
		if digest(b) != r.State.SpecHash {
			return problem("brief_changed", "brief changed since the reviewed attempt")
		}
		p, e := s.path(r.Mission.Repo, r.Mission.Slug, cp.Evidence)
		if e != nil {
			return e
		}
		b, e = os.ReadFile(p)
		if e != nil || digest(b) != cp.Hash {
			return problem("evidence_changed", "checkpoint evidence changed; cannot accept stale evidence")
		}
		if decision != "accept" && decision != "revise" {
			return problem("invalid_decision", "decision must be accept or revise")
		}
		if decision == "accept" {
			if a, e := findAttempt(&r.State, cp.Attempt); e == nil && len(a.Verifications) > 0 && !s.verified(*r, *a) {
				return problem("evidence_changed", "checked input or verification evidence changed since this result")
			}
		}
		cp.Actor = actor
		cp.Note = note
		cp.Status = "accepted"
		r.State.Pending = ""
		r.State.Status = "ready"
		if decision == "revise" {
			cp.Status = "changes_requested"
			invalidate := false
			for _, step := range r.Mission.Steps {
				if step.ID == r.State.Current {
					invalidate = true
				}
				if invalidate {
					ss := r.State.Steps[step.ID]
					ss.Status = "pending"
					ss.Evidence = ""
					r.State.Steps[step.ID] = ss
					for _, c := range r.Mission.Checkpoints {
						if c.After == step.ID && c.ID != id {
							cs := r.State.Checkpoints[c.ID]
							cs.Status = "invalidated"
							r.State.Checkpoints[c.ID] = cs
						}
					}
				}
			}
		}
		r.State.Decisions = append(r.State.Decisions, Decision{Checkpoint: id, Decision: decision, Attempt: cp.Attempt, EvidenceHash: cp.Hash, Actor: actor, Note: note, At: now()})
		r.State.Checkpoints[id] = cp
		if decision == "accept" {
			if _, e := nextStep(r.Mission, r.State); e != nil {
				if de, ok := e.(*DomainError); ok && de.Code == "complete" {
					r.State.Status = "done"
				} else {
					return e
				}
			}
		}
		return nil
	})
}
func (s *Store) retry(h string) (Record, error) {
	return s.mutate(h, func(r *Record) error {
		if r.State.Active != "" {
			return problem("busy", "cannot retry an active attempt")
		}
		ss, ok := r.State.Steps[r.State.Current]
		if !ok || ss.Status != "failed" {
			return problem("not_failed", "current step is not failed")
		}
		ss.Status = "pending"
		r.State.Steps[r.State.Current] = ss
		r.State.Status = "ready"
		return nil
	})
}
