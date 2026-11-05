package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"mission.local/prototype/internal/domain/mission"
)

// terminalFlavor is the Rex block that runs a program in a pane.
const terminalFlavor = "com.superlogical.terminal.shell"

// rexAPI calls one Rex server method and returns its result. It is a variable so
// a test can record the calls instead of reaching a live server; deploy writes
// nothing to Rex that a human would not see.
var rexAPI = rexCall

// rexCall runs `rex api call`, which prints the method's result as one JSON
// object when stdout is not a terminal. A missing server, a missing rex, or a
// refused method is one failure with rex's own message.
func rexCall(method string, args map[string]any) (map[string]any, error) {
	b, e := json.Marshal(args)
	if e != nil {
		return nil, e
	}
	var out, errOut bytes.Buffer
	cmd := exec.Command("rex", "api", "call", method, string(b))
	cmd.Stdout, cmd.Stderr = &out, &errOut
	if e := cmd.Run(); e != nil {
		msg := strings.TrimSpace(errOut.String())
		if msg == "" {
			msg = e.Error()
		}
		return nil, errors.New(msg)
	}
	var v map[string]any
	if e := json.Unmarshal(out.Bytes(), &v); e != nil {
		return nil, fmt.Errorf("rex answered %s with something that is not one JSON object: %w", method, e)
	}
	return v, nil
}

// rexSeat seats one plan in Rex. A Rex session holds windows, so the plan maps
// onto it directly: the army session holds the commander window and one captain
// window per mission, and each mission owns a subagent session for its troopers.
type rexSeat struct{}

func (rexSeat) mux() string { return "rex" }

// sessions is every Rex session by label. A session's label is the seat's
// identity, so deploy never has to guess an id it did not create.
func (rexSeat) sessions() (map[string]string, error) {
	v, e := rexAPI("session.list", map[string]any{})
	if e != nil {
		return nil, rexProblem("session.list", e)
	}
	out := map[string]string{}
	list, _ := v["sessions"].([]any)
	for _, s := range list {
		m, ok := s.(map[string]any)
		if !ok {
			continue
		}
		if label, id := text(m["label"]), text(m["session_id"]); label != "" && id != "" {
			out[label] = id
		}
	}
	return out, nil
}

// ensureSession creates one Rex session. The army session opens with its
// commander window; a session with no window is a place for troopers only, so it
// is created bare. The cwd is unused: a Rex window carries no cwd of its own, and
// the army session's commander is a shell that starts wherever Rex starts.
func (rexSeat) ensureSession(label, window, _ string) (string, error) {
	args := map[string]any{"label": label}
	if window != "" {
		args["initial_windows"] = []any{map[string]any{"window_label": window, "layout": shellLayout("")}}
	}
	v, e := rexAPI("session.create", args)
	if e != nil {
		return "", rexProblem("session.create", e)
	}
	id := text(v["session_id"])
	// A trooper session needs no id here, so only the army session's absence is
	// an error: deploy seats the captain in the session it was handed.
	if window != "" && id == "" {
		return "", mission.Problem("rex_error", "rex created session %q without returning its id", label)
	}
	return id, nil
}

// window returns the window labeled label in one session, and whether a captain
// runs in it.
func (rexSeat) window(sessionID, label string) (seatWindow, error) {
	return captainSeat(sessionID, label)
}

// focus lands on a live captain window, so a repeat press reports the seat the
// first press made.
func (rexSeat) focus(sessionID, windowID string) error {
	if _, e := rexAPI("session.focus_window", map[string]any{"session_id": sessionID, "window_id": windowID}); e != nil {
		return rexProblem("session.focus_window", e)
	}
	return nil
}

// clear closes a window whose captain is gone, so one label never names two
// windows and no window is left holding a block nobody can reach. A window rex
// already lost counts as closed.
func (rexSeat) clear(sessionID, windowID string) error {
	if _, e := rexAPI("session.close_window", map[string]any{"session_id": sessionID, "window_id": windowID}); e != nil && !isRexNotFound(e) {
		return rexProblem("session.close_window", e)
	}
	return nil
}

// place seats the captain in a new window of the army session, and reports the
// window and the block it runs in.
func (rexSeat) place(p Plan, sessionID string) (seatIdentity, error) {
	window, block, e := seatCaptain(p, sessionID)
	if e != nil {
		return seatIdentity{}, e
	}
	return seatIdentity{Window: window, Pane: block}, nil
}

// captainSeat returns the window labeled label in one session, and whether a
// captain runs in it. An empty Window means the seat is not there yet.
func captainSeat(sessionID, label string) (seatWindow, error) {
	v, e := rexAPI("session.view", map[string]any{"session_id": sessionID})
	if e != nil {
		return seatWindow{}, rexProblem("session.view", e)
	}
	windows, _ := v["windows"].([]any)
	for _, w := range windows {
		m, ok := w.(map[string]any)
		if !ok || text(m["label"]) != label {
			continue
		}
		s := seatWindow{Window: text(m["window_id"]), Block: rootBlock(m)}
		if s.Block == "" {
			return s, nil // a window with no block holds no captain
		}
		if s.Live, e = captainRuns(sessionID, s.Block); e != nil {
			return seatWindow{}, e
		}
		return s, nil
	}
	return seatWindow{}, nil
}

