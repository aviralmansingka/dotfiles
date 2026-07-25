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
