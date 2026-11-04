package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

func validateMission(m mission.Mission) error {
	if !validSlug(m.Repo) || !validSlug(m.Slug) {
		return mission.Problem("invalid_slug", "repository and mission slugs must be 3–64 lowercase letters/digits/hyphens")
	}
	if m.Title == "" || m.Goal == "" || len(m.Steps) == 0 {
		return mission.Problem("invalid_mission", "title, goal and at least one step are required")
	}
	if m.Kind != "research" && m.Kind != "implementation" {
		return mission.Problem("invalid_mission", "kind must be research or implementation")
	}
	ids := map[string]bool{}
	for _, st := range m.Steps {
		if !regexp.MustCompile(`^S[0-9]{2,}$`).MatchString(st.ID) || ids[st.ID] {
			return mission.Problem("invalid_step", "step IDs must be unique S01-style IDs")
		}
		ids[st.ID] = true
		if st.Title == "" || st.Agent == "" {
			return mission.Problem("invalid_step", "step title and agent required")
		}
		if st.Output == "" || filepath.Base(st.Output) != st.Output || strings.Contains(st.Output, "..") || st.Output == "session.jsonl" || st.Output == "session.log" || st.Output == "brief.md" {
			return mission.Problem("invalid_output", "output must be a simple filename; session.jsonl, session.log and brief.md are reserved")
		}
		for _, name := range mission.StepChecks(st) {
			if !knownCheck(name) {
				return mission.Problem("invalid_check", "unknown check %q; use mission checks to list presets", name)
			}
		}
		if len(st.Instructions) > 8000 || len(st.Acceptance) > 8000 {
			return mission.Problem("too_large", "step instructions and acceptance criteria are limited to 8000 characters each")
		}
	}
	cpids := map[string]bool{}
	after := map[string]bool{}
	for _, c := range m.Checkpoints {
		if !ids[c.After] || cpids[c.ID] || after[c.After] || c.Kind != "human" || c.Question == "" || !regexp.MustCompile(`^C[0-9]{2,}$`).MatchString(c.ID) {
			return mission.Problem("invalid_checkpoint", "unique C01 checkpoints must reference a step, kind human, and a question")
		}
		cpids[c.ID] = true
		after[c.After] = true
	}
	return nil
}
func (s *Store) create(m mission.Mission) (mission.Record, error) {
	var rec mission.Record
	mission.NormalizeMission(&m)
	if e := validateMission(m); e != nil {
		return rec, e
	}
	if _, e := s.repo(m.Repo); e != nil {
		return rec, e
	}
	err := s.locked(func() error {
		h := m.Repo + "/" + m.Slug
		d, e := s.dir(h)
		if e != nil {
			return e
		}
		if _, e = os.Stat(filepath.Join(d, "mission.md")); e == nil {
			return mission.Problem("exists", "mission %s already exists; inspect it instead of overwriting", h)
		}
		m.ID = mission.UID("mission-")
		m.Schema = 1
		m.Created = mission.Now()
		if m.Body == "" {
			m.Body = "# " + m.Title + "\n\n## Goal\n" + m.Goal + "\n\nStep instructions, acceptance criteria and checks are defined in frontmatter.\n"
		}
		b, e := markdown(m, m.Body)
		if e != nil {
			return e
		}
		st := mission.StateFor(m, mission.Digest(b))
		rec = mission.Record{Handle: h, Mission: m, State: st}
		stage, e := os.MkdirTemp(filepath.Dir(d), ".mission-create-")
		if e != nil {
			return e
		}
		defer os.RemoveAll(stage)
		if e = atomicWrite(filepath.Join(stage, "mission.md"), b); e != nil {
			return e
		}
		sb, e := markdown(st, stateBody(rec))
		if e != nil {
			return e
		}
		if e = atomicWrite(filepath.Join(stage, "state.md"), sb); e != nil {
			return e
		}
		return os.Rename(stage, d)
	})
	return rec, err
}
func (s *Store) load(h string) (mission.Record, error) {
	var r mission.Record
	p, pe := s.editPath(h)
	if pe != nil {
		return r, pe
	}
	if _, pe = os.Stat(p); pe == nil {
		return r, mission.Problem("edit_pending", "step edit was interrupted; run mission repair %s", h)
	} else if !os.IsNotExist(pe) {
		return r, pe
	}
	d, e := s.dir(h)
	if e != nil {
		return r, e
	}
	b, e := os.ReadFile(filepath.Join(d, "mission.md"))
	if e != nil {
		return r, mission.Problem("not_found", "mission %s not found", h)
	}
	body, e := parseMarkdown(b, &r.Mission)
	if e != nil {
		return r, e
	}
	r.Mission.Body = body
	mission.NormalizeMission(&r.Mission)
	r.Handle = h
	if e = validateMission(r.Mission); e != nil {
		return r, e
	}
	repo, slug, _ := splitHandle(h)
	if r.Mission.Repo != repo || r.Mission.Slug != slug {
		return r, mission.Problem("identity_mismatch", "mission metadata does not match its directory")
	}
	b, e = os.ReadFile(filepath.Join(d, "state.md"))
	if e != nil {
		return r, e
	}
	_, e = parseMarkdown(b, &r.State)
	if e != nil {
		return r, e
	}
	if r.State.Mission != r.Mission.ID {
		return r, mission.Problem("identity_mismatch", "state belongs to another mission")
	}
	return r, nil
}
func (s *Store) list() ([]mission.Record, error) {
	repos, e := s.repos()
	if e != nil {
		return nil, e
	}
	out := []mission.Record{}
	for _, repo := range repos {
		p, e := s.path(repo.Slug)
		if e != nil {
			return nil, e
		}
		ents, e := os.ReadDir(p)
		if e != nil {
			return nil, e
		}
		for _, v := range ents {
			if !v.IsDir() || !validSlug(v.Name()) {
				continue
			}
			r, e := s.load(repo.Slug + "/" + v.Name())
			if e != nil {
				return nil, e
			}
			out = append(out, r)
		}
	}
	return out, nil
}

