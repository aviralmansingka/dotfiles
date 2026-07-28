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

type orderedEntry struct {
	at        string
	lifecycle *vaultregistry.Lifecycle
	evidence  *vaultregistry.Evidence
	order     int
}

func orderedEntries(lifecycle []vaultregistry.Lifecycle, evidence []vaultregistry.Evidence, chronological bool) []orderedEntry {
	entries := make([]orderedEntry, 0, len(lifecycle)+len(evidence))
	for i := range lifecycle {
		entries = append(entries, orderedEntry{at: lifecycle[i].ObservedAt, lifecycle: &lifecycle[i], order: i})
	}
	for i := range evidence {
		entries = append(entries, orderedEntry{at: evidence[i].ObservedAt, evidence: &evidence[i], order: i})
	}
	sort.SliceStable(entries, func(i, j int) bool {
		if chronological {
			left, leftOK := parsedObservation(entries[i].at)
			right, rightOK := parsedObservation(entries[j].at)
			return leftOK && rightOK && left.Before(right)
		}
		if entries[i].at != entries[j].at {
			return entries[i].at < entries[j].at
		}
		if (entries[i].lifecycle != nil) != (entries[j].lifecycle != nil) {
			return entries[i].lifecycle != nil
		}
		return entries[i].order < entries[j].order
	})
	return entries
}

func parsedObservation(observedAt string) (time.Time, bool) {
	parsed, err := time.Parse(time.RFC3339Nano, observedAt)
	return parsed, err == nil
}

func laterObservation(candidate, current string) bool {
	candidateTime, candidateOK := parsedObservation(candidate)
	currentTime, currentOK := parsedObservation(current)
	if !candidateOK || !currentOK {
		return true
	}
	return !candidateTime.Before(currentTime)
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
	expanded      bool
}

func NewModel(run vaultregistry.Run, width, height int) Model {
	run = sanitizeRunProjection(run)
	m := Model{
		run:           run,
		width:         width,
		height:        height,
		detailVisible: true,
		reducedMotion: os.Getenv("VAULT_HUNTER_REDUCED_MOTION") == "1",
	}
	m.goals = normalize(run, false)
	m.selected = initialSelection(m.goals)
	return m
}

func NewExpandedModel(run vaultregistry.Run, width, height int) Model {
	m := NewModel(run, width, height)
	m.goals = normalize(run, true)
	m.selected = initialSelection(m.goals)
	m.expanded = true
	return m
}

