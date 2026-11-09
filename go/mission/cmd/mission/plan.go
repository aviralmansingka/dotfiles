package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

// The rank vocabulary of a deployment, in one place. One mux session, "army",
// holds the seats: the commander, and one captain window per mission. Every
// mission owns a subagent session, "mission-<slug>", where its troopers work.
// Adapters read these names from a plan; they never spell them themselves.
const (
	armySession     = "army"
	commanderWindow = "commander"
	captainPrefix   = "captain-"
	subagentPrefix  = "mission-"
)

// labelRoom is the longest seat label this tool writes. Herdr agent names, and
// the Pi extension that creates them, keep to 32 characters of [a-z0-9_-], so a
// seat label uses the same bound: plan, deploy, and the extension agree on one
// name for one mission, and no adapter has to invent a shortening of its own.
const labelRoom = 32

// labelHash is the tail that keeps two long slugs apart. Cutting a label is not
// enough on its own: slugs reach 54 characters, so two missions of one
// repository can share the first characters a seat label has room for. Six hex
// characters of the full slug's digest make the cut deterministic and distinct,
// and plan and deploy derive it from the same record.
const labelHash = 6

// seatLabel maps a mission slug onto one seat label: the rank prefix, then the
// slug cut to the room left, with trailing dashes stripped so the label never
// ends in one. A slug that does not fit loses its tail to a short digest of the
// whole slug, so the cut stays stable and unique. It is deterministic — plan and
// deploy derive the same label from the same record, so a repeated deploy
// focuses the window its first run made instead of looking for a name nobody
// created. The full slug stays in Plan.Slug.
func seatLabel(prefix, slug string) string {
	var b strings.Builder
	b.WriteString(prefix)
	for _, r := range slug {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '_', r == '-':
			b.WriteRune(r)
		case r >= 'A' && r <= 'Z':
			b.WriteRune(r + ('a' - 'A'))
		}
	}
	out := b.String()
	if len(out) > labelRoom {
		d := sha256.Sum256([]byte(slug))
		room := labelRoom - len(prefix) - labelHash - 1
		tail := strings.TrimRight(out[len(prefix):], "-")
		if len(tail) > room {
			tail = strings.TrimRight(tail[:room], "-")
		}
		out = prefix + tail + "-" + hex.EncodeToString(d[:])[:labelHash]
	}
	if trimmed := strings.TrimRight(out, "-"); trimmed != "" {
		out = trimmed
	}
	return out
}

// captainBrief is the captain contract, and the only copy of the launch prompt
// text: the captain profiles hold no second version of it, so the duties are
// edited here or nowhere. The first sentence is the token the captain attaches
// with: the plan's ack token by default, or the launch intent deploy reserved, so
// the id a captain reads is the id the record holds. The three duties are the rank's whole division of
// work: the captain keeps the claim and its hands off the files, a trooper does
// each step and another judges it, and the captain answers the commander. The
// session clause names where troopers work, because the captain is the only
// thing that deploys them: the plan's subagent session is the label it passes on
// every call, and the army session is never a place for a rank tab. The same
// string states the authority split the rank depends on: the captain runs its
// mandate without asking permission, sends its whole briefing with one ask when
// a block needs the human, and writes no mission definition except a step and
// its checks. The commander answers in a few bullets and may change the mission
// itself.
const captainBrief = `You are the captain of mission %[1]s, seated in its worktree as cwd for the whole mission. Before reading repository files, call mission with action=attach, handle=%[1]s, launch_id=%[2]s. Three duties, and no others: hold the claim for this mission and never edit repository files yourself; deploy a trooper for every step and judge the result through a trooper, not with your own hands; answer the commander in the %[3]s session. You are autonomous: inside those duties, decide and proceed without asking permission for each move. Deploy every trooper in the %[4]s session: pass session=%[4]s on each subagent call, so no rank tab lands in the %[3]s session. When a block needs the human, send one mission ask %[1]s --text "<full briefing>" --step <step-id> --kind blocked|question|decision. The text is a briefing, not a one-line question: state the block, what you already tried and what it showed, the options with their trade-offs, and the decision you need. The commander answers with a few bullets that unblock you, and may also update the mission, its brief, its steps, or its checks from outside; then stop and keep this session for the answer. Do not use ask_user_question; nobody watches a captain pane. Your one write to the mission definition is a step or its checks through mission step edit; never rewrite the mission brief, and never reset a step to weaken a check. Stop at checkpoints; keep this session and worktree for later steps.`

// captainPrompt renders the brief for one launch id. Plan renders it with the id
// a caller passes, and deploy renders it again with the intent it reserved, so
// the id a captain reads is the id the record holds. The session is the plan's
// subagent session, so the brief names the one label the captain must pass on.
func captainPrompt(h, subagentSession, launchID string) string {
	return fmt.Sprintf(captainBrief, h, launchID, armySession, subagentSession)
}

// captainLoadout is the captain's reach at launch: the same five tools the
// mission-captain profile declares. A captain holds the claim and never edits
// files, so no edit, write, or bash is granted to it — the profile is the
// contract, and this allowlist is the flag that makes a launched captain obey
// it instead of inheriting every default tool. ask_user_question is not here:
// a captain pane has no watcher, so a blocked captain writes a durable ask with
// `mission ask` instead of painting a menu nobody sees.
const captainLoadout = "mission,subagent,subagent_message,read,tool_search"