// journalEntry records one save attempt. The ledger stays authoritative; the
// journal shows which command wrote which revision, so a lost revision can be
// traced to the writer that produced it.
type journalEntry struct {
	At       string `json:"at"`
	Base     int    `json:"base_revision"`
	Revision int    `json:"revision"`
	Writer   string `json:"writer"`
	Attempts int    `json:"attempts"`
	Result   string `json:"result"`
}

// writer names the CLI command that produced a save. The revision journal uses
// it to show which command wrote a revision.
var writer = "mission"

// writeVerb names one command and, for a group command, its subcommand.
func writeVerb(cmd string, a platform.Args) string {
	for _, group := range []string{"step", "checkpoint", "review", "repo"} {
		if cmd == group && a.At(1) != "" {
			return "mission " + cmd + " " + a.At(1)
		}
	}
	return "mission " + cmd
}

// journal appends one line per save. It never fails a save: the ledger is the
// commit point and the journal is evidence.
func (s *Store) journal(r *mission.Record, base int, result string) {
	p, e := s.path(r.Mission.Repo, r.Mission.Slug, "journal.jsonl")
	if e != nil {
		return
	}
	b, e := json.Marshal(journalEntry{At: mission.Now(), Base: base, Revision: r.State.Revision, Writer: writer, Attempts: len(r.State.Attempts), Result: result})
	if e != nil {
		return
	}
	f, e := os.OpenFile(p, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if e != nil {
		return
	}
	defer f.Close()
	_, _ = f.Write(append(b, '\n'))
}

func (s *Store) save(r *mission.Record) error { return s.saveFrom(r, r.State.Revision-1) }

// saveFrom refuses to replace a ledger that moved after this record was read.
// A record carries the revision it was loaded from, so a stale snapshot cannot
// drop an attempt that a claim already saved.
func (s *Store) saveFrom(r *mission.Record, base int) error {
	d, e := s.dir(r.Handle)
	if e != nil {
		return e
	}
	sp := filepath.Join(d, "state.md")
	if onDisk, e := os.ReadFile(sp); e == nil {
		var disk mission.State
		if _, pe := parseMarkdown(onDisk, &disk); pe != nil {
			return mission.Problem("invalid_note", "state.md cannot be read for the revision check: %v", pe)
		}
		if disk.Revision != base {
			s.journal(r, base, "refused")
			return mission.Problem("revision_conflict", "the ledger moved to revision %d after this record was read at revision %d; reload and retry", disk.Revision, base)
		}
	} else if !os.IsNotExist(e) {
		return e
	}
	b, e := markdown(r.State, stateBody(*r))
	if e != nil {
		return e
	}
	// state.md is the single commit point; attempt notes and event streams are projections.
	if e = atomicWrite(sp, b); e != nil {
		return e
	}
	s.journal(r, base, "saved")
	for _, a := range r.State.Attempts {
		p, e := s.path(r.Mission.Repo, r.Mission.Slug, "attempts", fmt.Sprintf("%03d.md", a.Sequence))
		if e != nil {
			return e
		}
		body := "# " + a.Step + " · " + a.Agent + "\n\n## Assigned brief\n" + a.Brief + "\n\n## Evidence\nOutput: `" + a.Artifact + "`\n"
		for _, p := range a.Progress {
			body += "\n## " + p.At + " · " + p.Status + "\n" + p.Summary + "\n"
			if p.Next != "" {
				body += "\nNext: " + p.Next + "\n"
			}
			if p.Blocker != "" {
				body += "\nBlocker: " + p.Blocker + "\n"
			}
			for _, evidence := range p.Evidence {
				body += "\n- `" + evidence.Path + "` (`" + evidence.Hash + "`)\n"
			}
		}
		for _, v := range a.Verifications {
			body += "\n## Verification " + v.ID + "\n" + verificationSummary(v) + "\nSubject: `" + v.SubjectHash + "`\n"
			for _, c := range v.Results {
				for _, ev := range c.Evidence {
					body += "- " + c.Check + ": `" + ev.Path + "` (`" + ev.Hash + "`)\n"
				}
			}
		}
		body += "\nLifecycle events are also projected beside this note."
		b, e := markdown(a, body)
		if e != nil {
			return e
		}
		if e = atomicWrite(p, b); e != nil {
			return mission.Problem("projection_failed", "state committed; attempt projection failed: %v; use mission repair", e)
		}
		var events bytes.Buffer
		enc := json.NewEncoder(&events)
		for _, ev := range a.Events {
			if e = enc.Encode(ev); e != nil {
				return e
			}
		}
		ep, e := s.path(r.Mission.Repo, r.Mission.Slug, "attempts", fmt.Sprintf("%03d.events.jsonl", a.Sequence))
		if e != nil {
			return e
		}
		if e = atomicWrite(ep, events.Bytes()); e != nil {
			return mission.Problem("projection_failed", "state committed; event projection failed: %v", e)
		}
	}
	return nil
}
func stateBody(r mission.Record) string {
	b := "# " + r.Mission.Title + "\n\n## Progress\n"
	for _, st := range r.Mission.Steps {
		ss := r.State.Steps[st.ID]
		b += "- " + st.ID + " · " + ss.Status + " · " + st.Title + "\n"
	}
	if len(r.State.Attempts) > 0 {
		a := r.State.Attempts[len(r.State.Attempts)-1]
		if len(a.Progress) > 0 {
			p := a.Progress[len(a.Progress)-1]
			b += "\n## Latest report · " + p.Status + "\n" + p.Summary + "\n"
			if p.Next != "" {
				b += "\nNext: " + p.Next + "\n"
			}
			if p.Blocker != "" {
				b += "\nBlocker: " + p.Blocker + "\n"
			}
		}
	}
	if r.State.Pending != "" {
		for _, c := range r.Mission.Checkpoints {
			if c.ID == r.State.Pending {
				b += "\n## Human checkpoint " + c.ID + "\n" + c.Question + "\n"
			}
		}
	}
	return b + "\n## Brief\n[[./mission|Mission brief]]\n"
}
func (s *Store) mutate(h string, fn func(*mission.Record) error) (mission.Record, error) {
	var r mission.Record
	e := s.locked(func() error {
		var e error
		r, e = s.load(h)
		if e != nil {
			return e
		}
		if e = fn(&r); e != nil {
			return e
		}
		r.State.Revision++
		return s.save(&r)
	})
	return r, e
}

type CheckPreset struct {
	Name        string `json:"name"`
	Version     string `json:"version"`
	Description string `json:"description"`
}

func checkCatalog() []CheckPreset {
	return []CheckPreset{{"nonempty-artifact", "1", "Required: a nonempty UTF-8 result, limited to 16 MiB"}, {"json-valid", "1", "Parse the result as exactly one JSON value"}, {"go-test", "1", "Run go test ./... in the Go module under the attempt checkout, with a two-minute deadline"}}
}
func knownCheck(name string) bool {
	for _, c := range checkCatalog() {
		if c.Name == name {
			return true
		}
	}
	return false
}
func verificationSummary(v mission.Verification) string {
	parts := []string{}
	for _, r := range v.Results {
		parts = append(parts, r.Check+": "+r.Verdict)
	}
	return strings.Join(parts, ", ")
}
func (s *Store) editPath(h string) (string, error) {
	r, m, e := splitHandle(h)
	if e != nil {
		return "", e
	}
	return s.path(r, m, ".step-edit.yml")
}
