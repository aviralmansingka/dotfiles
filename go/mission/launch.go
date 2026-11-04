package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// The desk cannot start a mission by itself. A mission starts inside Pi, through
// the extension's start action, which reserves the launch in the vault, opens
// the mission worktree, and spawns the worker. So the desk leaves a request and
// the owning Pi session claims it. One file per handle is the whole protocol:
// the desk writes "pending", a Pi session rewrites the file as "claimed" and then
// "started" or "failed", and the desk renders whatever it finds. A press while a
// request is live rewrites nothing, so a second press cannot launch twice.
const (
	launchPending = "pending"
	launchClaimed = "claimed"
	launchStarted = "started"
	launchFailed  = "failed"
)

// Launch is one launch request. The JSON field names are the wire format the Pi
// extension reads and writes; keep them stable.
type Launch struct {
	Handle    string `json:"handle"`
	Repo      string `json:"repo"`
	Requested string `json:"requested_at"`
	State     string `json:"state"`
	ClaimedBy string `json:"claimed_by,omitempty"`
	LaunchID  string `json:"launch_id,omitempty"`
	Error     string `json:"error,omitempty"`
	Updated   string `json:"updated_at,omitempty"`
}

// live reports whether the request still owns the launch: the desk ignores a
// repeat press, and the extension claims only a pending request.
func (l Launch) live() bool { return l.State == launchPending || l.State == launchClaimed }

// launchStateDir is where the desk and the Pi extension meet. It mirrors the
// extension's cache dir so both sides resolve the same directory without a flag.
func launchStateDir() string {
	if d := os.Getenv("MISSION_STATE_DIR"); d != "" {
		return d
	}
	if d := os.Getenv("XDG_STATE_HOME"); d != "" {
		return filepath.Join(d, "pi-missions")
	}
	h, e := os.UserHomeDir()
	if e != nil {
		return filepath.Join(os.TempDir(), "pi-missions")
	}
	return filepath.Join(h, ".local", "state", "pi-missions")
}

// launchFile names the request for one handle. Handles are repo/slug, so one
// separator swap gives a stable, readable file name.
func launchFile(dir, handle string) string {
	return filepath.Join(dir, "launches", strings.ReplaceAll(handle, "/", "--")+".json")
}

// readLaunch returns the request for a handle, and false when thereis none or it
// is unreadable. A torn file is not a request, so the desk shows nothing.
func readLaunch(dir, handle string) (Launch, bool) {
	var l Launch
	b, e := os.ReadFile(launchFile(dir, handle))
	if e != nil || json.Unmarshal(b, &l) != nil || l.Handle != handle {
		return Launch{}, false
	}
	return l, true
}

// launches reads every request, keyed by handle, so one refresh feeds the whole
// list.
func launches(dir string) map[string]Launch {
	out := map[string]Launch{}
	entries, e := os.ReadDir(filepath.Join(dir, "launches"))
	if e != nil {
		return out
	}
	for _, v := range entries {
		if v.IsDir() || !strings.HasSuffix(v.Name(), ".json") {
			continue
		}
		var l Launch
		b, e := os.ReadFile(filepath.Join(dir, "launches", v.Name()))
		if e != nil || json.Unmarshal(b, &l) != nil || l.Handle == "" {
			continue
		}
		out[l.Handle] = l
	}
	return out
}

// requestLaunch writes a pending request unless one is already live. It reports
// whether it wrote, so the desk can tell the difference between "requested" and
// "already pending" without a second read.
func requestLaunch(dir, handle, repo string, now time.Time) (Launch, bool, error) {
	if l, ok := readLaunch(dir, handle); ok && l.live() {
		return l, false, nil
	}
	stamp := now.UTC().Format(time.RFC3339Nano)
	l := Launch{Handle: handle, Repo: repo, Requested: stamp, State: launchPending, Updated: stamp}
	b, e := json.MarshalIndent(l, "", "  ")
	if e != nil {
		return Launch{}, false, e
	}
	if e := os.MkdirAll(filepath.Dir(launchFile(dir, handle)), 0o700); e != nil {
		return Launch{}, false, e
	}
	return l, true, atomicWrite(launchFile(dir, handle), append(b, '\n'))
}

// launchSummary is the one line the list and the detail panel print for a live
// request. An empty string means the mission has nothing to show.
func launchSummary(l Launch) (string, string) {
	switch l.State {
	case launchPending:
		return "launch pending", "waiting for its Pi session"
	case launchClaimed:
		return "launch claimed", "the Pi session is starting it"
	case launchStarted:
		return "launch started", "the mission worktree has a session"
	case launchFailed:
		return "launch failed", clean(fallback(l.Error, "inspect the Pi session"))
	}
	return "", ""
}

// sortedLaunches is a stable order for tests and logs.
func sortedLaunches(m map[string]Launch) []Launch {
	out := make([]Launch, 0, len(m))
	for _, l := range m {
		out = append(out, l)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Handle < out[j].Handle })
	return out
}
