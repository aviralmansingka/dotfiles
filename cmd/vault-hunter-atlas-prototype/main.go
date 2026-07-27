// Throwaway prototype: answers whether three radically different spatial structures improve the expanded Operations Board.
package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

const (
	minWidth  = 120
	minHeight = 32
)

var variantNames = []string{"trail-tree", "time-river", "state-deck"}

type goal struct {
	id           string
	first        time.Time
	firstOrder   int
	kind         string
	state        string
	detail       string
	lifecycle    []vaultregistry.Lifecycle
	evidence     []vaultregistry.Evidence
	participants []vaultregistry.Participant
}

type event struct {
	at          string
	instant     time.Time
	order       int
	goalID      string
	lifecycle   *vaultregistry.Lifecycle
	evidence    *vaultregistry.Evidence
	participant *vaultregistry.Participant
}

type palette struct {
	h1, h2, h3, h4, h5, h6 lipgloss.Style
	fg, rail, muted        lipgloss.Style
	selected               lipgloss.Style
	success, warning       lipgloss.Style
	narrative, empty       lipgloss.Style
}

type model struct {
	runs       []vaultregistry.Run
	run        int
	goals      []goal
	goal       int
	variant    int
	width      int
	height     int
	showDetail bool
	styles     palette
}

func main() {
	flags := flag.NewFlagSet("vault-hunter-atlas-prototype", flag.ExitOnError)
	variant := flags.String("variant", "trail-tree", "board variant: trail-tree, time-river, or state-deck")
	runID := flags.String("run-id", "", "Run ID to display (default: latest UpdatedAt)")
	stateDir := flags.String("state-dir", "", "Vault Hunter state directory")
	color := flags.String("color", "auto", "color mode: auto, always, or never")
	flags.Parse(os.Args[1:])
	if flags.NArg() != 0 {
		fail(errors.New("unexpected positional arguments"))
	}
	variantIndex := indexOf(variantNames, *variant)
	if variantIndex < 0 {
		fail(fmt.Errorf("invalid --variant %q (want trail-tree, time-river, or state-deck)", *variant))
	}
	if *color != "auto" && *color != "always" && *color != "never" {
		fail(fmt.Errorf("invalid --color %q (want auto, always, or never)", *color))
	}

	// This prototype deliberately has only the Registry's read path.
	reader, err := vaultregistry.OpenReader(*stateDir)
	if err != nil {
		fail(err)
	}
	runs, err := reader.List()
	if err != nil {
		fail(err)
	}
	if len(runs) == 0 {
		fail(errors.New("Registry contains no runs"))
	}
	m, err := newModel(runs, *runID, variantIndex, *color)
	if err != nil {
		fail(err)
	}
	if _, err := tea.NewProgram(m, tea.WithAltScreen()).Run(); err != nil {
		fail(err)
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}

func indexOf(values []string, wanted string) int {
	for i, value := range values {
		if value == wanted {
			return i
		}
	}
	return -1
}

func newModel(runs []vaultregistry.Run, runID string, variant int, colorMode string) (model, error) {
	if len(runs) == 0 {
		return model{}, errors.New("Registry contains no runs")
	}
	runs = append([]vaultregistry.Run(nil), runs...)
	sort.SliceStable(runs, func(i, j int) bool { return runs[i].RunID < runs[j].RunID })
	selectedRun := -1
	if runID != "" {
		for i := range runs {
			if runs[i].RunID == runID {
				selectedRun = i
				break
			}
		}
		if selectedRun < 0 {
			return model{}, fmt.Errorf("run %q not found", runID)
		}
	} else {
		var latest time.Time
		for i := range runs {
			instant, err := time.Parse(time.RFC3339Nano, runs[i].UpdatedAt)
			if err != nil {
				continue
			}
			if selectedRun < 0 || instant.After(latest) || instant.Equal(latest) && runs[i].RunID < runs[selectedRun].RunID {
				selectedRun, latest = i, instant
			}
		}
		if selectedRun < 0 {
			selectedRun = 0
		}
	}
	m := model{
		runs:       runs,
		run:        selectedRun,
		variant:    max(0, min(variant, len(variantNames)-1)),
		showDetail: true,
		styles:     makePalette(colorMode),
	}
	m.loadGoals()
	return m, nil
}

func makePalette(mode string) palette {
	renderer := lipgloss.NewRenderer(os.Stdout)
	switch mode {
	case "never":
		renderer.SetColorProfile(termenv.Ascii)
	case "always":
		renderer.SetColorProfile(termenv.TrueColor)
	}
	style := func(color string) lipgloss.Style { return renderer.NewStyle().Foreground(lipgloss.Color(color)) }
	return palette{
		h1:        style("#f28534").Bold(true),
		h2:        style("#e9b143").Bold(true),
		h3:        style("#b0b846").Bold(true),
		h4:        style("#80aa9e").Bold(true),
		h5:        style("#d3869b").Bold(true),
		h6:        style("#f2594b").Bold(true),
		fg:        style("#ebdbb2"),
		rail:      style("#504945"),
		muted:     style("#928374"),
		selected:  style("#ebdbb2").Background(lipgloss.Color("#45403d")).Bold(true),
		success:   style("#b8bb26").Bold(true),
		warning:   style("#fabd2f").Bold(true),
		narrative: style("#ebdbb2").Italic(true),
		empty:     style("#928374").Italic(true),
	}
}

func (m model) Init() tea.Cmd { return nil }

func (m model) Update(message tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := message.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		m.clamp()
		return m, nil
	case tea.KeyMsg:
		key := msg.String()
		if key == "q" || key == "esc" || key == "ctrl+c" {
			return m, tea.Quit
		}
		if m.width < minWidth || m.height < minHeight {
			return m, nil
		}
		switch key {
		case "[", "h":
			m.changeRun(-1)
		case "]", "l":
			m.changeRun(1)
		case "k", "up":
			m.goal--
		case "j", "down":
			m.goal++
		case "enter":
			m.showDetail = !m.showDetail
		case "tab":
			m.variant = (m.variant + 1) % len(variantNames)
		case "shift+tab":
			m.variant = (m.variant + len(variantNames) - 1) % len(variantNames)
		case "1", "2", "3":
			m.variant = int(key[0] - '1')
		}
		m.clamp()
	}
	return m, nil
}

