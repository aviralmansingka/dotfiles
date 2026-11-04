package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

func validateMission(m Mission) error {
	if !validSlug(m.Repo) || !validSlug(m.Slug) {
		return problem("invalid_slug", "repository and mission slugs must be 3–64 lowercase letters/digits/hyphens")
	}
	if m.Title == "" || m.Goal == "" || len(m.Steps) == 0 {
		return problem("invalid_mission", "title, goal and at least one step are required")
	}
	if m.Kind != "research" && m.Kind != "implementation" {
		return problem("invalid_mission", "kind must be research or implementation")
	}
	ids := map[string]bool{}
	for _, st := range m.Steps {
		if !regexp.MustCompile(`^S[0-9]{2,}$`).MatchString(st.ID) || ids[st.ID] {
			return problem("invalid_step", "step IDs must be unique S01-style IDs")
		}
		ids[st.ID] = true
		if st.Title == "" || st.Agent == "" {
			return problem("invalid_step", "step title and agent required")
		}
		if st.Output == "" || filepath.Base(st.Output) != st.Output || strings.Contains(st.Output, "..") || st.Output == "session.jsonl" || st.Output == "session.log" || st.Output == "brief.md" {
			return problem("invalid_output", "output must be a simple filename; session.jsonl, session.log and brief.md are reserved")
		}
		for _, name := range stepChecks(st) {
			if !knownCheck(name) {
				return problem("invalid_check", "unknown check %q; use mission checks to list presets", name)
			}
		}
		if len(st.Instructions) > 8000 || len(st.Acceptance) > 8000 {
			return problem("too_large", "step instructions and acceptance criteria are limited to 8000 characters each")
		}
	}
	cpids := map[string]bool{}
	after := map[string]bool{}
	for _, c := range m.Checkpoints {
		if !ids[c.After] || cpids[c.ID] || after[c.After] || c.Kind != "human" || c.Question == "" || !regexp.MustCompile(`^C[0-9]{2,}$`).MatchString(c.ID) {
			return problem("invalid_checkpoint", "unique C01 checkpoints must reference a step, kind human, and a question")
		}
		cpids[c.ID] = true
		after[c.After] = true
	}
	return nil
}
func (s *Store) create(m Mission) (Record, error) {
	var rec Record
	normalizeMission(&m)
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
			return problem("exists", "mission %s already exists; inspect it instead of overwriting", h)
		}
		m.ID = uid("mission-")
		m.Schema = 1
		m.Created = now()
		if m.Body == "" {
			m.Body = "# " + m.Title + "\n\n## Goal\n" + m.Goal + "\n\nStep instructions, acceptance criteria and checks are defined in frontmatter.\n"
		}
		b, e := markdown(m, m.Body)
		if e != nil {
			return e
		}
		st := stateFor(m, digest(b))
		rec = Record{Handle: h, Mission: m, State: st}
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
func (s *Store) load(h string) (Record, error) {
	var r Record
	p, pe := s.editPath(h)
	if pe != nil {
		return r, pe
	}
	if _, pe = os.Stat(p); pe == nil {
		return r, problem("edit_pending", "step edit was interrupted; run mission repair %s", h)
	} else if !os.IsNotExist(pe) {
		return r, pe
	}
	d, e := s.dir(h)
	if e != nil {
		return r, e
	}
	b, e := os.ReadFile(filepath.Join(d, "mission.md"))
	if e != nil {
		return r, problem("not_found", "mission %s not found", h)
	}
	body, e := parseMarkdown(b, &r.Mission)
	if e != nil {
		return r, e
	}
	r.Mission.Body = body
	normalizeMission(&r.Mission)
	r.Handle = h
	if e = validateMission(r.Mission); e != nil {
		return r, e
	}
	repo, slug, _ := splitHandle(h)
	if r.Mission.Repo != repo || r.Mission.Slug != slug {
		return r, problem("identity_mismatch", "mission metadata does not match its directory")
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
		return r, problem("identity_mismatch", "state belongs to another mission")
	}
	return r, nil
}
func (s *Store) list() ([]Record, error) {
	repos, e := s.repos()
	if e != nil {
		return nil, e
	}
	out := []Record{}
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
func (s *Store) save(r *Record) error {
	d, e := s.dir(r.Handle)
	if e != nil {
		return e
	}
	b, e := markdown(r.State, stateBody(*r))
	if e != nil {
		return e
	}
	// state.md is the single commit point; attempt notes and event streams are projections.
	if e = atomicWrite(filepath.Join(d, "state.md"), b); e != nil {
		return e
	}
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
			return problem("projection_failed", "state committed; attempt projection failed: %v; use mission repair", e)
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
			return problem("projection_failed", "state committed; event projection failed: %v", e)
		}
	}
	return nil
}
func stateBody(r Record) string {
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
func (s *Store) mutate(h string, fn func(*Record) error) (Record, error) {
	var r Record
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
func verificationSummary(v Verification) string {
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
