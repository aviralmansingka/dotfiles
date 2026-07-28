package vaultregistry

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"syscall"
	"time"
)

type Producer struct {
	root       string
	createLock bool
}
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
	return &Producer{root: root, createLock: true}, nil
}

func OpenExistingProducer(root string) (*Producer, error) {
	var err error
	if root == "" {
		root, err = ResolveRoot()
	}
	if err != nil {
		return nil, err
	}
	for _, path := range []string{root, filepath.Join(root, "runs")} {
		info, statErr := os.Stat(path)
		if errors.Is(statErr, os.ErrNotExist) {
			return nil, fmt.Errorf("%w: %s", ErrNotFound, path)
		}
		if statErr != nil {
			return nil, statErr
		}
		if !info.IsDir() {
			return nil, fmt.Errorf("%w: %s: Registry path is not a directory", ErrMalformed, path)
		}
	}
	lockPath := filepath.Join(root, "registry.lock")
	if info, statErr := os.Stat(lockPath); statErr != nil {
		if errors.Is(statErr, os.ErrNotExist) {
			entries, readErr := os.ReadDir(filepath.Join(root, "runs"))
			if readErr != nil {
				return nil, readErr
			}
			if len(entries) == 0 {
				return nil, fmt.Errorf("%w: Registry is empty", ErrNotFound)
			}
			return nil, fmt.Errorf("%w: %s: missing Registry lock", ErrMalformed, lockPath)
		}
		return nil, statErr
	} else if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("%w: %s: Registry lock is not a regular file", ErrMalformed, lockPath)
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
	if run.SchemaVersion == 2 {
		return Run{}, fmt.Errorf("%w: schema-version-2 Runs require reconciled CreateRun", ErrMalformed)
	}
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
	if err := validateProducer(run, 0); err != nil {
		return Run{}, err
	}
	if err := p.write(run); err != nil {
		return Run{}, err
	}
	return clone(run)
}

// CreateRun atomically persists one reconciled schema-version-2 Run and its
// initial driver. Exact identity-and-driver replay is a no-write success.
func (p *Producer) CreateRun(request CreateRequest) (Run, error) {
	run := request.Run
	if run.Revision != 0 {
		return Run{}, fmt.Errorf("%w: create revision must be zero", ErrMalformed)
	}
	run.Revision = 1
	if err := validateInitialCreate(run, request.InitialDriver); err != nil {
		return Run{}, err
	}
	unlock, err := p.lock()
	if err != nil {
		return Run{}, err
	}
	defer unlock()

	var reserved []string
	for _, path := range []string{p.path(run.RunID), p.retiredPath(run.RunID)} {
		if _, err := os.Lstat(path); err == nil {
			reserved = append(reserved, path)
		} else if !errors.Is(err, os.ErrNotExist) {
			return Run{}, err
		}
	}
	if len(reserved) > 1 {
		return Run{}, fmt.Errorf("%w: run ID exists in active and retired namespaces", ErrConflict)
	}
	if len(reserved) == 1 {
		if reserved[0] == p.retiredPath(run.RunID) {
			return Run{}, fmt.Errorf("%w: run ID is retired", ErrConflict)
		}
		existing, err := loadProducer(reserved[0], run.RunID)
		if err != nil {
			return Run{}, err
		}
		if sameCreateReplay(existing, run, request.InitialDriver) {
			return clone(existing)
		}
		return Run{}, fmt.Errorf("%w: run identity or initial driver differs", ErrConflict)
	}
	if err := p.reserveName(run.Name, run.RunID); err != nil {
		return Run{}, err
	}
	run.Observations = []Observation{request.InitialDriver}
	if err := p.writeCreate(run); err != nil {
		return Run{}, err
	}
	return clone(run)
}

func sameCreateReplay(existing, wanted Run, driver Observation) bool {
	return existing.SchemaVersion == wanted.SchemaVersion && existing.RunID == wanted.RunID && existing.Name == wanted.Name &&
		existing.RunKind == wanted.RunKind && existing.InvokedAt == wanted.InvokedAt && equalJSON(existing.WorkReference, wanted.WorkReference) &&
		len(existing.Observations) > 0 && equalJSON(existing.Observations[0], driver)
}