func (m *model) changeRun(delta int) {
	if len(m.runs) == 0 {
		return
	}
	next := max(0, min(m.run+delta, len(m.runs)-1))
	if next != m.run {
		m.run = next
		m.loadGoals()
	}
}

func (m *model) clamp() {
	m.run = max(0, min(m.run, len(m.runs)-1))
	m.variant = max(0, min(m.variant, len(variantNames)-1))
	if len(m.goals) == 0 {
		m.goal = 0
	} else {
		m.goal = max(0, min(m.goal, len(m.goals)-1))
	}
}

func (m *model) loadGoals() {
	if len(m.runs) == 0 {
		m.goals, m.goal = nil, 0
		return
	}
	m.goals = buildGoals(m.runs[m.run])
	m.goal = initialGoal(m.goals)
	m.clamp()
}

func buildEvents(run vaultregistry.Run) []event {
	events := make([]event, 0, len(run.Lifecycle)+len(run.Evidence)+len(run.Participants))
	order := 0
	for i := range run.Lifecycle {
		observation := &run.Lifecycle[i]
		instant, _ := time.Parse(time.RFC3339Nano, observation.ObservedAt)
		events = append(events, event{at: observation.ObservedAt, instant: instant, order: order, goalID: observation.GoalID, lifecycle: observation})
		order++
	}
	for i := range run.Evidence {
		observation := &run.Evidence[i]
		instant, _ := time.Parse(time.RFC3339Nano, observation.ObservedAt)
		events = append(events, event{at: observation.ObservedAt, instant: instant, order: order, goalID: observation.VerifierID, evidence: observation})
		order++
	}
	for i := range run.Participants {
		observation := &run.Participants[i]
		instant, _ := time.Parse(time.RFC3339Nano, observation.ObservedAt)
		events = append(events, event{at: observation.ObservedAt, instant: instant, order: order, goalID: observation.GoalID, participant: observation})
		order++
	}
	sort.SliceStable(events, func(i, j int) bool {
		return events[i].instant.Before(events[j].instant)
	})
	return events
}

