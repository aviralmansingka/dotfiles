package atlas

import (
	"strings"
	"testing"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

func TestPickerPreviewsStayBoundedAndTyped(t *testing.T) {
	run := vaultregistry.Run{
		RunID: "run-task", Revision: 3,
		Task:         vaultregistry.Task{ID: "T21", Title: "Add Run Journey", Path: "missing.md"},
		Participants: []vaultregistry.Participant{{Role: "Verifier Builder"}, {Role: "Convergence Engineer"}},
	}
	crew := PickerCrewPreview(run, 30, 12)
	for _, stage := range []string{"Parent", "Verifier", "Convergence", "Delivery", "Parent closure"} {
		if !strings.Contains(crew, stage) {
			t.Fatalf("crew preview missing %q: %q", stage, crew)
		}
	}
	if lines := strings.Split(crew, "\n"); len(lines) != 12 {
		t.Fatalf("crew preview has %d rows, want 12", len(lines))
	}

	tabs := PickerTabsPreview("Unregistered", []string{"driver", "notes"}, 23, 12)
	for _, want := range []string{"Herdr Workspace", "no registered", "driver", "notes"} {
		if !strings.Contains(tabs, want) {
			t.Fatalf("tabs preview missing %q: %q", want, tabs)
		}
	}
}
