package atlas

import (
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

func TestCompactView(t *testing.T) {
	run := vaultregistry.Run{
		RunID: "run-compact",
		Participants: []vaultregistry.Participant{{
			ParticipantID: "worker", Role: "implementer",
		}},
		Lifecycle: []vaultregistry.Lifecycle{
			{GoalID: "T04.V01", Kind: "verifier", State: "active", ObservedAt: "2026-07-26T12:00:00Z"},
			{GoalID: "T04.V02", Kind: "verifier", State: "pending", ObservedAt: "2026-07-26T12:01:00Z"},
		},
	}

	frame := CompactView(run, "worker", 76, 2)
	want := strings.Join([]string{
		"Run run-compact · Goal 1/2 T04.V01",
		"Role worker · implementer · verifier · active",
	}, "\n")
	if frame != want {
		t.Fatalf("CompactView = %q, want %q", frame, want)
	}
	for row, line := range strings.Split(frame, "\n") {
		if width := lipgloss.Width(line); width > 76 {
			t.Fatalf("row %d width = %d, want at most 76", row+1, width)
		}
	}
}