func buildGoals(run vaultregistry.Run) []goal {
	byID := make(map[string]*goal)
	order := 0
	for _, observation := range buildEvents(run) {
		if observation.goalID == "" {
			continue
		}
		g := byID[observation.goalID]
		if g == nil {
			g = &goal{id: observation.goalID, first: observation.instant, firstOrder: order}
			byID[observation.goalID] = g
			order++
		}
		if observation.lifecycle != nil {
			g.lifecycle = append(g.lifecycle, *observation.lifecycle)
			g.kind, g.state, g.detail = observation.lifecycle.Kind, observation.lifecycle.State, observation.lifecycle.Detail
		}
		if observation.evidence != nil {
			g.evidence = append(g.evidence, *observation.evidence)
		}
		if observation.participant != nil {
			g.participants = append(g.participants, *observation.participant)
		}
	}
	goals := make([]goal, 0, len(byID))
	for _, g := range byID {
		goals = append(goals, *g)
	}
	sort.SliceStable(goals, func(i, j int) bool {
		if !goals[i].first.Equal(goals[j].first) {
			return goals[i].first.Before(goals[j].first)
		}
		return goals[i].firstOrder < goals[j].firstOrder
	})
	return goals
}

func initialGoal(goals []goal) int {
	if len(goals) == 0 {
		return 0
	}
	selected := len(goals) - 1
	var latest time.Time
	found := false
	for i := range goals {
		for _, observation := range goals[i].lifecycle {
			if observation.State == "pending" || observation.State == "done" {
				continue
			}
			instant, err := time.Parse(time.RFC3339Nano, observation.ObservedAt)
			if err == nil && (!found || instant.After(latest) || instant.Equal(latest)) {
				selected, latest, found = i, instant, true
			}
		}
	}
	return selected
}

func (m model) View() string {
	if m.width < minWidth || m.height < minHeight {
		first := fmt.Sprintf("× Operations Board needs 120×32; current %d×%d", m.width, m.height)
		return truncate(first, m.width) + "\n" + truncate("Resize terminal · q quit", m.width)
	}
	run := m.runs[m.run]
	selectedID := "?"
	if len(m.goals) != 0 {
		selectedID = shown(m.goals[m.goal].id)
	}
	rows := []string{
		m.line("◆ OPERATIONS BOARD  /  "+strings.ToUpper(variantNames[m.variant]), m.width, m.styles.h1),
		m.line(fmt.Sprintf("◉ Run %s  [%d/%d]  │  ▶ Goal %s  [%s]", shown(run.RunID), m.run+1, len(m.runs), selectedID, ordinal(m.goal, len(m.goals))), m.width, m.styles.h2),
		m.line(fmt.Sprintf("├─ Task %s · %s  │  %s", shown(run.Task.ID), shown(run.Task.Title), shown(run.Task.Kind)), m.width, m.styles.h3),
	}
	bodyHeight := m.height - 6
	var body []string
	switch m.variant {
	case 0:
		body = m.trailTree(bodyHeight)
	case 1:
		body = m.timeRiver(bodyHeight)
	case 2:
		body = m.stateDeck(bodyHeight)
	}
	for len(body) < bodyHeight {
		body = append(body, m.line("│", m.width, m.styles.rail))
	}
	rows = append(rows, body[:bodyHeight]...)
	rows = append(rows,
		m.line(fmt.Sprintf("Goals %d  │  lifecycle %d  │  evidence %d  │  participants %d  │  revision %d  │  updated %s", len(m.goals), len(run.Lifecycle), len(run.Evidence), len(run.Participants), run.Revision, shown(run.UpdatedAt)), m.width, m.styles.muted),
		m.line("[/] or h/l run  ·  k/j or ↑/↓ goal  ·  Enter detail  ·  Tab/Shift-Tab variant  ·  1/2/3 direct  ·  q quit", m.width, m.styles.fg),
		m.line(fmt.Sprintf("Read-only Registry snapshot  │  %s  │  %d×%d", variantNames[m.variant], m.width, m.height), m.width, m.styles.muted),
	)
	return strings.Join(rows, "\n")
}

func ordinal(index, length int) string {
	if length == 0 {
		return "0/0"
	}
	return fmt.Sprintf("%d/%d", index+1, length)
}

