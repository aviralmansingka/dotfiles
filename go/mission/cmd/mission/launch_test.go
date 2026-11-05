package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

// launchDesk is a desk whose requests land in a throwaway state dir, opened on
// the lane that holds the fixture mission.
func launchDesk(t *testing.T) (*desk, string) {
	t.Helper()
	s, h := fixture(t)
	m := newDesk(s)
	dir := t.TempDir()
	m.launchDir = dir
	m.refresh()
	selectHandle(t, m, h)
	return m, dir
}

func press(m *desk, key string) {
	m.Update(tea.KeyPressMsg{Code: []rune(key)[0], Text: key})
}

func TestLaunchRequestIsWrittenOnce(t *testing.T) {
	m, dir := launchDesk(t)
	handle := m.records[m.selected].Handle
	at := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	l, created, e := requestLaunch(dir, launchOwner{}, handle, "dotfiles", at)
	must(t, e)
	if !created || l.State != launchPending {
		t.Fatalf("first request: created=%v state=%s", created, l.State)
	}
	again, created, e := requestLaunch(dir, launchOwner{}, handle, "dotfiles", at.Add(time.Minute))
	must(t, e)
	if created {
		t.Fatal("a live request was rewritten")
	}
	if again.Requested != l.Requested {
		t.Fatalf("request time moved from %s to %s", l.Requested, again.Requested)
	}
	// A claimed request still owns the launch: the press that follows it is a
	// duplicate, not a second launch.
	must(t, platform.AtomicWrite(launchFile(dir, handle), []byte(`{"handle":"`+handle+`","repo":"dotfiles","requested_at":"2026-01-01T00:00:00Z","state":"claimed"}`)))
	if _, created, e = requestLaunch(dir, launchOwner{}, handle, "dotfiles", at); e != nil || created {
		t.Fatalf("claimed request: created=%v err=%v", created, e)
	}
}

func TestFailedLaunchCanBeRequestedAgain(t *testing.T) {
	_, dir := launchDesk(t)
	handle := "dotfiles/test-mission"
	at := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	_, _, e := requestLaunch(dir, launchOwner{}, handle, "dotfiles", at)
	must(t, e)
	must(t, platform.AtomicWrite(launchFile(dir, handle), []byte(`{"handle":"`+handle+`","repo":"dotfiles","state":"failed","error":"Herdr is not running"}`)))
	if _, created, e := requestLaunch(dir, launchOwner{}, handle, "dotfiles", at.Add(time.Minute)); e != nil || !created {
		t.Fatalf("a failed request must be retryable: created=%v err=%v", created, e)
	}
}

func TestLaunchReadIgnoresTornFiles(t *testing.T) {
	_, dir := launchDesk(t)
	handle := "dotfiles/test-mission"
	must(t, os.MkdirAll(filepath.Dir(launchFile(dir, handle)), 0o700))
	must(t, os.WriteFile(launchFile(dir, handle), []byte(`{"handle":`), 0o600))
	if _, ok := readLaunch(dir, handle); ok {
		t.Fatal("a torn request is not a request")
	}
	if len(launches(dir)) != 0 {
		t.Fatal("a torn request must not reach the list")
	}
}

func TestLaunchKeyWritesOneRequestAndShowsIt(t *testing.T) {
	m, dir := launchDesk(t)
	handle := m.records[m.selected].Handle
	press(m, "L")
	if m.err != nil {
		t.Fatal(m.err)
	}
	if !strings.Contains(m.notice, "Launch requested") {
		t.Fatalf("notice = %q", m.notice)
	}
	first, ok := readLaunch(dir, handle)
	if !ok || first.State != launchPending {
		t.Fatalf("request = %+v ok=%v", first, ok)
	}
	// The second press is a duplicate: same file, same request time, and the desk
	// says so instead of pretending it launched again.
	press(m, "L")
	second, _ := readLaunch(dir, handle)
	if second.Requested != first.Requested {
		t.Fatalf("second press rewrote the request: %s -> %s", first.Requested, second.Requested)
	}
	if !strings.Contains(m.notice, "already pending") {
		t.Fatalf("notice = %q", m.notice)
	}
	files, e := os.ReadDir(filepath.Join(dir, "launches"))
	must(t, e)
	if len(files) != 1 {
		t.Fatalf("%d request files, want 1", len(files))
	}
}

