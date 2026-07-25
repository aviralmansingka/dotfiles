package main

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/aviralmansingka/dotfiles/vault-hunter/internal/runregistry"
)

func TestV08InteractiveRefreshesRegistryRevisionAndParticipants(t *testing.T) {
	stateDir := t.TempDir()
	server := startV05Herdr(t)
	initial := v05Run("task", true)
	initial.Revision = 1
	initial.Task.Path = "/vault/1_projects/pi-agent/features/pi-skills-tools/tasks/T11.md"
	initial.Task.FeaturePath = "/vault/1_projects/pi-agent/features/pi-skills-tools/feature.md"
	initial.Orchestrator = runregistry.Participant{
		Role:        "orchestrator",
		Name:        "codex-pi-agent-pi-skills-tools-t11-orchestrator",
		WorkspaceID: "workspace",
		TabID:       "driver-tab",
		PaneID:      "w1:p0",
		TerminalID:  "driver-terminal",
		AgentSession: runregistry.AgentSession{
			Source: "herdr:codex",
			Kind:   "id",
			Value:  "driver-session",
		},
	}
	initial.Participants[0].Name = "codex-pi-agent-pi-skills-tools-t11-implementation"
	initial.Participants[0].WorkspaceID = "workspace"
	initial.Participants[0].TabID = "worker-tab"
	initial.Participants[0].TerminalID = "worker-terminal"
	initial.Participants[0].AgentSession = runregistry.AgentSession{
		Source: "herdr:codex",
		Kind:   "id",
		Value:  "worker-session",
	}
	initial.Participants = append([]runregistry.Participant{initial.Orchestrator}, initial.Participants...)
	writeCommandRun(t, stateDir, initial)

	input, send := io.Pipe()
	defer input.Close()
	defer send.Close()
	var stdout bytes.Buffer
	done := make(chan error, 1)
	go func() {
		done <- run([]string{
			"--run", initial.RunID,
			"--state-dir", stateDir,
			"--socket", server.path,
		}, input, &stdout)
	}()
	if !waitForV08Count(t, time.Second, func() int32 { return server.snapshots.Load() }, 2) {
		_, _ = send.Write([]byte("q"))
		<-done
		t.Fatal("interactive Atlas did not attach to the initial participants")
	}

	updated := initial
	updated.Revision = 2
	updated.ActiveGoal = "V08"
	updated.NextAction = "refresh the new participant"
	updated.Goals = append(updated.Goals, runregistry.Goal{
		ID:     "V08",
		Label:  "Registry refresh",
		Status: "active",
	})
	updated.Goals[0].Status = "done"
	updated.Participants = append(updated.Participants, runregistry.Participant{
		Role:        "verifier",
		GoalID:      "V08",
		Name:        "codex-pi-agent-pi-skills-tools-t11-verifier",
		WorkspaceID: "workspace",
		TabID:       "verifier-tab",
		PaneID:      "w1:p2",
		TerminalID:  "verifier-terminal",
		AgentSession: runregistry.AgentSession{
			Source: "herdr:codex",
			Kind:   "id",
			Value:  "verifier-session",
		},
	})
	replaceCommandRun(t, stateDir, updated)

	refreshed := waitForV08Count(t, 2*time.Second, func() int32 { return server.snapshots.Load() }, 5)
	if _, err := send.Write([]byte("q")); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("interactive Atlas did not stop")
	}
	if !refreshed {
		t.Fatal("Registry revision did not refresh both registered participants")
	}
	output := stdout.String()
	if !strings.Contains(output, "/goal V08") ||
		!strings.Contains(output, "refresh the new participant") ||
		!strings.Contains(output, "verifier · V08") {
		t.Fatalf("refreshed Registry revision was not rendered:\n%s", output)
	}
}

func replaceCommandRun(t *testing.T, stateDir string, run runregistry.Run) {
	t.Helper()
	data, err := json.Marshal(run)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(stateDir, "runs", run.RunID+".json")
	temp, err := os.CreateTemp(filepath.Dir(path), ".revision-*.json")
	if err != nil {
		t.Fatal(err)
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if _, err := temp.Write(data); err != nil {
		_ = temp.Close()
		t.Fatal(err)
	}
	if err := temp.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(tempPath, path); err != nil {
		t.Fatal(err)
	}
}

func waitForV08Count(t *testing.T, timeout time.Duration, value func() int32, want int32) bool {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if value() >= want {
			return true
		}
		time.Sleep(10 * time.Millisecond)
	}
	return value() >= want
}
