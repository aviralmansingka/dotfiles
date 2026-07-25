package atlas

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func TestV02InteractiveLayoutsPresentNavigationAndPlayback(t *testing.T) {
	for _, size := range [][2]int{{78, 17}, {120, 30}} {
		model := NewUIModel(loadFixture(t))
		updated, _ := model.Update(tea.WindowSizeMsg{Width: size[0], Height: size[1]})
		output := strings.ToLower(updated.(UIModel).View())
		for _, control := range []string{"select", "enter", "play"} {
			if !strings.Contains(output, control) {
				t.Errorf("%dx%d interactive layout does not present %q:\n%s", size[0], size[1], control, output)
			}
		}
	}
}

func TestV03UIPlayTickRendersDeterministicFrames(t *testing.T) {
	var model tea.Model = NewUIModel(loadFixture(t))
	model, tick := model.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("p")})
	if tick == nil {
		t.Fatal("play did not schedule a deterministic transition tick")
	}
	for _, want := range []string{"EDIT", "TEST", "GREEN"} {
		model, tick = model.Update(tick())
		if !strings.Contains(model.View(), want) {
			t.Fatalf("tick did not render %s through the interactive model:\n%s", want, model.View())
		}
		if tick == nil && want != "GREEN" {
			t.Fatalf("%s did not schedule the next deterministic tick", want)
		}
	}
}

func TestV06ReturnChangesRenderedDetail(t *testing.T) {
	model := NewUIModel(loadFixture(t))
	updated, _ := model.Update(tea.KeyMsg{Type: tea.KeyDown})
	updated, _ = updated.(UIModel).Update(tea.KeyMsg{Type: tea.KeyEnter})
	output := updated.(UIModel).View()
	if !strings.Contains(output, "V04 · VERIFIER JOURNEY") {
		t.Fatalf("Return did not make the highlighted goal authoritative for detail:\n%s", output)
	}
	if strings.Contains(output, "V03 · VERIFIER JOURNEY") {
		t.Fatalf("Return left the active goal in the selected detail panel:\n%s", output)
	}
}
