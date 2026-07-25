package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/aviralmansingka/dotfiles/vault-hunter/internal/runregistry"
)

type workerTestTab struct {
	TabID       string `json:"tab_id"`
	WorkspaceID string `json:"workspace_id"`
	Label       string `json:"label"`
	PaneCount   int    `json:"pane_count"`
}

type workerTestHerdrState struct {
	Tabs   []workerTestTab                    `json:"tabs"`
	Agents map[string]runregistry.Participant `json:"agents"`
	Panes  map[string]bool                    `json:"panes"`
}

type workerLifecycleReport struct {
	Workers []struct {
		Name  string `json:"name"`
		TabID string `json:"tab_id"`
		State string `json:"state"`
	} `json:"workers"`
}

func TestWorkerLifecycleV01(t *testing.T) {
	stateDir := t.TempDir()
	herdr, herdrState := newWorkerTestHerdr(t)
	writeWorkerTestRun(t, stateDir, workerTestRun())

	tests := []struct {
		name    string
		worker  runregistry.Participant
		tab     workerTestTab
		live    runregistry.Participant
		wantErr bool
	}{
		{
			name:    "wrong feature workspace",
			worker:  workerTestParticipant("codex-wrong-workspace", "w-other:t1", "w-other:p1", "term-wrong", "session-wrong"),
			tab:     workerTestTab{TabID: "w-other:t1", WorkspaceID: "w-other", Label: "Issue · verifier", PaneCount: 1},
			wantErr: true,
		},
		{
			name:    "unnamed tab",
			worker:  workerTestParticipant("codex-unnamed", "w-feature:t-unnamed", "w-feature:p-unnamed", "term-unnamed", "session-unnamed"),
			tab:     workerTestTab{TabID: "w-feature:t-unnamed", WorkspaceID: "w-feature", PaneCount: 1},
			wantErr: true,
		},
		{
			name:    "shared tab",
			worker:  workerTestParticipant("codex-shared", "w-feature:t-shared", "w-feature:p-shared", "term-shared", "session-shared"),
			tab:     workerTestTab{TabID: "w-feature:t-shared", WorkspaceID: "w-feature", Label: "Issue · reviewer", PaneCount: 2},
			wantErr: true,
		},
		{
			name:    "mismatched session",
			worker:  workerTestParticipant("codex-mismatch", "w-feature:t-mismatch", "w-feature:p-mismatch", "term-mismatch", "session-captured"),
			tab:     workerTestTab{TabID: "w-feature:t-mismatch", WorkspaceID: "w-feature", Label: "Issue · implementer", PaneCount: 1},
			live:    workerTestParticipant("codex-mismatch", "w-feature:t-mismatch", "w-feature:p-mismatch", "term-mismatch", "session-live"),
			wantErr: true,
		},
		{
			name:   "exact one-pane worker",
			worker: workerTestParticipant("codex-exact", "w-feature:t-exact", "w-feature:p-exact", "term-exact", "session-exact"),
			tab:    workerTestTab{TabID: "w-feature:t-exact", WorkspaceID: "w-feature", Label: "Issue · verifier", PaneCount: 1},
		},
	}

	for _, test := range tests {
		live := test.live
		if live.Name == "" {
			live = test.worker
		}
		writeWorkerTestHerdrState(t, herdrState, workerTestHerdrState{
			Tabs:   []workerTestTab{test.tab},
			Agents: map[string]runregistry.Participant{live.Name: live},
			Panes:  map[string]bool{live.PaneID: true},
		})
		_, err := runWorkerTestCommand(t, workerCaptureArgs(stateDir, herdr, test.worker))
		if (err != nil) != test.wantErr {
			t.Fatalf("%s: capture error = %v, wantErr=%v", test.name, err, test.wantErr)
		}
	}

	run := readWorkerTestRun(t, stateDir)
	if len(run.Participants) != 2 || run.Participants[1] != tests[len(tests)-1].worker {
		t.Fatalf("capture did not record only the exact launch tuple: %#v", run.Participants)
	}
}

