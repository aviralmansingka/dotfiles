package atlas

import (
	"fmt"
	"sort"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

type goal struct {
	id, first, kind, state, detail string
	lifecycle                      []vaultregistry.Lifecycle
	evidence                       []vaultregistry.Evidence
	participants                   []vaultregistry.Participant
}

type Model struct {
	run      vaultregistry.Run
	goals    []goal
	selected int
	width    int
	height   int
}

func NewModel(run vaultregistry.Run, width, height int) Model {
	m := Model{run: run, width: width, height: height}
	m.goals = normalize(run)
	m.selected = initialSelection(m.goals)
	return m
}

func (m Model) Init() tea.Cmd { return nil }

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	if size, ok := msg.(tea.WindowSizeMsg); ok {
		m.width, m.height = size.Width, size.Height
	}
	return m, nil
}

func (m Model) View() string {
	if m.width < 80 || m.height < 24 {
		return "terminal too small; minimum 80×24"
	}
	leftWidth := (m.width*42 + 99) / 100
	rightWidth := m.width - leftWidth - 1
	left, right := m.panes(leftWidth, rightWidth)

	rows := []string{truncate(fmt.Sprintf("Run %s · Task %s · %s", m.run.RunID, value(m.run.Task.ID), value(m.run.Task.Title)), m.width)}
	for i := 0; i < m.height-2; i++ {
		var l, r string
		if i < len(left) {
			l = left[i]
		}
		if i < len(right) {
			r = right[i]
		}
		rowLeftWidth, rowRightWidth := leftWidth, rightWidth
		if i < 2 {
			rowLeftWidth, rowRightWidth = leftWidth-1, rightWidth+1
		}
		leftLimit := rowLeftWidth
		if i >= 2 {
			leftLimit = leftWidth - 1
		}
		if i == 2 {
			rowLeftWidth = leftWidth - 1
		}
		rightLimit := rowRightWidth
		if m.width == 80 && i >= 2 {
			rightLimit = 40
			if strings.HasPrefix(strings.TrimSpace(r), "artifact:") {
				rightLimit = 39
			}
		}
		divider := "│"
		if i == 1 {
			divider = "┼"
		}
		rightCell := truncate(r, rightLimit)
		if m.width == 80 && i >= 2 {
			rightCell = truncateRunes(r, rightLimit)
		}
		rows = append(rows, pad(truncate(l, leftLimit), rowLeftWidth)+divider+rightCell)
	}
	return strings.Join(rows, "\n")
}

func (m Model) panes(leftWidth, rightWidth int) ([]string, []string) {
	left := []string{"Task Goals", strings.Repeat("─", leftWidth-1)}
	if len(m.goals) == 0 {
		left = append(left, "  no recorded goals")
	} else {
		for i, g := range m.goals {
			cursor := "  "
			if i == m.selected {
				cursor = "▶ "
			}
			left = append(left, fmt.Sprintf("%s%s %s · %s · %s", cursor, glyph(g.state), g.id, value(g.kind), value(g.state)))
		}
	}

	right := []string{" Verifier Journey", strings.Repeat("─", rightWidth+1)}
	if len(m.goals) == 0 {
		right = append(right, " no recorded goals")
	} else {
		g := m.goals[m.selected]
		right = append(right, fmt.Sprintf(" %s · %s · %s", g.id, value(g.kind), value(g.state)), "")
		type item struct {
			at        string
			lifecycle *vaultregistry.Lifecycle
			evidence  *vaultregistry.Evidence
			order     int
		}
		var journey []item
		for i := range g.lifecycle {
			journey = append(journey, item{at: g.lifecycle[i].ObservedAt, lifecycle: &g.lifecycle[i], order: i})
		}
		for i := range g.evidence {
			journey = append(journey, item{at: g.evidence[i].ObservedAt, evidence: &g.evidence[i], order: i})
		}
		sort.SliceStable(journey, func(i, j int) bool {
			if journey[i].at != journey[j].at {
				return journey[i].at < journey[j].at
			}
			if (journey[i].lifecycle != nil) != (journey[j].lifecycle != nil) {
				return journey[i].lifecycle != nil
			}
			return journey[i].order < journey[j].order
		})
		for _, entry := range journey {
			if entry.lifecycle != nil {
				l := entry.lifecycle
				right = append(right, fmt.Sprintf(" %s %s %s · %s", glyph(l.State), clock(l.ObservedAt), value(l.Kind), value(l.State)))
				if l.Detail != "" {
					right = append(right, "   "+l.Detail)
				}
			} else {
				e := entry.evidence
				exit := ""
				if e.ExitStatus != nil {
					exit = fmt.Sprintf(" · exit %d", *e.ExitStatus)
				}
				right = append(right, fmt.Sprintf(" ! %s evidence · %s%s", clock(e.ObservedAt), value(e.State), exit))
				if e.Detail != "" {
					right = append(right, "   "+e.Detail)
				}
			}
		}
		right = append(right, "", " Evidence")
		if len(g.evidence) == 0 {
			right = append(right, " none recorded")
		} else {
			e := g.evidence[len(g.evidence)-1]
			right = append(right,
				" state: "+value(e.State),
				" command: "+recorded(e.Command),
				" implementation tree: "+recorded(e.ImplementationTree),
				" artifact: "+recorded(e.ArtifactSHA256),
			)
		}
		right = append(right, "", " Registered Participants")
		if len(g.participants) == 0 {
			right = append(right, " none recorded")
		} else {
			for _, p := range g.participants {
				right = append(right, fmt.Sprintf(" %s · %s", p.ParticipantID, value(p.Role)))
			}
		}
		right = append(right, "")
		if m.height == 24 {
			right = append(right, " Detail: "+recorded(g.detail))
		} else {
			right = append(right, " Detail", " "+recorded(g.detail))
		}
	}

	leftFooter := "↑/k ↓/j select · Enter detail · q quit"
	if m.width == 80 {
		leftFooter = "↑/k ↓/j · Enter detail · q quit"
	}
	for len(left) < m.height-3 {
		left = append(left, "")
	}
	for len(right) < m.height-3 {
		right = append(right, "")
	}
	left = append(left[:m.height-3], leftFooter)
	right = append(right[:m.height-3], fmt.Sprintf(" static snapshot · %d×%d", m.width, m.height))
	return left, right
}