func (p *Producer) reserveName(name, runID string) error {
	for _, namespace := range []string{"runs", "retired"} {
		dir := filepath.Join(p.root, namespace)
		entries, err := os.ReadDir(dir)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
				continue
			}
			id := strings.TrimSuffix(entry.Name(), ".json")
			existing, err := load(filepath.Join(dir, entry.Name()), id)
			if err != nil {
				return err
			}
			if existing.RunID != runID && existing.Name == name {
				return fmt.Errorf("%w: run name is reserved", ErrConflict)
			}
		}
	}
	return nil
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

// AppendObservation atomically appends one strict schema-version-2
// observation. Replaying canonical byte-equivalent content is a no-write
// success, even when the caller's expected revision is stale. Reusing an ID
// for different content is a classified conflict.
func (p *Producer) AppendObservation(runID string, expectedRevision uint64, updatedAt string, observation Observation) (Run, error) {
	if err := validID(runID); err != nil {
		return Run{}, err
	}
	unlock, err := p.lock()
	if err != nil {
		return Run{}, err
	}
	defer unlock()
	if err := p.rejectRetiredV2(runID); err != nil {
		return Run{}, err
	}
	current, err := loadProducer(p.path(runID), runID)
	if err != nil {
		return Run{}, err
	}
	if current.SchemaVersion != 2 {
		return Run{}, fmt.Errorf("%w: observations require schema version 2", ErrUnsupportedVersion)
	}
	for _, existing := range current.Observations {
		if existing.ObservationID != observation.ObservationID {
			continue
		}
		if equalJSON(existing, observation) {
			return clone(current)
		}
		return Run{}, fmt.Errorf("%w: observation_id %q content differs", ErrConflict, observation.ObservationID)
	}
	return p.updateLocked(runID, expectedRevision, func(next *Run) error {
		next.UpdatedAt = updatedAt
		next.Observations = append(next.Observations, observation)
		return nil
	})
}

func (p *Producer) updateLocked(runID string, expectedRevision uint64, mutate func(*Run) error) (Run, error) {
	if err := p.rejectRetiredV2(runID); err != nil {
		return Run{}, err
	}
	current, err := loadProducer(p.path(runID), runID)
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
	strictFrom := len(current.Observations)
	next.Revision = expectedRevision + 1
	if err := validateProducer(next, strictFrom); err != nil {
		return Run{}, err
	}
	if err := p.write(next); err != nil {
		return Run{}, err
	}
	return clone(next)
}

func validateUpdate(current, next Run) error {
	scalarsChanged := next.SchemaVersion != current.SchemaVersion ||
		next.RunID != current.RunID || next.Name != current.Name || next.RunKind != current.RunKind || next.Revision != current.Revision ||
		next.InvokedAt != current.InvokedAt || !equalJSON(current.Task, next.Task) || !equalJSON(current.WorkReference, next.WorkReference)
	unknownChanged := len(current.Unknown) > 0 && !equalJSON(current.Unknown, next.Unknown)
	if current.SchemaVersion == 2 {
		unknownChanged = !equalJSON(current.Unknown, next.Unknown)
		scalarsChanged = scalarsChanged || next.State != current.State || !equalJSON(next.RetiredAt, current.RetiredAt)
	}
	historyChanged := !historyPrefix(current.Participants, next.Participants) ||
		!historyPrefix(current.Lifecycle, next.Lifecycle) ||
		!historyPrefix(current.Evidence, next.Evidence) ||
		!historyPrefix(current.Observations, next.Observations)
	if scalarsChanged || unknownChanged || historyChanged {
		return fmt.Errorf("%w: immutable fields or history prefixes changed", ErrMalformed)
	}
	return nil
}

func historyPrefix[T any](current, next []T) bool {
	return len(next) >= len(current) &&
		slices.EqualFunc(current, next[:len(current)], equalJSON)
}