func TestWorkerLifecycleV02(t *testing.T) {
	stateDir := t.TempDir()
	herdr, herdrState := newWorkerTestHerdr(t)
	run := workerTestRun()
	missing := workerTestParticipant("codex-missing", "w-feature:t-missing", "w-feature:p-missing", "term-missing", "session-missing")
	run.Participants = append(run.Participants, missing)
	writeWorkerTestRun(t, stateDir, run)
	writeWorkerTestHerdrState(t, herdrState, workerTestHerdrState{
		Tabs: []workerTestTab{
			{TabID: run.Orchestrator.TabID, WorkspaceID: "w-feature", Label: "Issue · driver", PaneCount: 2},
			{TabID: "w-feature:t-unrelated", WorkspaceID: "w-feature", Label: "Unrelated", PaneCount: 1},
		},
		Agents: map[string]runregistry.Participant{},
		Panes:  map[string]bool{run.Orchestrator.PaneID: true, run.Companion.PaneID: true},
	})

	first, err := runWorkerTestCommand(t, []string{
		"reconcile-workers", "--state-dir", stateDir, "--run-id", run.RunID, "--herdr", herdr,
	})
	if err != nil {
		t.Fatal(err)
	}
	second, err := runWorkerTestCommand(t, []string{
		"reconcile-workers", "--state-dir", stateDir, "--run-id", run.RunID, "--herdr", herdr,
	})
	if err != nil {
		t.Fatal(err)
	}
	if string(first) != string(second) {
		t.Fatalf("stale reconciliation is nondeterministic:\nfirst: %s\nsecond: %s", first, second)
	}
	report := decodeWorkerLifecycleReport(t, first)
	assertWorkerLifecycleStates(t, report, [][3]string{{missing.Name, missing.TabID, "stale"}})
	if strings.Contains(strings.ToLower(string(first)), "complete") {
		t.Fatalf("missing tab was inferred complete: %s", first)
	}
	persisted := readWorkerTestRun(t, stateDir)
	if persisted.Status != "active" || len(persisted.Participants) != 2 || persisted.Participants[1] != missing {
		t.Fatalf("reconciliation erased or completed the stale capture: %#v", persisted)
	}
}

func TestWorkerLifecycleV03(t *testing.T) {
	stateDir := t.TempDir()
	herdr, herdrState := newWorkerTestHerdr(t)
	run := workerTestRun()
	old := workerTestParticipant("codex-restarted-old", "w-feature:t-old", "w-feature:p-old", "term-old", "session-old")
	shared := workerTestParticipant("codex-shared", "w-feature:t-shared", "w-feature:p-shared", "term-shared", "session-shared")
	moved := workerTestParticipant("codex-moved", "w-feature:t-moved", "w-feature:p-moved", "term-moved", "session-moved")
	sessionChanged := workerTestParticipant("codex-session", "w-feature:t-session", "w-feature:p-session", "term-session", "session-captured")
	replacement := workerTestParticipant("codex-restarted-new", "w-feature:t-new", "w-feature:p-new", "term-new", "session-new")
	run.Participants = append(run.Participants, old, shared, moved, sessionChanged)
	writeWorkerTestRun(t, stateDir, run)

	movedLive := moved
	movedLive.TabID = "w-feature:t-moved-elsewhere"
	movedLive.PaneID = "w-feature:p-moved-elsewhere"
	sessionLive := sessionChanged
	sessionLive.AgentSession.Value = "session-live"
	writeWorkerTestHerdrState(t, herdrState, workerTestHerdrState{
		Tabs: []workerTestTab{
			{TabID: shared.TabID, WorkspaceID: "w-feature", Label: "Issue · shared", PaneCount: 2},
			{TabID: moved.TabID, WorkspaceID: "w-feature", Label: "Issue · moved", PaneCount: 1},
			{TabID: movedLive.TabID, WorkspaceID: "w-feature", Label: "Other", PaneCount: 1},
			{TabID: sessionChanged.TabID, WorkspaceID: "w-feature", Label: "Issue · session", PaneCount: 1},
			{TabID: replacement.TabID, WorkspaceID: "w-feature", Label: "Issue · replacement", PaneCount: 1},
		},
		Agents: map[string]runregistry.Participant{
			shared.Name:         shared,
			moved.Name:          movedLive,
			sessionChanged.Name: sessionLive,
			replacement.Name:    replacement,
		},
		Panes: map[string]bool{
			shared.PaneID: true, moved.PaneID: true, movedLive.PaneID: true,
			sessionChanged.PaneID: true, replacement.PaneID: true,
		},
	})

	if _, err := runWorkerTestCommand(t, workerCaptureArgs(stateDir, herdr, replacement)); err != nil {
		t.Fatalf("capturing restarted worker: %v", err)
	}
	first, err := runWorkerTestCommand(t, []string{
		"reconcile-workers", "--state-dir", stateDir, "--run-id", run.RunID, "--herdr", herdr,
	})
	if err != nil {
		t.Fatal(err)
	}
	second, err := runWorkerTestCommand(t, []string{
		"reconcile-workers", "--state-dir", stateDir, "--run-id", run.RunID, "--herdr", herdr,
	})
	if err != nil {
		t.Fatal(err)
	}
	if string(first) != string(second) {
		t.Fatalf("restart reconciliation is nondeterministic:\nfirst: %s\nsecond: %s", first, second)
	}
	assertWorkerLifecycleStates(t, decodeWorkerLifecycleReport(t, first), [][3]string{
		{old.Name, old.TabID, "stale"},
		{shared.Name, shared.TabID, "unexpected"},
		{moved.Name, moved.TabID, "unexpected"},
		{sessionChanged.Name, sessionChanged.TabID, "unexpected"},
		{replacement.Name, replacement.TabID, "live"},
	})
}

