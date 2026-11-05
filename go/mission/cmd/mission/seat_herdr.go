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

// herdrAPI runs one Herdr command and returns its result object. It is a
// variable so a test records the calls instead of reaching a live server.
var herdrAPI = herdrCall

// herdrCall runs one `herdr` subcommand, which prints {"result": {...}} as one
// JSON object. A missing server, a missing herdr, or a refused command is one
// failure carrying herdr's own code and message.
func herdrCall(args ...string) (map[string]any, error) {
	var out, errOut bytes.Buffer
	cmd := exec.Command("herdr", args...)
	cmd.Stdout, cmd.Stderr = &out, &errOut
	if e := cmd.Run(); e != nil {
		return nil, errors.New(herdrMessage(errOut.String(), e))
	}
	var v struct {
		Result map[string]any `json:"result"`
	}
	if e := json.Unmarshal(out.Bytes(), &v); e != nil {
		return nil, fmt.Errorf("herdr %s answered something that is not one JSON object: %w", strings.Join(args, " "), e)
	}
	return v.Result, nil
}

// herdrMessage is the code and message of a failed Herdr call, or the raw text.
// Herdr prints its refusal as one JSON envelope on stderr, so a reader sees
// "not_found: tab ... is gone" instead of the process noise around it.
func herdrMessage(stderr string, e error) string {
	if i := strings.Index(stderr, "{"); i >= 0 {
		var envelope struct {
			Error struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		if json.Unmarshal([]byte(stderr[i:]), &envelope) == nil && envelope.Error.Code != "" {
			return envelope.Error.Code + ": " + envelope.Error.Message
		}
	}
	if msg := strings.TrimSpace(stderr); msg != "" {
		return msg
	}
	return e.Error()
}

// herdrSeat seats one plan in Herdr. Herdr's units are not Rex's, so the adapter
// maps the plan onto them instead of inventing names of its own:
//
//	army session      -> a workspace labeled "army", found by label and created
//	                     once; its root tab becomes the commander window
//	captain window    -> a tab labeled captain-<slug> in that workspace, with the
//	                     mission worktree as its cwd
//	subagent session  -> nothing to create: Herdr has no session object, and a
//	                     mission's troopers are tabs beside their captain, so the
//	                     label travels in the seat's PI_SUBAGENT_SESSION
//
// The seat itself is the Rex one in Herdr's vocabulary: a tab opens on the
// human's login shell, deploy writes the same exec line into that pane, and it
// verifies that pi took the foreground, retrying the submit once.
type herdrSeat struct{}

func (herdrSeat) mux() string { return "herdr" }

// sessions is every Herdr workspace by label. A workspace label is the seat's
// identity, so deploy never has to guess an id it did not create.
func (herdrSeat) sessions() (map[string]string, error) {
	v, e := herdrAPI("workspace", "list")
	if e != nil {
		return nil, herdrProblem("workspace list", e)
	}
	out := map[string]string{}
	list, _ := v["workspaces"].([]any)
	for _, w := range list {
		m, ok := w.(map[string]any)
		if !ok {
			continue
		}
		if label, id := text(m["label"]), text(m["workspace_id"]); label != "" && id != "" {
			out[label] = id
		}
	}
	return out, nil
}

// ensureSession creates a Herdr workspace, which is where the army session
// lives. Its root tab takes the commander's label, so the workspace shows the
// same two windows a Rex army session does. A label Herdr has no object for (the
// mission's subagent session) creates nothing and answers "": the seat carries
// that label in its environment instead.
func (herdrSeat) ensureSession(label, window, cwd string) (string, error) {
	if window == "" {
		return "", nil
	}
	v, e := herdrAPI("workspace", "create", "--label", label, "--cwd", cwd, "--no-focus")
	if e != nil {
		return "", herdrProblem("workspace create", e)
	}
	ws, _ := v["workspace"].(map[string]any)
	id := text(ws["workspace_id"])
	if id == "" {
		return "", mission.Problem("herdr_error", "herdr created workspace %q without returning its id", label)
	}
	tab, _ := v["tab"].(map[string]any)
	if tabID := text(tab["tab_id"]); tabID != "" {
		// The root tab is the army's window, so it carries the window's name: a
		// reader sees "commander" where Rex shows one.
		if _, e := herdrAPI("tab", "rename", tabID, window); e != nil {
			return "", herdrProblem("tab rename", e)
		}
	}
	return id, nil
}

// window returns the tab labeled label in one workspace, and whether a captain
// runs in its pane. Liveness is the pane's own foreground process, the same
// probe placement verifies with: Herdr's agent detection can lag a pi that just
// took the seat, and a live captain must never be closed as a dead one.
func (herdrSeat) window(workspaceID, label string) (seatWindow, error) {
	tabs, e := herdrAPI("tab", "list", "--workspace", workspaceID)
	if e != nil {
		return seatWindow{}, herdrProblem("tab list", e)
	}
	var found seatWindow
	list, _ := tabs["tabs"].([]any)
	for _, t := range list {
		m, ok := t.(map[string]any)
		if !ok || text(m["label"]) != label {
			continue
		}
		found.Window = text(m["tab_id"])
		break
	}
	if found.Window == "" {
		return seatWindow{}, nil
	}
	panes, e := herdrAPI("pane", "list", "--workspace", workspaceID)
	if e != nil {
		return seatWindow{}, herdrProblem("pane list", e)
	}
	plist, _ := panes["panes"].([]any)
	for _, p := range plist {
		m, ok := p.(map[string]any)
		if !ok || text(m["tab_id"]) != found.Window {
			continue
		}
		found.Block = text(m["pane_id"])
		break
	}
	if found.Block == "" {
		return found, nil // a tab with no pane holds no captain
	}
	live, e := herdrCaptain(found.Block)
	if e != nil {
		return seatWindow{}, e
	}
	found.Live = live
	return found, nil
}

// focus lands on a live captain tab.
func (herdrSeat) focus(_, windowID string) error {
	if _, e := herdrAPI("tab", "focus", windowID); e != nil {
		return herdrProblem("tab focus", e)
	}
	return nil
}

// clear closes a tab whose captain is gone. A tab Herdr already lost counts as
// closed, the same tolerance Rex gets for a window it lost.
func (herdrSeat) clear(_, windowID string) error {
	if _, e := herdrAPI("tab", "close", windowID); e != nil && !isHerdrNotFound(e) {
		return herdrProblem("tab close", e)
	}
	return nil
}

// place seats the captain in a new tab of the army workspace, and reports the
// tab, the pane, and the Pi session file Herdr knows for it.
func (herdrSeat) place(p Plan, workspaceID string) (seatIdentity, error) {
	v, e := herdrAPI("tab", "create", "--workspace", workspaceID, "--cwd", p.Cwd, "--label", p.CaptainWindow)
	if e != nil {
		return seatIdentity{}, herdrProblem("tab create", e)
	}
	tab, _ := v["tab"].(map[string]any)
	root, _ := v["root_pane"].(map[string]any)
	id := seatIdentity{Window: text(tab["tab_id"]), Pane: text(root["pane_id"])}
	if id.Window == "" || id.Pane == "" {
		return id, mission.Problem("herdr_error", "herdr created tab %q without returning its pane", p.CaptainWindow)
	}
	if e := waitForPaneShell(id.Pane, workspaceID); e != nil {
		return id, e
	}
	if e := writePane(id.Pane, seatExecLine(p)); e != nil {
		return id, e
	}
	if e := submitPane(id.Pane); e != nil {
		return id, e
	}
	fg, started, e := waitForPaneCaptain(id.Pane)
	if e != nil {
		return id, e
	}
	if !started {
		if e := submitPane(id.Pane); e != nil {
			return id, e
		}
		if fg, started, e = waitForPaneCaptain(id.Pane); e != nil {
			return id, e
		}
		if !started {
			return id, mission.Problem("herdr_error", "the captain never took the seat: pane %s in tab %s still runs %s after the submit was sent twice", id.Pane, id.Window, foregroundName(fg))
		}
	}
	// Herdr reports the Pi session file for a detected agent. It can take a
	// moment to appear, and the captain records it itself on attach, so a read
	// that answers nothing leaves the record as it was instead of failing a seat
	// that is running.
	if pane, e := herdrAPI("pane", "get", id.Pane); e == nil {
		if p, ok := pane["pane"].(map[string]any); ok {
			if session, ok := p["agent_session"].(map[string]any); ok {
				id.SessionFile = text(session["value"])
			}
		}
	}
	return id, nil
}

// waitForPaneShell polls one pane until a process owns it, and reports the last
// failure when the deadline passes. A tab Herdr just created starts its shell
// asynchronously, and a write into that pane before the shell reads its terminal
// loses its tail: the readiness probe is the pane's own process list.
func waitForPaneShell(paneID, workspaceID string) error {
	deadline := time.Now().Add(seatShellWait)
	var last error
	for {
		v, e := herdrAPI("pane", "process-info", "--pane", paneID)
		if e == nil {
			if info, ok := v["process_info"].(map[string]any); ok {
				if procs, ok := info["foreground_processes"].([]any); ok && len(procs) > 0 {
					return nil
				}
			}
			last = errors.New("the pane reported no foreground process")
		} else {
			last = e
		}
		if !time.Now().Before(deadline) {
			return mission.Problem("herdr_error", "the seat's shell never started: pane %s in workspace %s reported no shell within %s, so nothing was written into it: %v", paneID, workspaceID, seatShellWait, last)
		}
		time.Sleep(seatPoll)
	}
}

// writePane writes one piece of text into a pane without submitting it.
func writePane(paneID, data string) error {
	if _, e := herdrAPI("pane", "send-text", paneID, data); e != nil {
		return herdrProblem("pane send-text", e)
	}
	return nil
}

// submitPane sends the Enter that makes the shell run the exec line. It is its
// own write, never the tail of the line's write, so a dropped tail cannot take
// the submit with it.
func submitPane(paneID string) error {
	if _, e := herdrAPI("pane", "send-keys", paneID, "enter"); e != nil {
		return herdrProblem("pane send-keys", e)
	}
	return nil
}

// waitForPaneCaptain polls one pane's foreground process until the login shell
// the tab opened on is gone. The last foreground it saw comes back with false, so
// a caller that gives up can say what the pane still runs.
func waitForPaneCaptain(paneID string) (map[string]any, bool, error) {
	shell := filepath.Base(loginShell())
	deadline := time.Now().Add(seatStartWait)
	var last map[string]any
	for {
		fg, e := herdrForeground(paneID)
		if e != nil {
			return last, false, e
		}
		last = fg
		if captainStarted(last, shell) {
			return last, true, nil
		}
		if !time.Now().Before(deadline) {
			return last, false, nil
		}
		time.Sleep(seatPoll)
	}
}

// herdrForeground is one pane's foreground process: the first entry of the
// process list `pane process-info` reports, in the same shape Rex answers with,
// so both adapters decide liveness with one matcher.
func herdrForeground(paneID string) (map[string]any, error) {
	v, e := herdrAPI("pane", "process-info", "--pane", paneID)
	if e != nil {
		return nil, herdrProblem("pane process-info", e)
	}
	info, _ := v["process_info"].(map[string]any)
	procs, _ := info["foreground_processes"].([]any)
	for _, p := range procs {
		if m, ok := p.(map[string]any); ok {
			return m, nil
		}
	}
	return nil, nil
}

// herdrCaptain reports whether pi runs in one pane. A pane Herdr no longer knows
// is a dead seat, not a failure.
func herdrCaptain(paneID string) (bool, error) {
	fg, e := herdrForeground(paneID)
	if e != nil {
		if isHerdrNotFound(e) {
			return false, nil
		}
		return false, e
	}
	return fg != nil && isPiProcess(fg), nil
}

// isHerdrNotFound marks a Herdr refusal that says the thing asked for is gone:
// a closed tab or pane is a seat nobody can use, not a reason to abort.
func isHerdrNotFound(e error) bool {
	msg := strings.ToLower(e.Error())
	return strings.Contains(msg, "not_found") || strings.Contains(msg, "not found")
}

// herdrProblem wraps a Herdr failure so the JSON envelope carries a code a
// caller can branch on, with herdr's own message intact.
func herdrProblem(what string, e error) error {
	return mission.Problem("herdr_error", "herdr %s failed: %v", what, e)
}