// rootBlock is a window's first block: the one a captain layout seats, and the
// one a captain's death leaves behind.
func rootBlock(w map[string]any) string {
	layers, _ := w["layers"].([]any)
	for _, l := range layers {
		lm, _ := l.(map[string]any)
		blocks, _ := lm["blocks"].([]any)
		for _, b := range blocks {
			bm, _ := b.(map[string]any)
			if id := text(bm["block_id"]); id != "" {
				return id
			}
		}
	}
	return ""
}

// captainRuns reports whether a captain still runs in one block. It asks the
// terminal block itself: `rex api call block.method` with method "process" is
// the API form of `rex block call <block> process`, and its result carries the
// terminal's foreground process and its ancestors, each with name, argv0 and
// path. A block rex no longer knows answers not_found, which is a dead seat, not
// a failure. Any other read failure is returned: deploy never guesses a live
// captain away and seats a second one.
func captainRuns(sessionID, blockID string) (bool, error) {
	v, e := rexAPI("block.method", map[string]any{"session_id": sessionID, "block_id": blockID, "method": "process"})
	if e != nil {
		if isRexNotFound(e) {
			return false, nil
		}
		return false, rexProblem("block.method", e)
	}
	if v["last_exit"] != nil {
		return false, nil // the captain's program exited, so no captain is left
	}
	procs := []any{v["foreground"]}
	if a, ok := v["ancestors"].([]any); ok {
		procs = append(procs, a...)
	}
	for _, p := range procs {
		if m, ok := p.(map[string]any); ok && isPiProcess(m) {
			return true, nil
		}
	}
	return false, nil
}

// isRexNotFound marks a Rex answer that says the thing asked for is gone, as
// opposed to a read that failed. Rex reports a missing block or window as
// not_found; that is a seat nobody can use, not a reason to abort.
func isRexNotFound(e error) bool {
	msg := strings.ToLower(e.Error())
	return strings.Contains(msg, "not_found") || strings.Contains(msg, "not found")
}

// shellLayout is one terminal in a new window or session.
func shellLayout(cwd string) map[string]any {
	options := map[string]any{}
	if cwd != "" {
		options["cwd"] = cwd
	}
	return map[string]any{"block": map[string]any{"flavor": terminalFlavor, "options": options}}
}

// captainLayout opens the captain's window on the human's login shell. A
// block's id does not exist until the window is created, so the captain cannot
// receive its own REX_BLOCK in a spawn environment. The window therefore starts
// a login shell reading commands from its terminal, and seatCaptain writes the
// exec line that replaces that shell with pi once the id is known.
//
// The shell is a login shell on purpose: it reads the account's profile, so the
// captain inherits the human's environment instead of the multiplexer's minimal
// PATH. That PATH is why a captain lost `mission` (spawn mission ENOENT), lost
// `rex` (the subagent gate stayed closed), and could not deploy troopers with pi.
//
// options.shell names that shell, because "none" seats the captain behind
// /usr/bin/login instead: Rex wraps a direct command in its rex-login helper,
// and login's foreground process reports no cwd, so the mission extension cannot
// bind the seat. Naming the shell is the `rex window new --shell zsh -- zsh -l`
// shape: still a login shell, and its process reports the cwd.
func captainLayout(p Plan) map[string]any {
	return map[string]any{"block": map[string]any{
		"flavor":  terminalFlavor,
		"label":   p.CaptainWindow,
		"options": map[string]any{"command": loginShellArgv(), "cwd": p.Cwd, "shell": filepath.Base(loginShell())},
	}}
}

// waitForShell polls one block until it answers for itself, and reports the last
// failure when the deadline passes. Rex's `pwd` method is the readiness probe:
// the process that owns the block answers it, so it stays unanswered while the
// login shell is still starting. The view is not a probe, because the view says a
// block exists, not that anything is listening in it.
func waitForShell(sessionID, blockID string) error {
	deadline := time.Now().Add(seatShellWait)
	for {
		if _, e := rexAPI("block.method", map[string]any{
			"session_id": sessionID,
			"block_id":   blockID,
			"method":     "pwd",
		}); e == nil {
			return nil
		} else if !time.Now().Before(deadline) {
			return mission.Problem("rex_error", "the seat's shell never started: block %s in session %s did not answer pwd within %s, so nothing was written into it: %v", blockID, sessionID, seatShellWait, e)
		}
		time.Sleep(seatPoll)
	}
}

