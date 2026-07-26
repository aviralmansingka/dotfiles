package vaultregistry

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"syscall"
	"time"
)

type Producer struct{ root string }
type Reader struct{ root string }

func ResolveRoot() (string, error) {
	if root := os.Getenv("VAULT_HUNTER_STATE_DIR"); root != "" {
		return root, nil
	}
	if root := os.Getenv("XDG_STATE_HOME"); root != "" {
		return filepath.Join(root, "vault-hunter"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".local", "state", "vault-hunter"), nil
}

func OpenProducer(root string) (*Producer, error) {
	var err error
	if root == "" {
		root, err = ResolveRoot()
	}
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(root, "runs"), 0700); err != nil {
		return nil, err
	}
	if err := os.Chmod(root, 0700); err != nil {
		return nil, err
	}
	if err := os.Chmod(filepath.Join(root, "runs"), 0700); err != nil {
		return nil, err
	}
	return &Producer{root: root}, nil
}

func OpenReader(root string) (*Reader, error) {
	var err error
	if root == "" {
		root, err = ResolveRoot()
	}
	if err != nil {
		return nil, err
	}
	return &Reader{root: root}, nil
}

func (p *Producer) Create(run Run) (Run, error) {
	if run.Revision != 0 {
		return Run{}, fmt.Errorf("%w: create revision must be zero", ErrMalformed)
	}
	if err := validID(run.RunID); err != nil {
		return Run{}, err
	}
	unlock, err := p.lock()
	if err != nil {
		return Run{}, err
	}
	defer unlock()
	for _, path := range []string{p.path(run.RunID), p.retiredPath(run.RunID)} {
		if _, err := os.Lstat(path); err == nil {
			return Run{}, fmt.Errorf("%w: run ID is reserved", ErrConflict)
		} else if !errors.Is(err, os.ErrNotExist) {
			return Run{}, err
		}
	}
	run.Revision = 1
	if err := validate(run); err != nil {
		return Run{}, err
	}
	if err := p.write(run); err != nil {
		return Run{}, err
	}
	return clone(run)
}

func (p *Producer) Update(runID string, expectedRevision uint64, mutate func(*Run) error) (Run, error) {
	if err := validID(runID); err != nil {
		return Run{}, err
	}
	unlock, err := p.lock()
	if err != nil {
		return Run{}, err
	}
	defer unlock()
	return p.updateLocked(runID, expectedRevision, mutate)
}

func (p *Producer) updateLocked(runID string, expectedRevision uint64, mutate func(*Run) error) (Run, error) {
	current, err := load(p.path(runID), runID)
	if err != nil {
		return Run{}, err
	}
	if current.Revision != expectedRevision {
		return Run{}, fmt.Errorf("%w: expected %d, actual %d", ErrConflict, expectedRevision, current.Revision)
	}
	next, err := clone(current)
	if err != nil {
		return Run{}, err
	}
	if err := mutate(&next); err != nil {
		return Run{}, err
	}
	if err := validateUpdate(current, next); err != nil {
		return Run{}, err
	}
	next.Revision = expectedRevision + 1
	if err := validate(next); err != nil {
		return Run{}, err
	}
	if err := p.write(next); err != nil {
		return Run{}, err
	}
	return clone(next)
}

func validateUpdate(current, next Run) error {
	scalarsChanged := next.SchemaVersion != current.SchemaVersion ||
		next.RunID != current.RunID || next.Revision != current.Revision ||
		next.InvokedAt != current.InvokedAt || !equalJSON(current.Task, next.Task)
	unknownChanged := len(current.Unknown) > 0 && !equalJSON(current.Unknown, next.Unknown)
	historyChanged := !historyPrefix(current.Participants, next.Participants) ||
		!historyPrefix(current.Lifecycle, next.Lifecycle) ||
		!historyPrefix(current.Evidence, next.Evidence)
	if scalarsChanged || unknownChanged || historyChanged {
		return fmt.Errorf("%w: immutable fields or history prefixes changed", ErrMalformed)
	}
	return nil
}

func historyPrefix[T any](current, next []T) bool {
	return len(next) >= len(current) &&
		slices.EqualFunc(current, next[:len(current)], equalJSON)
}

