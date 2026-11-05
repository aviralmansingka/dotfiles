package main

import (
	"strings"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

// closedStatus is the terminal status of a retired mission. A closed mission
// keeps its record, its attempts, and its runtime binding as history; it only
// stops offering work and stops reviving its checkout.
const closedStatus = "closed"

// closedView is the close contract: the handle, the new status, and whether an
// earlier call already closed the record.
type closedView struct {
	Handle    string `json:"handle"`
	Status    string `json:"status"`
	ClosedAt  string `json:"closed_at,omitempty"`
	CloseNote string `json:"close_note,omitempty"`
	Already   bool   `json:"already,omitempty"`
}

// requireOpen refuses a command that needs live work once the record is closed.
// Every mutating command funnels through this check, so a retired mission never
// claims a new attempt or revives its deleted checkout.
func requireOpen(r mission.Record) error {
	if r.State.Status != closedStatus {
		return nil
	}
	return mission.Problem("closed", "mission %s is closed; start a new mission with:\n  mission new %s/NAME --title TITLE --goal GOAL --step STEP", r.Handle, r.Mission.Repo)
}

// unfinishedSteps lists the defined steps the ledger has not passed yet.
func unfinishedSteps(r mission.Record) []string {
	out := []string{}
	for _, step := range r.Mission.Steps {
		if r.State.Steps[step.ID].Status != "passed" {
			out = append(out, step.ID)
		}
	}
	return out
}

// close retires one mission record. It refuses live work unless forced, and a
// second close on the same record reports the earlier close instead of failing.
func (s *App) close(h, note string, force bool) (closedView, error) {
	var out closedView
	_, e := s.update(h, func(r *mission.Record) error {
		if r.State.Status == closedStatus {
			out = closedView{Handle: r.Handle, Status: closedStatus, ClosedAt: r.State.ClosedAt, CloseNote: r.State.CloseNote, Already: true}
			return mission.ErrNoWrite
		}
		open := unfinishedSteps(*r)
		if !force && (r.State.Active != "" || len(open) > 0) {
			return mission.Problem("unfinished", "%s still has open work: %s. Retire it anyway with:\n  mission close %s --force --note %q", r.Handle, openWork(r.State.Active, open), h, platform.Fallback(strings.TrimSpace(note), "worktree retired by /cleanup"))
		}
		r.State.Status = closedStatus
		r.State.ClosedAt = mission.Now()
		r.State.CloseNote = note
		out = closedView{Handle: r.Handle, Status: closedStatus, ClosedAt: r.State.ClosedAt, CloseNote: r.State.CloseNote}
		return nil
	})
	return out, e
}

// openWork names every open item in one phrase, so the owner sees the whole
// refusal at once.
func openWork(active string, steps []string) string {
	parts := []string{}
	if active != "" {
		parts = append(parts, "active attempt "+active)
	}
	if len(steps) > 0 {
		parts = append(parts, "steps not passed: "+strings.Join(steps, ", "))
	}
	return strings.Join(parts, "; ")
}
