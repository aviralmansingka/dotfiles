package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"mission.local/prototype/internal/domain/mission"
)

// A seat is one mux's vocabulary: the whole of what deploy asks a multiplexer to
// do. There are two implementations, rexSeat and herdrSeat, and deploy picks one
// by --mux. Deploy itself names no mux command and no mux noun: the plan owns the
// labels, and an adapter only seats them.
type seat interface {
	// mux names the multiplexer this adapter seats.
	mux() string
	// sessions is every session the mux knows, by label: how deploy finds a seat
	// it did not create.
	sessions() (map[string]string, error)
	// ensureSession creates the session labeled label, with one window labeled
	// window when window is not empty, and returns its id. An adapter that has no
	// session object of its own answers "" and creates nothing; cwd is where a
	// mux that opens a session on a checkout starts it.
	ensureSession(label, window, cwd string) (string, error)
	// window returns the window labeled label in one session, and whether a
	// captain still runs in it.
	window(sessionID, label string) (seatWindow, error)
	// focus lands on a live captain window.
	focus(sessionID, windowID string) error
	// clear closes a window whose captain is gone, so one label never names two.
	clear(sessionID, windowID string) error
	// place creates the captain's window, waits for its shell, writes the exec
	// line, and verifies that the captain took the seat.
	place(p Plan, sessionID string) (seatIdentity, error)
}

// seatWindow is a captain window deploy found by label. Live is what makes it a
// seat: the window and the block or pane it holds exist, and a captain still runs
// there. A window whose block the mux no longer knows, or whose block no longer
// runs pi, holds no captain, so seating a "second" captain there would seat none.
type seatWindow struct {
	Window string
	Block  string
	Live   bool
}

// seatIdentity is what a mux says about the captain it just seated: the window
// (a Rex window, a Herdr tab), the block or pane the captain runs in, and the Pi
// session file, where the mux reports one.
type seatIdentity struct {
	Window      string
	Pane        string
	SessionFile string
}

// seatFor returns the adapter for one --mux value. An unknown mux is refused
// before deploy reads or writes anything, and the message names both that work.
func seatFor(mux string) (seat, error) {
	switch mux {
	case "rex":
		return rexSeat{}, nil
	case "herdr":
		return herdrSeat{}, nil
	}
	return nil, mission.Problem("mux_unsupported", "deploy seats one plan in rex or herdr; --mux %q is neither", mux)
}

// The seat's waits are bounded: a login shell sources the human's profile before
// it reads its terminal (about three seconds on this machine), and pi takes the
// foreground once the exec line runs. Neither wait may run forever, because a
// shell that never listens and a captain that never starts are failures deploy
// reports, not races it sleeps through. Both adapters share them, so one mux's
// seat cannot wait twice as long as the other's.
var (
	seatPoll      = 100 * time.Millisecond
	seatShellWait = 10 * time.Second
	seatStartWait = 10 * time.Second
)

// seatExecLine is the one line that replaces the login shell with the captain:
// the plan's argv (the brief last, as its first message), the mission's
// environment, and the seat's own identity when the mux gives a block one. It
// sets no PATH: the login shell already carries the human's PATH, so `mission`,
// `rex`, and `pi` resolve inside the captain exactly as they do in the human's
// own terminal.
func seatExecLine(p Plan, identity ...string) string {
	argv := append(append([]string{}, p.CaptainArgv...), p.CaptainBrief)
	parts := []string{"exec", "env"}
	for _, kv := range identity {
		parts = append(parts, shellQuote(kv))
	}
	parts = append(parts,
		shellQuote("PI_SUBAGENT_SESSION="+p.SubagentSession),
		shellQuote("PI_SUBAGENT_CWD="+p.Cwd),
	)
	for _, a := range argv {
		parts = append(parts, shellQuote(a))
	}
	return strings.Join(parts, " ")
}

// shellQuote makes one argument safe inside the shell line the seat writes. The
// brief carries spaces and punctuation, so every argument is quoted, and a
// single quote inside an argument is closed, escaped, and reopened.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// loginShellArgv is the command that opens the captain's block: the human's own
// shell as a login shell, so its startup files run and the exec line that
// follows reaches pi with the human's PATH. $SHELL names that shell; a relative
// or missing value falls back to /bin/sh, which every Unix has. Pooling a PATH
// list here instead would be a second, drifting copy of the human's profile.
func loginShellArgv() []string { return []string{loginShell(), "-l"} }

// loginShell is the account's shell, as an absolute path that exists. A Rex
// window resolves a command against the server's own PATH, so the seat names the
// shell by path and never by name.
func loginShell() string {
	if sh := os.Getenv("SHELL"); filepath.IsAbs(sh) {
		if st, e := os.Stat(sh); e == nil && !st.IsDir() && st.Mode()&0o111 != 0 {
			return sh
		}
	}
	return "/bin/sh"
}

// captainStarted reports whether a foreground process is something other than
// the login shell the seat opened on: the exec line replaces that shell with pi,
// which reports itself, or with the node that runs it.
func captainStarted(fg map[string]any, shell string) bool {
	if isPiProcess(fg) {
		return true
	}
	for _, name := range []string{text(fg["name"]), text(fg["argv0"])} {
		if name != "" && filepath.Base(name) != shell {
			return true
		}
	}
	return false
}

// isPiProcess is the matcher the Pi extension uses (isPiForegroundProcess): a
// process is the agent when its name is pi, or when the file name of its argv0
// is pi. Rex puts the real program name in argv0, so a pi running under node
// still matches.
func isPiProcess(proc map[string]any) bool {
	if text(proc["name"]) == "pi" {
		return true
	}
	argv0 := text(proc["argv0"])
	if argv0 == "" {
		argv0 = text(proc["path"])
	}
	return argv0 != "" && filepath.Base(argv0) == "pi"
}

// foregroundName describes one foreground process in a phrase.
func foregroundName(fg map[string]any) string {
	name, argv0 := text(fg["name"]), text(fg["argv0"])
	switch {
	case name != "" && argv0 != "":
		return fmt.Sprintf("%q (%s)", name, argv0)
	case name != "":
		return fmt.Sprintf("%q", name)
	case argv0 != "":
		return fmt.Sprintf("%q", argv0)
	}
	return "no foreground process"
}

// text reads a string from a mux result, and "" from anything else.
func text(v any) string {
	s, _ := v.(string)
	return s
}
