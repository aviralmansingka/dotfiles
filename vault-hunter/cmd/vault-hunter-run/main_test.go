package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/aviralmansingka/dotfiles/vault-hunter/internal/runregistry"
)

func TestV11ParticipantCommandRegistersCapturedHerdrIdentity(t *testing.T) {
	stateDir := t.TempDir()
	fixture := runregistry.Run{
		SchemaVersion: 1,
		RunID:         "run-cli",
		Revision:      1,
		Status:        "active",
		Task:          runregistry.Task{ID: "T11", Path: "/vault/T11.md", Kind: "task"},
		ActiveGoal:    "V11",
		Goals:         []runregistry.Goal{{ID: "V11", Status: "active"}},
		Orchestrator: runregistry.Participant{
			Role:       "orchestrator",
			Name:       "codex-driver",
			PaneID:     "driver-pane",
			TerminalID: "driver-terminal",
			AgentSession: runregistry.AgentSession{
				Source: "herdr:codex",
				Kind:   "id",
				Value:  "driver-session",
			},
		},
	}
	fixture.Participants = []runregistry.Participant{fixture.Orchestrator}
	writeCLIRun(t, stateDir, fixture)

	binary := filepath.Join(t.TempDir(), "herdr")
	script := `#!/bin/sh
printf '{"result":{"agent":{"name":"codex-worker","workspace_id":"workspace","tab_id":"worker-tab","pane_id":"worker-pane","terminal_id":"worker-terminal","agent_session":{"source":"herdr:codex","kind":"id","value":"worker-session"}}}}\n'
`
	if err := os.WriteFile(binary, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := run(context.Background(), []string{
		"participant",
		"--state-dir", stateDir,
		"--run-id", fixture.RunID,
		"--goal-id", "V11",
		"--role", "implementation",
		"--agent", "codex-worker",
		"--herdr", binary,
	}); err != nil {
		t.Fatal(err)
	}
	registered, err := runregistry.NewStore(stateDir, nil).Read(fixture.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if len(registered.Participants) != 2 {
		t.Fatalf("participant command stored %d participants", len(registered.Participants))
	}
	worker := registered.Participants[1]
	if worker.Role != "implementation" ||
		worker.GoalID != "V11" ||
		worker.Name != "codex-worker" ||
		worker.WorkspaceID != "workspace" ||
		worker.TabID != "worker-tab" ||
		worker.PaneID != "worker-pane" ||
		worker.TerminalID != "worker-terminal" ||
		worker.AgentSession != (runregistry.AgentSession{
			Source: "herdr:codex",
			Kind:   "id",
			Value:  "worker-session",
		}) {
		t.Fatalf("participant command lost captured identity: %#v", worker)
	}
}

func writeCLIRun(t *testing.T, stateDir string, run runregistry.Run) {
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
