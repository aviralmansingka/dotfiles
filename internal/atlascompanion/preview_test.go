package atlascompanion

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

func TestPreviewUniqueMatch(t *testing.T) {
	root := t.TempDir()
	producer, err := vaultregistry.OpenProducer(root)
	if err != nil {
		t.Fatal(err)
	}
	session := &vaultregistry.AgentSession{Source: "herdr:pi", Kind: "id", Value: "session-1"}
	identity := &vaultregistry.HerdrIdentity{
		WorkspaceID: "workspace-1", TabID: "tab-1", PaneID: "pane-1", TerminalID: "terminal-1",
	}
	run := vaultregistry.Run{
		SchemaVersion: 1,
		RunID:         "run-1",
		InvokedAt:     "2026-07-26T12:00:00Z",
		UpdatedAt:     "2026-07-26T12:00:00Z",
		Task: vaultregistry.Task{
			ID: "T04", Title: "Integrate compact Atlas", Path: "tasks/04.md",
			FeaturePath: "features/vault-hunter-atlas.md", Kind: "task",
		},
		Participants: []vaultregistry.Participant{{
			ParticipantID: "worker", ObservedAt: "2026-07-26T12:00:01Z", Role: "implementer",
			GoalID: "T04.V01", Herdr: identity, AgentSession: session,
		}},
		Lifecycle: []vaultregistry.Lifecycle{{
			ObservationID: "lifecycle-1", ObservedAt: "2026-07-26T12:00:02Z",
			Kind: "verifier", GoalID: "T04.V01", State: "active",
		}},
	}
	if _, err := producer.Create(run); err != nil {
		t.Fatal(err)
	}
	reader, err := vaultregistry.OpenReader(root)
	if err != nil {
		t.Fatal(err)
	}

	herdr := filepath.Join(t.TempDir(), "herdr")
	if err := os.WriteFile(herdr, []byte("#!/bin/sh\nprintf '%s\\n' \"$PREVIEW_HERDR_RESPONSE\"\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PREVIEW_HERDR_RESPONSE", herdrResponse(map[string]any{
		"type": "agent_list",
		"agents": []any{map[string]any{
			"workspace_id":  identity.WorkspaceID,
			"tab_id":        identity.TabID,
			"pane_id":       identity.PaneID,
			"terminal_id":   identity.TerminalID,
			"agent_session": session,
		}},
	}))
	selected := Agent{
		WorkspaceID: identity.WorkspaceID, TabID: identity.TabID,
		PaneID: identity.PaneID, TerminalID: identity.TerminalID, AgentSession: session,
	}
	result, err := (Client{Herdr: herdr}).Preview(reader, selected, 76, 4)
	if err != nil {
		t.Fatal(err)
	}
	if result.Outcome != "matched" || result.RunID != run.RunID || result.ParticipantID != "worker" {
		t.Fatalf("Preview result = %#v", result)
	}
	for _, want := range []string{
		"Run run-1 · Goal 1/1 T04.V01",
		"Role worker · implementer · verifier · active",
	} {
		if !strings.Contains(result.Frame, want) {
			t.Fatalf("Preview frame missing %q: %q", want, result.Frame)
		}
	}
}

func TestPreviewOutcomesFailClosedAndReadOnly(t *testing.T) {
	for _, tc := range []struct {
		name, outcome string
		registry      []byte
		configure     func(*testing.T, *vaultregistry.Producer, string, *vaultregistry.HerdrIdentity, *vaultregistry.AgentSession)
		agents        func(*vaultregistry.HerdrIdentity, *vaultregistry.AgentSession) []Agent
	}{
		{
			name: "malformed", outcome: "malformed", registry: []byte(`{"schema_version":`),
		},
		{
			name: "unsupported", outcome: "unsupported", registry: []byte("{\"schema_version\":2}\n"),
		},
		{
			name: "ambiguous", outcome: "ambiguous",
			configure: func(t *testing.T, producer *vaultregistry.Producer, taskPath string, identity *vaultregistry.HerdrIdentity, session *vaultregistry.AgentSession) {
				createPreviewRun(t, producer, previewRun("run-a", "task", taskPath, identity, session))
				createPreviewRun(t, producer, previewRun("run-b", "task", taskPath, identity, session))
			},
			agents: selectedPreviewAgents,
		},
		{
			name: "stale", outcome: "stale",
			configure: func(t *testing.T, producer *vaultregistry.Producer, taskPath string, identity *vaultregistry.HerdrIdentity, session *vaultregistry.AgentSession) {
				createPreviewRun(t, producer, previewRun("run-stale", "task", taskPath, identity, session))
			},
			agents: func(*vaultregistry.HerdrIdentity, *vaultregistry.AgentSession) []Agent { return []Agent{} },
		},
		{
			name: "stale incomplete registration", outcome: "stale",
			configure: func(t *testing.T, producer *vaultregistry.Producer, taskPath string, identity *vaultregistry.HerdrIdentity, _ *vaultregistry.AgentSession) {
				createPreviewRun(t, producer, previewRun("run-incomplete", "task", taskPath, identity, nil))
			},
			agents: selectedPreviewAgents,
		},
		{
			name: "contradictory", outcome: "contradictory",
			configure: func(t *testing.T, producer *vaultregistry.Producer, taskPath string, identity *vaultregistry.HerdrIdentity, _ *vaultregistry.AgentSession) {
				recorded := &vaultregistry.AgentSession{Source: "herdr:pi", Kind: "id", Value: "recorded-session"}
				createPreviewRun(t, producer, previewRun("run-contradictory", "task", taskPath, identity, recorded))
			},
			agents: selectedPreviewAgents,
		},
		{
			name: "unregistered", outcome: "unregistered",
			configure: func(t *testing.T, producer *vaultregistry.Producer, taskPath string, _ *vaultregistry.HerdrIdentity, session *vaultregistry.AgentSession) {
				other := &vaultregistry.HerdrIdentity{WorkspaceID: "other-workspace", TabID: "other-tab", PaneID: "other-pane", TerminalID: "other-terminal"}
				createPreviewRun(t, producer, previewRun("run-unregistered", "task", taskPath, other, session))
			},
			agents: selectedPreviewAgents,
		},
		{
			name: "ineligible", outcome: "ineligible",
			configure: func(t *testing.T, producer *vaultregistry.Producer, taskPath string, identity *vaultregistry.HerdrIdentity, session *vaultregistry.AgentSession) {
				createPreviewRun(t, producer, previewRun("run-feature", "feature", taskPath, identity, session))
			},
			agents: selectedPreviewAgents,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			vaultRoot := t.TempDir()
			taskPath := filepath.Join(vaultRoot, "tasks", "04.md")
			featurePath := filepath.Join(vaultRoot, "features", "atlas.md")
			if err := os.MkdirAll(filepath.Dir(taskPath), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.MkdirAll(filepath.Dir(featurePath), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(taskPath, []byte("# exact vault task source\n"), 0o600); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(featurePath, []byte("# exact vault feature source\n"), 0o600); err != nil {
				t.Fatal(err)
			}

			identity := &vaultregistry.HerdrIdentity{WorkspaceID: "workspace", TabID: "tab", PaneID: "pane", TerminalID: "terminal"}
			session := &vaultregistry.AgentSession{Source: "herdr:pi", Kind: "id", Value: "live-session"}
			producer, err := vaultregistry.OpenProducer(root)
			if err != nil {
				t.Fatal(err)
			}
			if tc.registry != nil {
				if err := os.WriteFile(filepath.Join(root, "runs", tc.name+".json"), tc.registry, 0o600); err != nil {
					t.Fatal(err)
				}
			} else {
				tc.configure(t, producer, taskPath, identity, session)
			}
			reader, err := vaultregistry.OpenReader(root)
			if err != nil {
				t.Fatal(err)
			}
			agents := []Agent{}
			if tc.agents != nil {
				agents = tc.agents(identity, session)
			}
			client, herdrLog := previewHerdr(t, herdrResponse(map[string]any{"type": "agent_list", "agents": agents}))
			before := snapshotPreviewSources(t, root, taskPath, featurePath)
			selected := Agent{WorkspaceID: identity.WorkspaceID, TabID: identity.TabID, PaneID: identity.PaneID, TerminalID: identity.TerminalID, AgentSession: session}

			result, err := client.Preview(reader, selected, 76, 4)
			if err != nil {
				t.Fatalf("Preview error = %v", err)
			}
			if result != (PreviewResult{Outcome: tc.outcome}) {
				t.Fatalf("Preview result = %#v, want outcome %q only", result, tc.outcome)
			}
			assertPreviewSources(t, before)
			if tc.registry != nil {
				log, err := os.ReadFile(herdrLog)
				if err != nil && !os.IsNotExist(err) {
					t.Fatal(err)
				}
				if len(log) != 0 {
					t.Fatalf("%s Registry failure reached Herdr transport: %q", tc.name, log)
				}
			}
		})
	}
}

func TestPreviewRejectsMalformedHerdrTransportReadOnly(t *testing.T) {
	root := t.TempDir()
	vaultPath := filepath.Join(t.TempDir(), "task.md")
	if err := os.WriteFile(vaultPath, []byte("# immutable vault source\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	identity := &vaultregistry.HerdrIdentity{WorkspaceID: "workspace", TabID: "tab", PaneID: "pane", TerminalID: "terminal"}
	session := &vaultregistry.AgentSession{Source: "herdr:pi", Kind: "id", Value: "session"}
	producer, err := vaultregistry.OpenProducer(root)
	if err != nil {
		t.Fatal(err)
	}
	createPreviewRun(t, producer, previewRun("run", "task", vaultPath, identity, session))
	reader, err := vaultregistry.OpenReader(root)
	if err != nil {
		t.Fatal(err)
	}
	valid := herdrResponse(map[string]any{"type": "agent_list", "agents": selectedPreviewAgents(identity, session)})
	for _, tc := range []struct {
		name, response string
	}{
		{name: "multiple JSON documents", response: valid + "\n" + valid},
		{name: "null envelope", response: "null"},
		{name: "missing result", response: `{"id":"preview"}`},
		{name: "scalar result", response: herdrResponse("agent_list")},
		{name: "wrong result type", response: herdrResponse(map[string]any{"type": "tab_list", "agents": []Agent{}})},
		{name: "null agents", response: herdrResponse(map[string]any{"type": "agent_list", "agents": nil})},
		{name: "partial identity", response: herdrResponse(map[string]any{
			"type": "agent_list", "agents": []any{map[string]any{"workspace_id": "workspace"}},
		})},
		{name: "partial session", response: herdrResponse(map[string]any{
			"type": "agent_list",
			"agents": []any{map[string]any{
				"workspace_id": "workspace", "tab_id": "tab", "pane_id": "pane", "terminal_id": "terminal",
				"agent_session": map[string]any{"source": "herdr:pi"},
			}},
		})},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client, _ := previewHerdr(t, tc.response)
			before := snapshotPreviewSources(t, root, vaultPath)
			selected := Agent{WorkspaceID: identity.WorkspaceID, TabID: identity.TabID, PaneID: identity.PaneID, TerminalID: identity.TerminalID, AgentSession: session}
			result, err := client.Preview(reader, selected, 76, 4)
			if err == nil || result != (PreviewResult{}) {
				t.Fatalf("Preview = %#v, %v; want fail-closed transport error", result, err)
			}
			assertPreviewSources(t, before)
		})
	}
}

func previewRun(runID, kind, taskPath string, identity *vaultregistry.HerdrIdentity, session *vaultregistry.AgentSession) vaultregistry.Run {
	return vaultregistry.Run{
		SchemaVersion: 1,
		RunID:         runID,
		InvokedAt:     "2026-07-26T12:00:00Z",
		UpdatedAt:     "2026-07-26T12:00:00Z",
		Task: vaultregistry.Task{
			ID: "T04", Title: "Preview", Path: taskPath,
			FeaturePath: filepath.Join(filepath.Dir(filepath.Dir(taskPath)), "features", "atlas.md"), Kind: kind,
		},
		Participants: []vaultregistry.Participant{{
			ParticipantID: "worker", ObservedAt: "2026-07-26T12:00:01Z", Role: "implementer",
			GoalID: "T04.V01", Herdr: identity, AgentSession: session,
		}},
	}
}

func createPreviewRun(t *testing.T, producer *vaultregistry.Producer, run vaultregistry.Run) {
	t.Helper()
	if _, err := producer.Create(run); err != nil {
		t.Fatal(err)
	}
}

func selectedPreviewAgents(identity *vaultregistry.HerdrIdentity, session *vaultregistry.AgentSession) []Agent {
	return []Agent{{
		WorkspaceID: identity.WorkspaceID, TabID: identity.TabID,
		PaneID: identity.PaneID, TerminalID: identity.TerminalID, AgentSession: session,
	}}
}

func previewHerdr(t *testing.T, response string) (Client, string) {
	t.Helper()
	dir := t.TempDir()
	log := filepath.Join(dir, "calls")
	script := filepath.Join(dir, "herdr")
	if err := os.WriteFile(script, []byte("#!/bin/sh\nprintf 'called\\n' >>\"$PREVIEW_HERDR_LOG\"\nprintf '%s\\n' \"$PREVIEW_HERDR_RESPONSE\"\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PREVIEW_HERDR_LOG", log)
	t.Setenv("PREVIEW_HERDR_RESPONSE", response)
	return Client{Herdr: script}, log
}

func snapshotPreviewSources(t *testing.T, root string, vaultPaths ...string) map[string][]byte {
	t.Helper()
	paths := append([]string(nil), vaultPaths...)
	entries, err := os.ReadDir(filepath.Join(root, "runs"))
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			paths = append(paths, filepath.Join(root, "runs", entry.Name()))
		}
	}
	before := make(map[string][]byte, len(paths))
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		before[path] = data
	}
	return before
}

func assertPreviewSources(t *testing.T, before map[string][]byte) {
	t.Helper()
	for path, want := range before {
		got, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(got, want) {
			t.Fatalf("Preview changed Registry/vault source bytes at %s", path)
		}
	}
}
