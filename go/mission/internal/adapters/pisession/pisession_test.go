package pisession

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"

	"mission.local/prototype/internal/domain/mission"
)

// sessionFile writes the given lines to a new file and returns its path.
func sessionFile(t *testing.T, lines ...string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "session.jsonl")
	b := []byte{}
	for _, line := range lines {
		b = append(b, []byte(line+"\n")...)
	}
	if e := os.WriteFile(p, b, 0o600); e != nil {
		t.Fatal(e)
	}
	return p
}

// TestHeaderReadsTheFirstLine pins the identity a session file proves: only the
// first line is the header, and the rest of the transcript is never parsed.
func TestHeaderReadsTheFirstLine(t *testing.T) {
	p := sessionFile(t, `{"type":"session","id":"pi-1","cwd":"/work/tree"}`, `{"type":"message"}`)
	h, e := Header(p)
	if e != nil {
		t.Fatal(e)
	}
	if h.HeaderErr != nil || h.Type != "session" || h.ID != "pi-1" || h.Cwd != "/work/tree" {
		t.Fatalf("header = %+v", h)
	}
}

// TestHeaderReportsWhyThereIsNoIdentity pins the two failures the core refuses
// with its own words: a file with no first line, and a first line that is not a
// header.
func TestHeaderReportsWhyThereIsNoIdentity(t *testing.T) {
	h, e := Header(sessionFile(t))
	if e != nil {
		t.Fatal(e)
	}
	if !errors.Is(h.HeaderErr, io.EOF) {
		t.Fatalf("empty file HeaderErr = %v, want io.EOF", h.HeaderErr)
	}
	h, e = Header(sessionFile(t, "not json"))
	if e != nil {
		t.Fatal(e)
	}
	if h.HeaderErr == nil || errors.Is(h.HeaderErr, io.EOF) {
		t.Fatalf("undecodable header HeaderErr = %v, want a decode error", h.HeaderErr)
	}
	// A header of the wrong shape decodes into fields the core compares and
	// refuses; the read itself is not an error.
	h, e = Header(sessionFile(t, `{"type":"message","id":"pi-1"}`))
	if e != nil {
		t.Fatal(e)
	}
	if h.HeaderErr != nil || h.Type != "message" {
		t.Fatalf("header = %+v", h)
	}
}

// TestHeaderReportsAnUnreadableFile pins the one case the read reports as an
// error instead of a header, so a caller keeps the underlying reason.
func TestHeaderReportsAnUnreadableFile(t *testing.T) {
	_, e := Header(filepath.Join(t.TempDir(), "missing.jsonl"))
	if e == nil {
		t.Fatal("a missing session file read as a header")
	}
	if _, ok := e.(*mission.DomainError); ok {
		t.Fatalf("a read failure became a domain refusal: %v", e)
	}
}
