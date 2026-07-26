package atlas

import (
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

func TestT02V01EveryPaneRowUsesFloorSplit(t *testing.T) {
	run := vaultregistry.Run{
		RunID: "run",
		Task:  vaultregistry.Task{ID: "T02", Title: "Atlas"},
		Lifecycle: []vaultregistry.Lifecycle{
			{
				GoalID:     "T02.V01",
				Kind:       "verifier",
				State:      "active",
				ObservedAt: "2026-07-26T12:05:00Z",
			},
		},
	}
	for _, size := range []struct {
		width, height int
	}{{100, 30}, {80, 24}} {
		lines := strings.Split(NewModel(run, size.width, size.height).View(), "\n")
		if got, want := len(lines), size.height-1; got != want {
			t.Fatalf("%dx%d: got %d rows, want %d", size.width, size.height, got, want)
		}
		for row, line := range lines[1:] {
			divider := "│"
			if row == 1 {
				divider = "┼"
			}
			left, _, ok := strings.Cut(line, divider)
			if !ok {
				t.Fatalf("%dx%d row %d: no %q divider: %q", size.width, size.height, row+2, divider, line)
			}
			want := size.width * 42 / 100
			if got := lipgloss.Width(left); got != want {
				t.Errorf("%dx%d row %d: divider follows %d left cells, want floor(%d*42/100) = %d", size.width, size.height, row+2, got, size.width, want)
			}
		}
	}
}

func TestT02V01ActiveVerifierRetainsVerifierGlyph(t *testing.T) {
	run := vaultregistry.Run{
		RunID: "run",
		Task:  vaultregistry.Task{ID: "T02", Title: "Atlas"},
		Lifecycle: []vaultregistry.Lifecycle{{
			GoalID:     "T02.V01",
			Kind:       "verifier",
			State:      "active",
			ObservedAt: "2026-07-26T12:05:00Z",
		}},
	}
	view := NewModel(run, 100, 30).View()
	for _, want := range []string{
		"▶ V T02.V01 · verifier · active",
		" V 12:05 verifier · active",
	} {
		if !strings.Contains(view, want) {
			t.Errorf("active verifier projection missing %q:\n%s", want, view)
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