func (m model) trailTree(limit int) []string {
	run := m.runs[m.run]
	rows := []string{
		m.line("HIERARCHY  /  Run → Task → Goal → recorded observations", m.width, m.styles.h4),
		m.line("◉ "+shown(run.RunID), m.width, m.styles.fg),
		m.line("│ └─ ◆ "+shown(run.Task.ID)+"  "+shown(run.Task.Title), m.width, m.styles.h3),
	}
	if len(m.goals) == 0 {
		return append(rows, m.line("│    └─ no recorded goals", m.width, m.styles.empty))
	}
	available := max(1, limit-len(rows))
	selectedBlock := m.goalTreeBlock(m.goals[m.goal], true)
	selectedBlock = boundWithOmission(selectedBlock, max(1, available-min(4, len(m.goals)-1)))
	contextSlots := max(0, available-len(selectedBlock))
	start := max(0, m.goal-contextSlots/2)
	end := min(len(m.goals), start+contextSlots+1)
	start = max(0, end-contextSlots-1)
	for i := start; i < end && len(rows) < limit; i++ {
		if i == m.goal {
			rows = append(rows, selectedBlock...)
			continue
		}
		g := m.goals[i]
		rows = append(rows, m.line(fmt.Sprintf("│    ├─ %s %s · %s · %s", stateGlyph(g.state), shown(g.id), shown(g.kind), shown(g.state)), m.width, m.goalStyle(g, false)))
	}
	return rows[:min(len(rows), limit)]
}

func (m model) goalTreeBlock(g goal, selected bool) []string {
	prefix := "│    ├─"
	if selected {
		prefix = "│    └─ ▶"
	}
	rows := []string{m.line(fmt.Sprintf("%s %s %s · %s · %s", prefix, stateGlyph(g.state), shown(g.id), shown(g.kind), shown(g.state)), m.width, m.goalStyle(g, selected))}
	events := eventsForGoal(m.runs[m.run], g.id)
	if len(events) == 0 {
		return append(rows, m.line("│       └─ no recorded observations", m.width, m.styles.empty))
	}
	for i, observation := range events {
		branch := "├─"
		if i == len(events)-1 {
			branch = "└─"
		}
		rows = append(rows, m.line("│       "+branch+" "+eventSummary(observation), m.width, m.eventStyle(observation)))
		if m.showDetail {
			if detail := eventDetail(observation); detail != "" {
				rows = append(rows, m.line("│       │  "+detail, m.width, m.styles.narrative))
			}
			if observation.evidence != nil && observation.evidence.Command != "" {
				rows = append(rows, m.line("│       │  $ "+observation.evidence.Command, m.width, m.styles.h5))
			}
		}
	}
	return rows
}

func (m model) timeRiver(limit int) []string {
	leftWidth := m.width * 68 / 100
	rightWidth := m.width - leftWidth - 1
	left := []string{"TIME RIVER  /  global chronology"}
	events := buildEvents(m.runs[m.run])
	if len(events) == 0 {
		left = append(left, "  no recorded observations")
	} else {
		visible := max(0, limit-1)
		start := max(0, len(events)-visible)
		for i := start; i < len(events); i++ {
			marker := "●"
			if events[i].goalID == selectedGoalID(m) {
				marker = "◉"
			}
			left = append(left, fmt.Sprintf("  %s  │  %s  │  %s", marker, shown(events[i].at), eventSummary(events[i])))
		}
	}
	right := m.dossier(limit)
	rows := make([]string, 0, limit)
	for i := 0; i < limit; i++ {
		l, r := "", ""
		if i < len(left) {
			l = left[i]
		}
		if i < len(right) {
			r = right[i]
		}
		leftStyle, rightStyle := m.styles.fg, m.styles.fg
		if i == 0 {
			leftStyle, rightStyle = m.styles.h4, m.styles.h5
		} else if strings.Contains(l, "no recorded") || strings.Contains(r, "none recorded") {
			leftStyle, rightStyle = m.styles.empty, m.styles.empty
		}
		rows = append(rows, m.cell(l, leftWidth, leftStyle)+m.styles.rail.Render("│")+m.cell(r, rightWidth, rightStyle))
	}
	return rows
}

