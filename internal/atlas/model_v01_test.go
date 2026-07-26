package atlas

import (
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

func TestT02V01PaneSplitUsesFloor(t *testing.T) {
	run := vaultregistry.Run{
		RunID: "run",
		Task:  vaultregistry.Task{ID: "T02", Title: "Atlas"},
		Lifecycle: []vaultregistry.Lifecycle{
			{GoalID: "V01", Kind: "verifier", State: "active"},
		},
	}
	for _, width := range []int{80, 83} {
		line := strings.Split(NewModel(run, width, 24).View(), "\n")[4]
		left, _, ok := strings.Cut(line, "│")
		if !ok {
			t.Fatalf("width %d: content row has no divider: %q", width, line)
		}
		want := width * 42 / 100
		if got := lipgloss.Width(left); got != want {
			t.Errorf("width %d: divider follows %d left cells, want floor(%d*42/100) = %d", width, got, width, want)
		}
	}
}

func TestT02V01TruncationUsesDisplayCells(t *testing.T) {
	for _, test := range []struct {
		name  string
		input string
		width int
	}{
		{name: "double width", input: strings.Repeat("界", 40), width: 40},
		{name: "combining", input: strings.Repeat("e\u0301", 40), width: 40},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := truncateRunes(test.input, test.width)
			if width := lipgloss.Width(got); width > test.width {
				t.Fatalf("display width = %d, want at most %d: %q", width, test.width, got)
			}
			if lipgloss.Width(test.input) <= test.width && got != test.input {
				t.Fatalf("display-bounded input was truncated: got %q, want %q", got, test.input)
			}
		})
	}
}
