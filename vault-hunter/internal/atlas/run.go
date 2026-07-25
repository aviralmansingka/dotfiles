package atlas

import (
	"bytes"
	"encoding/json"
	"fmt"
)

type Run struct {
	SchemaVersion int        `json:"schema_version"`
	RunID         string     `json:"run_id"`
	Revision      int        `json:"revision"`
	Status        string     `json:"status"`
	Task          Task       `json:"task"`
	ActiveGoal    string     `json:"active_goal"`
	NextAction    string     `json:"next_action"`
	Goals         []Goal     `json:"goals"`
	Evidence      []Evidence `json:"evidence"`
}

type Task struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Path  string `json:"path"`
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

func DecodeRun(data []byte) (Run, error) {
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

func (r Run) active() Goal {
	for _, goal := range r.Goals {
		if goal.ID == r.ActiveGoal {
			return goal
		}
	}
	return Goal{ID: r.ActiveGoal}
}
