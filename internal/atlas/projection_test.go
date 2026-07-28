package atlas

import (
	"strings"
	"testing"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

func TestRunProjectionSanitizesRegistryStringsBeforeRendering(t *testing.T) {
	control := "\x1b[31mFIXTURE\a\nNEXT"
	run := vaultregistry.Run{
		RunID:     "run-" + control,
		InvokedAt: control,
		UpdatedAt: control,
		Task: vaultregistry.Task{
			ID: control, Title: "Task " + control, Path: control,
			FeaturePath: control, Kind: control,
		},
		Participants: []vaultregistry.Participant{{
			ParticipantID: "participant-" + control, ObservedAt: control,
			Role: "role-" + control, GoalID: "goal-" + control,
			Herdr: &vaultregistry.HerdrIdentity{
				WorkspaceID: control, TabID: control, PaneID: control, TerminalID: control,
			},
			AgentSession: &vaultregistry.AgentSession{Source: control, Kind: control, Value: control},
		}},
		Lifecycle: []vaultregistry.Lifecycle{{
			ObservationID: control, ObservedAt: control, Kind: control,
			GoalID: control, State: control, Detail: control,
		}},
		Evidence: []vaultregistry.Evidence{{
			ObservationID: control, ObservedAt: control, VerifierID: control,
			State: control, Command: control, ImplementationTree: control,
			ArtifactSHA256: control, Detail: control,
		}},
	}

	projected := sanitizeRunProjection(run)
	values := []string{
		projected.RunID, projected.InvokedAt, projected.UpdatedAt,
		projected.Task.ID, projected.Task.Title, projected.Task.Path, projected.Task.FeaturePath, projected.Task.Kind,
		projected.Participants[0].ParticipantID, projected.Participants[0].ObservedAt,
		projected.Participants[0].Role, projected.Participants[0].GoalID,
		projected.Participants[0].Herdr.WorkspaceID, projected.Participants[0].Herdr.TabID,
		projected.Participants[0].Herdr.PaneID, projected.Participants[0].Herdr.TerminalID,
		projected.Participants[0].AgentSession.Source, projected.Participants[0].AgentSession.Kind,
		projected.Participants[0].AgentSession.Value,
		projected.Lifecycle[0].ObservationID, projected.Lifecycle[0].ObservedAt,
		projected.Lifecycle[0].Kind, projected.Lifecycle[0].GoalID,
		projected.Lifecycle[0].State, projected.Lifecycle[0].Detail,
		projected.Evidence[0].ObservationID, projected.Evidence[0].ObservedAt,
		projected.Evidence[0].VerifierID, projected.Evidence[0].State,
		projected.Evidence[0].Command, projected.Evidence[0].ImplementationTree,
		projected.Evidence[0].ArtifactSHA256, projected.Evidence[0].Detail,
	}
	for i, value := range values {
		if strings.ContainsAny(value, "\x1b\a\n") {
			t.Errorf("projected string %d retains a Registry control: %q", i, value)
		}
		if !strings.Contains(value, `\u001b[31mFIXTURE\u0007\nNEXT`) {
			t.Errorf("projected string %d did not escape controls: %q", i, value)
		}
	}
	if !strings.ContainsAny(run.Task.Title, "\x1b\a\n") {
		t.Fatal("projection mutated the caller's Run")
	}
}

func TestAtlasViewsKeepRendererRowsWhileEscapingRegistryControls(t *testing.T) {
	run := vaultregistry.Run{
		RunID: "run-observe",
		Task:  vaultregistry.Task{ID: "T09", Title: "FIXTURE\x1b[31m-CONTROL\a\nMULTILINE"},
		Participants: []vaultregistry.Participant{{
			ParticipantID: "worker\nMULTILINE", Role: "verifier\a", GoalID: "T09.V04",
		}},
		Lifecycle: []vaultregistry.Lifecycle{{
			ObservedAt: "2026-07-26T12:05:00Z", GoalID: "T09.V04",
			Kind: "verifier", State: "active", Detail: "life\nMULTILINE\x1b",
		}},
		Evidence: []vaultregistry.Evidence{{
			ObservedAt: "2026-07-26T12:06:00Z", VerifierID: "T09.V04",
			State: "green\a", Command: "verify\nMULTILINE", Detail: "evidence\x1bDETAIL",
		}},
	}

	view := NewModel(run, 120, 35).View()
	if strings.ContainsAny(view, "\x1b\a") {
		t.Fatalf("Atlas frame retained Registry controls:\n%s", view)
	}
	if got, want := len(strings.Split(view, "\n")), 34; got != want {
		t.Fatalf("Atlas rows = %d, want renderer-bounded %d", got, want)
	}
	for _, want := range []string{`FIXTURE\u001b[31m-CONTROL\u0007\nMULTILINE`, `life\nMULTILINE\u001b`, `verify\nMULTILINE`, `worker\nMULTILINE`} {
		if !strings.Contains(view, want) {
			t.Errorf("Atlas frame missing escaped Registry value %q:\n%s", want, view)
		}
	}

	compact := CompactView(run, "worker\nMULTILINE", 100, 2)
	if strings.ContainsAny(compact, "\x1b\a") || len(strings.Split(compact, "\n")) != 2 {
		t.Fatalf("compact projection did not preserve its two renderer rows: %q", compact)
	}
	if !strings.Contains(compact, `worker\nMULTILINE`) || !strings.Contains(compact, `verifier\u0007`) {
		t.Fatalf("compact projection missing escaped participant fields: %q", compact)
	}
}
