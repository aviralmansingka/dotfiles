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
	return reportsPi(v), nil
}

// reportsPi is whether a process report shows pi in the block: the foreground
// first, then its ancestors, because the login shell Rex runs a window command
// through can still be the reported foreground on some hosts.
func reportsPi(v map[string]any) bool {
	procs := []any{v["foreground"]}
	if a, ok := v["ancestors"].([]any); ok {
		procs = append(procs, a...)
	}
	for _, p := range procs {
		if m, ok := p.(map[string]any); ok && isPiProcess(m) {
			return true
		}
	}
	return false
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

// captainLayout opens the captain's window on the captain itself: the window's
// own command is the human's login shell running one `-c` line that execs pi.
//
// It used to open a bare login shell and type the exec line into it. That was a
// race the readiness gate could not see: Rex answers `block.method "pwd"` with an
// empty object about 0.02 s after the window exists, before the shell has a cwd,
// so the line was typed into a `zsh -l` still sourcing its profile. Written then,
// the line was dropped or truncated and the shell ended up inside an open quote.
// A window command has no prompt to race: zsh reads the line as its argument,
// `exec` replaces it with pi, and the block's foreground is pi from the start.
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
		"options": map[string]any{"command": captainCommand(p), "cwd": p.Cwd, "shell": filepath.Base(loginShell())},
	}}
}

// captainCommand is the captain window's own command: the login shell, reading
// the exec line as its `-c` argument. Command is an argv, not a shell string, so
// the line's quotes, spaces, and the brief's apostrophes reach the shell exactly
// as seatExecLine built them; a shell reading its terminal cannot do that safely.
func captainCommand(p Plan) []any {
	return []any{loginShell(), "-l", "-c", captainExecLine(p)}
}

// waitForCaptain polls one block's process report until pi holds the block. The
// last foreground it saw comes back with false, so a caller that gives up can say
// what the block still runs.
func waitForCaptain(sessionID, blockID string) (map[string]any, bool, error) {
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
		if reportsPi(v) {
			return last, true, nil
		}
		if !time.Now().Before(deadline) {
			return last, false, nil
		}
		time.Sleep(seatPoll)
	}
}

// seatFailure is the error a seat reports when the captain never took the
// foreground: the block, the window it is in, and what the block still runs,
// because that is what a reader needs to look at the window themselves.
func seatFailure(block, window string, fg map[string]any) error {
	return mission.Problem("rex_error", "the captain never took the seat: block %s in window %s still runs %s after the window ran its command", block, window, foregroundName(fg))
}

// seatVerifyTries is how many bounded waits the seat gives the captain's
// foreground: the first, and one retry. The retry repeats the check, not a
// submit, because a window command cannot be re-sent; it covers a process report
// that lags the window it describes. A second window is never the answer,
// because the label would name two.
const seatVerifyTries = 2

// seatCaptain creates the captain's window with the captain as its command, then
// verifies that the block really runs pi. Rex assigns the block id as it creates
// the window, and it sets REX_BLOCK in the environment of the program it starts
// there, so the exec line needs no id of its own: the mux names the seat. The
// verification stays because Rex accepting the window says only that the window
// exists, not that pi came up in it.
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
	if e := verifyCaptain(sessionID, block, window); e != nil {
		return "", "", e
	}
	return window, block, nil
}

// verifyCaptain waits for the block to report pi, and retries that wait once.
func verifyCaptain(sessionID, block, window string) error {
	var fg map[string]any
	for attempt := 0; attempt < seatVerifyTries; attempt++ {
		started := false
		var e error
		if fg, started, e = waitForCaptain(sessionID, block); e != nil {
			return e
		}
		if started {
			return nil
		}
	}
	return seatFailure(block, window, fg)
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

// captainExecLine is the one line the captain's window runs, with the seat
// identity a Rex block has. It names the session's label, not the id Rex put in
// REX_SESSION, because mission identities are labels. It does not name REX_BLOCK:
// Rex sets it in the environment of the program it starts in a block, so the
// captain already reads its own block, and a window command cannot carry an id
// that does not exist until the window has been created.
func captainExecLine(p Plan) string {
	return seatExecLine(p, "REX_SESSION="+p.Session)
}

// rexProblem wraps a Rex failure so the JSON envelope carries a code a caller
// can branch on, with rex's own message intact.
func rexProblem(method string, e error) error {
	return mission.Problem("rex_error", "rex %s failed: %v", method, e)
}
