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

func TestV05InteractiveAtlasKeepsTheFullProfileAtEverySize(t *testing.T) {
	model := NewUIModel(loadFixture(t))

	for _, size := range [][2]int{{78, 17}, {120, 30}} {
		updated, _ := model.Update(tea.WindowSizeMsg{Width: size[0], Height: size[1]})
		output := updated.(UIModel).View()
		if !strings.Contains(output, "Vault Hunter ·") ||
			!strings.Contains(output, "GOAL TIMELINE") ||
			strings.Contains(output, "Vault Hunter Atlas") {
			t.Fatalf("%dx%d interactive run did not use the full Operations Board:\n%s", size[0], size[1], output)
		}
		if lines := strings.Count(output, "\n") + 1; lines > size[1] {
			t.Fatalf("%dx%d interactive Atlas used %d rows", size[0], size[1], lines)
		}
	}
}
