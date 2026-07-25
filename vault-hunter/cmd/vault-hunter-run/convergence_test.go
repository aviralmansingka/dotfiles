package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/aviralmansingka/dotfiles/vault-hunter/internal/runregistry"
)

func TestV07GoalAndVerifierLifecycleCommands(t *testing.T) {
	t.Run("goal activate", func(t *testing.T) {
		stateDir := t.TempDir()
		fixture := lifecycleRun()
		fixture.Goals[0].Status = "pending"
		fixture.Goals[1].Status = "active"
		fixture.ActiveGoal = "V08"
		writeCLIRun(t, stateDir, fixture)

		runLifecycleCommand(t, "goal", "activate", "--state-dir", stateDir, "--run-id", fixture.RunID, "--goal-id", "V07")
		got := readLifecycleRun(t, stateDir, fixture.RunID)
		if got.ActiveGoal != "V07" || got.Goals[0].Status != "active" || got.Goals[1].Status != "pending" {
			t.Fatalf("activate did not leave exactly one active goal: %#v", got)
		}
		assertRevision(t, got, fixture.Revision+1)
	})

	t.Run("goal block and resume", func(t *testing.T) {
		stateDir := t.TempDir()
		fixture := lifecycleRun()
		writeCLIRun(t, stateDir, fixture)

		runLifecycleCommand(t, "goal", "block", "--state-dir", stateDir, "--run-id", fixture.RunID, "--goal-id", "V07")
		blocked := readLifecycleRun(t, stateDir, fixture.RunID)
		if blocked.Goals[0].Status != "blocked" {
			t.Fatalf("block left goal in %q", blocked.Goals[0].Status)
		}
		runLifecycleCommand(t, "goal", "activate", "--state-dir", stateDir, "--run-id", fixture.RunID, "--goal-id", "V07")
		resumed := readLifecycleRun(t, stateDir, fixture.RunID)
		if resumed.Goals[0].Status != "active" || resumed.ActiveGoal != "V07" {
			t.Fatalf("activate did not resume blocked goal: %#v", resumed)
		}
		assertRevision(t, resumed, fixture.Revision+2)
	})

	t.Run("goal complete accepts evidence", func(t *testing.T) {
		stateDir := t.TempDir()
		fixture := lifecycleRun()
		writeCLIRun(t, stateDir, fixture)

		runLifecycleCommand(
			t,
			"goal", "complete",
			"--state-dir", stateDir,
			"--run-id", fixture.RunID,
			"--goal-id", "V07",
			"--evidence", "V07 lifecycle suite green",
		)
		got := readLifecycleRun(t, stateDir, fixture.RunID)
		if got.Goals[0].Status != "done" ||
			len(got.Evidence) != 1 ||
			got.Evidence[0].Summary != "V07 lifecycle suite green" {
			t.Fatalf("complete did not atomically accept evidence: %#v", got)
		}
		assertRevision(t, got, fixture.Revision+1)
	})

	t.Run("verifier pending red green red increments iteration", func(t *testing.T) {
		stateDir := t.TempDir()
		fixture := lifecycleRun()
		fixture.Goals[0].Verifier = &runregistry.Verifier{State: "pending"}
		writeCLIRun(t, stateDir, fixture)

		for _, state := range []string{"red", "green", "red"} {
			runLifecycleCommand(
				t,
				"verifier", "set",
				"--state-dir", stateDir,
				"--run-id", fixture.RunID,
				"--goal-id", "V07",
				"--state", state,
			)
		}
		got := readLifecycleRun(t, stateDir, fixture.RunID)
		if got.Goals[0].Verifier.State != "red" || got.Goals[0].Verifier.Iteration != 2 {
			t.Fatalf("verifier transition lost red iteration: %#v", got.Goals[0].Verifier)
		}
		assertRevision(t, got, fixture.Revision+3)
	})

	t.Run("verifier goal requires green", func(t *testing.T) {
		stateDir := t.TempDir()
		fixture := lifecycleRun()
		fixture.Goals[0].Verifier = &runregistry.Verifier{State: "red", Iteration: 1}
		writeCLIRun(t, stateDir, fixture)

		err := run(context.Background(), []string{
			"goal", "complete",
			"--state-dir", stateDir,
			"--run-id", fixture.RunID,
			"--goal-id", "V07",
			"--evidence", "must not be accepted",
		})
		if err == nil {
			t.Fatal("red verifier goal completed")
		}
		got := readLifecycleRun(t, stateDir, fixture.RunID)
		if got.Revision != fixture.Revision || got.Goals[0].Status != "active" || len(got.Evidence) != 0 {
			t.Fatalf("refused completion mutated the Run: %#v", got)
		}
	})
}

func TestV07DefaultStateDirectoryHonorsXDGStateHome(t *testing.T) {
	xdg := t.TempDir()
	t.Setenv("XDG_STATE_HOME", xdg)
	got, err := defaultStateDir()
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(xdg, "vault-hunter")
	if got != want {
		t.Fatalf("orchestrator state directory = %q, want shared Atlas directory %q", got, want)
	}
}

