package main

import (
	"strings"
	"testing"

	"mission.local/prototype/internal/domain/mission"
)

// stampBuild pins the -X stamp and the fake Herdr answer for one test, so a
// record can be read for exactly the strings this build would print.
func stampBuild(t *testing.T, revision, at, herdr string) {
	t.Helper()
	swapRevision, swapTime, swapHerdr := buildRevision, buildTime, herdrVersionRead
	t.Cleanup(func() { buildRevision, buildTime, herdrVersionRead = swapRevision, swapTime, swapHerdr })
	buildRevision, buildTime = revision, at
	herdrVersionRead = func() string { return herdr }
}

// versionEventsOf returns every version event the attempt carries.
func versionEventsOf(t *testing.T, s *Store, handle, attempt string) []mission.Event {
	t.Helper()
	r, e := s.load(handle)
	must(t, e)
	a, e := mission.FindAttempt(&r.State, attempt)
	must(t, e)
	out := []mission.Event{}
	for _, ev := range a.Events {
		if ev.Type == "version" {
			out = append(out, ev)
		}
	}
	return out
}

// TestClaimRecordsOneVersionEvent is the first half of the acceptance line: a
// fresh attempt carries exactly one version event, and its summary names both
// the mission stamp and the Herdr version.
func TestClaimRecordsOneVersionEvent(t *testing.T) {
	s, h := fixture(t)
	stampBuild(t, "deadbeefcafe", "2026-11-05T19:00:00+00:00", "0.9.3")
	c := claimTest(t, s, h)

	events := versionEventsOf(t, s, h, c.Attempt.ID)
	if len(events) != 1 {
		t.Fatalf("%d version events, want exactly 1", len(events))
	}
	ev := events[0]
	if ev.Tool != "mission" {
		t.Fatalf("version event tool = %q, want mission", ev.Tool)
	}
	if ev.ID == "" || ev.At == "" {
		t.Fatalf("version event has no identity: %+v", ev)
	}
	for _, want := range []string{
		"mission ",
		"rev deadbeefcafe",
		"time 2026-11-05T19:00:00+00:00",
		"on herdr 0.9.3",
	} {
		if !strings.Contains(ev.Summary, want) {
			t.Fatalf("version event summary = %q, want it to contain %q", ev.Summary, want)
		}
	}
	if strings.ContainsAny(ev.Summary, "\n\r") {
		t.Fatalf("version event summary is not one line: %q", ev.Summary)
	}
}

// TestClaimStartsWithoutHerdr is the second half: with no herdr binary on PATH
// the launch still starts and still records the stamp, reading herdr as unknown.
func TestClaimStartsWithoutHerdr(t *testing.T) {
	s, h := fixture(t)
	// A PATH with nothing on it is a host with no herdr binary; a research claim
	// needs no other command, so this is the whole launch path.
	t.Setenv("PATH", t.TempDir())
	revision, at := buildRevision, buildTime
	t.Cleanup(func() { buildRevision, buildTime = revision, at })
	buildRevision, buildTime = "deadbeefcafe", "2026-11-05T19:00:00+00:00"

	if got := herdrVersion(); got != versionUnknown {
		t.Fatalf("herdr version without a herdr binary = %q, want %q", got, versionUnknown)
	}
	c, e := s.claim(h, "scout", "session-test", "", false)
	if e != nil {
		t.Fatalf("a launch with no herdr must start: %v", e)
	}
	events := versionEventsOf(t, s, h, c.Attempt.ID)
	if len(events) != 1 {
		t.Fatalf("%d version events, want exactly 1", len(events))
	}
	for _, want := range []string{"rev deadbeefcafe", "on herdr unknown"} {
		if !strings.Contains(events[0].Summary, want) {
			t.Fatalf("version event summary = %q, want it to contain %q", events[0].Summary, want)
		}
	}
}

// TestVersionSummaryReadsUnknownForAnEmptyHerdr keeps the summary honest when a
// caller has nothing to say about herdr.
func TestVersionSummaryReadsUnknownForAnEmptyHerdr(t *testing.T) {
	stampBuild(t, "deadbeefcafe", "2026-11-05T19:00:00+00:00", "")
	got := versionSummary("  ")
	if !strings.HasSuffix(got, " on herdr unknown") {
		t.Fatalf("summary = %q, want it to end with herdr unknown", got)
	}
}

// TestFirstLineKeepsOneVersionLine proves the quoted herdr answer may not break
// the one-line record, whatever the binary printed.
func TestFirstLineKeepsOneVersionLine(t *testing.T) {
	for name, tc := range map[string]struct{ out, want string }{
		"program name dropped": {"herdr 0.9.3\n", "0.9.3"},
		"blank first line":     {"\n  \nherdr 0.9.4\nmore\n", "0.9.4"},
		"bare version":         {"0.9.5", "0.9.5"},
		"program name only":    {"herdr \n", versionUnknown},
		"empty":                {"", versionUnknown},
	} {
		if got := firstLine(tc.out); got != tc.want {
			t.Errorf("%s: firstLine = %q, want %q", name, got, tc.want)
		}
	}
}
