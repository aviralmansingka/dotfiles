// Package vaultfs is the mission ledger as files in the vault.
//
// It owns every storage fact: the mission directory layout, the YAML and
// markdown bytes, the revision compare-and-swap, the journal, and the
// machine-wide lock. It decides no policy; the core does that and calls in
// through the mission.Repository port.
package vaultfs

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

// Store is one vault.
type Store struct {
	Vault string
	// LockDir overrides the machine-wide lock directory. Tests use it to show
	// two actors whose locks do not meet.
	LockDir string
}

// Option changes one Store setting.
type Option func(*Store)

// WithLockDir puts this store's lock in d instead of the shared directory.
func WithLockDir(d string) Option { return func(s *Store) { s.LockDir = d } }

// Open resolves one vault path and creates it when it is missing.
func Open(v string, opts ...Option) (*Store, error) {
	if strings.HasPrefix(v, "~/") {
		h, _ := os.UserHomeDir()
		v = filepath.Join(h, v[2:])
	}
	p, e := filepath.Abs(v)
	if e != nil {
		return nil, e
	}
	p = filepath.Clean(p)
	if e = os.MkdirAll(p, 0700); e != nil {
		return nil, e
	}
	p, e = filepath.EvalSymlinks(p)
	if e != nil {
		return nil, e
	}
	s := &Store{Vault: p}
	for _, opt := range opts {
		opt(s)
	}
	return s, nil
}

// VaultPath is the resolved vault root.
func (s *Store) VaultPath() string { return s.Vault }

// Path resolves one path inside the mission collection. Reads and writes share
// this check: a path that escapes the collection, or that crosses a symlink, is
// refused rather than followed.
func (s *Store) Path(parts ...string) (string, error) {
	base := filepath.Join(s.Vault, "6_missions")
	p := filepath.Join(append([]string{base}, parts...)...)
	r, e := filepath.Rel(base, p)
	if e != nil || r == ".." || strings.HasPrefix(r, ".."+string(os.PathSeparator)) {
		return "", mission.Problem("invalid_path", "path escapes mission store")
	}
	// Reject symlink traversal, including the collection root.
	cur := s.Vault
	rel, _ := filepath.Rel(s.Vault, p)
	for _, c := range strings.Split(rel, string(os.PathSeparator)) {
		cur = filepath.Join(cur, c)
		st, e := os.Lstat(cur)
		if os.IsNotExist(e) {
			continue
		}
		if e != nil {
			return "", e
		}
		if st.Mode()&os.ModeSymlink != 0 {
			return "", mission.Problem("invalid_path", "symlink refused: %s", cur)
		}
	}
	return p, nil
}

// Dir is the mission directory of one record.
func (s *Store) Dir(handle string) (string, error) {
	r, m, e := mission.SplitHandle(handle)
	if e != nil {
		return "", e
	}
	return s.Path(r, m)
}

// EditPath is the pending step-edit journal of one mission. It exists only
// between an interrupted edit and the repair that replays it.
func (s *Store) EditPath(handle string) (string, error) {
	r, m, e := mission.SplitHandle(handle)
	if e != nil {
		return "", e
	}
	return s.Path(r, m, ".step-edit.yml")
}

// Artifacts is the path of one attempt's result inside its mission.
func (s *Store) Artifacts(claim mission.Claim) string {
	d, _ := s.Dir(claim.Handle)
	return platform.ArtifactPath(d, claim.Attempt.Artifact)
}

// Read returns one record as stored. A pending step edit is a storage fact, so
// the read refuses until repair replays it; policy checks belong to the core.
func (s *Store) Read(handle string) (mission.Record, error) { return s.read(handle, false) }