func TestV07CompanionProbeDistinguishesAbsentFromOperationalError(t *testing.T) {
	for _, test := range []struct {
		name       string
		exit       string
		wantErr    bool
		wantSplits int
	}{
		{name: "absent is replaceable", exit: "1", wantSplits: 1},
		{name: "probe error is not absence", exit: "2", wantErr: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			stateDir := t.TempDir()
			logPath := filepath.Join(t.TempDir(), "herdr.log")
			herdr := filepath.Join(t.TempDir(), "herdr")
			script := `#!/bin/sh
printf '%s\n' "$*" >> "$ATLAS_V07_HERDR_LOG"
case "$1:$2" in
  agent:get)
    printf '{"result":{"agent":{"name":"codex-pi-agent-pi-skills-tools-t07-orchestrator","workspace_id":"workspace","tab_id":"driver-tab","pane_id":"driver","terminal_id":"terminal-driver","agent_session":{"source":"herdr:codex","kind":"id","value":"session-driver"}}}}\n'
    ;;
  pane:get)
    exit "$ATLAS_V07_PANE_GET_EXIT"
    ;;
  pane:split)
    printf '{"result":{"pane":{"pane_id":"replacement-atlas","tab_id":"driver-tab"}}}\n'
    ;;
esac
`
			if err := os.WriteFile(herdr, []byte(script), 0o700); err != nil {
				t.Fatal(err)
			}
			t.Setenv("PATH", filepath.Dir(herdr)+string(os.PathListSeparator)+os.Getenv("PATH"))
			t.Setenv("ATLAS_V07_HERDR_LOG", logPath)
			t.Setenv("ATLAS_V07_PANE_GET_EXIT", test.exit)
			fixture := lifecycleRun()
			fixture.Companion = &runregistry.Companion{
				PaneID:      "old-atlas",
				TabID:       fixture.Orchestrator.TabID,
				OwnerPaneID: fixture.Orchestrator.PaneID,
			}
			writeCLIRun(t, stateDir, fixture)

			_, err := runWorkerTestCommand(t, []string{
				"ensure",
				"--state-dir", stateDir,
				"--task-id", fixture.Task.ID,
				"--task-title", fixture.Task.Title,
				"--task-path", fixture.Task.Path,
				"--feature-path", fixture.Task.FeaturePath,
				"--invoked-at", fixture.InvokedAt,
				"--orchestrator-pane", fixture.Orchestrator.PaneID,
				"--atlas-command", "vault-hunter-atlas",
				"--goal", "V07=Lifecycle=active",
				"--goal", "V08=Refresh=pending",
			})
			if test.wantErr != (err != nil) {
				t.Fatalf("error = %v, want error %t", err, test.wantErr)
			}
			data, readErr := os.ReadFile(logPath)
			if readErr != nil {
				t.Fatal(readErr)
			}
			if splits := strings.Count(string(data), "pane split "); splits != test.wantSplits {
				t.Fatalf("pane probe exit %s caused %d splits, want %d:\n%s", test.exit, splits, test.wantSplits, data)
			}
		})
	}
}

func TestV11ParticipantNameIncludesProjectFeatureTaskAndRole(t *testing.T) {
	stateDir := t.TempDir()
	fixture := lifecycleRun()
	writeCLIRun(t, stateDir, fixture)
	participant := runregistry.Participant{
		Role:        "verifier",
		GoalID:      "V07",
		Name:        "codex-pi-skills-tools-t07-verifier",
		WorkspaceID: "workspace",
		TabID:       "worker-tab",
		PaneID:      "worker-pane",
		TerminalID:  "worker-terminal",
		AgentSession: runregistry.AgentSession{
			Source: "herdr:codex",
			Kind:   "id",
			Value:  "worker-session",
		},
	}
	if _, err := runregistry.NewStore(stateDir, nil).RegisterParticipant(fixture.RunID, participant); err == nil {
		t.Fatal("participant name without owning project was accepted")
	}
}

func lifecycleRun() runregistry.Run {
	orchestrator := runregistry.Participant{
		Role:        "orchestrator",
		Name:        "codex-pi-agent-pi-skills-tools-t07-orchestrator",
		WorkspaceID: "workspace",
		TabID:       "driver-tab",
		PaneID:      "driver",
		TerminalID:  "terminal-driver",
		AgentSession: runregistry.AgentSession{
			Source: "herdr:codex",
			Kind:   "id",
			Value:  "session-driver",
		},
	}
	return runregistry.Run{
		SchemaVersion: 1,
		RunID:         "run-lifecycle",
		Revision:      10,
		Status:        "active",
		InvokedAt:     "2026-07-25T12:00:00Z",
		Task: runregistry.Task{
			ID:          "T07",
			Title:       "Lifecycle",
			Path:        "/vault/1_projects/pi-agent/features/pi-skills-tools/tasks/T07.md",
			FeaturePath: "/vault/1_projects/pi-agent/features/pi-skills-tools/feature.md",
			Kind:        "task",
		},
		ActiveGoal:   "V07",
		Goals:        []runregistry.Goal{{ID: "V07", Status: "active"}, {ID: "V08", Status: "pending"}},
		Orchestrator: orchestrator,
		Participants: []runregistry.Participant{orchestrator},
	}
}

func runLifecycleCommand(t *testing.T, args ...string) {
	t.Helper()
	if err := run(context.Background(), args); err != nil {
		t.Fatalf("%s: %v", strings.Join(args[:2], " "), err)
	}
}

func readLifecycleRun(t *testing.T, stateDir, runID string) runregistry.Run {
	t.Helper()
	run, err := runregistry.NewStore(stateDir, nil).Read(runID)
	if err != nil {
		t.Fatal(err)
	}
	return run
}

func assertRevision(t *testing.T, run runregistry.Run, want int) {
	t.Helper()
	if run.Revision != want {
		t.Fatalf("revision = %d, want %d", run.Revision, want)
	}
}
