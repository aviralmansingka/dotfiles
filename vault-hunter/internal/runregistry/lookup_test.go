package runregistry

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestV10FindParticipantRequiresBothStableIdentities(t *testing.T) {
	stateDir := t.TempDir()
	run := Run{
		SchemaVersion: 1,
		RunID:         "run-one",
		Status:        "active",
		Task:          Task{ID: "T11", Kind: "task"},
		ActiveGoal:    "V10",
		Goals:         []Goal{{ID: "V10", Status: "active"}},
		Participants: []Participant{{
			TerminalID: "term-one",
			PaneID:     "w1:p1",
			AgentSession: AgentSession{
				Source: "herdr:codex",
				Kind:   "id",
				Value:  "session-one",
			},
		}},
	}
	writeLookupRun(t, stateDir, run)

	found, participant, err := FindParticipant(
		stateDir,
		"term-one",
		AgentSession{Source: "herdr:codex", Kind: "id", Value: "session-one"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if found.RunID != "run-one" || participant.PaneID != "w1:p1" {
		t.Fatalf("unexpected match: %#v %#v", found, participant)
	}
	if _, _, err := FindParticipant(
		stateDir,
		"term-one",
		AgentSession{Source: "herdr:codex", Kind: "id", Value: "other-session"},
	); err == nil {
		t.Fatal("terminal-only match was accepted")
	}
	if _, _, err := FindParticipant(
		stateDir,
		"other-terminal",
		AgentSession{Source: "herdr:codex", Kind: "id", Value: "session-one"},
	); err == nil {
		t.Fatal("session-only match was accepted")
	}
}

func TestV10FindParticipantRejectsMalformedRegistry(t *testing.T) {
	stateDir := t.TempDir()
	runsDir := filepath.Join(stateDir, "runs")
	if err := os.MkdirAll(runsDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(runsDir, "broken.json"), []byte(`{"schema_version":1`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := FindParticipant(
		stateDir,
		"term-one",
		AgentSession{Source: "herdr:codex", Kind: "id", Value: "session-one"},
	); err == nil {
		t.Fatal("malformed registry entry was ignored")
	}
}

func writeLookupRun(t *testing.T, stateDir string, run Run) {
	t.Helper()
	runsDir := filepath.Join(stateDir, "runs")
	if err := os.MkdirAll(runsDir, 0o700); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(run)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(runsDir, run.RunID+".json"), data, 0o600); err != nil {
		t.Fatal(err)
	}
}
