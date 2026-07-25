package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

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
			if err := run(test.args, strings.NewReader(""), &stdout); err == nil {
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

func TestV05InteractiveRunWaitsForRegistryAndStaysAlive(t *testing.T) {
	stateDir := t.TempDir()
	server := startV05Herdr(t)
	input, send := io.Pipe()
	defer input.Close()
	defer send.Close()
	var stdout bytes.Buffer
	done := make(chan error, 1)
	go func() {
		done <- run([]string{
			"--run", "run-interactive",
			"--state-dir", stateDir,
			"--socket", server.path,
		}, input, &stdout)
	}()

	select {
	case err := <-done:
		t.Fatalf("Atlas exited before the Registry commit: %v", err)
	case <-time.After(50 * time.Millisecond):
	}
	writeCommandRun(t, stateDir, v05Run("task", true))
	waitForV05(t, done, func() bool {
		return server.subscriptions.Load() == 1 && server.snapshots.Load() == 1
	})
	select {
	case err := <-done:
		t.Fatalf("Atlas exited after Herdr attached: %v", err)
	default:
	}
	if _, err := send.Write([]byte("q")); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("interactive Atlas exit: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("interactive Atlas did not stop on q")
	}
	if !strings.Contains(stdout.String(), "Vault Hunter ·") ||
		!strings.Contains(stdout.String(), "GOAL TIMELINE") ||
		strings.Contains(stdout.String(), "Vault Hunter Atlas") {
		t.Fatalf("interactive Atlas did not render the full Operations Board:\n%s", stdout.String())
	}
}

func TestV05InteractiveRunValidatesRegistry(t *testing.T) {
	cases := []struct {
		name  string
		setup func(*testing.T, string)
		args  func(string) []string
		want  string
	}{
		{
			name:  "run id required",
			setup: func(*testing.T, string) {},
			args: func(stateDir string) []string {
				return []string{"--state-dir", stateDir}
			},
			want: "--run RUN_ID is required",
		},
		{
			name: "malformed registry",
			setup: func(t *testing.T, stateDir string) {
				runsDir := filepath.Join(stateDir, "runs")
				if err := os.MkdirAll(runsDir, 0o700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(runsDir, "broken.json"), []byte(`{`), 0o600); err != nil {
					t.Fatal(err)
				}
			},
			args: func(stateDir string) []string {
				return []string{"--run", "broken", "--state-dir", stateDir}
			},
			want: "unexpected EOF",
		},
		{
			name: "Task Run required",
			setup: func(t *testing.T, stateDir string) {
				writeCommandRun(t, stateDir, v05Run("feature", true))
			},
			args: func(stateDir string) []string {
				return []string{"--run", "run-interactive", "--state-dir", stateDir}
			},
			want: "is not a Task Run",
		},
		{
			name: "participant required",
			setup: func(t *testing.T, stateDir string) {
				writeCommandRun(t, stateDir, v05Run("task", false))
			},
			args: func(stateDir string) []string {
				return []string{"--run", "run-interactive", "--state-dir", stateDir}
			},
			want: "has no registered participants",
		},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			stateDir := t.TempDir()
			test.setup(t, stateDir)
			var stdout bytes.Buffer
			err := run(test.args(stateDir), strings.NewReader("q"), &stdout)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error = %v, want %q", err, test.want)
			}
			if stdout.Len() != 0 {
				t.Fatalf("validation failure rendered partial output: %q", stdout.String())
			}
		})
	}
}

func v05Run(kind string, participant bool) runregistry.Run {
	run := runregistry.Run{
		SchemaVersion: 1,
		RunID:         "run-interactive",
		Status:        "active",
		Task:          runregistry.Task{ID: "T11", Kind: kind},
		ActiveGoal:    "V05",
		Goals:         []runregistry.Goal{{ID: "V05", Label: "Interactive startup", Status: "active"}},
	}
	if participant {
		run.Participants = []runregistry.Participant{{PaneID: "w1:p1"}}
	}
	return run
}

type v05Herdr struct {
	path          string
	listener      net.Listener
	subscriptions atomic.Int32
	snapshots     atomic.Int32
}

func startV05Herdr(t *testing.T) *v05Herdr {
	t.Helper()
	socketDir, err := os.MkdirTemp(os.TempDir(), "vh-v05-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(socketDir) })
	path := filepath.Join(socketDir, "herdr.sock")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	server := &v05Herdr{path: path, listener: listener}
	t.Cleanup(func() { _ = listener.Close() })
	go func() {
		for {
			connection, err := listener.Accept()
			if err != nil {
				return
			}
			go server.serve(connection)
		}
	}()
	return server
}

func (s *v05Herdr) serve(connection net.Conn) {
	defer connection.Close()
	var request struct {
		ID     string          `json:"id"`
		Method string          `json:"method"`
		Params json.RawMessage `json:"params"`
	}
	if json.NewDecoder(connection).Decode(&request) != nil {
		return
	}
	switch request.Method {
	case "events.subscribe":
		s.subscriptions.Add(1)
		_ = json.NewEncoder(connection).Encode(map[string]any{
			"id": request.ID,
			"result": map[string]string{
				"type": "subscription_started",
			},
		})
		_, _ = io.Copy(io.Discard, connection)
	case "agent.get":
		var params struct {
			Target string `json:"target"`
		}
		if json.Unmarshal(request.Params, &params) != nil {
			return
		}
		s.snapshots.Add(1)
		_ = json.NewEncoder(connection).Encode(map[string]any{
			"id": request.ID,
			"result": map[string]any{
				"agent": map[string]any{
					"pane_id":      params.Target,
					"agent_status": "working",
					"revision":     1,
				},
			},
		})
	}
}

func waitForV05(t *testing.T, done <-chan error, ready func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !ready() {
		select {
		case err := <-done:
			t.Fatalf("Atlas exited while attaching to fake Herdr: %v", err)
		default:
		}
		if time.Now().After(deadline) {
			t.Fatal("timed out waiting for fake Herdr")
		}
		time.Sleep(10 * time.Millisecond)
	}
}
