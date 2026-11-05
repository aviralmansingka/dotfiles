package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"mission.local/prototype/internal/domain/mission"
)

// askKinds is the closed vocabulary of a captain's question. A blocked ask
// reports a wall the captain cannot pass, a question asks for information, and
// a decision waits for the owner's checkpoint answer.
var askKinds = map[string]bool{"blocked": true, "question": true, "decision": true}

const askKindDefault = "blocked"

// Ask is one durable question from a captain to the commander. It lives in the
// mission record, not in a pane, so a question survives the commander being
// absent, a restart, or a captain that never gets an answer: the file is the
// channel, and the commander's own session drains it.
type Ask struct {
	ID      string `json:"id"`
	Handle  string `json:"handle"`
	Step    string `json:"step,omitempty"`
	Attempt string `json:"attempt,omitempty"`
	Kind    string `json:"kind"`
	Text    string `json:"text"`
	At      string `json:"at"`
	// Delivery is written by whoever drains the ask into a session, so an ask
	// is delivered once even across a commander restart.
	DeliveredAt string `json:"delivered_at,omitempty"`
	DeliveredTo string `json:"delivered_to,omitempty"`
}

// askFile is one ask with the file it lives in. The path is in the receipt so a
// captain can point the owner at the exact question it wrote.
type askFile struct {
	Ask
	Path string `json:"path"`
}

// askListing is the `--list` answer: pending asks still waiting for the
// commander, and delivered asks kept as history, both oldest first.
type askListing struct {
	Handle    string    `json:"handle"`
	Pending   []askFile `json:"pending"`
	Delivered []askFile `json:"delivered"`
}

// askInput is one `mission ask` request.
type askInput struct {
	Text    string
	Step    string
	Attempt string
	Kind    string
}

// ask writes one ask file under the mission record. It needs no token and no
// lock: a captain holds no credential, and two asks never share a filename, so
// the write cannot collide with the ledger or with another ask.
func (s *Store) ask(h string, in askInput) (askFile, error) {
	text := strings.TrimSpace(in.Text)
	if text == "" {
		return askFile{}, mission.Problem("usage", "mission ask needs one question:\n  mission ask %s --text QUESTION [--step S01] [--kind blocked|question|decision]", h)
	}
	kind := in.Kind
	if kind == "" {
		kind = askKindDefault
	}
	if !askKinds[kind] {
		return askFile{}, mission.Problem("usage", "ask kind must be blocked, question, or decision")
	}
	if in.Step != "" && !regexp.MustCompile(`^S[0-9]{2,}$`).MatchString(in.Step) {
		return askFile{}, mission.Problem("usage", "step must be an S01-style step ID")
	}
	r, e := s.load(h)
	if e != nil {
		return askFile{}, e
	}
	// A retired record takes no new work, and a question is work: the owner
	// reads it as a request to act on a mission that no longer exists.
	if r.State.Status == closedStatus {
		return askFile{}, mission.Problem("closed_mission", "mission %s is closed; start a new mission with:\n  mission new %s/NAME --title TITLE --goal GOAL --step STEP", r.Handle, r.Mission.Repo)
	}
	now := time.Now().UTC()
	ask := Ask{ID: mission.UID("ask-"), Handle: h, Step: in.Step, Attempt: in.Attempt, Kind: kind, Text: text, At: now.Format(time.RFC3339Nano)}
	// The filename carries a fixed-width UTC stamp, so readdir order is oldest
	// first and a captain's questions reach the commander in the order it asked.
	name := now.Format("20060102T150405.000000000Z") + "-" + ask.ID + ".json"
	p, e := s.path(r.Mission.Repo, r.Mission.Slug, "asks", name)
	if e != nil {
		return askFile{}, e
	}
	b, e := json.MarshalIndent(ask, "", "  ")
	if e != nil {
		return askFile{}, e
	}
	if e = atomicWrite(p, append(b, '\n')); e != nil {
		return askFile{}, e
	}
	return askFile{Ask: ask, Path: p}, nil
}

// asks reads every ask of one mission. A missing asks directory is an empty
// answer, not an error: most missions never ask anything.
func (s *Store) asks(h string) (askListing, error) {
	r, e := s.load(h)
	if e != nil {
		return askListing{}, e
	}
	d, e := s.path(r.Mission.Repo, r.Mission.Slug, "asks")
	if e != nil {
		return askListing{}, e
	}
	out := askListing{Handle: h, Pending: []askFile{}, Delivered: []askFile{}}
	ents, e := os.ReadDir(d)
	if os.IsNotExist(e) {
		return out, nil
	}
	if e != nil {
		return out, e
	}
	for _, ent := range ents {
		if ent.IsDir() || !strings.HasSuffix(ent.Name(), ".json") {
			continue
		}
		p := filepath.Join(d, ent.Name())
		b, e := os.ReadFile(p)
		if e != nil {
			return out, e
		}
		var ask Ask
		if e = json.Unmarshal(b, &ask); e != nil {
			return out, mission.Problem("invalid_ask", "ask file %s cannot be read: %v", p, e)
		}
		f := askFile{Ask: ask, Path: p}
		if ask.DeliveredAt == "" {
			out.Pending = append(out.Pending, f)
		} else {
			out.Delivered = append(out.Delivered, f)
		}
	}
	// ReadDir already sorts by name, and the name starts with a fixed-width UTC
	// stamp; keep the sort explicit so the order survives a future rename.
	oldest := func(list []askFile) {
		sort.SliceStable(list, func(i, j int) bool { return filepath.Base(list[i].Path) < filepath.Base(list[j].Path) })
	}
	oldest(out.Pending)
	oldest(out.Delivered)
	return out, nil
}