func TestWorkerLifecycleV04(t *testing.T) {
	stateDir := t.TempDir()
	herdr, herdrState := newWorkerTestHerdr(t)
	run := workerTestRun()
	live := workerTestParticipant("codex-live", "w-feature:t-live", "w-feature:p-live", "term-live", "session-live")
	stale := workerTestParticipant("codex-stale", "w-feature:t-stale", "w-feature:p-stale", "term-stale", "session-stale")
	unexpected := workerTestParticipant("codex-unexpected", "w-feature:t-unexpected", "w-feature:p-unexpected", "term-unexpected", "session-unexpected")
	run.Participants = append(run.Participants, live, stale, unexpected)
	writeWorkerTestRun(t, stateDir, run)

	fake := workerTestHerdrState{
		Tabs: []workerTestTab{
			{TabID: run.Orchestrator.TabID, WorkspaceID: "w-feature", Label: "Issue · driver", PaneCount: 2},
			{TabID: live.TabID, WorkspaceID: "w-feature", Label: "Issue · live", PaneCount: 1},
			{TabID: unexpected.TabID, WorkspaceID: "w-feature", Label: "Issue · unexpected", PaneCount: 2},
			{TabID: "w-feature:t-unrelated", WorkspaceID: "w-feature", Label: "Unrelated", PaneCount: 1},
		},
		Agents: map[string]runregistry.Participant{live.Name: live, unexpected.Name: unexpected},
		Panes: map[string]bool{
			run.Orchestrator.PaneID: true,
			run.Companion.PaneID:    true,
			live.PaneID:             true,
			unexpected.PaneID:       true,
			"w-feature:p-unrelated": true,
		},
	}
	writeWorkerTestHerdrState(t, herdrState, fake)

	cleanup := []string{"cleanup-workers", "--state-dir", stateDir, "--run-id", run.RunID, "--herdr", herdr}
	if _, err := runWorkerTestCommand(t, cleanup); err == nil {
		t.Fatal("cleanup accepted unexpected worker ownership")
	}
	if closes := workerTestCloseCalls(t); len(closes) != 0 {
		t.Fatalf("refused cleanup closed resources: %#v", closes)
	}
	if got := readWorkerTestRun(t, stateDir); !reflect.DeepEqual(got.Participants, run.Participants) {
		t.Fatalf("refused cleanup mutated worker references: %#v", got.Participants)
	}

	fake.Tabs = []workerTestTab{fake.Tabs[0], fake.Tabs[1], fake.Tabs[3]}
	delete(fake.Agents, unexpected.Name)
	writeWorkerTestHerdrState(t, herdrState, fake)
	if _, err := runWorkerTestCommand(t, cleanup); err != nil {
		t.Fatal(err)
	}
	if closes := workerTestCloseCalls(t); !reflect.DeepEqual(closes, []string{"tab close " + live.TabID}) {
		t.Fatalf("cleanup crossed worker ownership boundary: %#v", closes)
	}
	persisted := readWorkerTestRun(t, stateDir)
	if !reflect.DeepEqual(persisted.Participants, []runregistry.Participant{run.Orchestrator}) {
		t.Fatalf("cleanup left worker references: %#v", persisted.Participants)
	}
	afterCleanup := readWorkerTestHerdrState(t, herdrState)
	assertWorkerTestPreserved(t, afterCleanup, run)

	if _, err := runWorkerTestCommand(t, cleanup); err != nil {
		t.Fatal(err)
	}
	if closes := workerTestCloseCalls(t); !reflect.DeepEqual(closes, []string{"tab close " + live.TabID}) {
		t.Fatalf("idempotent cleanup made another close call: %#v", closes)
	}

	t.Setenv("PATH", filepath.Dir(herdr)+string(os.PathListSeparator)+os.Getenv("PATH"))
	if _, err := runWorkerTestCommand(t, []string{
		"finish", "--state-dir", stateDir, "--run-id", run.RunID,
	}); err != nil {
		t.Fatal(err)
	}
	closes := workerTestCloseCalls(t)
	wantCloses := []string{"tab close " + live.TabID, "pane close " + run.Companion.PaneID}
	if !reflect.DeepEqual(closes, wantCloses) {
		t.Fatalf("finish crossed Atlas ownership boundary: got %#v want %#v", closes, wantCloses)
	}
	finished := readWorkerTestRun(t, stateDir)
	if finished.Status != "completed" || !reflect.DeepEqual(finished.Participants, []runregistry.Participant{run.Orchestrator}) {
		t.Fatalf("finish changed worker ownership or failed to complete: %#v", finished)
	}
	finalHerdr := readWorkerTestHerdrState(t, herdrState)
	if finalHerdr.Panes[run.Companion.PaneID] {
		t.Fatal("finish left the owned Atlas pane live")
	}
	assertWorkerTestPreserved(t, finalHerdr, run)
}

