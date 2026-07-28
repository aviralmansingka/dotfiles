package atlascompanion

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

func TestT18V04AttachRunDerivesV2ParticipantsAndCreatesMissingCompanion(t *testing.T) {
	tuple := Tuple{RunID: "run-v2", WorkspaceID: "ws-companion", TabID: "created-tab", PaneID: "created-pane", TerminalID: "created-terminal"}
	create := herdrResponse(map[string]any{
		"type":      "tab_created",
		"tab":       map[string]any{"workspace_id": tuple.WorkspaceID, "tab_id": tuple.TabID, "label": label(tuple.RunID, tuple.WorkspaceID), "pane_count": 1},
		"root_pane": map[string]any{"workspace_id": tuple.WorkspaceID, "tab_id": tuple.TabID, "pane_id": tuple.PaneID, "terminal_id": tuple.TerminalID},
	})
	afterTabs := herdrResponse(map[string]any{"type": "tab_list", "tabs": []any{map[string]any{"workspace_id": tuple.WorkspaceID, "tab_id": tuple.TabID, "label": label(tuple.RunID, tuple.WorkspaceID), "pane_count": 1}}})
	afterPanes := herdrResponse(map[string]any{"type": "pane_list", "panes": []any{map[string]any{"workspace_id": tuple.WorkspaceID, "tab_id": tuple.TabID, "pane_id": tuple.PaneID, "terminal_id": tuple.TerminalID}}})
	atlas := []string{"atlas-bin"}
	client, log := fakeHerdr(t, "", "", "", create)
	client.Executable = "atlas-bin"
	env := client.atlasEnv(tuple.RunID, "/state")
	info := herdrResponse(map[string]any{"type": "pane_process_info", "process_info": map[string]any{"pane_id": tuple.PaneID, "foreground_processes": []any{
		map[string]any{"argv": append([]string{"/bin/sh", "-c", wrapperScript(env), marker(tuple)}, atlas...)},
		map[string]any{"argv": atlas},
	}}})
	t.Setenv("HERDR_TEST_INFO", info)
	t.Setenv("HERDR_TEST_AFTER_TABS", afterTabs)
	t.Setenv("HERDR_TEST_AFTER_PANES", afterPanes)

	attachment, err := client.AttachRun(v2CompanionRun(tuple), tuple.WorkspaceID, "/state")
	if err != nil {
		t.Fatal(err)
	}
	if attachment.Tuple != tuple {
		t.Fatalf("attachment tuple = %#v, want %#v", attachment.Tuple, tuple)
	}
	commands, err := os.ReadFile(log)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"tab create\n", "pane run\n", "pane process-info\n"} {
		if !strings.Contains(string(commands), want) {
			t.Fatalf("companion create log missing %q\n%s", want, commands)
		}
	}
}

func TestT18V04AttachRunKeepsHealthyV2Companion(t *testing.T) {
	tuple := Tuple{RunID: "run-v2", WorkspaceID: "ws-companion", TabID: "created-tab", PaneID: "created-pane", TerminalID: "created-terminal"}
	tabs := herdrResponse(map[string]any{"type": "tab_list", "tabs": []any{map[string]any{"workspace_id": tuple.WorkspaceID, "tab_id": tuple.TabID, "label": label(tuple.RunID, tuple.WorkspaceID), "pane_count": 1}}})
	panes := herdrResponse(map[string]any{"type": "pane_list", "panes": []any{map[string]any{"workspace_id": tuple.WorkspaceID, "tab_id": tuple.TabID, "pane_id": tuple.PaneID, "terminal_id": tuple.TerminalID}}})
	atlas := []string{"atlas-bin"}
	client, log := fakeHerdr(t, tabs, panes, "", "")
	client.Executable = "atlas-bin"
	env := client.atlasEnv(tuple.RunID, "/state")
	info := herdrResponse(map[string]any{"type": "pane_process_info", "process_info": map[string]any{"pane_id": tuple.PaneID, "foreground_processes": []any{
		map[string]any{"argv": append([]string{"/bin/sh", "-c", wrapperScript(env), marker(tuple)}, atlas...)},
		map[string]any{"argv": atlas},
	}}})
	t.Setenv("HERDR_TEST_INFO", info)

	attachment, err := client.AttachRun(v2CompanionRun(tuple), tuple.WorkspaceID, "/state")
	if err != nil {
		t.Fatal(err)
	}
	if attachment.Tuple != tuple {
		t.Fatalf("attachment tuple = %#v, want %#v", attachment.Tuple, tuple)
	}
	commands, err := os.ReadFile(log)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"tab create\n", "pane run\n", "tab close\n"} {
		if strings.Contains(string(commands), forbidden) {
			t.Fatalf("healthy companion mutated Herdr with %q\n%s", forbidden, commands)
		}
	}
}

func v2CompanionRun(tuple Tuple) vaultregistry.Run {
	herdr := &vaultregistry.HerdrIdentity{WorkspaceID: tuple.WorkspaceID, TabID: "tab-driver", PaneID: "pane-driver", TerminalID: "term-driver"}
	return vaultregistry.Run{
		SchemaVersion: 2,
		RunID:         tuple.RunID,
		Name:          "companion-me",
		RunKind:       vaultregistry.RunKindHunter,
		WorkReference: &vaultregistry.WorkReference{ID: "T18", Title: "Parent decisions", Path: filepath.ToSlash("tasks/18.md"), FeaturePath: filepath.ToSlash("feature.md"), Kind: "task"},
		Revision:      1,
		State:         vaultregistry.RunStateActive,
		Stage:         "awaiting-parent",
		InvokedAt:     "2026-07-28T00:00:00Z",
		UpdatedAt:     "2026-07-28T00:00:00Z",
		Observations: []vaultregistry.Observation{{
			ObservationID:  "participant-companion-start",
			Kind:           vaultregistry.KindRegisteredParticipant,
			State:          vaultregistry.StateActive,
			GoalID:         "run",
			Title:          "Driver registered",
			Summary:        "Driver registered.",
			ObservedAt:     "2026-07-28T00:00:00Z",
			CorrelationID:  tuple.RunID,
			Actor:          vaultregistry.Identity{Kind: "participant", ID: "participant-companion"},
			Source:         vaultregistry.Identity{Kind: "fixture", ID: "fixture"},
			RedactionClass: "internal",
			StartedAt:      ptr("2026-07-28T00:00:00Z"),
			Payload: vaultregistry.ObservationPayload{RegisteredParticipant: &vaultregistry.RegisteredParticipantPayload{
				ParticipantID: "participant-companion",
				Role:          "driver",
				AgentSession:  vaultregistry.AgentSession{Source: "pi", Kind: "session", Value: "session-companion"},
				Herdr:         herdr,
			}},
		}},
	}
}

func ptr(value string) *string { return &value }