// Retire atomically moves an exact active Run revision into the reserved
// retired namespace. A retry for the same retired revision is idempotent.
func (p *Producer) Retire(runID string, expectedRevision uint64) (Run, error) {
	if err := validID(runID); err != nil {
		return Run{}, err
	}
	if expectedRevision == 0 {
		return Run{}, fmt.Errorf("%w: retire revision must be non-zero", ErrMalformed)
	}
	unlock, err := p.lock()
	if err != nil {
		return Run{}, err
	}
	defer unlock()

	activePath := p.path(runID)
	retiredPath := p.retiredPath(runID)
	activeInfo, activeErr := os.Lstat(activePath)
	retiredInfo, retiredErr := os.Lstat(retiredPath)
	if activeErr != nil && !errors.Is(activeErr, os.ErrNotExist) {
		return Run{}, activeErr
	}
	if retiredErr != nil && !errors.Is(retiredErr, os.ErrNotExist) {
		return Run{}, retiredErr
	}
	activeExists := activeErr == nil
	retiredExists := retiredErr == nil

	if activeExists && retiredExists {
		return Run{}, fmt.Errorf("%w: active and retired records both exist", ErrConflict)
	}
	if !activeExists {
		if !retiredExists {
			return Run{}, fmt.Errorf("%w: %s", ErrNotFound, activePath)
		}
		if !retiredInfo.Mode().IsRegular() {
			return Run{}, fmt.Errorf("%w: retired destination collision", ErrConflict)
		}
		retired, err := load(retiredPath, runID)
		if err != nil {
			return Run{}, err
		}
		if retired.Revision != expectedRevision {
			return Run{}, fmt.Errorf("%w: expected %d, retired %d", ErrConflict, expectedRevision, retired.Revision)
		}
		return clone(retired)
	}
	if !activeInfo.Mode().IsRegular() {
		return Run{}, fmt.Errorf("%w: %s: active record is not a regular file", ErrMalformed, activePath)
	}
	active, err := load(activePath, runID)
	if err != nil {
		return Run{}, err
	}
	if active.Revision != expectedRevision {
		return Run{}, fmt.Errorf("%w: expected %d, actual %d", ErrConflict, expectedRevision, active.Revision)
	}

	retiredDir := filepath.Join(p.root, "retired")
	createdRetiredDir := false
	if info, err := os.Lstat(retiredDir); errors.Is(err, os.ErrNotExist) {
		if err := os.Mkdir(retiredDir, 0700); err != nil {
			return Run{}, err
		}
		createdRetiredDir = true
	} else if err != nil {
		return Run{}, err
	} else if !info.IsDir() {
		return Run{}, fmt.Errorf("%w: retired namespace is not a directory", ErrConflict)
	}
	if err := os.Chmod(retiredDir, 0700); err != nil {
		if createdRetiredDir {
			_ = os.Remove(retiredDir)
		}
		return Run{}, err
	}

	activeDir, err := os.Open(filepath.Join(p.root, "runs"))
	if err != nil {
		if createdRetiredDir {
			_ = os.Remove(retiredDir)
		}
		return Run{}, err
	}
	defer activeDir.Close()
	retiredDirFile, err := os.Open(retiredDir)
	if err != nil {
		if createdRetiredDir {
			_ = os.Remove(retiredDir)
		}
		return Run{}, err
	}
	defer retiredDirFile.Close()

	if err := os.Rename(activePath, retiredPath); err != nil {
		if createdRetiredDir {
			_ = os.Remove(retiredDir)
		}
		return Run{}, err
	}
	activeSyncErr := activeDir.Sync()
	retiredSyncErr := retiredDirFile.Sync()
	if err := errors.Join(activeSyncErr, retiredSyncErr); err != nil {
		return Run{}, err
	}
	return clone(active)
}

func (p *Producer) Get(runID string) (Run, error) { return load(p.path(runID), runID) }
func (r *Reader) Get(runID string) (Run, error) {
	if err := validID(runID); err != nil {
		return Run{}, err
	}
	return load(filepath.Join(r.root, "runs", runID+".json"), runID)
}