func (m model) dossier(limit int) []string {
	if len(m.goals) == 0 {
		return []string{"STICKY DOSSIER", "no recorded goals"}
	}
	g := m.goals[m.goal]
	rows := []string{
		"STICKY DOSSIER",
		fmt.Sprintf("▶ %s  %s", stateGlyph(g.state), shown(g.id)),
		"state  " + shown(g.state),
		"kind   " + shown(g.kind),
		fmt.Sprintf("trace  %d lifecycle · %d evidence", len(g.lifecycle), len(g.evidence)),
		"",
		"PARTICIPANTS",
	}
	if len(g.participants) == 0 {
		rows = append(rows, "none recorded")
	} else {
		for _, participant := range g.participants {
			rows = append(rows, fmt.Sprintf("◆ %s · %s", shown(participant.ParticipantID), shown(participant.Role)))
		}
	}
	rows = append(rows, "", "LATEST EVIDENCE")
	if len(g.evidence) == 0 {
		rows = append(rows, "none recorded")
	} else {
		evidence := g.evidence[len(g.evidence)-1]
		rows = append(rows, fmt.Sprintf("! %s · %s", shown(evidence.ObservedAt), shown(evidence.State)))
		if evidence.ExitStatus != nil {
			rows = append(rows, fmt.Sprintf("exit %d", *evidence.ExitStatus))
		}
		if evidence.Command != "" {
			rows = append(rows, "$ "+evidence.Command)
		}
		if m.showDetail && evidence.Detail != "" {
			rows = append(rows, evidence.Detail)
		}
	}
	return rows[:min(len(rows), limit)]
}

func (m model) stateDeck(limit int) []string {
	states := []string{"pending", "active", "awaiting-human-evaluation", "blocked", "failed", "done"}
	labels := []string{"○ PENDING", "● ACTIVE", "◇ WAITING", "! BLOCKED", "× FAILED", "✓ DONE"}
	laneHeight := min(8, max(3, limit/3))
	lanes := make([][]string, len(states))
	other := []string{}
	for i := range states {
		lanes[i] = []string{labels[i]}
	}
	for i, g := range m.goals {
		entry := fmt.Sprintf("%s %s", stateGlyph(g.state), shown(g.id))
		if i == m.goal {
			entry = "▶ " + entry
		}
		lane := indexOf(states, g.state)
		if lane < 0 {
			other = append(other, entry+" · "+shown(g.state))
		} else {
			lanes[lane] = append(lanes[lane], entry)
		}
	}
	rows := []string{m.line("STATE DECK  /  six current-state lanes", m.width, m.styles.h4)}
	widths := splitWidths(m.width, len(states))
	for row := 0; row < laneHeight && len(rows) < limit; row++ {
		var line strings.Builder
		for column := range lanes {
			text := ""
			if row < len(lanes[column]) {
				text = lanes[column][row]
			}
			style := m.styles.fg
			if row == 0 {
				style = []lipgloss.Style{m.styles.muted, m.styles.h3, m.styles.h5, m.styles.warning, m.styles.h6, m.styles.success}[column]
			} else if strings.HasPrefix(text, "▶") {
				style = m.styles.selected
			} else if column == 5 {
				style = m.styles.success
			}
			line.WriteString(m.cell(text, widths[column], style))
			if column != len(lanes)-1 {
				line.WriteString(m.styles.rail.Render("│"))
			}
		}
		rows = append(rows, line.String())
	}
	if len(rows) < limit {
		rows = append(rows, m.line("OTHER BELT  ─────────────────────────────────────────────────────────────────────────────────────────────────────────", m.width, m.styles.h6))
	}
	if len(rows) < limit {
		text := "none recorded"
		style := m.styles.empty
		if len(other) != 0 {
			text, style = strings.Join(other, "  │  "), m.styles.fg
		}
		rows = append(rows, m.line(text, m.width, style))
	}
	if len(rows) < limit {
		rows = append(rows, m.line("LOWER TRACE TREE  /  selected goal", m.width, m.styles.h5))
	}
	if len(rows) < limit {
		if len(m.goals) == 0 {
			rows = append(rows, m.line("└─ no selected trace", m.width, m.styles.empty))
		} else {
			trace := m.goalTreeBlock(m.goals[m.goal], true)
			trace = boundWithOmission(trace, limit-len(rows))
			rows = append(rows, trace...)
		}
	}
	return rows[:min(len(rows), limit)]
}