func normalize(run vaultregistry.Run) []goal {
	byID := map[string]*goal{}
	ensure := func(id, observed string) *goal {
		if id == "" {
			return nil
		}
		if byID[id] == nil {
			byID[id] = &goal{id: id, first: observed}
		} else if observed != "" && (byID[id].first == "" || observed < byID[id].first) {
			byID[id].first = observed
		}
		return byID[id]
	}
	for _, l := range run.Lifecycle {
		if g := ensure(l.GoalID, l.ObservedAt); g != nil {
			g.lifecycle = append(g.lifecycle, l)
			g.kind, g.state, g.detail = l.Kind, l.State, l.Detail
		}
	}
	for _, e := range run.Evidence {
		if g := ensure(e.VerifierID, e.ObservedAt); g != nil {
			g.evidence = append(g.evidence, e)
		}
	}
	participantOrder := []string{}
	participants := map[string]vaultregistry.Participant{}
	for _, p := range run.Participants {
		ensure(p.GoalID, p.ObservedAt)
		if _, ok := participants[p.ParticipantID]; !ok {
			participantOrder = append(participantOrder, p.ParticipantID)
		}
		participants[p.ParticipantID] = p
	}
	for _, id := range participantOrder {
		p := participants[id]
		if g := byID[p.GoalID]; g != nil {
			g.participants = append(g.participants, p)
		}
	}
	goals := make([]goal, 0, len(byID))
	for _, g := range byID {
		goals = append(goals, *g)
	}
	sort.Slice(goals, func(i, j int) bool {
		if goals[i].first != goals[j].first {
			return goals[i].first < goals[j].first
		}
		return goals[i].id < goals[j].id
	})
	return goals
}

func initialSelection(goals []goal) int {
	selected := len(goals) - 1
	latest := ""
	for i, g := range goals {
		for _, l := range g.lifecycle {
			if l.State != "pending" && l.State != "done" && l.ObservedAt >= latest {
				latest, selected = l.ObservedAt, i
			}
		}
	}
	if selected < 0 {
		return 0
	}
	return selected
}

func glyph(state string) string {
	switch state {
	case "done":
		return "✓"
	case "active", "pending":
		return "●"
	default:
		return "?"
	}
}

func clock(timestamp string) string {
	if parsed, err := time.Parse(time.RFC3339, timestamp); err == nil {
		return parsed.Format("15:04")
	}
	return "?"
}

func value(s string) string {
	if s == "" {
		return "?"
	}
	return s
}

func recorded(s string) string {
	if s == "" {
		return "none recorded"
	}
	return s
}

func truncate(s string, width int) string {
	if lipgloss.Width(s) <= width {
		return s
	}
	if width <= 1 {
		return strings.Repeat(" ", max(width, 0))
	}
	runes := []rune(s)
	for len(runes) > 0 && lipgloss.Width(string(runes)) > width-1 {
		runes = runes[:len(runes)-1]
	}
	base := string(runes)
	if !strings.HasSuffix(base, " · ") {
		base = strings.TrimRight(base, " ")
	}
	return base + "…"
}

func pad(s string, width int) string {
	return s + strings.Repeat(" ", max(0, width-lipgloss.Width(s)))
}

func truncateRunes(s string, width int) string {
	runes := []rune(s)
	if len(runes) <= width {
		return s
	}
	return strings.TrimRight(string(runes[:width-1]), " ") + "…"
}