// captainPi resolves the pi binary at plan time. A window's command is resolved
// against the mux server's own PATH, not the caller's, and that PATH holds the
// app directory plus /usr/bin, /bin, /usr/sbin and /sbin. A bare "pi" is not
// found there, so a seat that named pi in the window command failed before it
// seated anything:
//
//	creating "com.superlogical.terminal.shell": executable "pi" not found in
//	PATH "...Rex Server.app/Contents/MacOS:/usr/bin:/bin:/usr/sbin:/sbin"
//	(status=400 code=bad_request)
//
// The seat now opens a login shell and execs pi from it, so a profile's PATH is
// what finds pi there; the absolute path keeps the seat independent of any
// profile. LookPath resolves pi on the PATH this process holds. When the plan
// runs inside pi itself, os.Executable is the same binary, so it answers too.
// The bare name is the last resort: it keeps the old behaviour rather than
// failing the plan.
func captainPi() string {
	if path, e := exec.LookPath("pi"); e == nil {
		if abs, e := filepath.Abs(path); e == nil {
			return abs
		}
		return path
	}
	if exe, e := os.Executable(); e == nil && strings.TrimSuffix(filepath.Base(exe), filepath.Ext(exe)) == "pi" {
		return exe
	}
	return "pi"
}

// captainArgv starts a captain in its window. It is a list, not a string, so an
// adapter appends its own seat flags instead of quoting: the window's cwd is
// Cwd, and the brief reaches the agent through the adapter's prompt call. The
// first element is absolute, because the window resolves it without this PATH.
func captainArgv() []string { return []string{captainPi(), "--tools", captainLoadout} }

// Plan is the mux-neutral launch description of one mission. It describes a
// deployment without performing any part of it: an adapter turns the labels into
// its own session, window, and tab calls, acks the token, and only then starts
// the captain. Nothing here names a mux command.
type Plan struct {
	Handle string `json:"handle"`
	Repo   string `json:"repo"`
	Slug   string `json:"slug"`
	Mux    string `json:"mux"`
	Step   string `json:"step,omitempty"`
	// Rank vocabulary: the session that holds the seats, its two windows, and
	// the session the mission's troopers work in.
	Session         string `json:"session"`
	CommanderWindow string `json:"commander_window"`
	CaptainWindow   string `json:"captain_window"`
	SubagentSession string `json:"subagent_session"`
	// The worktree the captain and its troopers own.
	Cwd    string `json:"cwd"`
	Branch string `json:"branch"`
	// What the captain window runs, and the text it starts from.
	CaptainArgv  []string `json:"captain_argv"`
	CaptainBrief string   `json:"captain_brief"`
	Ack          string   `json:"ack"`
}

// ackToken derives the token a launch acknowledgement carries. It is derived,
// never reserved: plan is read-only, so one mission always answers with the same
// token and `mission launch --ack` can consume it later. It is not a credential;
// it stands for "this mission's launch was described", so it travels in the JSON
// and in the brief. It names no step, so it stays stable across steps.
func ackToken(vault, h, branch string) string {
	d := sha256.Sum256([]byte(strings.Join([]string{"mission-ack", vault, h, branch}, "\x00")))
	return "ack-" + hex.EncodeToString(d[:8])
}

// plan describes how to deploy one mission and changes nothing: no worktree, no
// attempt, no launch record. A missing worktree is reported instead of created,
// because the captain needs an existing checkout to work in.
func (s *App) plan(h, mux, launchID string) (Plan, error) {
	r, e := s.load(h)
	if e != nil {
		return Plan{}, e
	}
	if e = requireOpen(r); e != nil {
		return Plan{}, e
	}
	b := r.State.Runtime
	if b == nil {
		return Plan{}, mission.Problem("worktree_required", "prepare the mission worktree first:\n  mission workspace %s", h)
	}
	if b.Machine != platform.Machine() {
		return Plan{}, mission.Problem("wrong_machine", "mission worktree is bound on %s", b.Machine)
	}
	if _, e = os.Stat(b.Cwd); e != nil {
		return Plan{}, mission.Problem("worktree_missing", "mission worktree %s is missing; revive it with:\n  mission workspace %s", b.Cwd, h)
	}
	step := ""
	// A busy or fully reviewed mission still has a captain to focus, so a step
	// that cannot start now is not a reason to refuse the description.
	if next, e := mission.NextStep(r.Mission, r.State); e == nil {
		step = next.ID
	}
	ack := ackToken(s.Repo.VaultPath(), h, b.Branch)
	if launchID == "" {
		launchID = ack
	}
	return Plan{
		Handle:          h,
		Repo:            r.Mission.Repo,
		Slug:            r.Mission.Slug,
		Mux:             mux,
		Step:            step,
		Session:         armySession,
		CommanderWindow: commanderWindow,
		CaptainWindow:   seatLabel(captainPrefix, r.Mission.Slug),
		SubagentSession: seatLabel(subagentPrefix, r.Mission.Slug),
		Cwd:             b.Cwd,
		Branch:          b.Branch,
		CaptainArgv:     captainArgv(),
		CaptainBrief:    captainPrompt(h, seatLabel(subagentPrefix, r.Mission.Slug), launchID),
		Ack:             ack,
	}, nil
}