func (p *Producer) rejectRetiredV2(runID string) error {
	retired, err := loadProducer(p.retiredPath(runID), runID)
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if retired.SchemaVersion == 2 {
		return fmt.Errorf("%w: run is retired", ErrConflict)
	}
	return nil
}

// Retire atomically moves an exact active Run revision into the reserved
// retired namespace. V2 increments the revision and replays only the original
// expected revision; v1 preserves its byte-identical revision replay.
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
		active, activeLoadErr := loadProducer(activePath, runID)
		retired, retiredLoadErr := loadProducer(retiredPath, runID)
		if activeLoadErr != nil || retiredLoadErr != nil || !sameRetirement(active, retired, expectedRevision) {
			return Run{}, fmt.Errorf("%w: active and retired records both exist", ErrConflict)
		}
		// A crash can leave the durable retired record beside the still-valid
		// active record. Exact replay completes that one safe intermediate state.
		if err := retireRemove(activePath); err != nil {
			return Run{}, err
		}
		if err := retireSyncDirectory(filepath.Dir(activePath)); err != nil {
			return Run{}, err
		}
		return clone(retired)
	}
	if !activeExists {
		if !retiredExists {
			return Run{}, fmt.Errorf("%w: %s", ErrNotFound, activePath)
		}
		if !retiredInfo.Mode().IsRegular() {
			return Run{}, fmt.Errorf("%w: retired destination collision", ErrConflict)
		}
		retired, err := loadProducer(retiredPath, runID)
		if err != nil {
			return Run{}, err
		}
		if retired.SchemaVersion == 2 {
			if retired.State != RunStateRetired || retired.Revision != expectedRevision+1 {
				return Run{}, fmt.Errorf("%w: expected active revision %d, retired revision %d", ErrConflict, expectedRevision, retired.Revision)
			}
		} else if retired.Revision != expectedRevision {
			return Run{}, fmt.Errorf("%w: expected %d, retired %d", ErrConflict, expectedRevision, retired.Revision)
		}
		return clone(retired)
	}
	if !activeInfo.Mode().IsRegular() {
		return Run{}, fmt.Errorf("%w: %s: active record is not a regular file", ErrMalformed, activePath)
	}
	active, err := loadProducer(activePath, runID)
	if err != nil {
		return Run{}, err
	}
	if active.Revision != expectedRevision {
		return Run{}, fmt.Errorf("%w: expected %d, actual %d", ErrConflict, expectedRevision, active.Revision)
	}
	result := active
	if active.SchemaVersion == 2 {
		if active.State != RunStateActive {
			return Run{}, fmt.Errorf("%w: schema-version-2 Run is not active", ErrConflict)
		}
		retiredAt := retirementTimestamp(active.UpdatedAt)
		result.Revision++
		result.State = RunStateRetired
		result.UpdatedAt = retiredAt
		result.RetiredAt = &retiredAt
		if err := validateProducer(result, len(result.Observations)); err != nil {
			return Run{}, err
		}
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

	if active.SchemaVersion == 2 {
		if err := retireV2(activePath, retiredPath, result); err != nil {
			if createdRetiredDir {
				_ = os.Remove(retiredDir)
			}
			return Run{}, err
		}
		return clone(result)
	}

	// Schema v1 keeps the historical byte- and inode-preserving move contract.
	if err := retireRename(activePath, retiredPath); err != nil {
		if createdRetiredDir {
			_ = os.Remove(retiredDir)
		}
		if errors.Is(err, os.ErrExist) {
			return Run{}, fmt.Errorf("%w: retired destination collision: %v", ErrConflict, err)
		}
		return Run{}, err
	}
	if err := errors.Join(retireSyncDirectory(filepath.Dir(activePath)), retireSyncDirectory(retiredDir)); err != nil {
		return Run{}, err
	}
	return clone(result)
}

