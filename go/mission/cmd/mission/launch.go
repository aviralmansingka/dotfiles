package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"mission.local/prototype/internal/platform"
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
//
// The owner fields address the request to the seat that asked for it. A session
// in that Herdr workspace claims first; a session elsewhere waits until the
// addressed workspace is gone, and then adopts the request only inside the same
// checkout family. Without an address (the desk ran outside Herdr) any idle
// session of the repository may claim.
type Launch struct {
	Handle         string `json:"handle"`
	Repo           string `json:"repo"`
	Requested      string `json:"requested_at"`
	State          string `json:"state"`
	OwnerWorkspace string `json:"owner_workspace,omitempty"`
	OwnerLabel     string `json:"owner_label,omitempty"`
	OwnerCommon    string `json:"owner_common,omitempty"`
	ClaimedBy      string `json:"claimed_by,omitempty"`
	LaunchID       string `json:"launch_id,omitempty"`
	Workspace      string `json:"workspace,omitempty"`
	Pane           string `json:"pane,omitempty"`
	SessionFile    string `json:"session_file,omitempty"`
	Error          string `json:"error,omitempty"`
	Updated        string `json:"updated_at,omitempty"`
}

// launchOwner is the seat that writes a request. It comes from the desk's own
// environment: the pane it runs in is the address the extension matches.
type launchOwner struct {
	Workspace string // HERDR_WORKSPACE_ID
	Label     string // HERDR_PANE_ID, the seat that asked
	Common    string // absolute git common dir, the checkout family
}

// deskOwner reads the seat from the desk's environment. A desk outside Herdr
// still records its checkout family, so the request cannot be adopted by a
// session of another repository.
func (s *App) deskOwner(cwd string) launchOwner {
	common, _ := s.Catalog.Common(cwd)
	return launchOwner{Workspace: os.Getenv("HERDR_WORKSPACE_ID"), Label: os.Getenv("HERDR_PANE_ID"), Common: common}
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
func requestLaunch(dir string, owner launchOwner, handle, repo string, now time.Time) (Launch, bool, error) {
	if l, ok := readLaunch(dir, handle); ok && l.live() {
		return l, false, nil
	}
	stamp := now.UTC().Format(time.RFC3339Nano)
	l := Launch{Handle: handle, Repo: repo, Requested: stamp, State: launchPending, Updated: stamp,
		OwnerWorkspace: owner.Workspace, OwnerLabel: owner.Label, OwnerCommon: owner.Common}
	b, e := json.MarshalIndent(l, "", "  ")
	if e != nil {
		return Launch{}, false, e
	}
	if e := os.MkdirAll(filepath.Dir(launchFile(dir, handle)), 0o700); e != nil {
		return Launch{}, false, e
	}
	return l, true, platform.AtomicWrite(launchFile(dir, handle), append(b, '\n'))
}

// launchSummary is the one line the list and the detail panel print for a live
// request. An empty string means the mission has nothing to show.
func launchSummary(l Launch) (string, string) {
	switch l.State {
	case launchPending:
		return "launch pending", ownerLine(l)
	case launchClaimed:
		return "launch claimed", "the Pi session is starting it"
	case launchStarted:
		if l.Workspace != "" {
			return "launch started", "Herdr agent in " + l.Workspace
		}
		return "launch started", "the mission worktree has a session"
	case launchFailed:
		return "launch failed", clean(platform.Fallback(l.Error, "inspect the Pi session"))
	}
	return "", ""
}

// ownerLine is the one line the desk prints for a pending request: it names the
// seat the request is addressed to, so a human knows which Pi session starts it.
func ownerLine(l Launch) string {
	if l.OwnerWorkspace == "" {
		return "waiting for a Pi session in this repository"
	}
	if l.OwnerLabel != "" {
		return "waiting for the Pi session in " + l.OwnerWorkspace + " (" + l.OwnerLabel + ")"
	}
	return "waiting for a Pi session in " + l.OwnerWorkspace
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
