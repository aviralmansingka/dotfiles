package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

func (s *App) hook(h, id, token string, ev mission.Event) (mission.Record, error) {
	allowed := map[string]bool{"session-start": true, "agent-start": true, "agent-end": true, "agent-settled": true, "tool-start": true, "tool-end": true, "session-end": true, "process-start": true, "process-exit": true, "note": true, "question": true}
	if !allowed[ev.Type] {
		return mission.Record{}, mission.Problem("invalid_event", "unsupported lifecycle event %s", ev.Type)
	}
	if len(ev.Summary) > 4000 {
		return mission.Record{}, mission.Problem("too_large", "event summary exceeds 4000 characters")
	}
	if ev.ID == "" {
		ev.ID = mission.UID("event-")
	}
	ev.At = ""
	ev.Fingerprint = ""
	b, _ := json.Marshal(ev)
	finger := mission.Digest(b)
	return s.update(h, func(r *mission.Record) error {
		a, e := mission.FindAttempt(&r.State, id)
		if e != nil {
			return e
		}
		if e = authorize(a, token); e != nil {
			return e
		}
		for _, old := range a.Events {
			if old.ID == ev.ID {
				if old.Fingerprint != finger {
					return mission.Problem("event_conflict", "event id reused with different content")
				}
				return nil
			}
		}
		if len(a.Events) >= 4096 {
			return mission.Problem("event_limit", "attempt event limit reached")
		}
		if ev.Type == "process-start" || ev.Type == "process-exit" {
			return mission.Problem("reserved_event", "process events are reserved for the run wrapper")
		}
		if ev.SessionID != "" {
			if a.SessionID != "" && a.SessionID != ev.SessionID {
				return mission.Problem("session_mismatch", "event session does not match claimed session")
			}
			a.SessionID = ev.SessionID
		}
		if a.Execution == "pi" && ev.Type == "session-start" {
			if r.State.Runtime == nil || r.State.Runtime.Workspace != ev.Workspace || ev.Pane == "" {
				return mission.Problem("workspace_mismatch", "restore the Pi owner in the repository workspace")
			}
			r.State.Runtime.Pane = ev.Pane
		}
		if ev.SessionFile != "" {
			a.SessionFile = ev.SessionFile
		}
		ev.At = mission.Now()
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
			if a.Execution == "pi" && mission.Active(*a) {
				r.State.Status = "waiting"
			} else if !a.Managed && mission.Active(*a) && a.Verifying != "" {
				a.ReportedFailure = true
				a.Status = "reported"
				r.State.Status = "waiting"
			} else if !a.Managed && mission.Active(*a) {
				a.Status = "interrupted"
				a.Ended = mission.Now()
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
func (s *App) snapshotTranscript(r *mission.Record, a *mission.Attempt) error {
	if a.SessionFile == "" {
		return nil
	}
	f, e := os.Open(a.SessionFile)
	if e != nil {
		return mission.Problem("transcript_unavailable", "cannot preserve session transcript: %v", e)
	}
	defer f.Close()
	b, e := io.ReadAll(io.LimitReader(f, (16<<20)+1))
	if e != nil {
		return e
	}
	if len(b) > 16<<20 {
		return mission.Problem("transcript_too_large", "transcript exceeds prototype's 16 MiB preservation limit")
	}
	rel := filepath.ToSlash(filepath.Join("artifacts", fmt.Sprintf("%03d", a.Sequence), "session.jsonl"))
	p, e := s.Repo.Path(r.Mission.Repo, r.Mission.Slug, rel)
	if e != nil {
		return e
	}
	if e = platform.AtomicWrite(p, b); e != nil {
		return e
	}
	a.Transcript = rel
	return nil
}
func (s *App) finish(h, id, token string, failed bool, note string, observedExit bool, code int, piSettlement ...bool) (mission.Record, error) {
	settled := len(piSettlement) > 0 && piSettlement[0]
	opening, e := s.load(h)
	if e != nil {
		return opening, e
	}
	if e = requireOpen(opening); e != nil {
		return opening, e
	}
	if !failed {
		r, e := s.load(h)
		if e != nil {
			return r, e
		}
		if r.State.Pending != "" && r.State.Checkpoints[r.State.Pending].Attempt != id {
			return r, mission.Problem("review_pending", "review %s is waiting. Decide with:\n  mission checkpoint accept %s %s --note \"Reviewed the evidence\"", r.State.Pending, r.Handle, r.State.Pending)
		}
		a, e := mission.FindAttempt(&r.State, id)
		if e != nil {
			return r, e
		}
		if e = authorize(a, token); e != nil {
			return r, e
		}
		if mission.Active(*a) && (!a.Managed || observedExit || settled) && !a.ReportedFailure {
			if !s.verified(r, *a) {
				r, e = s.verify(h, id, token)
				if e != nil {
					return r, e
				}
				a, _ = mission.FindAttempt(&r.State, id)
			}
			v := a.Verifications[len(a.Verifications)-1]
			if !allPassed(v, attemptDefinition(r, *a)) {
				if len(v.Results) > 0 && v.Results[0].Verdict == "failed" {
					return r, mission.Problem("missing_artifact", "required result check failed; inspect verification evidence")
				}
				return r, mission.Problem("checks_failed", "required checks did not pass: %s", mission.VerificationSummary(v))
			}
		}
	}
	return s.update(h, func(r *mission.Record) error {
		if e := requireOpen(*r); e != nil {
			return e
		}
		a, e := mission.FindAttempt(&r.State, id)
		if e != nil {
			return e
		}
		if e = authorize(a, token); e != nil {
			return e
		}
		if !mission.Active(*a) {
			if a.Status == "succeeded" && !failed {
				return nil
			}
			return mission.Problem("attempt_terminal", "attempt is already %s", a.Status)
		}
		if r.State.Active != id {
			return mission.Problem("stale_attempt", "attempt is not the current owner")
		}
		if a.Managed && !observedExit && !settled {
			a.Status = "reported"
			a.ReportedFailure = a.ReportedFailure || failed
			a.Events = append(a.Events, mission.Event{ID: mission.UID("event-"), Type: "completion-reported", At: mission.Now(), Summary: note})
			a.Updated = mission.Now()
			return nil
		}
		if a.Verifying != "" {
			return mission.Problem("verification_busy", "checks are still running; attempt ownership retained")
		}
		failed = failed || a.ReportedFailure
		if settled {
			if a.Execution != "pi" || a.Status != "reported" || !piQuiet(*a) {
				return mission.Problem("runtime_busy", "Pi resumed during settlement; ownership retained")
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
				return mission.Problem("evidence_changed", "checked input changed; run checks again before finishing")
			}
			d, _ := s.Repo.Dir(h)
			spec, e := os.ReadFile(filepath.Join(d, "mission.md"))
			if e != nil {
				return e
			}
			if mission.Digest(spec) != a.SpecHash {
				return mission.Problem("brief_changed", "brief changed during this attempt; successful completion refused")
			}
			p, e := s.Repo.Path(r.Mission.Repo, r.Mission.Slug, a.Artifact)
			if e != nil {
				return e
			}
			b, e := os.ReadFile(p)
			if e != nil || len(bytes.TrimSpace(b)) == 0 {
				return mission.Problem("missing_artifact", "write the nonempty artifact before finishing: %s", a.Artifact)
			}
			if len(b) > 16<<20 {
				return mission.Problem("too_large", "artifact exceeds 16 MiB")
			}
			a.ArtifactHash = mission.Digest(b)
		}
		a.Status = "succeeded"
		if failed {
			a.Status = "failed"
		}
		a.Ended = mission.Now()
		a.Updated = a.Ended
		a.Events = append(a.Events, mission.Event{ID: mission.UID("event-"), Type: "attempt-finished", At: mission.Now(), Summary: note})
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
				r.State.Checkpoints[cp.ID] = mission.CheckState{Status: "pending", Attempt: a.ID, Evidence: a.Artifact, Hash: a.ArtifactHash}
				r.State.Pending = cp.ID
				r.State.Status = "waiting"
				if cp.After == r.Mission.Steps[len(r.Mission.Steps)-1].ID {
					r.State.Status = "review"
				}
				return nil
			}
		}
		if _, e := mission.NextStep(r.Mission, r.State); e != nil {
			if de, ok := e.(*mission.DomainError); ok && de.Code == "complete" {
				r.State.Status = "done"
			} else {
				return e
			}
		}
		return nil
	})
}
func (s *App) retry(h string) (mission.Record, error) {
	return s.update(h, func(r *mission.Record) error {
		if e := requireOpen(*r); e != nil {
			return e
		}
		if r.State.Active != "" {
			return mission.Problem("busy", "cannot retry an active attempt")
		}
		ss, ok := r.State.Steps[r.State.Current]
		if !ok || ss.Status != "failed" {
			return mission.Problem("not_failed", "current step is not failed")
		}
		ss.Status = "pending"
		r.State.Steps[r.State.Current] = ss
		r.State.Status = "ready"
		return nil
	})
}
