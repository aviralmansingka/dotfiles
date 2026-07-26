package atlas

import (
	"fmt"

	tea "github.com/charmbracelet/bubbletea"
)

type UIModel struct {
	run        Run
	live       *LiveState
	selection  *Selection
	transition *Transition
	width      int
	height     int
}

func NewUIModel(run Run) UIModel {
	return NewLiveUIModel(run, nil)
}

func NewLiveUIModel(run Run, live *LiveState) UIModel {
	return UIModel{
		run:        run,
		live:       live,
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
		case tea.KeyCtrlC, tea.KeyEsc:
			return m, tea.Quit
		case tea.KeyCtrlJ, tea.KeyDown, tea.KeyCtrlN:
			m.selection.Next()
		case tea.KeyCtrlK, tea.KeyUp, tea.KeyCtrlP:
			m.selection.Previous()
		case tea.KeyEnter:
			m.selection.Select()
		case tea.KeyRunes:
			switch string(message.Runes) {
			case "q":
				return m, tea.Quit
			case "p":
				m.transition.Toggle()
			}
		}
	}
	return m, nil
}

func (m UIModel) View() string {
	height := max(m.height-1, 1)
	var output string
	if m.height <= 17 {
		output = RenderCompactLive(m.run, m.live, m.width, height)
	} else {
		output = RenderExpandedLive(m.run, m.live, m.width, height)
	}
	index := m.selection.Selected()
	if index < 0 || index >= len(m.run.Goals) {
		return output
	}
	goal := m.run.Goals[index]
	return output + "\n" + truncate(fmt.Sprintf("selected: %s %s", goal.ID, goal.Label), m.width)
}
