package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

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

// Deployment is what one deploy did, or found already done. The labels come from
// the plan, so a reader sees the same names the captain brief carries.
type Deployment struct {
	Handle          string `json:"handle"`
	Mux             string `json:"mux"`
	Session         string `json:"session"`
	SessionCreated  bool   `json:"session_created"`
	SubagentSession string `json:"subagent_session"`
	SubagentCreated bool   `json:"subagent_created"`
	CaptainWindow   string `json:"captain_window"`
	CaptainWindowID string `json:"captain_window_id,omitempty"`
	// Focused marks a repeat press that found the captain still running: deploy
	// focused that window instead of seating a second captain.
	Focused bool `json:"focused"`
	// LaunchID is the intent the captain brief names: the reservation deploy
	// made, or the one an adapter made before it. Ack is the token that intent
	// was acknowledged with, and Acknowledged marks the first deploy that
	// recorded it.
	LaunchID     string `json:"launch_id,omitempty"`
	Ack          string `json:"ack"`
	Acknowledged bool   `json:"acknowledged"`
}

// deploy turns one plan into seats. It reads the plan, reserves the launch
// intent, then creates only what is missing: the army session and its commander,
// the mission's subagent session, and the captain window. The brief is rendered
// from the reserved intent, so the captain attaches with the id the record
// holds. A live captain window is focused, never duplicated, so one key press
// cannot seat two captains; a window whose captain is gone is not a seat, and
// deploy clears it before seating a fresh one. The ack lands last, so a failure
// part way leaves the record unacknowledged and a second press finishes the same
// deployment with the same intent.
func (s *Store) deploy(h, mux string) (Deployment, error) {
	if mux != "rex" {
		return Deployment{}, mission.Problem("mux_unsupported", "deploy has one adapter today: --mux rex")
	}
	// The plan first, so a mission that cannot be deployed is refused before this
	// command writes anything. Plan itself stays read-only.
	p, e := s.plan(h, mux, "")
	if e != nil {
		return Deployment{}, e
	}
	launchID, e := s.reserveLaunch(h)
	if e != nil {
		return Deployment{}, e
	}
	if launchID != "" {
		p.CaptainBrief = captainPrompt(h, p.SubagentSession, launchID)
	}
	d := Deployment{Handle: h, Mux: mux, Session: p.Session, SubagentSession: p.SubagentSession, CaptainWindow: p.CaptainWindow, LaunchID: launchID, Ack: p.Ack}
	ids, e := sessionIDs()
	if e != nil {
		return d, e
	}
	army, seated := ids[p.Session]
	if !seated {
		v, e := rexAPI("session.create", map[string]any{
			"label":           p.Session,
			"initial_windows": []any{map[string]any{"window_label": commanderWindow, "layout": shellLayout("")}},
		})
		if e != nil {
			return d, rexProblem("session.create", e)
		}
		if army = text(v["session_id"]); army == "" {
			return d, mission.Problem("rex_error", "rex created session %q without returning its id", p.Session)
		}
		d.SessionCreated = true
	} else if st, e := captainSeat(army, p.CaptainWindow); e != nil {
		return d, e
	} else if st.Live {
		if _, e := rexAPI("session.focus_window", map[string]any{"session_id": army, "window_id": st.Window}); e != nil {
			return d, rexProblem("session.focus_window", e)
		}
		d.CaptainWindowID, d.Focused = st.Window, true
	} else if st.Window != "" {
		// The label names a window, but no captain runs in it: the seat is dead.
		// Close that window, so one label never names two windows and no window
		// is left holding a block nobody can reach, then seat a fresh captain
		// below. A window rex already lost counts as closed.
		if _, e := rexAPI("session.close_window", map[string]any{"session_id": army, "window_id": st.Window}); e != nil && !isRexNotFound(e) {
			return d, rexProblem("session.close_window", e)
		}
	}
	if !d.Focused {
		if _, ok := ids[p.SubagentSession]; !ok {
			if _, e := rexAPI("session.create", map[string]any{"label": p.SubagentSession}); e != nil {
				return d, rexProblem("session.create", e)
			}
			d.SubagentCreated = true
		}
		id, e := seatCaptain(p, army)
		if e != nil {
			return d, e
		}
		d.CaptainWindowID = id
	}
	ack, e := s.ack(h)
	if e != nil {
		return d, e
	}
	d.Ack, d.Acknowledged = text(ack["ack"]), ack["acknowledged"] == true
	return d, nil
}

// reserveLaunch reserves the launch intent the captain brief names, and returns
// the id the record holds: the intent an adapter already reserved, or a fresh
// launch-<uid>. It mirrors the Pi extension, which reserves through
// `mission launch` before it asks for a plan. It writes only when there is no
// intent yet, so a repeat press leaves the record alone. A mission that already
// recorded a session has no intent left to name, so it answers "" and the brief
// falls back to the plan's derived ack.
func (s *Store) reserveLaunch(h string) (string, error) {
	r, e := s.load(h)
	if e != nil {
		return "", e
	}
	if e = requireOpen(r); e != nil {
		return "", e
	}
	b := r.State.Runtime
	if b == nil {
		return "", mission.Problem("worktree_required", "prepare the mission worktree first:\n  mission workspace %s", h)
	}
	if b.LaunchID != "" || b.SessionID != "" {
		return b.LaunchID, nil
	}
	var id string
	_, e = s.mutate(h, func(r *mission.Record) error {
		if e := requireOpen(*r); e != nil {
			return e
		}
		if b := r.State.Runtime; b != nil {
			if b.LaunchID == "" && b.SessionID == "" {
				b.LaunchID = mission.UID("launch-")
			}
			id = b.LaunchID
		}
		return nil
	})
	return id, e
}

