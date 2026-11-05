package main

import (
	"context"
	"os/exec"
	"strings"
	"time"

	"mission.local/prototype/internal/domain/mission"
)

// herdrVersionArgs is the command that prints a Herdr version line. It is a
// variable so a test answers instead of reaching an installed binary.
var herdrVersionArgs = []string{"--version"}

// herdrVersionRead reads the Herdr version. A test replaces it, so no test needs
// Herdr on the host.
var herdrVersionRead = herdrVersion

// herdrVersionTimeout bounds the version read: the read is best effort, and a
// wedged binary must never hold a launch.
const herdrVersionTimeout = 2 * time.Second

// herdrVersion names the Herdr a launch runs on, as one version token, or
// unknown. Every failure — no herdr on this host, a refused command, the
// deadline, unreadable output — reads unknown and is swallowed: a launch must
// start without Herdr.
func herdrVersion() string {
	ctx, cancel := context.WithTimeout(context.Background(), herdrVersionTimeout)
	defer cancel()
	out, e := exec.CommandContext(ctx, "herdr", herdrVersionArgs...).CombinedOutput()
	if e != nil {
		return versionUnknown
	}
	return firstLine(string(out))
}

// firstLine keeps the first non-blank line of herdr's answer as the version, so
// what a record quotes stays one line whatever the binary printed. The program
// name is dropped, because the summary already says "on herdr".
func firstLine(out string) string {
	for _, l := range strings.Split(out, "\n") {
		if l = strings.TrimSpace(l); l != "" {
			l = strings.TrimSpace(strings.TrimPrefix(l, "herdr"))
			if l == "" {
				return versionUnknown
			}
			return l
		}
	}
	return versionUnknown
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
	// Pane is the block or pane the captain runs in, as the mux names it.
	Pane string `json:"pane,omitempty"`
	// SessionFile is the Pi session file the mux reported for the captain, where
	// it reports one.
	SessionFile string `json:"session_file,omitempty"`
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
//
// Seating has one owner: this command. The mux is the only thing the adapter
// changes, so rex and herdr read the same plan and make the same decisions about
// it; nothing below names a mux command.
func (s *App) deploy(h, mux string) (Deployment, error) {
	ad, e := seatFor(mux)
	if e != nil {
		return Deployment{}, e
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
	ids, e := ad.sessions()
	if e != nil {
		return d, e
	}
	army, seated := ids[p.Session]
	if !seated {
		if army, e = ad.ensureSession(p.Session, p.CommanderWindow, p.Cwd); e != nil {
			return d, e
		}
		d.SessionCreated = true
	} else if st, e := ad.window(army, p.CaptainWindow); e != nil {
		return d, e
	} else if st.Live {
		if e := ad.focus(army, st.Window); e != nil {
			return d, e
		}
		d.CaptainWindowID, d.Pane, d.Focused = st.Window, st.Block, true
	} else if st.Window != "" {
		// The label names a window, but no captain runs in it: the seat is dead.
		// Close it, so one label never names two windows and no window is left
		// holding a block nobody can reach, then seat a fresh captain below.
		if e := ad.clear(army, st.Window); e != nil {
			return d, e
		}
	}
	if !d.Focused {
		// A mux with no session object of its own (Herdr) answers "": nothing to
		// create, and the label travels in the seat it is about to open.
		if _, ok := ids[p.SubagentSession]; !ok {
			id, e := ad.ensureSession(p.SubagentSession, "", p.Cwd)
			if e != nil {
				return d, e
			}
			d.SubagentCreated = id != ""
		}
		seat, e := ad.place(p, army)
		if e != nil {
			return d, e
		}
		d.CaptainWindowID, d.Pane, d.SessionFile = seat.Window, seat.Pane, seat.SessionFile
		if seat.SessionFile != "" && d.LaunchID != "" {
			// The seat's own session file is recorded on the intent that reserved
			// it, as an adapter launch always did, so a later deploy or attach
			// adopts the session that exists instead of starting another.
			if _, e := s.launch(h, seat.SessionFile, d.LaunchID); e != nil {
				return d, e
			}
		}
	}
	ack, e := s.ack(h)
	if e != nil {
		return d, e
	}
	d.Ack, d.Acknowledged = text(ack["ack"]), ack["acknowledged"] == true
	return d, nil
}

// reserveLaunch reserves the launch intent the captain brief names, and returns
// the id the record holds: an intent that is already there, or a fresh
// launch-<uid>. Deploy is the only seating path now, so this is where a launch
// starts. It writes only when there is no intent yet, so a repeat press leaves
// the record alone. A mission that already
// recorded a session has no intent left to name, so it answers "" and the brief
// falls back to the plan's derived ack.
func (s *App) reserveLaunch(h string) (string, error) {
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
	_, e = s.update(h, func(r *mission.Record) error {
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