func TestWorkerLifecycleFakeHerdr(t *testing.T) {
	statePath := os.Getenv("VAULT_HUNTER_FAKE_HERDR_STATE")
	if statePath == "" {
		return
	}
	args := os.Args
	for len(args) > 0 && args[0] != "--" {
		args = args[1:]
	}
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "fake Herdr: missing --")
		os.Exit(1)
	}
	if err := runWorkerTestHerdr(statePath, os.Getenv("VAULT_HUNTER_FAKE_HERDR_LOG"), args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "fake Herdr:", err)
		os.Exit(1)
	}
	os.Exit(0)
}

func runWorkerTestHerdr(statePath, logPath string, args []string) error {
	log, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintln(log, strings.Join(args, " ")); err != nil {
		_ = log.Close()
		return err
	}
	if err := log.Close(); err != nil {
		return err
	}
	data, err := os.ReadFile(statePath)
	if err != nil {
		return err
	}
	var state workerTestHerdrState
	if err := json.Unmarshal(data, &state); err != nil {
		return err
	}
	switch strings.Join(args[:min(2, len(args))], " ") {
	case "agent get":
		if len(args) != 3 {
			return fmt.Errorf("agent get args: %#v", args)
		}
		agent, ok := state.Agents[args[2]]
		if !ok {
			return fmt.Errorf("agent %s missing", args[2])
		}
		return writeWorkerTestHerdrResult(map[string]any{"agent": agent})
	case "tab list":
		return writeWorkerTestHerdrResult(map[string]any{"tabs": state.Tabs})
	case "tab close":
		if len(args) != 3 {
			return fmt.Errorf("tab close args: %#v", args)
		}
		found := false
		tabs := state.Tabs[:0]
		for _, tab := range state.Tabs {
			if tab.TabID == args[2] {
				found = true
				continue
			}
			tabs = append(tabs, tab)
		}
		if !found {
			return fmt.Errorf("tab %s missing", args[2])
		}
		state.Tabs = tabs
		for name, agent := range state.Agents {
			if agent.TabID == args[2] {
				delete(state.Panes, agent.PaneID)
				delete(state.Agents, name)
			}
		}
		return saveWorkerTestHerdrState(statePath, state)
	case "pane get":
		if len(args) != 3 || !state.Panes[args[2]] {
			return fmt.Errorf("pane missing: %#v", args)
		}
		return writeWorkerTestHerdrResult(map[string]any{"pane": map[string]string{"pane_id": args[2]}})
	case "pane close":
		if len(args) != 3 || !state.Panes[args[2]] {
			return fmt.Errorf("pane missing: %#v", args)
		}
		delete(state.Panes, args[2])
		return saveWorkerTestHerdrState(statePath, state)
	default:
		return fmt.Errorf("unexpected command: %s", strings.Join(args, " "))
	}
}

