package vaultregistry

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"time"
)

var (
	ErrNotFound           = errors.New("run not found")
	ErrConflict           = errors.New("revision conflict")
	ErrMalformed          = errors.New("malformed run")
	ErrUnsupportedVersion = errors.New("unsupported schema version")
	ErrInvalidID          = errors.New("invalid run id")
	ErrAmbiguous          = errors.New("ambiguous run selector")
	runIDPattern          = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)
)

type Task struct {
	ID, Title, Path, FeaturePath, Kind string
	Unknown                            map[string]json.RawMessage
}

// WorkReference identifies runtime-neutral work without assigning workflow authority.
type WorkReference struct {
	ID, Title, Path, FeaturePath, Kind string
	Unknown                            map[string]json.RawMessage
}

type RunKind string
type RunState string

const (
	RunKindScout    RunKind  = "scout"
	RunKindHunter   RunKind  = "hunter"
	RunStateActive  RunState = "active"
	RunStateRetired RunState = "retired"
)

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
	Name          string
	RunKind       RunKind
	WorkReference *WorkReference
	Revision      uint64
	State         RunState
	Stage         string
	InvokedAt     string
	UpdatedAt     string
	RetiredAt     *string
	Task          Task
	Participants  []Participant
	Lifecycle     []Lifecycle
	Evidence      []Evidence
	Observations  []Observation
	Unknown       map[string]json.RawMessage
}

// CreateRequest is the one atomic schema-version-2 Run and driver transaction.
type CreateRequest struct {
	Run           Run
	InitialDriver Observation
}

// ListFilter selects Runs by exact identity and an inclusive update-time range.
type ListFilter struct {
	TaskID           string        `json:"task_id,omitempty"`
	FeaturePath      string        `json:"feature_path,omitempty"`
	ParticipantID    string        `json:"participant_id,omitempty"`
	AgentSession     *AgentSession `json:"agent_session,omitempty"`
	UpdatedAtFrom    string        `json:"updated_at_from,omitempty"`
	UpdatedAtThrough string        `json:"updated_at_through,omitempty"`
	UpdatedAtTo      string        `json:"updated_at_to,omitempty"` // legacy Reader API alias
}

// TaskSummary is the bounded Task projection returned by ListSummaries.
type TaskSummary struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Path        string `json:"path"`
	FeaturePath string `json:"feature_path"`
	Kind        string `json:"kind"`
}

// RunSummary excludes observation histories and unknown extension fields.
type RunSummary struct {
	SchemaVersion uint64         `json:"schema_version"`
	RunID         string         `json:"run_id"`
	Name          string         `json:"name,omitempty"`
	RunKind       RunKind        `json:"run_kind,omitempty"`
	Revision      uint64         `json:"revision"`
	State         RunState       `json:"state,omitempty"`
	Stage         string         `json:"stage,omitempty"`
	InvokedAt     string         `json:"invoked_at"`
	UpdatedAt     string         `json:"updated_at"`
	Task          *TaskSummary   `json:"task,omitempty"`
	WorkReference *WorkReference `json:"work_reference,omitempty"`
}

func validID(id string) error {
	if !runIDPattern.MatchString(id) {
		return fmt.Errorf("%w: %q", ErrInvalidID, id)
	}
	return nil
}

func validateV1(run Run) error {
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
		if p.ParticipantID == "" || p.Role == "" || !timestamp(p.ObservedAt) ||
			p.Herdr != nil && (p.Herdr.WorkspaceID == "" || p.Herdr.TabID == "" || p.Herdr.PaneID == "" || p.Herdr.TerminalID == "") ||
			p.AgentSession != nil && (p.AgentSession.Source == "" || p.AgentSession.Kind == "" || p.AgentSession.Value == "") {
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
