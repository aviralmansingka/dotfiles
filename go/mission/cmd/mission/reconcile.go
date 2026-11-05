package main

import (
	"fmt"
	"os"
	"time"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

// attemptQuietWindow is how long an attempt must leave no trace before repair
// calls it quiescent: no event, no progress note, no report, and no write to its
// recorded session file. It is a bound, not a heartbeat: a process that works
// but does not write is not misread as dead inside this window, and a record
// that stayed silent past it is not left unclosable forever.
const attemptQuietWindow = 10 * time.Minute

// attemptState is what this host can prove about one attempt.
type attemptState int

const (
	// attemptLive means the attempt may still be working: a process answered
	// signal 0, or the attempt wrote inside the quiet window.
	attemptLive attemptState = iota
	// attemptQuiescent means no process answers here and nothing the attempt
	// records has been written inside the quiet window.
	attemptQuiescent
	// attemptUnjudgeable means this host has no evidence about the attempt at
	// all, so repair must not guess.
	attemptUnjudgeable
)

// attemptActivity reads the one liveness probe, processLiveness, and then the
// attempt's own recorded traces, in that order. A process answer wins: a live
// pid is never released. When the probe cannot inspect a process, the traces
// decide, because process_exited is not an answer: only the run wrapper sets
// that flag, so a wrapper killed with its child leaves it false on an attempt
// whose process is long gone.
func attemptActivity(a mission.Attempt) attemptState {
	switch processLiveness(a) {
	case processLive:
		return attemptLive
	case processUninspectable:
		if a.Machine != platform.Machine() {
			// Another host's pid, session file, and session are not this
			// host's to judge. Repair leaves that record alone.
			return attemptUnjudgeable
		}
		if a.PID > 0 {
			// The pid is local, but the kernel answered neither "exists" nor
			// "gone", so this host cannot prove anything about it.
			return attemptUnjudgeable
		}
	}
	fresh, judgeable := attemptWrote(a)
	switch {
	case !judgeable:
		return attemptUnjudgeable
	case fresh:
		return attemptLive
	}
	return attemptQuiescent
}

// attemptWrote reports whether the attempt left any dated trace inside the
// quiet window, and whether this host can date its traces at all. The recorded
// session file counts when it exists here: a live Pi session appends to it, so
// its modification time is the only heartbeat a seat without a pid offers. A
// session file this host cannot stat is no evidence either way, so repair
// refuses to judge; a missing file proves nothing, so the attempt's own stamps
// decide.
func attemptWrote(a mission.Attempt) (fresh, judgeable bool) {
	var last time.Time
	if a.SessionFile != "" {
		switch fi, e := os.Stat(a.SessionFile); {
		case e == nil && fi.Mode().IsRegular():
			judgeable, last = true, fi.ModTime()
		case e != nil && !os.IsNotExist(e):
			return false, false
		}
	}
	for _, s := range append([]string{a.Updated, a.Started}, attemptStamps(a)...) {
		if t, e := time.Parse(time.RFC3339Nano, s); e == nil {
			judgeable = true
			if t.After(last) {
				last = t
			}
		}
	}
	return judgeable && time.Since(last) < attemptQuietWindow, judgeable
}

// attemptStamps is every dated record the attempt keeps beyond its own
// updated_at and started_at stamps.
func attemptStamps(a mission.Attempt) []string {
	out := make([]string, 0, len(a.Events)+len(a.Progress)+len(a.Reports))
	for _, ev := range a.Events {
		out = append(out, ev.At)
	}
	for _, p := range a.Progress {
		out = append(out, p.At)
	}
	for _, rp := range a.Reports {
		out = append(out, rp.At)
	}
	return out
}

// reconcileAttempts ends every active attempt that is quiescent: no live
// process, and nothing written inside the quiet window. It calls the one
// liveness probe, processLiveness, instead of reading process_exited.
//
// Three cases change nothing. A live process, or any write inside the window,
// keeps the attempt running however the record looks. A record this host cannot
// judge, such as one on another host, stays untouched: repair refuses to end
// work on a guess, and `mission next` names `mission repair` for the caller who
// is blocked. A step that already passed keeps its attempt, because a passed
// step is never demoted; `mission abandon` ends such an attempt when a caller
// needs that.
func (s *App) reconcileAttempts(r *mission.Record) int {
	ended := 0
	for i := range r.State.Attempts {
		a := &r.State.Attempts[i]
		if !mission.Active(*a) {
			continue
		}
		if r.State.Steps[a.Step].Status == "passed" {
			continue
		}
		if attemptActivity(*a) != attemptQuiescent {
			continue
		}
		at := mission.Now()
		a.Status = "failed"
		a.Ended, a.Updated = at, at
		a.Events = append(a.Events, mission.Event{ID: mission.UID("event-"), Type: "attempt-reconciled", At: at,
			Summary: fmt.Sprintf("Repair marked attempt %s on step %s failed: %s, and no event, progress, report, or session write for %s",
				a.ID, a.Step, quietNote(*a), attemptQuietWindow)})
		// The step is left failed, not pending: the record has to be read
		// before the work is offered again, exactly as a lost owner leaves it.
		ss := r.State.Steps[a.Step]
		if ss.Attempt == "" || ss.Attempt == a.ID {
			r.State.Steps[a.Step] = mission.StepState{Status: "failed", Attempt: a.ID}
		}
		if r.State.Active == a.ID {
			r.State.Active = ""
			r.State.Current = a.Step
			r.State.Status = "failed"
		}
		ended++
	}
	return ended
}

// quietNote names why repair judged the attempt, so the event records whether
// the process was proven gone or was merely never inspectable from this host.
func quietNote(a mission.Attempt) string {
	switch processLiveness(a) {
	case processGone:
		return fmt.Sprintf("its process %d on %s is gone", a.PID, a.Machine)
	case processLive:
		return "its process answered signal 0"
	}
	if a.PID > 0 {
		return fmt.Sprintf("this host could not judge its process %d", a.PID)
	}
	if a.SessionFile != "" {
		return "its session reports no process this host can inspect, and its session file is stale"
	}
	return "its session reports no process this host can inspect"
}
