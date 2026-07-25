package atlas

import (
	"encoding/json"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func TestV06EquivalentNavigationKeysAndReturn(t *testing.T) {
	run := loadFixture(t)
	before, err := json.Marshal(run)
	if err != nil {
		t.Fatal(err)
	}

	next := []tea.KeyMsg{
		{Type: tea.KeyCtrlJ},
		{Type: tea.KeyDown},
		{Type: tea.KeyCtrlN},
	}
	for _, key := range next {
		model := NewUIModel(run)
		updated, _ := model.Update(key)
		got := updated.(UIModel)
		if got.selection.Cursor() != 4 {
			t.Errorf("%s cursor = %d, want 4", key.String(), got.selection.Cursor())
		}
	}

	previous := []tea.KeyMsg{
		{Type: tea.KeyCtrlK},
		{Type: tea.KeyUp},
		{Type: tea.KeyCtrlP},
	}
	for _, key := range previous {
		model := NewUIModel(run)
		updated, _ := model.Update(key)
		got := updated.(UIModel)
		if got.selection.Cursor() != 2 {
			t.Errorf("%s cursor = %d, want 2", key.String(), got.selection.Cursor())
		}
	}

	model := NewUIModel(run)
	updated, _ := model.Update(tea.KeyMsg{Type: tea.KeyDown})
	updated, _ = updated.(UIModel).Update(tea.KeyMsg{Type: tea.KeyEnter})
	selected := updated.(UIModel)
	if selected.selection.Selected() != 4 {
		t.Fatalf("Return selected %d, want 4", selected.selection.Selected())
	}
	if !strings.Contains(selected.View(), "V04 cleanup") {
		t.Fatalf("selected detail missing from view:\n%s", selected.View())
	}

	after, err := json.Marshal(run)
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != string(before) {
		t.Fatal("navigation mutated authoritative run data")
	}
}

func TestV05InteractiveAtlasUsesCompactAtShortHeightsAndFullAtNormalHeights(t *testing.T) {
	cases := []struct {
		width   int
		height  int
		compact bool
		want    []string
	}{
		{40, 10, true, []string{"Vault Hunter Atlas"}},
		{78, 17, true, []string{"Vault Hunter Atlas", "GOALS", "VERIFIER JOURNEY"}},
		{77, 46, false, []string{"Vault Hunter ·", "GOAL TIMELINE", "SELECTED VERIFIER JOURNEY"}},
		{120, 30, false, []string{"Vault Hunter ·", "GOAL TIMELINE"}},
	}
	for _, test := range cases {
		model := NewUIModel(loadFixture(t))
		updated, _ := model.Update(tea.WindowSizeMsg{Width: test.width, Height: test.height})
		current := updated.(UIModel)
		output := current.View()
		isCompact := strings.Contains(output, "Vault Hunter Atlas")
		if isCompact != test.compact {
			t.Fatalf("%dx%d compact = %t, want %t:\n%s", test.width, test.height, isCompact, test.compact, output)
		}
		lines := strings.Split(output, "\n")
		if len(lines) > test.height {
			t.Fatalf("%dx%d interactive Atlas used %d rows", test.width, test.height, len(lines))
		}
		for index, line := range lines {
			if columns := len([]rune(line)); columns > test.width {
				t.Fatalf("%dx%d interactive Atlas row %d used %d columns: %q", test.width, test.height, index, columns, line)
			}
		}
		for _, want := range test.want {
			if !strings.Contains(output, want) {
				t.Fatalf("%dx%d interactive Atlas missing %q:\n%s", test.width, test.height, want, output)
			}
		}
		if test.width == 78 && test.height == 17 &&
			(!strings.Contains(lines[2], "GOALS") || !strings.Contains(lines[2], "VERIFIER JOURNEY")) {
			t.Fatalf("78x17 interactive Atlas lost its compact two-column composition:\n%s", output)
		}
		next, _ := current.Update(tea.KeyMsg{Type: tea.KeyDown})
		selected, _ := next.(UIModel).Update(tea.KeyMsg{Type: tea.KeyEnter})
		if !strings.Contains(selected.(UIModel).View(), "selected: V04 cleanup") {
			t.Fatalf("%dx%d interactive navigation did not select V04", test.width, test.height)
		}
	}
}
