package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// A launch has two halves. The reservation lives in the vault: it is acquired
// once and it records the receipt. The host actions live behind this port: open
// the workspace, create the tab, start one agent. The CLI command and the Pi
// extension both call the port, so one launch path exists.
type LaunchPlan struct {
	Handle   string
	Slug     string
	Checkout string // primary checkout, the anchor Herdr needs
	Cwd      string // mission worktree
	LaunchID string
	Prompt   string
}

// LaunchReceipt names the surface and the agent a launch created.
type LaunchReceipt struct {
	Target      string `json:"target"`
	Workspace   string `json:"workspace,omitempty"`
	Pane        string `json:"pane,omitempty"`
	SessionFile string `json:"session_file,omitempty"`
}

// Launcher opens a host surface and starts exactly one agent in it.
type Launcher interface {
	Target() string
	Launch(LaunchPlan) (LaunchReceipt, error)
}

// launcherFor selects the adapter. Tests replace it with a stub.
var launcherFor = func(target string) Launcher {
	if target == "local" {
		return localLauncher{start: startPi, wait: launchWait()}
	}
	return herdrLauncher{call: herdrCommand, wait: launchWait(), newID: newSessionID}
}

// launchTarget resolves --target. Herdr is the default inside a Herdr pane; a
// plain terminal starts the agent in its own pane.
func launchTarget(explicit string) (string, error) {
	switch explicit {
	case "":
		if os.Getenv("HERDR_ENV") == "1" {
			return "herdr", nil
		}
		return "local", nil
	case "herdr", "local":
		return explicit, nil
	}
	return "", problem("usage", "--target takes herdr or local")
}

// launchWait is how long a launch waits for the agent's session file. The
// receipt is optional: the worker records it from inside when the wait expires.
func launchWait() time.Duration {
	if v := os.Getenv("MISSION_LAUNCH_WAIT_MS"); v != "" {
		if ms, e := strconv.Atoi(v); e == nil && ms >= 0 {
			return time.Duration(ms) * time.Millisecond
		}
	}
	return 15 * time.Second
}

// launchPrompt is the first message the launched agent receives. It names the
// reservation, so the agent attaches instead of starting a second launch.
func launchPrompt(handle, launchID string) string {
	return fmt.Sprintf("Work on mission %s. Before reading or editing repository files, call mission with action=attach, handle=%s, launch_id=%s. Then follow the returned step brief and the missions skill. Report structured progress. Write the required artifact and call finish when the step is ready. Stop at checkpoints; keep this session and worktree for later steps.", handle, handle, launchID)
}

// newSessionID names the agent session the launcher creates, so the receipt can
// point at pi's own session file.
func newSessionID() string { return uid("") }

// herdrRun runs one Herdr API command and returns its result object.
type herdrRun func(args ...string) (map[string]any, error)

// herdrCommand talks to the host Herdr server. HERDR_BIN overrides the binary,
// so a test can stand in for the server.
func herdrCommand(args ...string) (map[string]any, error) {
	bin := fallback(os.Getenv("HERDR_BIN"), "herdr")
	out, e := exec.Command(bin, args...).Output()
	if e != nil {
		if x, ok := e.(*exec.ExitError); ok && len(x.Stderr) > 0 {
			return nil, problem("launch_failed", "herdr %s: %s", args[0], strings.TrimSpace(string(x.Stderr)))
		}
		return nil, problem("launch_failed", "herdr %s: %v", args[0], e)
	}
	var env struct {
		Result map[string]any `json:"result"`
	}
	if e := json.Unmarshal(out, &env); e != nil {
		return nil, problem("launch_failed", "herdr %s returned no result", args[0])
	}
	return env.Result, nil
}

// herdrLauncher opens the mission worktree as a Herdr workspace and starts one
// pi agent in it. The primary checkout anchors the call, because Herdr refuses
// to open a worktree from inside a linked worktree.
type herdrLauncher struct {
	call  herdrRun
	wait  time.Duration
	newID func() string
}

func (h herdrLauncher) Target() string { return "herdr" }

