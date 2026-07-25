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

func TestV05InteractiveAtlasAdaptsBetweenCompactAndFull(t *testing.T) {
	model := NewUIModel(loadFixture(t))

	compactModel, _ := model.Update(tea.WindowSizeMsg{Width: 78, Height: 17})
	compact := compactModel.(UIModel).View()
	if !strings.Contains(compact, "Vault Hunter Atlas") || strings.Contains(compact, "GOAL TIMELINE") {
		t.Fatalf("78x17 did not use the compact Atlas:\n%s", compact)
	}
	if lines := strings.Count(compact, "\n") + 1; lines > 17 {
		t.Fatalf("compact Atlas used %d rows, want at most 17", lines)
	}

	fullModel, _ := model.Update(tea.WindowSizeMsg{Width: 120, Height: 30})
	full := fullModel.(UIModel).View()
	if !strings.Contains(full, "GOAL TIMELINE") || !strings.Contains(full, "SELECTED VERIFIER JOURNEY") {
		t.Fatalf("120x30 did not use the full Operations Board:\n%s", full)
	}
	if lines := strings.Count(full, "\n") + 1; lines > 30 {
		t.Fatalf("full Atlas used %d rows, want at most 30", lines)
	}
}
