package atlascompanion

import (
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
