package atlas

import (
	"fmt"

	tea "github.com/charmbracelet/bubbletea"
)

type UIModel struct {
	run        Run
	selection  *Selection
	transition *Transition
	width      int
	height     int
}

func NewUIModel(run Run) UIModel {
	return UIModel{
		run:        run,
		selection:  NewSelection(run),
		transition: NewTransition(),
		width:      78,
		height:     17,
	}
}

func (m UIModel) Init() tea.Cmd {
	return nil
}

func (m UIModel) Update(message tea.Msg) (tea.Model, tea.Cmd) {
	switch message := message.(type) {
	case tea.WindowSizeMsg:
		m.width = message.Width
		m.height = message.Height
	case tea.KeyMsg:
		switch message.Type {
		case tea.KeyCtrlJ, tea.KeyDown, tea.KeyCtrlN:
			m.selection.Next()
		case tea.KeyCtrlK, tea.KeyUp, tea.KeyCtrlP:
			m.selection.Previous()
		case tea.KeyEnter:
			m.selection.Select()
		case tea.KeyRunes:
			if string(message.Runes) == "p" {
				m.transition.Toggle()
			}
		}
	}
	return m, nil
}

func (m UIModel) View() string {
	output := RenderCompact(m.run, m.width, m.height)
	index := m.selection.Selected()
	if index < 0 || index >= len(m.run.Goals) {
		return output
	}
	goal := m.run.Goals[index]
	return output + fmt.Sprintf("\nselected: %s %s", goal.ID, goal.Label)
}