// writeSeat writes exactly one piece of text into the captain's block. The
// exec line and the newline that submits it are separate writes: a line that
// arrives in one piece can lose its tail, and with it the quote that closes the
// brief, so the shell sits in quote continuation and never runs anything.
func writeSeat(sessionID, blockID, data string) error {
	_, e := rexAPI("block.method", map[string]any{
		"session_id": sessionID,
		"block_id":   blockID,
		"method":     "write",
		"args":       map[string]any{"data": data},
	})
	if e != nil {
		return rexProblem("block.method", e)
	}
	return nil
}

// submitSeat sends the newline that makes the shell run the exec line. It is its
// own write, never the tail of the line's write, so a dropped tail cannot take
// the submit with it.
func submitSeat(sessionID, blockID string) error { return writeSeat(sessionID, blockID, "\n") }

// waitForCaptain polls one block's foreground process until the login shell the
// window opened on is gone. The last foreground it saw comes back with false, so
// a caller that gives up can say what the block still runs.
func waitForCaptain(sessionID, blockID string) (map[string]any, bool, error) {
	shell := filepath.Base(loginShell())
	deadline := time.Now().Add(seatStartWait)
	var last map[string]any
	for {
		v, e := rexAPI("block.method", map[string]any{
			"session_id": sessionID,
			"block_id":   blockID,
			"method":     "process",
		})
		if e != nil {
			return last, false, rexProblem("block.method", e)
		}
		last, _ = v["foreground"].(map[string]any)
		if captainStarted(last, shell) {
			return last, true, nil
		}
		if !time.Now().Before(deadline) {
			return last, false, nil
		}
		time.Sleep(seatPoll)
	}
}

// seatFailure is the error a seat reports when the captain never took the
// foreground: the block, the window, and what the block still runs, because that
// is what a reader needs to look at the window themselves.
func seatFailure(block, window string, fg map[string]any) error {
	return mission.Problem("rex_error", "the captain never took the seat: block %s in window %s still runs %s after the submit was sent twice", block, window, foregroundName(fg))
}

// seatCaptain creates the captain's window, reads the block id Rex assigned it,
// then writes the exec line that turns that block into the captain. Two phases
// are the only shape that works: the id arrives in the window-creation result,
// so no process started with the window can already own it. The exec line keeps
// the plan's argv and the brief, so pi starts exactly as it would have.
//
// The wait before the write is the fix for a lost captain: deploy used to write
// the moment the window existed, while `zsh -l` was still sourcing profile
// files, and the tail of the line arrived nowhere. The shell then waited inside
// an open quote and the seat never started. So the seat waits for the shell to
// answer, writes the line and its newline separately, and verifies that pi took
// the foreground. One retry of the submit covers a shell that read its line
// late; a second window is never the answer, because the label would name two.
func seatCaptain(p Plan, sessionID string) (string, string, error) {
	v, e := rexAPI("session.new_window", map[string]any{
		"session_id":   sessionID,
		"window_label": p.CaptainWindow,
		"layout":       captainLayout(p),
	})
	if e != nil {
		return "", "", rexProblem("session.new_window", e)
	}
	window := text(v["window_id"])
	if window == "" {
		return "", "", mission.Problem("rex_error", "rex created window %q without returning its id", p.CaptainWindow)
	}
	block := seatedBlock(v)
	if block == "" {
		return "", "", mission.Problem("rex_error", "rex created window %q without returning its block id", p.CaptainWindow)
	}
	if e := waitForShell(sessionID, block); e != nil {
		return "", "", e
	}
	if e := writeSeat(sessionID, block, captainExecLine(p, block)); e != nil {
		return "", "", e
	}
	if e := submitSeat(sessionID, block); e != nil {
		return "", "", e
	}
	fg, started, e := waitForCaptain(sessionID, block)
	if e != nil {
		return "", "", e
	}
	if !started {
		if e := submitSeat(sessionID, block); e != nil {
			return "", "", e
		}
		if fg, started, e = waitForCaptain(sessionID, block); e != nil {
			return "", "", e
		}
		if !started {
			return "", "", seatFailure(block, window, fg)
		}
	}
	return window, block, nil
}

// seatedBlock is the block id in a window-creation result. Rex answers with
// block_ids in layout order, so the first is the block the captain layout seated;
// a shaped view that nests layers is read the same way.
func seatedBlock(v map[string]any) string {
	if ids, ok := v["block_ids"].([]any); ok && len(ids) > 0 {
		if id := text(ids[0]); id != "" {
			return id
		}
	}
	return rootBlock(v)
}

// captainExecLine is the one line that replaces the login shell with the
// captain, with the seat identity a Rex block has: its session and its own block.
func captainExecLine(p Plan, block string) string {
	return seatExecLine(p, "REX_SESSION="+p.Session, "REX_BLOCK="+block)
}

// rexProblem wraps a Rex failure so the JSON envelope carries a code a caller
// can branch on, with rex's own message intact.
func rexProblem(method string, e error) error {
	return mission.Problem("rex_error", "rex %s failed: %v", method, e)
}