// read is Read, with the pending-edit refusal that repair's replay passes.
func (s *Store) read(handle string, throughEdit bool) (mission.Record, error) {
	var r mission.Record
	if !throughEdit {
		p, pe := s.EditPath(handle)
		if pe != nil {
			return r, pe
		}
		if _, pe = os.Stat(p); pe == nil {
			return r, mission.Problem("edit_pending", "step edit was interrupted; run mission repair %s", handle)
		} else if !os.IsNotExist(pe) {
			return r, pe
		}
	}
	d, e := s.Dir(handle)
	if e != nil {
		return r, e
	}
	b, e := os.ReadFile(filepath.Join(d, "mission.md"))
	if e != nil {
		return r, mission.Problem("not_found", "mission %s not found", handle)
	}
	body, e := platform.ParseMarkdown(b, &r.Mission)
	if e != nil {
		return r, e
	}
	r.Mission.Body = body
	mission.NormalizeMission(&r.Mission)
	r.Handle = handle
	b, e = os.ReadFile(filepath.Join(d, "state.md"))
	if e != nil {
		return r, e
	}
	_, e = platform.ParseMarkdown(b, &r.State)
	if e != nil {
		return r, e
	}
	return r, nil
}

// List returns every stored record.
func (s *Store) List() ([]mission.Record, error) {
	repos, e := s.Repos()
	if e != nil {
		return nil, e
	}
	out := []mission.Record{}
	for _, repo := range repos {
		p, e := s.Path(repo.Slug)
		if e != nil {
			return nil, e
		}
		ents, e := os.ReadDir(p)
		if e != nil {
			return nil, e
		}
		for _, v := range ents {
			if !v.IsDir() || !mission.ValidSlug(v.Name()) {
				continue
			}
			r, e := s.Read(repo.Slug + "/" + v.Name())
			if e != nil {
				return nil, e
			}
			out = append(out, r)
		}
	}
	return out, nil
}

// Create writes one new mission record. The core stamps and validates the
// mission first; the store refuses an existing directory and renames the new
// directory into place as one step.
func (s *Store) Create(m mission.Mission) (mission.Record, error) {
	var rec mission.Record
	e := s.locked(func() error {
		h := m.Repo + "/" + m.Slug
		d, e := s.Dir(h)
		if e != nil {
			return e
		}
		if _, e = os.Stat(filepath.Join(d, "mission.md")); e == nil {
			return mission.Problem("exists", "mission %s already exists; inspect it instead of overwriting", h)
		}
		b, e := platform.Markdown(m, m.Body)
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
		if e = platform.AtomicWrite(filepath.Join(stage, "mission.md"), b); e != nil {
			return e
		}
		sb, e := platform.Markdown(st, stateBody(rec))
		if e != nil {
			return e
		}
		if e = platform.AtomicWrite(filepath.Join(stage, "state.md"), sb); e != nil {
			return e
		}
		return os.Rename(stage, d)
	})
	return rec, e
}

// Update reads one record under the lock, lets fn change it, and saves the
// result with the revision it was read at as the base. fn returns ErrNoWrite to
// leave the ledger, its revision, and the journal untouched.
func (s *Store) Update(handle, writer string, fn func(*mission.Record) error) (mission.Record, error) {
	return s.update(handle, writer, false, fn)
}

// UpdatePending is Update for a mission whose pending step edit is being
// replayed: the interrupted edit is what it applies, so the read goes through
// the journal. Repair is its only caller.
func (s *Store) UpdatePending(handle, writer string, fn func(*mission.Record) error) (mission.Record, error) {
	return s.update(handle, writer, true, fn)
}

