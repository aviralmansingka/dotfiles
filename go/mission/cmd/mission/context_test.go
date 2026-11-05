package main

import (
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"testing"

	"mission.local/prototype/internal/domain/mission"
)

// attemptID matches one attempt id in rendered text, so a test can assert on
// what a seat actually reads instead of on the field that produced it.
var attemptID = regexp.MustCompile(`attempt-[0-9a-f]{24}`)

// rendered is the text one emitter hands a seat: the JSON the CLI prints.
func rendered(t *testing.T, v any) string {
	t.Helper()
	b, e := json.MarshalIndent(v, "", "  ")
	must(t, e)
	return string(b)
}

// emittedContext is the injected text of one context view: the step context and
// the driver lines a seat reads. The record the view also carries is ledger data
// (its attempts list names every attempt, current or ended), not injected text,
// so a test that checks what a seat reads reads exactly this.
func emittedContext(v contextView) string { return v.Context + strings.Join(v.Driver, "\n") }

// emittedClaim is the injected text of one claim: the context, the driver lines,
// and the environment line that names an attempt.
func emittedClaim(c mission.Claim) string {
	return c.Context + strings.Join(c.Driver, "\n") + c.Environment["MISSION_ATTEMPT"]
}

// named is every attempt id the rendered text names.
func named(text string) []string { return attemptID.FindAllString(text, -1) }

// reClaim ends the attempt a claim opened, the way a dead owner leaves it, and
// claims the same step again. It returns both claims, so a test can compare the
// text each one emitted.
func reClaim(t *testing.T, s *Store, h string) (mission.Claim, mission.Claim) {
	t.Helper()
	first := claimTest(t, s, h)
	_, e := s.finish(h, first.Attempt.ID, first.Token, true, "owner tab closed", false, 1)
	must(t, e)
	_, e = s.retry(h)
	must(t, e)
	second := claimTest(t, s, h)
	if second.Attempt.ID == first.Attempt.ID {
		t.Fatalf("the re-claim reused attempt %s", first.Attempt.ID)
	}
	return first, second
}

// TestContextNamesTheNewAttemptAfterReClaim pins the acceptance case: context
// emitted after a re-claim names the new attempt id, in the claim a seat reads,
// in the context `show` renders, and in the brief file MISSION_BRIEF points at.
// Between the two claims the ledger lists no owner, and nothing emitted then
// names an attempt at all — a captured snapshot would.
func TestContextNamesTheNewAttemptAfterReClaim(t *testing.T) {
	s, h := fixture(t)
	first := claimTest(t, s, h)
	_, e := s.finish(h, first.Attempt.ID, first.Token, true, "owner tab closed", false, 1)
	must(t, e)
	// Nothing owns the mission between the two claims.
	between := emittedContext(contextOf(ledger(t, s, h)))
	if ids := named(between); len(ids) != 0 {
		t.Fatalf("the idle ledger's context named %v", ids)
	}
	if !strings.Contains(between, "No active attempt") {
		t.Fatalf("the idle ledger's context does not say it lists no attempt:\n%s", between)
	}
	_, e = s.retry(h)
	must(t, e)
	second := claimTest(t, s, h)
	if second.Attempt.ID == first.Attempt.ID {
		t.Fatalf("the re-claim reused attempt %s", first.Attempt.ID)
	}
	after := emittedClaim(second)
	if !strings.Contains(after, second.Attempt.ID) {
		t.Fatalf("the emitted claim does not name the new attempt %s:\n%s", second.Attempt.ID, after)
	}
	// The old attempt is no longer the owner, so no emitted line may name it.
	if strings.Contains(after, first.Attempt.ID) {
		t.Fatalf("the emitted claim still names the previous attempt %s:\n%s", first.Attempt.ID, after)
	}
	// The same record at render time, through the surface the extension reads.
	live := emittedContext(contextOf(ledger(t, s, h)))
	if !strings.Contains(live, second.Attempt.ID) || strings.Contains(live, first.Attempt.ID) {
		t.Fatalf("`show` rendered the wrong attempt for %s:\n%s", h, live)
	}
	// And the brief file the seat is pointed at was re-rendered with it.
	file, e := os.ReadFile(second.Environment["MISSION_BRIEF"])
	must(t, e)
	if !strings.Contains(string(file), second.Attempt.ID) {
		t.Fatalf("the emitted brief does not name the new attempt %s:\n%s", second.Attempt.ID, file)
	}
	if strings.Contains(string(file), first.Attempt.ID) {
		t.Fatalf("the emitted brief still names the previous attempt %s:\n%s", first.Attempt.ID, file)
	}
	if string(file) != second.Context {
		t.Fatalf("the brief file and the emitted context disagree:\n%s\n---\n%s", file, second.Context)
	}
	// The environment line names the same attempt the ledger lists.
	if got := second.Environment["MISSION_ATTEMPT"]; got != second.Attempt.ID {
		t.Fatalf("MISSION_ATTEMPT names %s, the ledger lists %s", got, second.Attempt.ID)
	}
}