// retireV2 commits the retired bytes before removing the active bytes. The
// crash states are therefore active-only, both (recovered by exact Retire
// replay), or retired-only; a Run is never absent from both namespaces and an
// active path never contains retired-state bytes. Ordinary pre-remove failures
// roll back the retired record. A post-remove active-directory sync failure is
// replayable because the retired directory was already synced.
func retireV2(activePath, retiredPath string, result Run) error {
	data, err := json.Marshal(result)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	retiredDir := filepath.Dir(retiredPath)
	tmp, err := retireWriteTemp(retiredDir, data)
	if err != nil {
		return err
	}
	defer func() { _ = os.Remove(tmp) }()
	if err := retireRename(tmp, retiredPath); err != nil {
		if errors.Is(err, os.ErrExist) {
			return fmt.Errorf("%w: retired destination collision: %v", ErrConflict, err)
		}
		return err
	}
	rollback := func(cause error) error {
		removeErr := os.Remove(retiredPath)
		syncErr := retireSyncDirectory(retiredDir)
		return errors.Join(cause, removeErr, syncErr)
	}
	if err := retireSyncDirectory(retiredDir); err != nil {
		return rollback(err)
	}
	if err := retireRemove(activePath); err != nil {
		return rollback(err)
	}
	return retireSyncDirectory(filepath.Dir(activePath))
}

func sameRetirement(active, retired Run, expectedRevision uint64) bool {
	if active.SchemaVersion != 2 || active.State != RunStateActive || active.Revision != expectedRevision ||
		retired.SchemaVersion != 2 || retired.State != RunStateRetired || retired.Revision != expectedRevision+1 ||
		retired.RetiredAt == nil || retired.UpdatedAt != *retired.RetiredAt {
		return false
	}
	active.Revision, active.State = retired.Revision, retired.State
	active.UpdatedAt, active.RetiredAt = retired.UpdatedAt, retired.RetiredAt
	return equalJSON(active, retired)
}

func retirementTimestamp(updatedAt string) string {
	now := time.Now().UTC()
	if previous, err := time.Parse(time.RFC3339, updatedAt); err == nil && !now.After(previous) {
		now = previous.Add(time.Nanosecond)
	}
	return now.Format(time.RFC3339Nano)
}

func (p *Producer) Get(runID string) (Run, error) {
	return loadProducer(p.path(runID), runID)
}
func (r *Reader) Get(selector string) (Run, error) {
	return r.resolve("runs", selector)
}

// GetRetired reads only the explicit retired namespace without creating state.
func (r *Reader) GetRetired(selector string) (Run, error) {
	return r.resolve("retired", selector)
}

// resolve accepts either stable Run ID or name. A selector that identifies
// different Runs in the ID and name namespaces is ambiguous rather than ID-preferred.
func (r *Reader) resolve(namespace, selector string) (Run, error) {
	if err := validID(selector); err != nil {
		return Run{}, err
	}
	unlock, empty, err := r.lock()
	if err != nil {
		return Run{}, err
	}
	if empty {
		return Run{}, fmt.Errorf("%w: %s", ErrNotFound, selector)
	}
	defer unlock()
	entries, err := os.ReadDir(filepath.Join(r.root, namespace))
	if errors.Is(err, os.ErrNotExist) {
		return Run{}, fmt.Errorf("%w: %s", ErrNotFound, selector)
	}
	if err != nil {
		return Run{}, err
	}
	matches := map[string]Run{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		id := strings.TrimSuffix(entry.Name(), ".json")
		run, err := load(filepath.Join(r.root, namespace, entry.Name()), id)
		if err != nil {
			return Run{}, err
		}
		if run.RunID == selector || run.Name == selector {
			matches[run.RunID] = run
		}
	}
	if len(matches) == 0 {
		return Run{}, fmt.Errorf("%w: %s", ErrNotFound, selector)
	}
	if len(matches) != 1 {
		return Run{}, fmt.Errorf("%w: %q", ErrAmbiguous, selector)
	}
	for _, run := range matches {
		return run, nil
	}
	panic("unreachable")
}

