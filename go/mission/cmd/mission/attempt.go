package main

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"

	"mission.local/prototype/internal/domain/mission"
)

// progress appends one structured report to the attempt. A nonempty actor is
// the trooper that reported: the call also appends a Report beside the
// progress entry, so the sitrep reads who finished what without a vault token
// in the trooper's hands. Existing calls that carry no actor keep the exact
// earlier shape and fingerprint.
func (s *Store) progress(h, id, token, actor string, p mission.Progress, paths []string) (mission.Record, error) {
	actor = strings.TrimSpace(actor)
	if p.ID == "" || p.Summary == "" || len(p.Summary)+len(p.Next)+len(p.Blocker) > 8000 || len(paths) > 16 {
		return mission.Record{}, mission.Problem("usage", "progress needs a stable event-id, summary, and at most 16 evidence paths (8000 characters total)")
	}
	if len(actor) > 64 {
		return mission.Record{}, mission.Problem("usage", "--actor names one trooper in at most 64 characters")
	}
	if p.Status != "working" && p.Status != "blocked" && p.Status != "needs-input" && p.Status != "ready" {
		return mission.Record{}, mission.Problem("usage", "progress status must be working, blocked, needs-input, or ready")
	}
	if (p.Status == "blocked" || p.Status == "needs-input") && p.Blocker == "" {
		return mission.Record{}, mission.Problem("usage", "blocked progress needs --blocker")
	}
	// The actor joins the fingerprint only when it is present, so a replay of a
	// pre-report call keeps its original digest.
	request, _ := json.Marshal(struct {
		P     mission.Progress
		Paths []string
		Actor string `json:",omitempty"`
	}{p, paths, actor})
	finger := mission.Digest(request)
	return s.mutate(h, func(r *mission.Record) error {
		a, e := mission.FindAttempt(&r.State, id)
		if e != nil {
			return e
		}
		if e = authorize(a, token); e != nil {
			return e
		}
		for _, old := range a.Progress {
			if old.ID == p.ID {
				if old.Fingerprint != finger {
					return mission.Problem("event_conflict", "progress id reused with different content")
				}
				// A repeated call is idempotent. The report it named was recorded
				// with the entry, so a replay adds nothing back — a resumed
				// trooper's later report must not be undone by a stale retry.
				return nil
			}
		}
		if !mission.Active(*a) || r.State.Active != id {
			return mission.Problem("stale_attempt", "progress needs the active attempt")
		}
		if len(a.Progress) >= 1024 {
			return mission.Problem("event_limit", "attempt progress limit reached")
		}
		for _, path := range paths {
			prefix := fmt.Sprintf("artifacts/%03d/", a.Sequence)
			if !strings.HasPrefix(path, prefix) || filepath.ToSlash(filepath.Clean(path)) != path {
				return mission.Problem("invalid_evidence", "evidence must be relative to this attempt: %s", prefix)
			}
			full, e := s.path(r.Mission.Repo, r.Mission.Slug, path)
			if e != nil {
				return e
			}
			b, e := readBounded(full, 16<<20)
			if e != nil {
				return e
			}
			p.Evidence = append(p.Evidence, mission.Evidence{Path: path, Hash: mission.Digest(b)})
		}
		p.At, p.Fingerprint = mission.Now(), finger
		a.Progress = append(a.Progress, p)
		appendReport(a, p, actor)
		a.Updated = p.At
		r.State.Status = "running"
		if p.Status == "blocked" || p.Status == "needs-input" {
			r.State.Status = "waiting"
		}
		return nil
	})
}

// appendReport records one trooper report for a new progress entry, keeping one
// row per trooper: the same subagent that finishes blocked, is resumed, and
// then finishes ready reports twice under its own name, and the attempt must
// read the state it finished in rather than the one it left behind. The ID is
// the progress event ID that carried the report, so an already recorded report
// is never duplicated (repeats return from progress before this runs).
func appendReport(a *mission.Attempt, p mission.Progress, actor string) {
	if actor == "" {
		return
	}
	report := mission.Report{ID: p.ID, Trooper: actor, Status: p.Status, Summary: p.Summary, Next: p.Next, At: p.At}
	for i, old := range a.Reports {
		if old.Trooper == actor {
			a.Reports[i] = report
			return
		}
	}
	a.Reports = append(a.Reports, report)
}

// Only the adapter calls settle, after an explicit finish/fail report AND an
// observed quiescent turn boundary. It does not claim that the process exited.
func (s *Store) settle(h, id, token, session string) (mission.Record, error) {
	r, e := s.load(h)
	if e != nil {
		return r, e
	}
	a, e := mission.FindAttempt(&r.State, id)
	if e != nil {
		return r, e
	}
	if e = authorize(a, token); e != nil {
		return r, e
	}
	if a.Execution != "pi" || a.SessionID != session {
		return r, mission.Problem("session_mismatch", "settlement needs the attached Pi session")
	}
	if a.Settled && !mission.Active(*a) {
		return r, nil
	}
	if a.Status != "reported" {
		return r, mission.Problem("completion_required", "report finish or fail before settling")
	}
	if !piQuiet(*a) {
		return r, mission.Problem("runtime_busy", "turn must end without pending children, messages, or external waits")
	}
	return s.finish(h, id, token, a.ReportedFailure, "Pi turn settled", false, 0, true)
}

func piQuiet(a mission.Attempt) bool {
	quiet := false
	for _, ev := range a.Events {
		if ev.Type == "agent-start" || ev.Type == "agent-end" || ev.Type == "session-end" {
			quiet = false
		}
		if ev.Type == "agent-settled" {
			quiet = ev.Quiescent && ev.SessionID == a.SessionID
		}
	}
	return quiet
}

// A persisted launch intent fails closed after an ambiguous crash. A second
// caller sees the intent and attaches/resumes the recorded owner instead.
