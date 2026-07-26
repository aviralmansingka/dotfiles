package vaultregistry

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"syscall"
	"time"
)

var (
	ErrNotFound           = errors.New("run not found")
	ErrConflict           = errors.New("revision conflict")
	ErrMalformed          = errors.New("malformed run")
	ErrUnsupportedVersion = errors.New("unsupported schema version")
	ErrInvalidID          = errors.New("invalid run id")
	runIDPattern          = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)
)

type Task struct {
	ID, Title, Path, FeaturePath, Kind string
	Unknown                            map[string]json.RawMessage
}

type HerdrIdentity struct {
	WorkspaceID, TabID, PaneID, TerminalID string
	Unknown                                map[string]json.RawMessage
}

type AgentSession struct {
	Source, Kind, Value string
	Unknown             map[string]json.RawMessage
}

type Participant struct {
	ParticipantID, ObservedAt, Role, GoalID string
	Herdr                                   *HerdrIdentity
	AgentSession                            *AgentSession
	Unknown                                 map[string]json.RawMessage
}

type Lifecycle struct {
	ObservationID, ObservedAt, Kind, GoalID, State, Detail string
	Unknown                                                map[string]json.RawMessage
}

type Evidence struct {
	ObservationID, ObservedAt, VerifierID, State string
	Command, ImplementationTree, ArtifactSHA256  string
	ExitStatus                                   *int
	Detail                                       string
	Unknown                                      map[string]json.RawMessage
}

