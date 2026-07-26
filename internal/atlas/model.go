package atlas

import (
	"fmt"
	"os"
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
	run           vaultregistry.Run
	goals         []goal
	selected      int
	width         int
	height        int
	detailVisible bool
	reducedMotion bool
	activityFrame int
}

func NewModel(run vaultregistry.Run, width, height int) Model {
	m := Model{
		run:           run,
		width:         width,
		height:        height,
		detailVisible: true,
		reducedMotion: os.Getenv("VAULT_HUNTER_REDUCED_MOTION") == "1",
	}
	m.goals = normalize(run)
	m.selected = initialSelection(m.goals)
	return m
}

// CompactView projects the same normalized goals and initial selection as the
// standalone Atlas into the two rows available in Sidekick's preview.
func CompactView(run vaultregistry.Run, participantID string, width, height int) string {
	goals := normalize(run)
	selected := initialSelection(goals)
	goalID, kind, state := "?", "?", "?"
	ordinal := "0/0"
	if len(goals) != 0 {
		goal := goals[selected]
		goalID, kind, state = value(goal.id), value(goal.kind), value(goal.state)
		ordinal = fmt.Sprintf("%d/%d", selected+1, len(goals))
	}
	role := "?"
	for _, participant := range run.Participants {
		if participant.ParticipantID == participantID {
			role = value(participant.Role)
		}
	}
	rows := []string{
		boundedFields(width, []string{"Run ", " · Goal " + ordinal + " ", ""}, []string{value(run.RunID), goalID}),
		boundedFields(width, []string{"Role ", " · ", " · ", " · ", ""}, []string{value(participantID), role, kind, state}),
	}
	if height < len(rows) {
		rows = rows[:max(height, 0)]
	}
	return strings.Join(rows, "\n")
}

func boundedFields(width int, separators, fields []string) string {
	var full strings.Builder
	for i, field := range fields {
		full.WriteString(separators[i])
		full.WriteString(field)
	}
	full.WriteString(separators[len(separators)-1])
	if lipgloss.Width(full.String()) <= width {
		return full.String()
	}
	fixed := 0
	for _, separator := range separators {
		fixed += lipgloss.Width(separator)
	}
	available := max(width-fixed, 0)
	var bounded strings.Builder
	for i, field := range fields {
		bounded.WriteString(separators[i])
		remaining := len(fields) - i
		limit := available / remaining
		part := truncate(field, limit)
		bounded.WriteString(part)
		available -= lipgloss.Width(part)
	}
	bounded.WriteString(separators[len(separators)-1])
	return truncate(bounded.String(), width)
}

type tickMsg struct{}

func tick() tea.Cmd {
	return tea.Tick(80*time.Millisecond, func(time.Time) tea.Msg { return tickMsg{} })
}

func (m Model) Init() tea.Cmd {
	if m.reducedMotion {
		return nil
	}
	return tick()
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
	case tea.KeyMsg:
		switch msg.String() {
		case "j", "down":
			if m.selected < len(m.goals)-1 {
				m.selected++
			}
		case "k", "up":
			if m.selected > 0 {
				m.selected--
			}
		case "enter":
			m.detailVisible = !m.detailVisible
		case "q", "esc", "ctrl+c":
			return m, tea.Quit
		}
	case tickMsg:
		if !m.reducedMotion {
			m.activityFrame = (m.activityFrame + 1) % 2
			return m, tick()
		}
	}
	return m, nil
}

func (m Model) View() string {
	if m.width < 80 || m.height < 24 {
		return truncate("terminal too small; minimum 80×24", m.width)
	}
	leftWidth := m.width * 42 / 100
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
		divider := "│"
		if i == 1 {
			divider = "┼"
		}
		leftLimit := leftWidth
		if i >= 2 {
			leftLimit = leftWidth - 1
		}
		rightLimit := rightWidth
		if i >= 2 {
			rightLimit = min(rightWidth, max(0, m.width-40))
			if rightLimit < rightWidth && strings.HasPrefix(strings.TrimSpace(r), "artifact:") {
				rightLimit--
			}
		}
		rows = append(rows, pad(truncate(l, leftLimit), leftWidth)+divider+truncate(r, rightLimit))
	}
	return strings.Join(rows, "\n")
}

