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