// GetRetired reads only the explicit retired namespace without creating state.
func (r *Reader) GetRetired(runID string) (Run, error) {
	if err := validID(runID); err != nil {
		return Run{}, err
	}
	return load(filepath.Join(r.root, "retired", runID+".json"), runID)
}

// List returns all recorded runs in deterministic Run ID order without creating state.
func (r *Reader) List() ([]Run, error) {
	unlock, err := r.lock()
	if err != nil {
		return nil, err
	}
	defer unlock()

	entries, err := os.ReadDir(filepath.Join(r.root, "runs"))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var ids []string
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".json") {
			ids = append(ids, strings.TrimSuffix(entry.Name(), ".json"))
		}
	}
	sort.Strings(ids)
	runs := make([]Run, 0, len(ids))
	for _, id := range ids {
		run, err := r.Get(id)
		if err != nil {
			return nil, err
		}
		runs = append(runs, run)
	}
	return runs, nil
}

// ListSummaries returns a complete, bounded snapshot of active Run records.
func (r *Reader) ListSummaries(filter ListFilter) ([]RunSummary, error) {
	from, through, err := validateListFilter(filter)
	if err != nil {
		return nil, err
	}
	unlock, err := r.lock()
	if err != nil {
		return nil, err
	}
	defer unlock()

	runs, err := r.activeRuns()
	if err != nil {
		return nil, err
	}
	summaries := make([]RunSummary, 0, len(runs))
	for _, run := range runs {
		if matchesListFilter(run, filter, from, through) {
			summaries = append(summaries, summarize(run))
		}
	}
	sort.Slice(summaries, func(i, j int) bool {
		return summaries[i].RunID < summaries[j].RunID
	})
	return summaries, nil
}

// activeRuns validates every active JSON record before ListSummaries applies
// filters. Temporary files, non-JSON entries, and directories are not active.
// ponytail: scan all records; add an index only if Registry size makes it measurable.
func (r *Reader) activeRuns() ([]Run, error) {
	dir := filepath.Join(r.root, "runs")
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return []Run{}, nil
	}
	if err != nil {
		return nil, err
	}
	runs := make([]Run, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		path := filepath.Join(dir, entry.Name())
		info, err := os.Lstat(path)
		if err != nil {
			return nil, err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return nil, fmt.Errorf("%w: %s: active record is a symlink", ErrMalformed, path)
		}
		if !info.Mode().IsRegular() {
			return nil, fmt.Errorf("%w: %s: active record is not a regular file", ErrMalformed, path)
		}
		id := strings.TrimSuffix(entry.Name(), ".json")
		if err := validID(id); err != nil {
			return nil, fmt.Errorf("%w: %s: invalid run file name", ErrMalformed, path)
		}
		run, err := load(path, id)
		if err != nil {
			return nil, err
		}
		runs = append(runs, run)
	}
	return runs, nil
}

func validateListFilter(filter ListFilter) (*time.Time, *time.Time, error) {
	if session := filter.AgentSession; session != nil &&
		(session.Source == "" || session.Kind == "" || session.Value == "") {
		return nil, nil, fmt.Errorf("%w: agent_session requires source, kind, and value", ErrMalformed)
	}
	from, err := parseListBoundary("updated_at_from", filter.UpdatedAtFrom)
	if err != nil {
		return nil, nil, err
	}
	through, err := parseListBoundary("updated_at_through", filter.UpdatedAtThrough)
	if err != nil {
		return nil, nil, err
	}
	if from != nil && through != nil && from.After(*through) {
		return nil, nil, fmt.Errorf("%w: updated_at_from is after updated_at_through", ErrMalformed)
	}
	return from, through, nil
}

func parseListBoundary(name, value string) (*time.Time, error) {
	if value == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid %s: %v", ErrMalformed, name, err)
	}
	return &parsed, nil
}

