package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
)

// launchDesk is a desk whose requests land in a throwaway state dir.
func launchDesk(t *testing.T) (*desk, string) {
	t.Helper()
	s, _ := fixture(t)
	m := newDesk(s)
	dir := t.TempDir()
	m.launchDir = dir
	m.refresh()
	return m, dir
}

func press(m *desk, key string) {
	m.Update(tea.KeyPressMsg{Code: []rune(key)[0], Text: key})
}

func TestLaunchRequestIsWrittenOnce(t *testing.T) {
	m, dir := launchDesk(t)
	handle := m.records[m.selected].Handle
	at := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	l, created, e := requestLaunch(dir, handle, "dotfiles", at)
	must(t, e)
	if !created || l.State != launchPending {
		t.Fatalf("first request: created=%v state=%s", created, l.State)
	}
	again, created, e := requestLaunch(dir, handle, "dotfiles", at.Add(time.Minute))
	must(t, e)
	if created {
		t.Fatal("a live request was rewritten")
	}
	if again.Requested != l.Requested {
		t.Fatalf("request time moved from %s to %s", l.Requested, again.Requested)
	}
	// A claimed request still owns the launch: the press that follows it is a
	// duplicate, not a second launch.
	must(t, atomicWrite(launchFile(dir, handle), []byte(`{"handle":"`+handle+`","repo":"dotfiles","requested_at":"2026-01-01T00:00:00Z","state":"claimed"}`)))
	if _, created, e = requestLaunch(dir, handle, "dotfiles", at); e != nil || created {
		t.Fatalf("claimed request: created=%v err=%v", created, e)
	}
}

func TestFailedLaunchCanBeRequestedAgain(t *testing.T) {
	_, dir := launchDesk(t)
	handle := "dotfiles/test-mission"
	at := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	_, _, e := requestLaunch(dir, handle, "dotfiles", at)
	must(t, e)
	must(t, atomicWrite(launchFile(dir, handle), []byte(`{"handle":"`+handle+`","repo":"dotfiles","state":"failed","error":"Herdr is not running"}`)))
	if _, created, e := requestLaunch(dir, handle, "dotfiles", at.Add(time.Minute)); e != nil || !created {
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
	must(t, atomicWrite(launchFile(dir, handle), []byte(`{"handle":"`+handle+`","repo":"dotfiles","state":"failed","error":"Herdr is not running"}`)))
	m.refresh()
	frame = stripANSI(m.render())
	if !strings.Contains(frame, "LAUNCH FAILED") || !strings.Contains(frame, "Herdr is not running") {
		t.Fatalf("the failure is not visible:\n%s", frame)
	}
}

func TestLaunchKeyRefusesAnOwnedMission(t *testing.T) {
	m, dir := launchDesk(t)
	m.records[m.selected].State.Runtime = &RuntimeBinding{Machine: machine(), SessionID: "owner-session"}
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
