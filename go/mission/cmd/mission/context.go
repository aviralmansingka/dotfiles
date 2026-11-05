package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"mission.local/prototype/internal/domain/mission"
)

// The active attempt is a ledger fact, never a captured value.
//
// On 2026-11-05 an attempt wedged while its owner session was dead. Injected
// context and the driver lines carried the attempt id a claim had captured, so
// a fresh seat could not attach while the ledger still listed that attempt, and
// a resumed session kept reporting under an id the ledger had stopped listing.
// Every renderer below reads the attempt from the record it is handed, so the
// text a seat reads names the attempt the ledger lists at that moment, or says
// that the ledger lists none.

// listedAttempt is the attempt the ledger names as its owner, and it is an
// attempt the ledger actually lists. A record whose active_attempt names
// nothing the attempts list holds has no attempt to render: such an id is a
// phantom, and naming it would hand a seat an owner the ledger cannot show.
func listedAttempt(r mission.Record) *mission.Attempt {
	if r.State.Active == "" {
		return nil
	}
	a, e := mission.FindAttempt(&r.State, r.State.Active)
	if e != nil {
		return nil
	}
	return a
}

// attemptLine is the one line of injected context that names an attempt.
func attemptLine(r mission.Record) string {
	a := listedAttempt(r)
	if a == nil {
		return "No active attempt: the ledger lists none. Claim the step before editing."
	}
	return fmt.Sprintf("Attempt %s on step %s is %s.", a.ID, a.Step, a.Status)
}

// stepBrief is the injected step context: the step brief this attempt was
// claimed with, then the attempt the ledger lists right now. The brief itself
// carries no attempt id, so the line that does is always read at render time.
func stepBrief(r mission.Record, st mission.Step) string {
	return assignedBrief(r.Mission, st) + "\n" + attemptLine(r) + "\n"
}

// stepContext is the injected context for the record as it stands: the brief of
// the step the ledger's attempt is running, or the status lines when the ledger
// lists no attempt.
func stepContext(r mission.Record) string {
	if a := listedAttempt(r); a != nil {
		return stepBrief(r, attemptDefinition(r, *a))
	}
	return strings.Join(driverLines(r), "\n") + "\n"
}

// driverLines are the driver and continuation lines for this record. They name
// the attempt the ledger lists, and they name none at all when it lists none: a
// seat is never told to report under an attempt the ledger cannot show.
func driverLines(r mission.Record) []string {
	lines := []string{fmt.Sprintf("Mission %s is %s.", r.Handle, r.State.Status)}
	a := listedAttempt(r)
	switch {
	case a != nil:
		lines = append(lines, attemptLine(r))
	case r.State.Current != "":
		lines = append(lines, fmt.Sprintf("%s, the current step, is %s. %s",
			r.State.Current, r.State.Steps[r.State.Current].Status, attemptLine(r)))
	default:
		lines = append(lines, attemptLine(r))
	}
	if cmd := nextCommand(r); cmd != nil {
		return append(lines, "The next command: "+*cmd)
	}
	// A held mission waits on a human, and a retired one takes no new attempt.
	if a == nil && r.State.Pending == "" && r.State.Status != closedStatus {
		lines = append(lines, "Inspect status and answer the human's status and admin prompts here. Start another step only with mission action=next after reviews are decided. Do not modify code while no step is active.")
	}
	return lines
}

// contextView is one mission record plus the text its seat reads. The two
// derived fields are rendered from this record at this moment, so a reader of
// this view — `show`, or the claim an attach returns — injects the attempt the
// ledger lists now, never one an earlier claim captured.
type contextView struct {
	recordView
	Context string   `json:"context"`
	Driver  []string `json:"driver"`
}

func contextOf(r mission.Record) contextView {
	return contextView{recordView: viewOf(r), Context: stepContext(r), Driver: driverLines(r)}
}

// emitClaim renders the claim one seat reads: the environment lines, the brief
// file, and the injected context. Everything here is computed from the record as
// it stands, so a replayed attach after a re-claim names the new attempt, and a
// report the seat sends names an attempt the ledger lists.
func (s *Store) emitClaim(r mission.Record, a mission.Attempt, token string) (mission.Claim, error) {
	listed := listedAttempt(r)
	if listed == nil || listed.ID != a.ID {
		return mission.Claim{}, mission.Problem("stale_attempt", "attempt %s is not the attempt the ledger lists", a.ID)
	}
	d, e := s.dir(r.Handle)
	if e != nil {
		return mission.Claim{}, e
	}
	st := attemptDefinition(r, a)
	brief := filepath.Join(d, "artifacts", fmt.Sprintf("%03d", a.Sequence), "brief.md")
	text := stepBrief(r, st)
	if e = os.MkdirAll(filepath.Dir(brief), 0o700); e != nil {
		return mission.Claim{}, e
	}
	if e = atomicWrite(brief, []byte(text)); e != nil {
		return mission.Claim{}, e
	}
	artifact := filepath.Join(d, filepath.FromSlash(a.Artifact))
	return mission.Claim{
		Handle: r.Handle, Step: st, Attempt: a, Token: token,
		Context: text, Driver: driverLines(r),
		Environment: map[string]string{
			"MISSION_VAULT": s.Vault, "MISSION_HANDLE": r.Handle, "MISSION_ATTEMPT": listed.ID,
			"MISSION_TOKEN": token, "MISSION_ARTIFACT": artifact, "MISSION_BRIEF": brief, "MISSION_STEP": a.Step,
		},
	}, nil
}