func (s *Store) update(handle, writer string, throughEdit bool, fn func(*mission.Record) error) (mission.Record, error) {
	var r mission.Record
	e := s.locked(func() error {
		var e error
		r, e = s.read(handle, throughEdit)
		if e != nil {
			return e
		}
		if e = fn(&r); e != nil {
			if errors.Is(e, mission.ErrNoWrite) {
				return nil
			}
			return e
		}
		r.State.Revision++
		return s.saveFrom(&r, r.State.Revision-1, writer)
	})
	return r, e
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

// journal appends one line per save. It never fails a save: the ledger is the
// commit point and the journal is evidence.
func (s *Store) journal(r *mission.Record, base int, writer, result string) {
	p, e := s.Path(r.Mission.Repo, r.Mission.Slug, "journal.jsonl")
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

// Save writes one record at the revision it carries, journaling it under one
// writer. It is the commit point Update composes; a caller that already holds
// the record writes through it and gets the same compare-and-swap refusal.
func (s *Store) Save(r *mission.Record, writer string) error {
	return s.saveFrom(r, r.State.Revision-1, writer)
}

// saveFrom refuses to replace a ledger that moved after this record was read.
// A record carries the revision it was loaded from, so a stale snapshot cannot
// drop an attempt that a claim already saved.
func (s *Store) saveFrom(r *mission.Record, base int, writer string) error {
	d, e := s.Dir(r.Handle)
	if e != nil {
		return e
	}
	sp := filepath.Join(d, "state.md")
	if onDisk, e := os.ReadFile(sp); e == nil {
		var disk mission.State
		if _, pe := platform.ParseMarkdown(onDisk, &disk); pe != nil {
			return mission.Problem("invalid_note", "state.md cannot be read for the revision check: %v", pe)
		}
		if disk.Revision != base {
			s.journal(r, base, writer, "refused")
			return mission.Problem("revision_conflict", "the ledger moved to revision %d after this record was read at revision %d; reload and retry", disk.Revision, base)
		}
	} else if !os.IsNotExist(e) {
		return e
	}
	b, e := platform.Markdown(r.State, stateBody(*r))
	if e != nil {
		return e
	}
	// state.md is the single commit point; attempt notes and event streams are projections.
	if e = platform.AtomicWrite(sp, b); e != nil {
		return e
	}
	s.journal(r, base, writer, "saved")
	for _, a := range r.State.Attempts {
		p, e := s.Path(r.Mission.Repo, r.Mission.Slug, "attempts", fmt.Sprintf("%03d.md", a.Sequence))
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
			body += "\n## Verification " + v.ID + "\n" + mission.VerificationSummary(v) + "\nSubject: `" + v.SubjectHash + "`\n"
			for _, c := range v.Results {
				for _, ev := range c.Evidence {
					body += "- " + c.Check + ": `" + ev.Path + "` (`" + ev.Hash + "`)\n"
				}
			}
		}
		body += "\nLifecycle events are also projected beside this note."
		b, e := platform.Markdown(a, body)
		if e != nil {
			return e
		}
		if e = platform.AtomicWrite(p, b); e != nil {
			return mission.Problem("projection_failed", "state committed; attempt projection failed: %v; use mission repair", e)
		}
		var events bytes.Buffer
		enc := json.NewEncoder(&events)
		for _, ev := range a.Events {
			if e = enc.Encode(ev); e != nil {
				return e
			}
		}
		ep, e := s.Path(r.Mission.Repo, r.Mission.Slug, "attempts", fmt.Sprintf("%03d.events.jsonl", a.Sequence))
		if e != nil {
			return e
		}
		if e = platform.AtomicWrite(ep, events.Bytes()); e != nil {
			return mission.Problem("projection_failed", "state committed; event projection failed: %v", e)
		}
	}
	return nil
}

// StateBody renders the human-readable progress body of one state.
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

// StateBody is the progress body stored beside one record's state.
func StateBody(r mission.Record) string { return stateBody(r) }

// locked runs fn with the vault lock held. The lock is one file per real vault
// path, so two actors agree through the filesystem and not through a process.
func (s *Store) locked(fn func() error) error {
	// ponytail: one local lock per real vault path; Git sync is not a distributed mutex.
	d := s.LockDir
	if d == "" {
		d = filepath.Join(os.TempDir(), "mission-cli-locks")
	}
	if e := os.MkdirAll(d, 0700); e != nil {
		return e
	}
	p := filepath.Join(d, strings.TrimPrefix(mission.Digest([]byte(s.Vault)), "sha256:")+".lock")
	f, e := os.OpenFile(p, os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return e
	}
	defer f.Close()
	if e = syscall.Flock(int(f.Fd()), syscall.LOCK_EX); e != nil {
		return e
	}
	defer syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
	return fn()
}