// sessionIDs is every Rex session by label. A session's label is the seat's
// identity, so deploy never has to guess an id it did not create.
func sessionIDs() (map[string]string, error) {
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

// seat is a captain window deploy found by label. Live is what makes it a seat:
// the window and its first block exist, and a captain still runs in that block.
// A window whose block rex no longer knows, or whose block no longer runs pi,
// holds no captain, so seating a "second" captain there would seat none.
type seat struct {
	Window string
	Block  string
	Live   bool
}

// captainSeat returns the window labeled label in one session, and whether a
// captain runs in it. An empty Window means the seat is not there yet.
func captainSeat(sessionID, label string) (seat, error) {
	v, e := rexAPI("session.view", map[string]any{"session_id": sessionID})
	if e != nil {
		return seat{}, rexProblem("session.view", e)
	}
	windows, _ := v["windows"].([]any)
	for _, w := range windows {
		m, ok := w.(map[string]any)
		if !ok || text(m["label"]) != label {
			continue
		}
		s := seat{Window: text(m["window_id"]), Block: rootBlock(m)}
		if s.Block == "" {
			return s, nil // a window with no block holds no captain
		}
		if s.Live, e = captainRuns(sessionID, s.Block); e != nil {
			return seat{}, e
		}
		return s, nil
	}
	return seat{}, nil
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

// captainLayout opens the captain's window on a shell that waits. A block's id
// does not exist until the window is created, so the captain cannot receive its
// own REX_BLOCK in a spawn environment. The window therefore starts a shell
// reading commands from its terminal, and seatCaptain writes the exec line that
// replaces that shell with pi once the id is known.
func captainLayout(p Plan) map[string]any {
	return map[string]any{"block": map[string]any{
		"flavor":  terminalFlavor,
		"label":   p.CaptainWindow,
		"options": map[string]any{"command": []string{"/bin/sh", "-s"}, "cwd": p.Cwd, "shell": "none"},
	}}
}

// seatCaptain creates the captain's window, reads the block id Rex assigned it,
// then writes the exec line that turns that block into the captain. Two phases
// are the only shape that works: the id arrives in the window-creation result,
// so no process started with the window can already own it. The exec line keeps
// the plan's argv and the brief, so pi starts exactly as it would have.
func seatCaptain(p Plan, sessionID string) (string, error) {
	v, e := rexAPI("session.new_window", map[string]any{
		"session_id":   sessionID,
		"window_label": p.CaptainWindow,
		"layout":       captainLayout(p),
	})
	if e != nil {
		return "", rexProblem("session.new_window", e)
	}
	window := text(v["window_id"])
	if window == "" {
		return "", mission.Problem("rex_error", "rex created window %q without returning its id", p.CaptainWindow)
	}
	block := seatedBlock(v)
	if block == "" {
		return "", mission.Problem("rex_error", "rex created window %q without returning its block id", p.CaptainWindow)
	}
	if _, e := rexAPI("block.method", map[string]any{
		"session_id": sessionID,
		"block_id":   block,
		"method":     "write",
		"args":       map[string]any{"data": captainExecLine(p, block) + "\n"},
	}); e != nil {
		return "", rexProblem("block.method", e)
	}
	return window, nil
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

// captainExecLine is the one line that replaces the waiting shell with the
// captain: the plan's argv (the brief last, as its first message) and the seat's
// own identity in its environment. PATH carries the directory of rex, because
// the captain deploys its troopers through rex and inherits this PATH.
func captainExecLine(p Plan, block string) string {
	argv := append(append([]string{}, p.CaptainArgv...), p.CaptainBrief)
	parts := []string{"exec", "env",
		shellQuote("REX_SESSION=" + p.Session),
		shellQuote("REX_BLOCK=" + block),
		shellQuote("PATH=" + captainPATH()),
		shellQuote("PI_SUBAGENT_SESSION=" + p.SubagentSession),
		shellQuote("PI_SUBAGENT_CWD=" + p.Cwd),
	}
	for _, a := range argv {
		parts = append(parts, shellQuote(a))
	}
	return strings.Join(parts, " ")
}

// captainPATH is this process's PATH with the directory that holds rex in front
// of it. A captain whose PATH cannot find rex cannot deploy a trooper, so the
// seat guarantees it even when the mission binary was started from a short PATH.
func captainPATH() string {
	path := os.Getenv("PATH")
	rex, e := exec.LookPath("rex")
	if e != nil {
		return path
	}
	dir := filepath.Dir(rex)
	for _, d := range filepath.SplitList(path) {
		if d == dir {
			return path
		}
	}
	if path == "" {
		return dir + string(os.PathListSeparator) + "/usr/bin:/bin"
	}
	return dir + string(os.PathListSeparator) + path
}

// shellQuote makes one argument safe inside the shell line the seat writes. The
// brief carries spaces and punctuation, so every argument is quoted, and a
// single quote inside an argument is closed, escaped, and reopened.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// text reads a string from a Rex result, and "" from anything else.
func text(v any) string {
	s, _ := v.(string)
	return s
}

// rexProblem wraps a Rex failure so the JSON envelope carries a code a caller
// can branch on, with rex's own message intact.
func rexProblem(method string, e error) error {
	return mission.Problem("rex_error", "rex %s failed: %v", method, e)
}