// TestContextNeverNamesAnAttemptTheLedgerDoesNotList pins the other half: a
// ledger whose active_attempt names nothing the attempts list holds emits no
// attempt id anywhere, and the emitter refuses to hand a seat a claim for it
// rather than naming a phantom.
func TestContextNeverNamesAnAttemptTheLedgerDoesNotList(t *testing.T) {
	s, h := fixture(t)
	c := claimTest(t, s, h)
	// The incident's shape: active_attempt survives, the attempt record does not.
	lost := ledger(t, s, h)
	lost.State.Attempts = nil
	for _, text := range []string{
		emittedContext(contextOf(lost)),
		strings.Join(driverLines(lost), "\n"),
		stepContext(lost),
	} {
		if ids := named(text); len(ids) != 0 {
			t.Fatalf("context named an attempt the ledger does not list: %v\n%s", ids, text)
		}
		if !strings.Contains(text, "No active attempt") {
			t.Fatalf("context did not say the ledger lists no attempt:\n%s", text)
		}
	}
	// An attempt id from an earlier sequence is not the owner either.
	older := ledger(t, s, h)
	older.State.Active = "attempt-000000000000000000000000"
	if ids := named(emittedContext(contextOf(older))); len(ids) != 0 {
		t.Fatalf("context named an unlisted attempt: %v", ids)
	}
	// The emitter refuses instead of naming one, so no seat receives it.
	_, e := s.emitClaim(lost, c.Attempt, c.Token)
	wantCode(t, e, "stale_attempt")
	// The record the ledger holds is untouched by any of the reads.
	if got := ledger(t, s, h).State.Active; got != c.Attempt.ID {
		t.Fatalf("a read changed the ledger's owner to %q", got)
	}
}

// TestBriefNamesTheLedgerAttempt pins the brief: the text MISSION_BRIEF points
// at is rendered from the ledger when it is emitted, so each claim's brief names
// its own attempt and no brief names one the ledger dropped.
func TestBriefNamesTheLedgerAttempt(t *testing.T) {
	s, h := fixture(t)
	first, second := reClaim(t, s, h)
	read := func(c mission.Claim) string {
		t.Helper()
		b, e := os.ReadFile(c.Environment["MISSION_BRIEF"])
		must(t, e)
		return string(b)
	}
	one, two := read(first), read(second)
	if !strings.Contains(one, first.Attempt.ID) || !strings.Contains(two, second.Attempt.ID) {
		t.Fatalf("a brief did not name its own attempt:\n%s\n---\n%s", one, two)
	}
	if strings.Contains(two, first.Attempt.ID) {
		t.Fatalf("the re-claim's brief still names the previous attempt:\n%s", two)
	}
	// Both briefs carry the step the attempt runs, so a seat is told what to do.
	for _, text := range []string{one, two} {
		if !strings.Contains(text, "# Assigned step: S01") {
			t.Fatalf("the brief lost its step:\n%s", text)
		}
		if !strings.Contains(text, "## Acceptance criteria") {
			t.Fatalf("the brief lost its acceptance criteria:\n%s", text)
		}
	}
}

// TestDriverLinesReadTheLedgerAttempt pins the driver and continuation lines:
// they name the attempt the ledger lists now, name none when it lists none, and
// hand the seat the one command that advances the mission.
func TestDriverLinesReadTheLedgerAttempt(t *testing.T) {
	s, h := fixture(t)
	idle := strings.Join(driverLines(ledger(t, s, h)), "\n")
	if ids := named(idle); len(ids) != 0 {
		t.Fatalf("the idle driver lines named %v", ids)
	}
	if !strings.Contains(idle, "Mission "+h+" is ready.") {
		t.Fatalf("the idle driver lines lost the mission status:\n%s", idle)
	}
	c := claimTest(t, s, h)
	live := strings.Join(driverLines(ledger(t, s, h)), "\n")
	if !strings.Contains(live, "Attempt "+c.Attempt.ID+" on step S01 is running.") {
		t.Fatalf("the driver lines did not name the listed attempt:\n%s", live)
	}
	// A reported attempt is one command away from completion, and the lines say
	// which; the id is still the ledger's, never a value captured before.
	_, e := s.mutate(h, func(r *mission.Record) error {
		a, e := mission.FindAttempt(&r.State, c.Attempt.ID)
		if e != nil {
			return e
		}
		a.Status = "reported"
		return nil
	})
	must(t, e)
	reported := strings.Join(driverLines(ledger(t, s, h)), "\n")
	if !strings.Contains(reported, "The next command: mission finish "+h) {
		t.Fatalf("the driver lines lost the completion command:\n%s", reported)
	}
	// The one attempt id they name is the one the ledger lists.
	if ids := named(reported); len(ids) != 1 || ids[0] != c.Attempt.ID {
		t.Fatalf("the driver lines named %v, the ledger lists %s", ids, c.Attempt.ID)
	}
}
