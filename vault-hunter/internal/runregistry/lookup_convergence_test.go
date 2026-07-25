package runregistry

import "testing"

func TestV10FindParticipantIgnoresNonTaskRuns(t *testing.T) {
	stateDir := t.TempDir()
	run := Run{
		SchemaVersion: 1,
		RunID:         "feature-run",
		Status:        "active",
		Task:          Task{ID: "feature", Kind: "feature"},
		ActiveGoal:    "V10",
		Goals:         []Goal{{ID: "V10", Status: "active"}},
		Participants: []Participant{{
			TerminalID: "term-one",
			AgentSession: AgentSession{
				Source: "herdr:codex",
				Kind:   "id",
				Value:  "session-one",
			},
		}},
	}
	writeLookupRun(t, stateDir, run)
	if _, _, err := FindParticipant(
		stateDir,
		"term-one",
		AgentSession{Source: "herdr:codex", Kind: "id", Value: "session-one"},
	); err == nil {
		t.Fatal("non-Task Run replaced the default preview")
	}
}
