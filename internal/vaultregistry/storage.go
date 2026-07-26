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
	if _, err := os.Stat(p.path(run.RunID)); err == nil {
		return Run{}, fmt.Errorf("%w: run already exists", ErrConflict)
	} else if !errors.Is(err, os.ErrNotExist) {
		return Run{}, err
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

func (p *Producer) Get(runID string) (Run, error) { return load(p.path(runID), runID) }
func (r *Reader) Get(runID string) (Run, error) {
	if err := validID(runID); err != nil {
		return Run{}, err
	}
	return load(filepath.Join(r.root, "runs", runID+".json"), runID)
}

// List returns all recorded runs in deterministic Run ID order without creating state.
func (r *Reader) List() ([]Run, error) {
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

func (p *Producer) path(id string) string { return filepath.Join(p.root, "runs", id+".json") }

func (p *Producer) lock() (func(), error) {
	f, err := os.OpenFile(filepath.Join(p.root, "registry.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err := f.Chmod(0600); err != nil {
		f.Close()
		return nil, err
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX); err != nil {
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