func matchesListFilter(run Run, filter ListFilter, from, through *time.Time) bool {
	if filter.TaskID != "" && run.Task.ID != filter.TaskID ||
		filter.FeaturePath != "" && run.Task.FeaturePath != filter.FeaturePath {
		return false
	}
	if wanted := filter.AgentSession; wanted != nil {
		matched := false
		for _, participant := range run.Participants {
			session := participant.AgentSession
			if session != nil && session.Source == wanted.Source &&
				session.Kind == wanted.Kind && session.Value == wanted.Value {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}
	updated, _ := time.Parse(time.RFC3339, run.UpdatedAt)
	return (from == nil || !updated.Before(*from)) &&
		(through == nil || !updated.After(*through))
}

func summarize(run Run) RunSummary {
	return RunSummary{
		SchemaVersion: run.SchemaVersion,
		RunID:         run.RunID,
		Revision:      run.Revision,
		InvokedAt:     run.InvokedAt,
		UpdatedAt:     run.UpdatedAt,
		Task: TaskSummary{
			ID:          run.Task.ID,
			Title:       run.Task.Title,
			Path:        run.Task.Path,
			FeaturePath: run.Task.FeaturePath,
			Kind:        run.Task.Kind,
		},
	}
}

func (p *Producer) path(id string) string { return filepath.Join(p.root, "runs", id+".json") }
func (p *Producer) retiredPath(id string) string {
	return filepath.Join(p.root, "retired", id+".json")
}

func (p *Producer) lock() (func(), error) {
	f, err := os.OpenFile(filepath.Join(p.root, "registry.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err := f.Chmod(0600); err != nil {
		f.Close()
		return nil, err
	}
	return flock(f, syscall.LOCK_EX)
}

// Reader locking is deliberately non-creating: a missing lock file represents
// an empty or not-yet-produced Registry and has a snapshot before any writer.
func (r *Reader) lock() (func(), error) {
	f, err := os.Open(filepath.Join(r.root, "registry.lock"))
	if errors.Is(err, os.ErrNotExist) {
		return func() {}, nil
	}
	if err != nil {
		return nil, err
	}
	return flock(f, syscall.LOCK_SH)
}

func flock(f *os.File, mode int) (func(), error) {
	if err := syscall.Flock(int(f.Fd()), mode); err != nil {
		f.Close()
		return nil, err
	}
	return func() {
		_ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
		_ = f.Close()
	}, nil
}

func (p *Producer) write(run Run) error {
	data, err := json.Marshal(run)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	dir := filepath.Join(p.root, "runs")
	name, err := writeTemp(dir, data)
	if err != nil {
		return err
	}
	defer os.Remove(name)
	if err := os.Rename(name, p.path(run.RunID)); err != nil {
		return err
	}
	d, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}

func writeTemp(dir string, data []byte) (string, error) {
	tmp, err := os.CreateTemp(dir, ".run-*.tmp")
	if err != nil {
		return "", err
	}
	name := tmp.Name()
	if err = tmp.Chmod(0600); err == nil {
		_, err = tmp.Write(data)
	}
	if err == nil {
		err = tmp.Sync()
	}
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		os.Remove(name)
		return "", err
	}
	return name, nil
}

func load(path, requestedID string) (Run, error) {
	if err := validID(requestedID); err != nil {
		return Run{}, err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return Run{}, fmt.Errorf("%w: %s", ErrNotFound, path)
	}
	if err != nil {
		return Run{}, err
	}
	if err := checkVersion(data, path); err != nil {
		return Run{}, err
	}
	var run Run
	if err := json.Unmarshal(data, &run); err != nil {
		return Run{}, fmt.Errorf("%w: %s: %v", ErrMalformed, path, err)
	}
	if run.RunID != requestedID {
		return Run{}, fmt.Errorf("%w: %s: run_id mismatch", ErrMalformed, path)
	}
	if err := validate(run); err != nil {
		return Run{}, fmt.Errorf("%w: %s: %v", ErrMalformed, path, err)
	}
	return run, nil
}

func checkVersion(data []byte, path string) error {
	var version struct {
		SchemaVersion json.RawMessage `json:"schema_version"`
	}
	if err := json.Unmarshal(data, &version); err != nil {
		return fmt.Errorf("%w: %s: %v", ErrMalformed, path, err)
	}
	var n uint64
	if len(version.SchemaVersion) == 0 || json.Unmarshal(version.SchemaVersion, &n) != nil || n == 0 {
		return fmt.Errorf("%w: %s: invalid schema_version", ErrMalformed, path)
	}
	if n != 1 {
		return fmt.Errorf("%w: %s: version %d", ErrUnsupportedVersion, path, n)
	}
	return nil
}
