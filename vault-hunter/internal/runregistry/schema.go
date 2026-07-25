package runregistry

import (
	"bytes"
	"encoding/json"
	"fmt"
)

type Run struct {
	SchemaVersion int           `json:"schema_version"`
	RunID         string        `json:"run_id"`
	Revision      int           `json:"revision"`
	Status        string        `json:"status"`
	InvokedAt     string        `json:"invoked_at,omitempty"`
	UpdatedAt     string        `json:"updated_at,omitempty"`
	Task          Task          `json:"task"`
	ActiveGoal    string        `json:"active_goal"`
	NextAction    string        `json:"next_action"`
	Goals         []Goal        `json:"goals"`
	Evidence      []Evidence    `json:"evidence"`
	Orchestrator  Participant   `json:"orchestrator,omitempty"`
	Participants  []Participant `json:"participants,omitempty"`
	Companion     *Companion    `json:"companion,omitempty"`
}

type Task struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Path        string `json:"path"`
	FeaturePath string `json:"feature_path,omitempty"`
	Kind        string `json:"kind,omitempty"`
}

type Goal struct {
	ID       string    `json:"id"`
	Label    string    `json:"label"`
	Status   string    `json:"status"`
	Verifier *Verifier `json:"verifier,omitempty"`
}

type Verifier struct {
	State     string        `json:"state"`
	Iteration int           `json:"iteration"`
	Journey   []JourneyStep `json:"journey"`
}

type JourneyStep struct {
	Label  string `json:"label"`
	Status string `json:"status"`
}

type Evidence struct {
	ID      string `json:"id"`
	Summary string `json:"summary"`
}

type Participant struct {
	Role         string       `json:"role"`
	GoalID       string       `json:"goal_id,omitempty"`
	Name         string       `json:"name"`
	WorkspaceID  string       `json:"workspace_id,omitempty"`
	TabID        string       `json:"tab_id,omitempty"`
	PaneID       string       `json:"pane_id"`
	TerminalID   string       `json:"terminal_id"`
	AgentSession AgentSession `json:"agent_session"`
}

type AgentSession struct {
	Source string `json:"source"`
	Kind   string `json:"kind"`
	Value  string `json:"value"`
}

type Companion struct {
	PaneID      string `json:"pane_id"`
	TabID       string `json:"tab_id"`
	OwnerPaneID string `json:"owner_pane_id"`
}

func Decode(data []byte) (Run, error) {
	var run Run
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&run); err != nil {
		return Run{}, err
	}
	if run.SchemaVersion != 1 {
		return Run{}, fmt.Errorf("unsupported schema version %d", run.SchemaVersion)
	}
	if run.RunID == "" || run.Task.ID == "" || run.ActiveGoal == "" {
		return Run{}, fmt.Errorf("run_id, task.id, and active_goal are required")
	}
	for _, goal := range run.Goals {
		if goal.ID == run.ActiveGoal {
			return run, nil
		}
	}
	return Run{}, fmt.Errorf("active goal %q is not in the timeline", run.ActiveGoal)
}

func (r Run) Active() Goal {
	for _, goal := range r.Goals {
		if goal.ID == r.ActiveGoal {
			return goal
		}
	}
	return Goal{ID: r.ActiveGoal}
}