// ExpandedView renders the read-only Operations Board snapshot. It deliberately
// shares the compact model's normalized goals and initial active selection.
func (m Model) ExpandedView() string {
	if m.width < 120 || m.height < 32 {
		return truncate("terminal too small; minimum 120×32", m.width)
	}

	type entry struct {
		at        string
		lifecycle *vaultregistry.Lifecycle
		evidence  *vaultregistry.Evidence
		order     int
	}
	var timeline []entry
	for i := range m.run.Lifecycle {
		timeline = append(timeline, entry{at: m.run.Lifecycle[i].ObservedAt, lifecycle: &m.run.Lifecycle[i], order: i})
	}
	for i := range m.run.Evidence {
		timeline = append(timeline, entry{at: m.run.Evidence[i].ObservedAt, evidence: &m.run.Evidence[i], order: i})
	}
	sort.SliceStable(timeline, func(i, j int) bool {
		if timeline[i].at != timeline[j].at {
			return timeline[i].at < timeline[j].at
		}
		if (timeline[i].lifecycle != nil) != (timeline[j].lifecycle != nil) {
			return timeline[i].lifecycle != nil
		}
		return timeline[i].order < timeline[j].order
	})
	formatEntry := func(item entry, showGoal bool) string {
		if item.lifecycle != nil {
			l := item.lifecycle
			goal := ""
			if showGoal {
				goal = value(l.GoalID) + " · "
			}
			line := fmt.Sprintf(" %s %s%s · %s", clock(l.ObservedAt), goal, value(l.Kind), value(l.State))
			if l.Detail != "" && (showGoal || m.detailVisible) {
				line += " · " + l.Detail
			}
			return line
		}
		e := item.evidence
		goal := ""
		if showGoal {
			goal = value(e.VerifierID) + " · "
		}
		line := fmt.Sprintf(" %s %sevidence · %s", clock(e.ObservedAt), goal, value(e.State))
		if e.ExitStatus != nil {
			line += fmt.Sprintf(" · exit %d", *e.ExitStatus)
		}
		if e.Detail != "" && (showGoal || m.detailVisible) {
			line += " · " + e.Detail
		}
		return line
	}

	timelineLines := make([]string, 0, len(timeline))
	for _, item := range timeline {
		timelineLines = append(timelineLines, formatEntry(item, true))
	}
	if len(timelineLines) == 0 {
		timelineLines = append(timelineLines, " no recorded activity")
	}
	if len(timelineLines) > 8 {
		timelineLines = timelineLines[len(timelineLines)-8:]
	}

	selectedID, selectedKind, selectedState := "?", "?", "?"
	var journeyLines []string
	var latestEvidence *vaultregistry.Evidence
	var participants []string
	if len(m.goals) != 0 {
		g := m.goals[m.selected]
		selectedID, selectedKind, selectedState = value(g.id), value(g.kind), value(g.state)
		var journey []entry
		for i := range g.lifecycle {
			journey = append(journey, entry{at: g.lifecycle[i].ObservedAt, lifecycle: &g.lifecycle[i], order: i})
		}
		for i := range g.evidence {
			journey = append(journey, entry{at: g.evidence[i].ObservedAt, evidence: &g.evidence[i], order: i})
			if latestEvidence == nil || g.evidence[i].ObservedAt >= latestEvidence.ObservedAt {
				latestEvidence = &g.evidence[i]
			}
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
		for _, item := range journey {
			journeyLines = append(journeyLines, formatEntry(item, false))
		}
		for _, p := range g.participants {
			line := fmt.Sprintf(" %s · %s", value(p.ParticipantID), value(p.Role))
			if p.Herdr != nil {
				line += fmt.Sprintf(" · Herdr %s/%s/%s/%s", p.Herdr.WorkspaceID, p.Herdr.TabID, p.Herdr.PaneID, p.Herdr.TerminalID)
			}
			if p.AgentSession != nil {
				line += fmt.Sprintf(" · agent session %s/%s/%s", p.AgentSession.Source, p.AgentSession.Kind, p.AgentSession.Value)
			}
			participants = append(participants, line)
		}
	}
	if len(journeyLines) == 0 {
		journeyLines = append(journeyLines, " no recorded journey")
	}
	if len(journeyLines) > 8 {
		journeyLines = journeyLines[len(journeyLines)-8:]
	}
	if len(participants) == 0 {
		participants = append(participants, " none recorded")
	}
	if len(participants) > 8 {
		participants = participants[:8]
	}

	evidenceLines := []string{"", "EVIDENCE"}
	if latestEvidence == nil {
		evidenceLines = append(evidenceLines, " none recorded")
	} else {
		e := latestEvidence
		evidenceLines[1] = fmt.Sprintf("EVIDENCE · %s · %s", value(e.ObservationID), value(e.ObservedAt))
		exit := "none recorded"
		if e.ExitStatus != nil {
			exit = fmt.Sprintf("%d", *e.ExitStatus)
		}
		evidenceLines = append(evidenceLines,
			fmt.Sprintf(" state: %s · exit %s", value(e.State), exit),
			" command: "+recorded(e.Command),
			" implementation tree: "+recorded(e.ImplementationTree),
			" artifact sha-256: "+recorded(e.ArtifactSHA256),
			" detail: "+recorded(e.Detail),
		)
	}

	fixedRows := 1 + 3 + 3 + len(evidenceLines) + 2
	for fixedRows+len(timelineLines)+len(journeyLines)+len(participants) > m.height && len(timelineLines) > 1 {
		timelineLines = timelineLines[1:]
	}
	for fixedRows+len(timelineLines)+len(journeyLines)+len(participants) > m.height && len(journeyLines) > 1 {
		journeyLines = journeyLines[1:]
	}
	for fixedRows+len(timelineLines)+len(journeyLines)+len(participants) > m.height && len(participants) > 1 {
		participants = participants[:len(participants)-1]
	}

	rows := []string{
		fmt.Sprintf("Run %s · Task %s · %s", value(m.run.RunID), value(m.run.Task.ID), value(m.run.Task.Title)),
		"", "TIMELINE", strings.Repeat("─", m.width),
	}
	rows = append(rows, timelineLines...)
	rows = append(rows, "", fmt.Sprintf("VERIFIER LEDGER · Goal %s · %s · %s", selectedID, selectedKind, selectedState), strings.Repeat("─", m.width))
	rows = append(rows, journeyLines...)
	rows = append(rows, evidenceLines...)
	rows = append(rows, "", "ASSOCIATED PARTICIPANTS")
	rows = append(rows, participants...)
	if len(rows) > m.height {
		rows = rows[:m.height]
	}
	for i, row := range rows {
		row = strings.Map(func(r rune) rune {
			if r < 32 || r == 127 {
				return ' '
			}
			return r
		}, row)
		rows[i] = truncate(row, m.width)
	}
	return strings.Join(rows, "\n")
}

func (m Model) panes(leftWidth, rightWidth int) ([]string, []string) {
	left := []string{"Task Goals", strings.Repeat("─", leftWidth)}
	if len(m.goals) == 0 {
		left = append(left, "  no recorded goals")
	} else {
		goalSlots := m.height - 5
		start := min(max(m.selected-goalSlots+1, 0), max(len(m.goals)-goalSlots, 0))
		end := min(start+goalSlots, len(m.goals))
		for i := start; i < end; i++ {
			g := m.goals[i]
			cursor := "  "
			if i == m.selected {
				cursor = "▶ "
			}
			left = append(left, fmt.Sprintf("%s%s %s · %s · %s", cursor, goalGlyph(g), g.id, value(g.kind), value(g.state)))
		}
	}

	right := []string{" Verifier Journey", strings.Repeat("─", rightWidth)}
	if len(m.goals) == 0 {
		right = append(right, " no recorded goals")
	} else {
		g := m.goals[m.selected]
		prefix := []string{fmt.Sprintf(" %s · %s · %s", g.id, value(g.kind), value(g.state)), ""}
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
		var journeyLines []string
		for _, entry := range journey {
			if entry.lifecycle != nil {
				l := entry.lifecycle
				journeyLines = append(journeyLines, fmt.Sprintf(" %s %s %s · %s", lifecycleGlyph(l.Kind, l.State), clock(l.ObservedAt), value(l.Kind), value(l.State)))
				if m.detailVisible && l.Detail != "" {
					journeyLines = append(journeyLines, "   "+l.Detail)
				}
			} else {
				e := entry.evidence
				exit := ""
				if e.ExitStatus != nil {
					exit = fmt.Sprintf(" · exit %d", *e.ExitStatus)
				}
				journeyLines = append(journeyLines, fmt.Sprintf(" ! %s evidence · %s%s", clock(e.ObservedAt), value(e.State), exit))
				if m.detailVisible && e.Detail != "" {
					journeyLines = append(journeyLines, "   "+e.Detail)
				}
			}
		}
		var context []string
		context = append(context, "", " Evidence")
		if len(g.evidence) == 0 {
			context = append(context, " none recorded")
		} else {
			e := g.evidence[len(g.evidence)-1]
			context = append(context,
				" state: "+value(e.State),
				" command: "+recorded(e.Command),
				" implementation tree: "+recorded(e.ImplementationTree),
				" artifact: "+recorded(e.ArtifactSHA256),
			)
		}
		context = append(context, "", " Registered Participants")
		if len(g.participants) == 0 {
			context = append(context, " none recorded")
		} else {
			for _, p := range g.participants {
				context = append(context, fmt.Sprintf(" %s · %s", p.ParticipantID, value(p.Role)))
			}
		}
		if m.detailVisible {
			context = append(context, "")
			if m.height == 24 {
				context = append(context, " Detail: "+recorded(g.detail))
			} else {
				context = append(context, " Detail", " "+recorded(g.detail))
			}
		}
		journeySlots := max(0, m.height-5-len(prefix)-len(context))
		if len(journeyLines) > journeySlots {
			journeyLines = journeyLines[len(journeyLines)-journeySlots:]
		}
		right = append(right, prefix...)
		right = append(right, journeyLines...)
		right = append(right, context...)
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
	activity := "·"
	if m.activityFrame != 0 {
		activity = "•"
	}
	right = append(right[:m.height-3], fmt.Sprintf(" static snapshot %s %d×%d", activity, m.width, m.height))
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
		previous, ok := participants[p.ParticipantID]
		if !ok {
			participantOrder = append(participantOrder, p.ParticipantID)
		}
		if !ok || p.ObservedAt >= previous.ObservedAt {
			participants[p.ParticipantID] = p
		}
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

func goalGlyph(g goal) string {
	if !knownKind(g.kind) || !knownState(g.state) {
		return "?"
	}
	if g.state == "blocked" {
		return "!"
	}
	if g.state == "failed" {
		return "×"
	}
	if g.kind == "checkpoint" {
		switch g.state {
		case "awaiting-human-evaluation":
			return "◇"
		case "resuming":
			return "↻"
		}
	}
	if g.state == "active" {
		switch g.kind {
		case "verifier":
			return "V"
		case "refactor":
			return "F"
		case "review":
			return "R"
		case "pull-request":
			return "P"
		case "landing":
			return "L"
		case "cleanup":
			return "C"
		}
	}
	return glyph(g.state)
}

func lifecycleGlyph(kind, state string) string {
	return goalGlyph(goal{kind: kind, state: state})
}

func knownKind(kind string) bool {
	switch kind {
	case "checkpoint", "verifier", "refactor", "review", "pull-request", "landing", "cleanup":
		return true
	default:
		return false
	}
}

func knownState(state string) bool {
	switch state {
	case "pending", "active", "awaiting-human-evaluation", "resuming", "blocked", "failed", "done":
		return true
	default:
		return false
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
		if width == 1 {
			return "…"
		}
		return ""
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
	return truncate(s, width)
}