type Run struct {
	SchemaVersion uint64
	RunID         string
	Revision      uint64
	InvokedAt     string
	UpdatedAt     string
	Task          Task
	Participants  []Participant
	Lifecycle     []Lifecycle
	Evidence      []Evidence
	Unknown       map[string]json.RawMessage
}

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
	if next.SchemaVersion != current.SchemaVersion || next.RunID != current.RunID || next.Revision != current.Revision ||
		!slices.EqualFunc(current.Participants, next.Participants[:min(len(current.Participants), len(next.Participants))], equalJSON) ||
		!slices.EqualFunc(current.Lifecycle, next.Lifecycle[:min(len(current.Lifecycle), len(next.Lifecycle))], equalJSON) ||
		!slices.EqualFunc(current.Evidence, next.Evidence[:min(len(current.Evidence), len(next.Evidence))], equalJSON) ||
		len(next.Participants) < len(current.Participants) || len(next.Lifecycle) < len(current.Lifecycle) || len(next.Evidence) < len(current.Evidence) {
		return Run{}, fmt.Errorf("%w: immutable fields or history prefixes changed", ErrMalformed)
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

func (p *Producer) Get(runID string) (Run, error) { return load(p.path(runID), runID) }
func (r *Reader) Get(runID string) (Run, error) {
	if err := validID(runID); err != nil {
		return Run{}, err
	}
	return load(filepath.Join(r.root, "runs", runID+".json"), runID)
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
	tmp, err := os.CreateTemp(dir, ".run-*.tmp")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if err = tmp.Chmod(0600); err == nil {
		_, err = tmp.Write(data)
	}
	if err == nil {
		err = tmp.Sync()
	}
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(name, p.path(run.RunID))
	}
	if err != nil {
		return err
	}
	d, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
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
	var version struct {
		SchemaVersion json.RawMessage `json:"schema_version"`
	}
	if err := json.Unmarshal(data, &version); err != nil {
		return Run{}, fmt.Errorf("%w: %s: %v", ErrMalformed, path, err)
	}
	var n uint64
	if len(version.SchemaVersion) == 0 || json.Unmarshal(version.SchemaVersion, &n) != nil || n == 0 {
		return Run{}, fmt.Errorf("%w: %s: invalid schema_version", ErrMalformed, path)
	}
	if n != 1 {
		return Run{}, fmt.Errorf("%w: %s: version %d", ErrUnsupportedVersion, path, n)
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

func validID(id string) error {
	if !runIDPattern.MatchString(id) {
		return fmt.Errorf("%w: %q", ErrInvalidID, id)
	}
	return nil
}

func validate(run Run) error {
	if run.SchemaVersion != 1 || run.Revision == 0 {
		return fmt.Errorf("%w: invalid schema or revision", ErrMalformed)
	}
	if err := validID(run.RunID); err != nil {
		return err
	}
	if !timestamp(run.InvokedAt) || !timestamp(run.UpdatedAt) ||
		run.Task.ID == "" || run.Task.Title == "" || run.Task.Path == "" || run.Task.FeaturePath == "" || run.Task.Kind == "" {
		return fmt.Errorf("%w: invalid run identity", ErrMalformed)
	}
	for _, p := range run.Participants {
		if p.ParticipantID == "" || p.Role == "" || !timestamp(p.ObservedAt) {
			return fmt.Errorf("%w: invalid participant", ErrMalformed)
		}
	}
	for _, l := range run.Lifecycle {
		if l.ObservationID == "" || l.Kind == "" || !timestamp(l.ObservedAt) {
			return fmt.Errorf("%w: invalid lifecycle observation", ErrMalformed)
		}
	}
	for _, e := range run.Evidence {
		if e.ObservationID == "" || e.VerifierID == "" || e.State == "" || !timestamp(e.ObservedAt) {
			return fmt.Errorf("%w: invalid evidence observation", ErrMalformed)
		}
	}
	return nil
}

func timestamp(s string) bool {
	_, err := time.Parse(time.RFC3339, s)
	return err == nil
}

func clone[T any](value T) (T, error) {
	var out T
	data, err := json.Marshal(value)
	if err == nil {
		err = json.Unmarshal(data, &out)
	}
	return out, err
}

func equalJSON[T any](a, b T) bool {
	aa, _ := json.Marshal(a)
	bb, _ := json.Marshal(b)
	return bytes.Equal(aa, bb)
}

func marshalObject(unknown map[string]json.RawMessage, known map[string]any) ([]byte, error) {
	fields := make(map[string]json.RawMessage, len(unknown)+len(known))
	for key, value := range unknown {
		fields[key] = value
	}
	for key, value := range known {
		data, err := json.Marshal(value)
		if err != nil {
			return nil, err
		}
		fields[key] = data
	}
	return json.Marshal(fields)
}

func unknownFields(data []byte, known ...string) (map[string]json.RawMessage, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return nil, err
	}
	for _, key := range known {
		delete(fields, key)
	}
	return fields, nil
}

func (v Task) MarshalJSON() ([]byte, error) {
	return marshalObject(v.Unknown, map[string]any{"id": v.ID, "title": v.Title, "path": v.Path, "feature_path": v.FeaturePath, "kind": v.Kind})
}
func (v *Task) UnmarshalJSON(data []byte) error {
	type wire struct {
		ID, Title, Path, Kind string
		FeaturePath           string `json:"feature_path"`
	}
	var w wire
	if err := json.Unmarshal(data, &w); err != nil {
		return err
	}
	v.ID, v.Title, v.Path, v.FeaturePath, v.Kind = w.ID, w.Title, w.Path, w.FeaturePath, w.Kind
	v.Unknown, _ = unknownFields(data, "id", "title", "path", "feature_path", "kind")
	return nil
}

func (v HerdrIdentity) MarshalJSON() ([]byte, error) {
	return marshalObject(v.Unknown, map[string]any{"workspace_id": v.WorkspaceID, "tab_id": v.TabID, "pane_id": v.PaneID, "terminal_id": v.TerminalID})
}
func (v *HerdrIdentity) UnmarshalJSON(data []byte) error {
	type wire struct {
		WorkspaceID string `json:"workspace_id"`
		TabID       string `json:"tab_id"`
		PaneID      string `json:"pane_id"`
		TerminalID  string `json:"terminal_id"`
	}
	var w wire
	if err := json.Unmarshal(data, &w); err != nil {
		return err
	}
	v.WorkspaceID, v.TabID, v.PaneID, v.TerminalID = w.WorkspaceID, w.TabID, w.PaneID, w.TerminalID
	v.Unknown, _ = unknownFields(data, "workspace_id", "tab_id", "pane_id", "terminal_id")
	return nil
}

func (v AgentSession) MarshalJSON() ([]byte, error) {
	return marshalObject(v.Unknown, map[string]any{"source": v.Source, "kind": v.Kind, "value": v.Value})
}
func (v *AgentSession) UnmarshalJSON(data []byte) error {
	var w struct{ Source, Kind, Value string }
	if err := json.Unmarshal(data, &w); err != nil {
		return err
	}
	v.Source, v.Kind, v.Value = w.Source, w.Kind, w.Value
	v.Unknown, _ = unknownFields(data, "source", "kind", "value")
	return nil
}

func (v Participant) MarshalJSON() ([]byte, error) {
	return marshalObject(v.Unknown, map[string]any{"participant_id": v.ParticipantID, "observed_at": v.ObservedAt, "role": v.Role, "goal_id": v.GoalID, "herdr": v.Herdr, "agent_session": v.AgentSession})
}
func (v *Participant) UnmarshalJSON(data []byte) error {
	var w struct {
		ParticipantID string         `json:"participant_id"`
		ObservedAt    string         `json:"observed_at"`
		Role          string         `json:"role"`
		GoalID        string         `json:"goal_id"`
		Herdr         *HerdrIdentity `json:"herdr"`
		AgentSession  *AgentSession  `json:"agent_session"`
	}
	if err := json.Unmarshal(data, &w); err != nil {
		return err
	}
	v.ParticipantID, v.ObservedAt, v.Role, v.GoalID, v.Herdr, v.AgentSession = w.ParticipantID, w.ObservedAt, w.Role, w.GoalID, w.Herdr, w.AgentSession
	v.Unknown, _ = unknownFields(data, "participant_id", "observed_at", "role", "goal_id", "herdr", "agent_session")
	return nil
}

func (v Lifecycle) MarshalJSON() ([]byte, error) {
	return marshalObject(v.Unknown, map[string]any{"observation_id": v.ObservationID, "observed_at": v.ObservedAt, "kind": v.Kind, "goal_id": v.GoalID, "state": v.State, "detail": v.Detail})
}
func (v *Lifecycle) UnmarshalJSON(data []byte) error {
	var w struct {
		ObservationID               string `json:"observation_id"`
		ObservedAt                  string `json:"observed_at"`
		Kind, GoalID, State, Detail string
	}
	if err := json.Unmarshal(data, &w); err != nil {
		return err
	}
	v.ObservationID, v.ObservedAt, v.Kind, v.GoalID, v.State, v.Detail = w.ObservationID, w.ObservedAt, w.Kind, w.GoalID, w.State, w.Detail
	v.Unknown, _ = unknownFields(data, "observation_id", "observed_at", "kind", "goal_id", "state", "detail")
	return nil
}

func (v Evidence) MarshalJSON() ([]byte, error) {
	return marshalObject(v.Unknown, map[string]any{"observation_id": v.ObservationID, "observed_at": v.ObservedAt, "verifier_id": v.VerifierID, "state": v.State, "command": v.Command, "exit_status": v.ExitStatus, "implementation_tree": v.ImplementationTree, "artifact_sha256": v.ArtifactSHA256, "detail": v.Detail})
}
func (v *Evidence) UnmarshalJSON(data []byte) error {
	var w struct {
		ObservationID      string `json:"observation_id"`
		ObservedAt         string `json:"observed_at"`
		VerifierID         string `json:"verifier_id"`
		State, Command     string
		ExitStatus         *int   `json:"exit_status"`
		ImplementationTree string `json:"implementation_tree"`
		ArtifactSHA256     string `json:"artifact_sha256"`
		Detail             string
	}
	if err := json.Unmarshal(data, &w); err != nil {
		return err
	}
	v.ObservationID, v.ObservedAt, v.VerifierID, v.State, v.Command, v.ExitStatus, v.ImplementationTree, v.ArtifactSHA256, v.Detail = w.ObservationID, w.ObservedAt, w.VerifierID, w.State, w.Command, w.ExitStatus, w.ImplementationTree, w.ArtifactSHA256, w.Detail
	v.Unknown, _ = unknownFields(data, "observation_id", "observed_at", "verifier_id", "state", "command", "exit_status", "implementation_tree", "artifact_sha256", "detail")
	return nil
}

func (v Run) MarshalJSON() ([]byte, error) {
	return marshalObject(v.Unknown, map[string]any{"schema_version": v.SchemaVersion, "run_id": v.RunID, "revision": v.Revision, "invoked_at": v.InvokedAt, "updated_at": v.UpdatedAt, "task": v.Task, "participants": v.Participants, "lifecycle": v.Lifecycle, "evidence": v.Evidence})
}
func (v *Run) UnmarshalJSON(data []byte) error {
	var w struct {
		SchemaVersion uint64 `json:"schema_version"`
		RunID         string `json:"run_id"`
		Revision      uint64
		InvokedAt     string `json:"invoked_at"`
		UpdatedAt     string `json:"updated_at"`
		Task          Task
		Participants  []Participant
		Lifecycle     []Lifecycle
		Evidence      []Evidence
	}
	if err := json.Unmarshal(data, &w); err != nil {
		return err
	}
	v.SchemaVersion, v.RunID, v.Revision, v.InvokedAt, v.UpdatedAt, v.Task, v.Participants, v.Lifecycle, v.Evidence = w.SchemaVersion, w.RunID, w.Revision, w.InvokedAt, w.UpdatedAt, w.Task, w.Participants, w.Lifecycle, w.Evidence
	v.Unknown, _ = unknownFields(data, "schema_version", "run_id", "revision", "invoked_at", "updated_at", "task", "participants", "lifecycle", "evidence")
	return nil
}