func TestLaunchStateReachesTheFrame(t *testing.T) {
	m, dir := launchDesk(t)
	handle := m.records[m.selected].Handle
	m.width, m.height = 128, 42
	press(m, "L")
	frame := stripANSI(m.render())
	if !strings.Contains(frame, "LAUNCH PENDING") {
		t.Fatalf("the detail panel does not show the pending launch:\n%s", frame)
	}
	if !strings.Contains(frame, "launch pending") {
		t.Fatalf("the mission list does not show the pending launch:\n%s", frame)
	}
	// The extension reports back through the same file, so the next refresh
	// shows a started mission and a failure the human can read.
	must(t, platform.AtomicWrite(launchFile(dir, handle), []byte(`{"handle":"`+handle+`","repo":"dotfiles","state":"failed","error":"Herdr is not running"}`)))
	m.refresh()
	frame = stripANSI(m.render())
	if !strings.Contains(frame, "LAUNCH FAILED") || !strings.Contains(frame, "Herdr is not running") {
		t.Fatalf("the failure is not visible:\n%s", frame)
	}
}

// ownDesk marks the desk's record as owned by a live Pi session, the way a
// claim leaves it, and re-filters so the detail panel reads the same record.
func ownDesk(t *testing.T, m *desk, handle string) {
	t.Helper()
	for i := range m.records {
		if m.records[i].Handle == handle {
			m.records[i].State.Runtime = &mission.RuntimeBinding{Machine: platform.Machine(), SessionID: "owner-session"}
		}
	}
	selectHandle(t, m, handle)
}

func TestLaunchKeyRefusesAnOwnedMission(t *testing.T) {
	m, dir := launchDesk(t)
	ownDesk(t, m, m.records[m.selected].Handle)
	press(m, "L")
	if !strings.Contains(m.notice, "Already owned") {
		t.Fatalf("notice = %q", m.notice)
	}
	if _, e := os.ReadDir(filepath.Join(dir, "launches")); e == nil {
		t.Fatal("an owned mission must not write a launch request")
	}
}

func TestLaunchFilesAreNamedPerHandle(t *testing.T) {
	dir := t.TempDir()
	if got := filepath.Base(launchFile(dir, "dotfiles/missions-desk-ui")); got != "dotfiles--missions-desk-ui.json" {
		t.Fatalf("file = %s", got)
	}
}

// A request is addressed to the seat that asked for it, so one Pi session in
// that Herdr workspace picks it up and no other repository can adopt it.
func TestLaunchRequestRecordsTheSeatThatAsked(t *testing.T) {
	t.Setenv("HERDR_WORKSPACE_ID", "w67")
	t.Setenv("HERDR_PANE_ID", "w67:p9")
	m, dir := launchDesk(t)
	press(m, "L")
	l, ok := readLaunch(dir, m.records[m.selected].Handle)
	if !ok {
		t.Fatal("the press wrote no request")
	}
	if l.OwnerWorkspace != "w67" || l.OwnerLabel != "w67:p9" {
		t.Fatalf("owner = %q/%q, want w67/w67:p9", l.OwnerWorkspace, l.OwnerLabel)
	}
	if l.OwnerCommon == "" {
		t.Fatal("the request does not record its checkout family")
	}
	if !strings.Contains(m.notice, "w67") {
		t.Fatalf("the notice does not name the seat: %q", m.notice)
	}
}

// Outside Herdr the desk has no seat. The request stays inside the repository
// and any idle session there may claim it.
func TestLaunchOutsideHerdrWaitsForTheRepository(t *testing.T) {
	t.Setenv("HERDR_WORKSPACE_ID", "")
	t.Setenv("HERDR_PANE_ID", "")
	m, dir := launchDesk(t)
	press(m, "L")
	l, _ := readLaunch(dir, m.records[m.selected].Handle)
	if l.OwnerWorkspace != "" || l.OwnerLabel != "" {
		t.Fatalf("owner = %q/%q, want an unaddressed request", l.OwnerWorkspace, l.OwnerLabel)
	}
	if line := ownerLine(l); !strings.Contains(line, "this repository") {
		t.Fatalf("owner line = %q", line)
	}
}

// The receipt names the Herdr agent the launch created, so the human can find
// the new tab instead of guessing whether anything happened.
func TestStartedLaunchShowsItsHerdrAgent(t *testing.T) {
	m, dir := launchDesk(t)
	handle := m.records[m.selected].Handle
	m.width, m.height = 128, 42
	press(m, "L")
	l, _ := readLaunch(dir, handle)
	l.State, l.Workspace, l.Pane = launchStarted, "w42", "w42:p1"
	b, e := json.Marshal(l)
	must(t, e)
	must(t, platform.AtomicWrite(launchFile(dir, handle), b))
	m.refresh()
	frame := stripANSI(m.render())
	if !strings.Contains(frame, "Herdr agent in w42") {
		t.Fatalf("the receipt does not name the created agent:\n%s", frame)
	}
}