// CompactView projects the same normalized goals and initial selection as the
// standalone Atlas into the two rows available in Sidekick's preview.
func CompactView(run vaultregistry.Run, participantID string, width, height int) string {
	run = sanitizeRunProjection(run)
	participantID = sanitizeRegistryString(participantID)
	goals := normalize(run, false)
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
	if m.expanded {
		return m.ExpandedView()
	}
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
// shares the compact model's normalized goals and active selection.
func (m Model) ExpandedView() string {
	if m.width < 120 || m.height < 32 {
		return truncate("terminal too small; minimum 120×32", m.width)
	}

	selectedID, selectedKind, selectedState := "?", "?", "?"
	var selected *goal
	if len(m.goals) != 0 {
		selected = &m.goals[m.selected]
		selectedID = value(selected.id)
		selectedKind = value(selected.kind)
		selectedState = value(selected.state)
	}

	leftWidth := m.width * 16 / 100
	middleWidth := m.width * 52 / 100
	evidenceWidth := m.width - leftWidth - 1 - middleWidth - 1
	bodyRows := m.height - 4

	allEntries := orderedEntries(m.run.Lifecycle, m.run.Evidence, true)
	timelineEntries := timelineWindow(allEntries, selectedID, 8)
	timelineLines := make([]string, 0, len(timelineEntries))
	for _, entry := range timelineEntries {
		timelineLines = append(timelineLines, timelineEntryLine(entry))
	}
	if len(timelineLines) == 0 {
		timelineLines = append(timelineLines, " no recorded activity")
	}

	var ledgerLines []string
	var latestEvidence *vaultregistry.Evidence
	if selected == nil {
		ledgerLines = append(ledgerLines, " no recorded goals")
	} else {
		journeyLines := []string{"SELECTED JOURNEY"}
		journey := orderedEntries(selected.lifecycle, selected.evidence, true)
		if len(journey) == 0 {
			journeyLines = append(journeyLines, " no recorded journey")
		}
		for _, entry := range journey {
			journeyLines = append(journeyLines, journeyEntryLines(entry, m.detailVisible)...)
		}
		for i := range selected.evidence {
			evidence := &selected.evidence[i]
			if latestEvidence == nil || laterObservation(evidence.ObservedAt, latestEvidence.ObservedAt) {
				latestEvidence = evidence
			}
		}

		var currentLines []string
		if latestEvidence != nil {
			currentLines = append(currentLines, "", "LATEST EVIDENCE COMMAND", " "+recorded(latestEvidence.Command))
		}
		if len(selected.participants) != 0 {
			currentLines = append(currentLines, "", "ASSOCIATED PARTICIPANTS")
			for _, participant := range selected.participants {
				currentLines = append(currentLines, fmt.Sprintf(" %s · %s", value(participant.ParticipantID), value(participant.Role)))
				var identities []string
				if participant.Herdr != nil {
					identities = append(identities, fmt.Sprintf("Herdr %s/%s/%s/%s", participant.Herdr.WorkspaceID, participant.Herdr.TabID, participant.Herdr.PaneID, participant.Herdr.TerminalID))
				}
				if participant.AgentSession != nil {
					identities = append(identities, fmt.Sprintf("agent session %s/%s/%s", participant.AgentSession.Source, participant.AgentSession.Kind, participant.AgentSession.Value))
				}
				if len(identities) != 0 {
					currentLines = append(currentLines, "  "+strings.Join(identities, " · "))
				}
			}
		}

		var recordedLines []string
		for _, entry := range allEntries {
			if entryGoalID(entry) != selected.id {
				recordedLines = append(recordedLines, fullEntryLine(entry))
			}
		}
		if len(recordedLines) != 0 {
			recordedLines = append([]string{"", "RECORDED LIFECYCLE"}, recordedLines...)
		}
		ledgerLines = boundedLedger(journeyLines, currentLines, recordedLines, bodyRows)
	}

	evidenceLines := []string{"EVIDENCE"}
	if latestEvidence == nil {
		evidenceLines = append(evidenceLines, " none recorded")
	} else {
		evidenceLines = append(evidenceLines,
			" "+value(latestEvidence.ObservationID),
			" "+value(latestEvidence.ObservedAt),
		)
		exit := "none recorded"
		if latestEvidence.ExitStatus != nil {
			exit = fmt.Sprintf("%d", *latestEvidence.ExitStatus)
		}
		evidenceLines = append(evidenceLines, fmt.Sprintf(" state: %s · exit %s", value(latestEvidence.State), exit))
		evidenceLines = append(evidenceLines, wrappedField("command", recorded(latestEvidence.Command), evidenceWidth)...)
		evidenceLines = append(evidenceLines, wrappedField("implementation tree", recorded(latestEvidence.ImplementationTree), evidenceWidth)...)
		evidenceLines = append(evidenceLines, wrappedField("artifact sha-256", recorded(latestEvidence.ArtifactSHA256), evidenceWidth)...)
		evidenceLines = append(evidenceLines, wrappedField("detail", recorded(latestEvidence.Detail), evidenceWidth)...)
	}

	heading := columnRow("TIMELINE", fmt.Sprintf("VERIFIER LEDGER · Goal %s · %s · %s", selectedID, selectedKind, selectedState), "EVIDENCE", leftWidth, middleWidth, evidenceWidth)
	rows := []string{
		truncate(clean(fmt.Sprintf("Run %s · Task %s · %s", value(m.run.RunID), value(m.run.Task.ID), value(m.run.Task.Title))), m.width),
		truncate(clean(fmt.Sprintf("Selected Goal %s · %s · %s", selectedID, selectedKind, selectedState)), m.width),
		heading,
	}
	for row := 0; row < bodyRows; row++ {
		var timeline, ledger, evidence string
		if row < len(timelineLines) {
			timeline = timelineLines[row]
		}
		if row < len(ledgerLines) {
			ledger = ledgerLines[row]
		}
		if row < len(evidenceLines) {
			evidence = evidenceLines[row]
		}
		rows = append(rows, columnRow(timeline, ledger, evidence, leftWidth, middleWidth, evidenceWidth))
	}
	rows = append(rows, truncate(fmt.Sprintf("↑/k ↓/j select · Enter detail · q quit · %d×%d", m.width, m.height), m.width))
	return strings.Join(rows, "\n")
}

func boundedLedger(journey, current, recorded []string, limit int) []string {
	all := append(append(append([]string(nil), journey...), current...), recorded...)
	if len(all) <= limit {
		return all
	}

	heading := journey[:min(1, len(journey))]
	journey = journey[len(heading):]
	available := max(limit-len(heading)-len(current), 0)
	if len(journey) > available {
		journey = journey[len(journey)-available:]
	}
	lines := append(append(append([]string(nil), heading...), journey...), current...)
	if len(lines) > limit {
		return lines[:limit]
	}
	return append(lines, recorded[:min(len(recorded), limit-len(lines))]...)
}

func timelineWindow(entries []orderedEntry, selectedID string, limit int) []orderedEntry {
	if len(entries) <= limit {
		return entries
	}
	window := append([]orderedEntry(nil), entries[len(entries)-limit:]...)
	for _, entry := range window {
		if entryGoalID(entry) == selectedID {
			return window
		}
	}
	for i := len(entries) - limit - 1; i >= 0; i-- {
		if entryGoalID(entries[i]) == selectedID {
			return append([]orderedEntry{entries[i]}, window[1:]...)
		}
	}
	return window
}

func entryGoalID(entry orderedEntry) string {
	if entry.lifecycle != nil {
		return entry.lifecycle.GoalID
	}
	return entry.evidence.VerifierID
}

func timelineEntryLine(entry orderedEntry) string {
	if entry.lifecycle != nil {
		return fmt.Sprintf(" %s %s · %s · %s", value(entry.lifecycle.GoalID), clock(entry.at), value(entry.lifecycle.Kind), value(entry.lifecycle.State))
	}
	return fmt.Sprintf(" %s %s · evidence · %s", value(entry.evidence.VerifierID), clock(entry.at), value(entry.evidence.State))
}

func fullEntryLine(entry orderedEntry) string {
	line := timelineEntryLine(entry)
	if entry.lifecycle != nil && entry.lifecycle.Detail != "" {
		line += " · " + entry.lifecycle.Detail
	}
	if entry.evidence != nil {
		if entry.evidence.ExitStatus != nil {
			line += fmt.Sprintf(" · exit %d", *entry.evidence.ExitStatus)
		}
		if entry.evidence.Detail != "" {
			line += " · " + entry.evidence.Detail
		}
	}
	return line
}

func journeyEntryLines(entry orderedEntry, detailVisible bool) []string {
	if entry.lifecycle != nil {
		lines := []string{fmt.Sprintf(" %s %s · %s", clock(entry.at), value(entry.lifecycle.Kind), value(entry.lifecycle.State))}
		if detailVisible && entry.lifecycle.Detail != "" {
			lines = append(lines, " detail: "+entry.lifecycle.Detail)
		}
		return lines
	}
	line := fmt.Sprintf(" %s evidence · %s", clock(entry.at), value(entry.evidence.State))
	if entry.evidence.ExitStatus != nil {
		line += fmt.Sprintf(" · exit %d", *entry.evidence.ExitStatus)
	}
	lines := []string{line}
	if detailVisible && entry.evidence.Detail != "" {
		lines = append(lines, " detail: "+entry.evidence.Detail)
	}
	return lines
}

func columnRow(left, middle, right string, leftWidth, middleWidth, rightWidth int) string {
	left = pad(truncate(clean(left), leftWidth), leftWidth)
	middle = pad(truncate(clean(middle), middleWidth), middleWidth)
	right = pad(truncate(clean(right), rightWidth), rightWidth)
	return left + "│" + middle + "│" + right
}

func wrappedField(label, field string, width int) []string {
	prefix := " " + label + ": "
	field = clean(field)
	if lipgloss.Width(prefix+field) <= width {
		return []string{prefix + field}
	}
	lines := []string{strings.TrimSuffix(prefix, " ")}
	for _, part := range wrapCells(field, max(width-1, 1)) {
		lines = append(lines, " "+part)
	}
	return lines
}

func wrapCells(s string, width int) []string {
	var lines []string
	var line strings.Builder
	used := 0
	for _, r := range s {
		cells := lipgloss.Width(string(r))
		if used != 0 && used+cells > width {
			lines = append(lines, line.String())
			line.Reset()
			used = 0
		}
		line.WriteRune(r)
		used += cells
	}
	if line.Len() != 0 || len(lines) == 0 {
		lines = append(lines, line.String())
	}
	return lines
}

func clean(s string) string {
	return strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return ' '
		}
		return r
	}, s)
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
		journey := orderedEntries(g.lifecycle, g.evidence, false)
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

func normalize(run vaultregistry.Run, chronologicalParticipants bool) []goal {
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
		if !chronologicalParticipants || !ok || laterObservation(p.ObservedAt, previous.ObservedAt) {
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
	if parsed, err := time.Parse(time.RFC3339Nano, timestamp); err == nil {
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