// List returns all recorded runs in deterministic Run ID order without creating state.
func (r *Reader) List() ([]Run, error) {
	unlock, empty, err := r.lock()
	if err != nil {
		return nil, err
	}
	if empty {
		return []Run{}, nil
	}
	defer unlock()

	runs, err := r.activeRuns()
	if err != nil {
		return nil, err
	}
	sort.Slice(runs, func(i, j int) bool { return runs[i].RunID < runs[j].RunID })
	return runs, nil
}

// ListSummaries returns a complete, bounded snapshot of active Run records.
func (r *Reader) ListSummaries(filter ListFilter) ([]RunSummary, error) {
	from, through, err := validateListFilter(filter)
	if err != nil {
		return nil, err
	}
	unlock, empty, err := r.lock()
	if err != nil {
		return nil, err
	}
	if empty {
		return []RunSummary{}, nil
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
	if filter.UpdatedAtThrough != "" && filter.UpdatedAtTo != "" {
		return nil, nil, fmt.Errorf("%w: updated_at_through and updated_at_to are mutually exclusive", ErrMalformed)
	}
	throughValue, throughName := filter.UpdatedAtThrough, "updated_at_through"
	if throughValue == "" {
		throughValue, throughName = filter.UpdatedAtTo, "updated_at_to"
	}
	through, err := parseListBoundary(throughName, throughValue)
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
	workID, featurePath := run.Task.ID, run.Task.FeaturePath
	if run.WorkReference != nil {
		workID, featurePath = run.WorkReference.ID, run.WorkReference.FeaturePath
	}
	if filter.TaskID != "" && workID != filter.TaskID || filter.FeaturePath != "" && featurePath != filter.FeaturePath {
		return false
	}
	if filter.ParticipantID != "" || filter.AgentSession != nil {
		matched := false
		if run.SchemaVersion == 1 {
			for _, participant := range run.Participants {
				if participantMatches(participant.ParticipantID, participant.AgentSession, filter) {
					matched = true
					break
				}
			}
		} else {
			for _, observation := range run.Observations {
				if observation.Kind != KindRegisteredParticipant || observation.Payload.RegisteredParticipant == nil {
					continue
				}
				participant := observation.Payload.RegisteredParticipant
				if participantMatches(participant.ParticipantID, &participant.AgentSession, filter) {
					matched = true
					break
				}
			}
		}
		if !matched {
			return false
		}
	}
	updated, _ := time.Parse(time.RFC3339, run.UpdatedAt)
	return (from == nil || !updated.Before(*from)) && (through == nil || !updated.After(*through))
}

func participantMatches(id string, session *AgentSession, filter ListFilter) bool {
	return (filter.ParticipantID == "" || id == filter.ParticipantID) &&
		(filter.AgentSession == nil || session != nil && sameAgentSession(*session, *filter.AgentSession))
}

func sameAgentSession(got, wanted AgentSession) bool {
	return got.Source == wanted.Source && got.Kind == wanted.Kind && got.Value == wanted.Value
}

func summarize(run Run) RunSummary {
	summary := RunSummary{
		SchemaVersion: run.SchemaVersion,
		RunID:         run.RunID,
		Name:          run.Name,
		RunKind:       run.RunKind,
		Revision:      run.Revision,
		State:         run.State,
		Stage:         run.Stage,
		InvokedAt:     run.InvokedAt,
		UpdatedAt:     run.UpdatedAt,
	}
	if run.WorkReference != nil {
		summary.WorkReference = &WorkReferenceSummary{
			ID: run.WorkReference.ID, Title: run.WorkReference.Title, Path: run.WorkReference.Path,
			FeaturePath: run.WorkReference.FeaturePath, Kind: run.WorkReference.Kind,
		}
	} else {
		summary.Task = &TaskSummary{
			ID: run.Task.ID, Title: run.Task.Title, Path: run.Task.Path,
			FeaturePath: run.Task.FeaturePath, Kind: run.Task.Kind,
		}
	}
	return summary
}

func (p *Producer) path(id string) string { return filepath.Join(p.root, "runs", id+".json") }
func (p *Producer) retiredPath(id string) string {
	return filepath.Join(p.root, "retired", id+".json")
}

func (p *Producer) lock() (func(), error) {
	flags := os.O_RDWR
	if p.createLock {
		flags |= os.O_CREATE
	}
	f, err := os.OpenFile(filepath.Join(p.root, "registry.lock"), flags, 0600)
	if err != nil {
		return nil, err
	}
	if p.createLock {
		if err := f.Chmod(0600); err != nil {
			_ = f.Close()
			return nil, err
		}
	}
	return flock(f, syscall.LOCK_EX)
}

// Reader locking is deliberately non-creating. A missing lock is an empty
// Registry only while both active and retired namespaces are absent or empty;
// records without their coordinating lock are malformed and must not be scanned.
func (r *Reader) lock() (func(), bool, error) {
	lockPath := filepath.Join(r.root, "registry.lock")
	f, err := os.Open(lockPath)
	if errors.Is(err, os.ErrNotExist) {
		for _, namespace := range []string{"runs", "retired"} {
			empty, checkErr := directoryEmpty(filepath.Join(r.root, namespace))
			if checkErr != nil {
				return nil, false, checkErr
			}
			if !empty {
				return nil, false, fmt.Errorf("%w: %s: missing Registry lock", ErrMalformed, lockPath)
			}
		}
		return nil, true, nil
	}
	if err != nil {
		return nil, false, err
	}
	unlock, err := flock(f, syscall.LOCK_SH)
	return unlock, false, err
}

func directoryEmpty(path string) (bool, error) {
	dir, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	_, readErr := dir.Readdirnames(1)
	closeErr := dir.Close()
	if errors.Is(readErr, io.EOF) {
		return true, closeErr
	}
	if readErr != nil {
		return false, readErr
	}
	return false, closeErr
}

func flock(f *os.File, mode int) (func(), error) {
	if err := syscall.Flock(int(f.Fd()), mode); err != nil {
		_ = f.Close()
		return nil, err
	}
	return func() {
		_ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
		_ = f.Close()
	}, nil
}

var createRename = renameNoReplace

// Retirement hooks make every persistence boundary deterministic in tests.
var (
	retireWriteTemp     = writeTemp
	retireRename        = renameNoReplace
	retireSyncDirectory = syncCreateDirectory
	retireRemove        = os.Remove
)

var syncCreateDirectory = func(path string) error {
	dir, err := os.Open(path)
	if err != nil {
		return err
	}
	if err = dir.Sync(); err != nil {
		_ = dir.Close()
		return err
	}
	return dir.Close()
}

func (p *Producer) writeCreate(run Run) error {
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
	defer func() { _ = os.Remove(name) }()
	if err := createRename(name, p.path(run.RunID)); err != nil {
		if errors.Is(err, os.ErrExist) {
			return fmt.Errorf("%w: run ID is reserved", ErrConflict)
		}
		return err
	}
	if err := syncCreateDirectory(dir); err != nil {
		_ = os.Remove(p.path(run.RunID))
		_ = syncCreateDirectory(dir)
		return err
	}
	return nil
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
	defer func() { _ = os.Remove(name) }()
	if err := os.Rename(name, p.path(run.RunID)); err != nil {
		return err
	}
	d, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer func() { _ = d.Close() }()
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
		_ = os.Remove(name)
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
	if err := validateReader(run); err != nil {
		return Run{}, fmt.Errorf("%s: %w", path, err)
	}
	return run, nil
}

func loadProducer(path, requestedID string) (Run, error) {
	run, err := load(path, requestedID)
	if err != nil {
		return Run{}, err
	}
	if err := validateProducer(run, len(run.Observations)); err != nil {
		return Run{}, fmt.Errorf("%s: %w", path, err)
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
	if n != 1 && n != 2 {
		return fmt.Errorf("%w: %s: version %d", ErrUnsupportedVersion, path, n)
	}
	return nil
}