func (h herdrLauncher) Launch(p LaunchPlan) (LaunchReceipt, error) {
	r := LaunchReceipt{Target: "herdr"}
	open, e := h.call("worktree", "open", "--cwd", p.Checkout, "--path", p.Cwd, "--no-focus")
	if e != nil {
		return r, e
	}
	workspace := nested(open, "workspace", "workspace_id")
	if workspace == "" {
		return r, problem("launch_failed", "herdr did not return the mission workspace")
	}
	// A workspace that was already open may be parked on the mission's previous
	// session, so a relaunch takes its own tab instead of that pane.
	holder := open
	if already, _ := open["already_open"].(bool); already {
		if holder, e = h.call("tab", "create", "--workspace", workspace, "--cwd", p.Cwd, "--label", p.Slug, "--no-focus"); e != nil {
			return r, e
		}
	}
	pane := nested(holder, "root_pane", "pane_id")
	if pane == "" || nested(holder, "root_pane", "workspace_id") != workspace {
		return r, problem("launch_failed", "herdr did not return the mission pane")
	}
	session := h.newID()
	if _, e = h.call("agent", "start", "pi", "--kind", "pi", "--pane", pane, "--", "--session-id", session); e != nil {
		return r, e
	}
	if _, e = h.call("agent", "prompt", pane, p.Prompt); e != nil {
		return r, e
	}
	r.Workspace, r.Pane = workspace, pane
	r.SessionFile = waitForSession(p.Cwd, session, h.wait)
	return r, nil
}

// piStart starts one pi process in the current pane. The CLI hands its terminal
// to the child, so the agent keeps the pane after the command returns.
type piStart func(cwd string, argv []string) error

func startPi(cwd string, argv []string) error {
	c := exec.Command(fallback(os.Getenv("PI_BIN"), "pi"), argv...)
	c.Dir, c.Stdin, c.Stdout, c.Stderr = cwd, os.Stdin, os.Stdout, os.Stderr
	if e := c.Start(); e != nil {
		return problem("launch_failed", "start pi: %v", e)
	}
	return nil
}

// localLauncher starts the agent in the pane the command runs in, for terminals
// that have no Herdr server.
type localLauncher struct {
	start piStart
	wait  time.Duration
	newID func() string
}

func (l localLauncher) Target() string { return "local" }

func (l localLauncher) Launch(p LaunchPlan) (LaunchReceipt, error) {
	r := LaunchReceipt{Target: "local", Pane: os.Getenv("HERDR_PANE_ID")}
	id := newSessionID
	if l.newID != nil {
		id = l.newID
	}
	session := id()
	if e := l.start(p.Cwd, []string{"--session-id", session, "--", p.Prompt}); e != nil {
		return r, e
	}
	r.SessionFile = waitForSession(p.Cwd, session, l.wait)
	return r, nil
}

// sessionDir is where pi keeps the sessions of one working directory.
func sessionDir(cwd string) string {
	root := os.Getenv("PI_CODING_AGENT_DIR")
	if root == "" {
		home, _ := os.UserHomeDir()
		root = filepath.Join(home, ".pi", "agent")
	}
	slug := "--" + strings.ReplaceAll(strings.TrimPrefix(filepath.Clean(cwd), "/"), "/", "-") + "--"
	return filepath.Join(root, "sessions", slug)
}

// sessionPath finds the session file pi created for one id. Pi owns the
// timestamp prefix, so the id is the only stable part of the name.
func sessionPath(cwd, id string) (string, bool) {
	m, _ := filepath.Glob(filepath.Join(sessionDir(cwd), "*_"+id+".jsonl"))
	if len(m) == 0 {
		return "", false
	}
	return m[0], true
}

// waitForSession waits a bounded time for the agent to write its session file.
func waitForSession(cwd, id string, wait time.Duration) string {
	deadline := time.Now().Add(wait)
	for {
		if p, ok := sessionPath(cwd, id); ok {
			return p
		}
		if !time.Now().Before(deadline) {
			return ""
		}
		time.Sleep(50 * time.Millisecond)
	}
}

// nested reads one string field from a nested Herdr result object.
func nested(m map[string]any, keys ...string) string {
	var cur any = m
	for _, k := range keys {
		next, ok := cur.(map[string]any)
		if !ok {
			return ""
		}
		cur = next[k]
	}
	s, _ := cur.(string)
	return s
}
