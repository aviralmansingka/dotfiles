package vaultregistry

import (
	"bytes"
	"encoding/json"
)

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
		ObservationID string `json:"observation_id"`
		ObservedAt    string `json:"observed_at"`
		Kind          string `json:"kind"`
		GoalID        string `json:"goal_id"`
		State         string `json:"state"`
		Detail        string `json:"detail"`
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
