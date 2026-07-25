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

type RunUpdatedMsg struct {
	Run Run
}

type transitionTickMsg struct{}

func transitionTick() tea.Msg {
	return transitionTickMsg{}
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
	case RunUpdatedMsg:
		selectedKey := m.selection.Key(m.run, m.selection.Selected())
		m.run = message.Run
		m.selection.Reconcile(message.Run, selectedKey)
	case transitionTickMsg:
		frame := m.transition.Advance()
		updated, err := ApplyFrame(m.run, frame)
		if err == nil {
			m.run = updated
		}
		if frame == FrameGreen {
			m.transition.Stop()
			return m, nil
		}
		return m, transitionTick
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
				if m.transition.Playing() {
					return m, transitionTick
				}
			}
		}
	}
	return m, nil
}

func (m UIModel) View() string {
	height := max(m.height-1, 1)
	controls := "j/k select · Enter detail · p play"
	if m.transition.Playing() {
		controls = "j/k select · Enter detail · p pause"
	}
	detail := m.selection.Detail(m.run)
	var output string
	if m.height <= 17 {
		var participant *Participant
		if m.live != nil {
			participant = activeParticipant(m.run)
		}
		output = renderCompactDetail(m.run, participant, m.live, detail, controls, m.width, height)
	} else {
		output = renderExpandedDetail(m.run, m.live, detail, controls, m.width, height)
	}
	index := m.selection.Cursor()
	if m.selection.Committed() {
		index = m.selection.Selected()
	}
	label := m.selection.Label(m.run, index)
	if label == "" {
		return output
	}
	state := "cursor"
	if m.selection.Committed() {
		state = "selected"
	}
	return output + "\n" + truncate(fmt.Sprintf("▌ %s: %s", state, label), m.width)
}