func splitWidths(total, columns int) []int {
	usable := total - columns + 1
	widths := make([]int, columns)
	for i := range widths {
		widths[i] = usable / columns
		if i < usable%columns {
			widths[i]++
		}
	}
	return widths
}

func eventsForGoal(run vaultregistry.Run, goalID string) []event {
	all := buildEvents(run)
	selected := make([]event, 0)
	for _, observation := range all {
		if observation.goalID == goalID {
			selected = append(selected, observation)
		}
	}
	return selected
}

func selectedGoalID(m model) string {
	if len(m.goals) == 0 {
		return ""
	}
	return m.goals[m.goal].id
}

func eventSummary(observation event) string {
	switch {
	case observation.lifecycle != nil:
		return fmt.Sprintf("%s %s · %s · %s", stateGlyph(observation.lifecycle.State), shown(observation.goalID), shown(observation.lifecycle.Kind), shown(observation.lifecycle.State))
	case observation.evidence != nil:
		exit := ""
		if observation.evidence.ExitStatus != nil {
			exit = fmt.Sprintf(" · exit %d", *observation.evidence.ExitStatus)
		}
		return fmt.Sprintf("! %s · evidence · %s%s", shown(observation.goalID), shown(observation.evidence.State), exit)
	default:
		return fmt.Sprintf("◆ %s · participant %s · %s", shown(observation.goalID), shown(observation.participant.ParticipantID), shown(observation.participant.Role))
	}
}

func eventDetail(observation event) string {
	if observation.lifecycle != nil {
		return observation.lifecycle.Detail
	}
	if observation.evidence != nil {
		return observation.evidence.Detail
	}
	return ""
}

func stateGlyph(state string) string {
	switch state {
	case "pending":
		return "○"
	case "active":
		return "●"
	case "awaiting-human-evaluation":
		return "◇"
	case "resuming":
		return "↻"
	case "blocked":
		return "!"
	case "failed":
		return "×"
	case "done", "passed":
		return "✓"
	default:
		return "?"
	}
}

func (m model) goalStyle(g goal, selected bool) lipgloss.Style {
	if selected {
		return m.styles.selected
	}
	switch g.state {
	case "done":
		return m.styles.success
	case "blocked":
		return m.styles.warning
	case "failed":
		return m.styles.h6
	default:
		return m.styles.fg
	}
}

func (m model) eventStyle(observation event) lipgloss.Style {
	state := ""
	if observation.lifecycle != nil {
		state = observation.lifecycle.State
	} else if observation.evidence != nil {
		state = observation.evidence.State
	}
	switch state {
	case "done", "passed":
		return m.styles.success
	case "blocked":
		return m.styles.warning
	case "failed":
		return m.styles.h6
	default:
		return m.styles.fg
	}
}

func boundWithOmission(lines []string, limit int) []string {
	if limit <= 0 {
		return nil
	}
	if len(lines) <= limit {
		return lines
	}
	if limit == 1 {
		return lines[:1]
	}
	result := append([]string(nil), lines[:limit-1]...)
	result = append(result, "│       └─ … earlier/later recorded observations omitted")
	return result
}

func shown(value string) string {
	if value == "" {
		return "?"
	}
	return value
}

func clean(value string) string {
	return strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return ' '
		}
		return r
	}, value)
}

func truncate(value string, width int) string {
	value = clean(value)
	if width <= 0 {
		return ""
	}
	if lipgloss.Width(value) <= width {
		return value
	}
	if width == 1 {
		return "…"
	}
	runes := []rune(value)
	for len(runes) != 0 && lipgloss.Width(string(runes)) > width-1 {
		runes = runes[:len(runes)-1]
	}
	return strings.TrimRight(string(runes), " ") + "…"
}

func (m model) line(value string, width int, style lipgloss.Style) string {
	value = truncate(value, width)
	return style.Render(value) + strings.Repeat(" ", max(0, width-lipgloss.Width(value)))
}

func (m model) cell(value string, width int, style lipgloss.Style) string {
	value = truncate(value, width)
	value += strings.Repeat(" ", max(0, width-lipgloss.Width(value)))
	return style.Render(value)
}