func writeWorkerTestHerdrResult(result any) error {
	return json.NewEncoder(os.Stdout).Encode(map[string]any{"result": result})
}

func newWorkerTestHerdr(t *testing.T) (string, string) {
	t.Helper()
	directory := t.TempDir()
	binary := filepath.Join(directory, "herdr")
	statePath := filepath.Join(directory, "state.json")
	logPath := filepath.Join(directory, "calls.log")
	script := fmt.Sprintf("#!/bin/sh\nexec %q -test.run='^TestWorkerLifecycleFakeHerdr$' -- \"$@\"\n", os.Args[0])
	if err := os.WriteFile(binary, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("VAULT_HUNTER_FAKE_HERDR_STATE", statePath)
	t.Setenv("VAULT_HUNTER_FAKE_HERDR_LOG", logPath)
	return binary, statePath
}

func workerTestRun() runregistry.Run {
	driver := runregistry.Participant{
		Role:         "orchestrator",
		Name:         "codex-driver",
		WorkspaceID:  "w-feature",
		TabID:        "w-feature:t-driver",
		PaneID:       "w-feature:p-driver",
		TerminalID:   "term-driver",
		AgentSession: runregistry.AgentSession{Source: "herdr:codex", Kind: "id", Value: "session-driver"},
	}
	return runregistry.Run{
		SchemaVersion: 1,
		RunID:         "run-worker-lifecycle",
		Revision:      1,
		Status:        "active",
		Task:          runregistry.Task{ID: "issue-worker-lifecycle", Path: "/vault/reconcile-worker-lifecycle.md", Kind: "task"},
		ActiveGoal:    "V01",
		Goals: []runregistry.Goal{
			{ID: "V01", Label: "launch", Status: "done"},
			{ID: "V02", Label: "stale", Status: "done"},
			{ID: "V03", Label: "restart", Status: "done"},
			{ID: "V04", Label: "cleanup", Status: "done"},
		},
		Orchestrator: driver,
		Participants: []runregistry.Participant{driver},
		Companion: &runregistry.Companion{
			PaneID:      "w-feature:p-atlas",
			TabID:       driver.TabID,
			OwnerPaneID: driver.PaneID,
		},
	}
}

func workerTestParticipant(name, tabID, paneID, terminalID, session string) runregistry.Participant {
	return runregistry.Participant{
		Role:        "verifier",
		GoalID:      "V01",
		Name:        name,
		WorkspaceID: strings.SplitN(tabID, ":", 2)[0],
		TabID:       tabID,
		PaneID:      paneID,
		TerminalID:  terminalID,
		AgentSession: runregistry.AgentSession{
			Source: "herdr:codex",
			Kind:   "id",
			Value:  session,
		},
	}
}

func workerCaptureArgs(stateDir, herdr string, worker runregistry.Participant) []string {
	return []string{
		"participant",
		"--state-dir", stateDir,
		"--run-id", "run-worker-lifecycle",
		"--goal-id", worker.GoalID,
		"--role", worker.Role,
		"--agent", worker.Name,
		"--workspace-id", worker.WorkspaceID,
		"--tab-id", worker.TabID,
		"--pane-id", worker.PaneID,
		"--terminal-id", worker.TerminalID,
		"--agent-session-source", worker.AgentSession.Source,
		"--agent-session-kind", worker.AgentSession.Kind,
		"--agent-session-value", worker.AgentSession.Value,
		"--herdr", herdr,
	}
}

func runWorkerTestCommand(t *testing.T, args []string) ([]byte, error) {
	t.Helper()
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	original := os.Stdout
	os.Stdout = writer
	runErr := run(context.Background(), args)
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	os.Stdout = original
	output, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	if err := reader.Close(); err != nil {
		t.Fatal(err)
	}
	return output, runErr
}

func writeWorkerTestRun(t *testing.T, stateDir string, run runregistry.Run) {
	t.Helper()
	runsDir := filepath.Join(stateDir, "runs")
	if err := os.MkdirAll(runsDir, 0o700); err != nil {
		t.Fatal(err)
	}
	data, err := json.MarshalIndent(run, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(runsDir, run.RunID+".json"), data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func readWorkerTestRun(t *testing.T, stateDir string) runregistry.Run {
	t.Helper()
	run, err := runregistry.NewStore(stateDir, nil).Read("run-worker-lifecycle")
	if err != nil {
		t.Fatal(err)
	}
	return run
}

func writeWorkerTestHerdrState(t *testing.T, path string, state workerTestHerdrState) {
	t.Helper()
	if err := saveWorkerTestHerdrState(path, state); err != nil {
		t.Fatal(err)
	}
}

func saveWorkerTestHerdrState(path string, state workerTestHerdrState) error {
	data, err := json.Marshal(state)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}

func readWorkerTestHerdrState(t *testing.T, path string) workerTestHerdrState {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var state workerTestHerdrState
	if err := json.Unmarshal(data, &state); err != nil {
		t.Fatal(err)
	}
	return state
}

func decodeWorkerLifecycleReport(t *testing.T, data []byte) workerLifecycleReport {
	t.Helper()
	var report workerLifecycleReport
	if err := json.Unmarshal(data, &report); err != nil {
		t.Fatalf("invalid lifecycle report %q: %v", data, err)
	}
	return report
}

func assertWorkerLifecycleStates(t *testing.T, report workerLifecycleReport, want [][3]string) {
	t.Helper()
	got := make([][3]string, 0, len(report.Workers))
	for _, worker := range report.Workers {
		got = append(got, [3]string{worker.Name, worker.TabID, worker.State})
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("worker lifecycle states = %#v, want %#v", got, want)
	}
}

func workerTestCloseCalls(t *testing.T) []string {
	t.Helper()
	data, err := os.ReadFile(os.Getenv("VAULT_HUNTER_FAKE_HERDR_LOG"))
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		t.Fatal(err)
	}
	var closes []string
	for _, call := range strings.Split(strings.TrimSpace(string(data)), "\n") {
		if strings.HasPrefix(call, "tab close ") || strings.HasPrefix(call, "pane close ") ||
			strings.HasPrefix(call, "workspace close ") {
			closes = append(closes, call)
		}
	}
	return closes
}

func assertWorkerTestPreserved(t *testing.T, state workerTestHerdrState, run runregistry.Run) {
	t.Helper()
	tabs := make(map[string]bool, len(state.Tabs))
	for _, tab := range state.Tabs {
		tabs[tab.TabID] = true
	}
	if !tabs[run.Orchestrator.TabID] || !tabs["w-feature:t-unrelated"] {
		t.Fatalf("cleanup removed driver, Feature workspace, or unrelated tab: %#v", state.Tabs)
	}
	if !state.Panes[run.Orchestrator.PaneID] || !state.Panes["w-feature:p-unrelated"] {
		t.Fatalf("cleanup removed driver or unrelated pane: %#v", state.Panes)
	}
}
