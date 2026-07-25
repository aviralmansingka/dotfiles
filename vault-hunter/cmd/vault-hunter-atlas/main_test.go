package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/aviralmansingka/dotfiles/vault-hunter/internal/runregistry"
)

func TestV10SelectionErrorsProduceNoPartialStdout(t *testing.T) {
	stateDir := t.TempDir()
	fixture := runregistry.Run{
		SchemaVersion: 1,
		RunID:         "run-one",
		Status:        "active",
		Task:          runregistry.Task{ID: "T11", Kind: "task"},
		ActiveGoal:    "V10",
		NextAction:    "Keep the default preview",
		Goals:         []runregistry.Goal{{ID: "V10", Label: "Picker fallback", Status: "active"}},
		Participants: []runregistry.Participant{{
			TerminalID: "term-one",
			PaneID:     "w1:p1",
			AgentSession: runregistry.AgentSession{
				Source: "herdr:codex",
				Kind:   "id",
				Value:  "session-one",
			},
		}},
	}
	writeCommandRun(t, stateDir, fixture)

	base := []string{
		"render",
		"--state-dir", stateDir,
		"--terminal-id", "term-one",
		"--agent-session-source", "herdr:codex",
		"--agent-session-kind", "id",
		"--agent-session-value", "session-one",
		"--width", "78",
		"--height", "17",
	}
	cases := []struct {
		name string
		args []string
	}{
		{
			name: "unavailable Herdr snapshot",
			args: append(append([]string{}, base...), "--socket", filepath.Join(t.TempDir(), "missing.sock")),
		},
		{
			name: "non-participant",
			args: append(append([]string{}, base...), "--terminal-id", "term-other"),
		},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			var stdout bytes.Buffer
			if err := run(test.args, &stdout); err == nil {
				t.Fatal("render unexpectedly succeeded")
			}
			if stdout.Len() != 0 {
				t.Fatalf("failed render leaked partial stdout: %q", stdout.String())
			}
		})
	}
}

func writeCommandRun(t *testing.T, stateDir string, run runregistry.Run) {
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
