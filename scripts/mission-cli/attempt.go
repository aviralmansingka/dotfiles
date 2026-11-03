package main

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
)

func (s *Store) progress(h, id, token string, p Progress, paths []string) (Record, error) {
	if p.ID == "" || p.Summary == "" || len(p.Summary)+len(p.Next)+len(p.Blocker) > 8000 || len(paths) > 16 {
		return Record{}, problem("usage", "progress needs a stable event-id, summary, and at most 16 evidence paths (8000 characters total)")
	}
	if p.Status != "working" && p.Status != "blocked" && p.Status != "needs-input" && p.Status != "ready" {
		return Record{}, problem("usage", "progress status must be working, blocked, needs-input, or ready")
	}
	if (p.Status == "blocked" || p.Status == "needs-input") && p.Blocker == "" {
		return Record{}, problem("usage", "blocked progress needs --blocker")
	}
	request, _ := json.Marshal(struct {
		P     Progress
		Paths []string
	}{p, paths})
	finger := digest(request)
	return s.mutate(h, func(r *Record) error {
		a, e := findAttempt(&r.State, id)
		if e != nil {
			return e
		}
		if e = authorize(a, token); e != nil {
			return e
		}
		for _, old := range a.Progress {
			if old.ID == p.ID {
				if old.Fingerprint != finger {
					return problem("event_conflict", "progress id reused with different content")
				}
				return nil
			}
		}
		if !active(*a) || r.State.Active != id {
			return problem("stale_attempt", "progress needs the active attempt")
		}
		if len(a.Progress) >= 1024 {
			return problem("event_limit", "attempt progress limit reached")
		}
		for _, path := range paths {
			prefix := fmt.Sprintf("artifacts/%03d/", a.Sequence)
			if !strings.HasPrefix(path, prefix) || filepath.ToSlash(filepath.Clean(path)) != path {
				return problem("invalid_evidence", "evidence must be relative to this attempt: %s", prefix)
			}
			full, e := s.path(r.Mission.Repo, r.Mission.Slug, path)
			if e != nil {
				return e
			}
			b, e := readBounded(full, 16<<20)
			if e != nil {
				return e
			}
			p.Evidence = append(p.Evidence, Evidence{Path: path, Hash: digest(b)})
		}
		p.At, p.Fingerprint = now(), finger
		a.Progress = append(a.Progress, p)
		a.Updated = p.At
		r.State.Status = "running"
		if p.Status == "blocked" || p.Status == "needs-input" {
			r.State.Status = "waiting"
		}
		return nil
	})
}

// Only the adapter calls settle, after an explicit finish/fail report AND an
// observed quiescent turn boundary. It does not claim that the process exited.
func (s *Store) settle(h, id, token, session string) (Record, error) {
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
	if a.Execution != "pi" || a.SessionID != session {
		return r, problem("session_mismatch", "settlement needs the attached Pi session")
	}
	if a.Settled && !active(*a) {
		return r, nil
	}
	if a.Status != "reported" {
		return r, problem("completion_required", "report finish or fail before settling")
	}
	if !piQuiet(*a) {
		return r, problem("runtime_busy", "turn must end without pending children, messages, or external waits")
	}
	return s.finish(h, id, token, a.ReportedFailure, "Pi turn settled", false, 0, true)
}

func piQuiet(a Attempt) bool {
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
