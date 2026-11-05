package main

import (
	"errors"
	"strings"
	"syscall"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

// abandonedStatus is the terminal status of an attempt its owner could no
// longer close. It is distinct from "interrupted", which repair writes for an
// attempt that lost the ledger and could still be resumed, and from "failed",
// which records work that ran and did not satisfy the step.
const abandonedStatus = "abandoned"

// liveness is the answer to one question: does this attempt still have a live
// process? It is the only probe. `abandon`, and `repair`'s reconciliation, ask
// it instead of reading process_exited, because only the run wrapper can set
// that flag: a wrapper killed with its child leaves process_exited false on an
// attempt whose process is long gone.
type liveness int

const (
	// processGone means no process answers for this attempt any more.
	processGone liveness = iota
	// processLive means a process answers signal 0.
	processLive
	// processUninspectable means the attempt records no process this host may
	// judge: a Pi seat is Herdr's child, and another host's pid is not ours.
	processUninspectable
)

// processLiveness probes the attempt's recorded process. Signal 0 asks "does
// this process exist and may I signal it", so only ESRCH proves the process is
// gone; EPERM means it exists under another user. A pid recorded on another
// host means nothing here, so it is never probed.
func processLiveness(a mission.Attempt) liveness {
	if a.PID <= 0 || a.Machine != platform.Machine() {
		return processUninspectable
	}
	e := syscall.Kill(a.PID, 0)
	switch {
	case e == nil, errors.Is(e, syscall.EPERM):
		return processLive
	case errors.Is(e, syscall.ESRCH):
		return processGone
	}
	return processUninspectable
}

// abandonedView is the abandon contract: it names the attempt and the step, so
// the caller reads back exactly which piece of work it released.
type abandonedView struct {
	Handle  string `json:"handle"`
	Attempt string `json:"attempt"`
	Step    string `json:"step"`
	Status  string `json:"status"`
	Note    string `json:"note"`
	EndedAt string `json:"ended_at,omitempty"`
	Already bool   `json:"already,omitempty"`
}

// abandon ends one attempt whose process is gone. It needs no attempt token,
// because the caller is the commander or the owner of a lost process rather
// than the process itself. It refuses while the attempt still has a live
// process, and it refuses an attempt whose process this host cannot inspect:
// ending a live trooper's work on a guess is worse than leaving the record for
// repair. It never edits mission.md and never replays an edit journal.
func (s *Store) abandon(h, id, note string) (abandonedView, error) {
	var out abandonedView
	if h == "" || id == "" {
		return out, mission.Problem("usage", "abandon needs a mission and an attempt: mission abandon REPO/SLUG --attempt ATTEMPT --note TEXT")
	}
	if note = trimNote(note); note == "" {
		return out, mission.Problem("usage", "abandon needs --note TEXT: the record keeps why the attempt ended")
	}
	e := s.locked(func() error {
		r, e := s.load(h)
		if e != nil {
			return e
		}
		if e = requireOpen(r); e != nil {
			return e
		}
		a, e := mission.FindAttempt(&r.State, id)
		if e != nil {
			return e
		}
		out = abandonedView{Handle: r.Handle, Attempt: a.ID, Step: a.Step, Status: a.Status, Note: note, EndedAt: a.Ended}
		if !mission.Active(*a) {
			if a.Status == abandonedStatus {
				// A repeat abandon reports the earlier release; the record is
				// untouched, so a retried command cannot write twice.
				out.Already = true
				return nil
			}
			return mission.Problem("attempt_terminal", "attempt %s is already %s; nothing to abandon", a.ID, a.Status)
		}
		// processGone is the zero value: only a proven-gone process falls
		// through to the release below.
		switch processLiveness(*a) {
		case processLive:
			return mission.Problem("busy", "attempt %s still has a live process (pid %d on %s); end it from its owner, or wait for that process to exit before abandoning", a.ID, a.PID, a.Machine)
		case processUninspectable:
			return mission.Problem("busy", "attempt %s records no process this host can inspect, so a live session cannot be ruled out; reconcile it with:\n  mission repair %s", a.ID, r.Handle)
		}
		at := mission.Now()
		a.Status = abandonedStatus
		a.Ended, a.Updated = at, at
		a.Events = append(a.Events, mission.Event{ID: mission.UID("event-"), Type: "attempt-abandoned", At: at, Summary: note})
		// The step is left failed, not pending: the record now has to be read
		// before the work is offered again, exactly as a lost owner leaves it.
		ss := r.State.Steps[a.Step]
		if ss.Attempt == "" || ss.Attempt == a.ID {
			r.State.Steps[a.Step] = mission.StepState{Status: "failed", Attempt: a.ID}
		}
		if r.State.Active == a.ID {
			r.State.Active = ""
			r.State.Status = "failed"
		}
		out.Status, out.EndedAt = a.Status, a.Ended
		r.State.Revision++
		return s.save(&r)
	})
	return out, e
}

// trimNote bounds one human note. An empty note refuses, and a very long one is
// cut so a paste cannot bloat the ledger.
func trimNote(note string) string {
	n := []rune(strings.TrimSpace(note))
	if len(n) > 2000 {
		n = append(n[:1999], '…')
	}
	return string(n)
}
