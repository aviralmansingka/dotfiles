// Throwaway prototype: answers whether three radically different spatial structures improve the expanded Operations Board.
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

const (
	minWidth               = 120
	minHeight              = 32
	outputTruncationMarker = "… output truncated"
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

type subagentDetail struct {
	Schema       string `json:"schema"`
	ToolCallID   string `json:"tool_call_id"`
	Agent        string `json:"agent"`
	CWD          string `json:"cwd"`
	Model        string `json:"model"`
	ResultSHA256 string `json:"result_sha256"`
	DurationMS   *int64 `json:"duration_ms"`
	ExitStatus   *int   `json:"exit_status"`
	ToolCount    *int   `json:"tool_count"`
	Usage        *struct {
		TotalTokens *int64   `json:"total_tokens"`
		Cost        *float64 `json:"cost"`
		Turns       *int     `json:"turns"`
	} `json:"usage"`
	Error  string  `json:"error"`
	Output *string `json:"output"`
	Result *string `json:"result"`
}

type subagentInvocation struct {
	started      *event
	finished     *event
	participants []*event
}

type traceDetail struct {
	head            string
	body            []string
	style           lipgloss.Style
	priority        int
	outputTruncated bool
}

type traceItem struct {
	observation *event
	invocation  *subagentInvocation
}

type traceEntry struct {
	summary string
	style   lipgloss.Style
	details []traceDetail
}

type palette struct {
	h1, h2, h3, h4, h5, h6  lipgloss.Style
	fg, rail, muted         lipgloss.Style
	selected, badge, keycap lipgloss.Style
	success, warning        lipgloss.Style
	narrative, empty        lipgloss.Style
}

type styledSegment struct {
	text  string
	style lipgloss.Style
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
		h5:        style("#d3869b"),
		h6:        style("#f2594b"),
		fg:        style("#ebdbb2"),
		rail:      style("#504945"),
		muted:     style("#928374"),
		selected:  style("#b0b846").Background(lipgloss.Color("#32302f")).Bold(true),
		badge:     style("#928374").Background(lipgloss.Color("#3c3836")),
		keycap:    style("#ebdbb2").Background(lipgloss.Color("#3c3836")).Bold(true),
		success:   style("#b8bb26"),
		warning:   style("#fabd2f"),
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
	rows := m.header(run)
	bodyHeight := m.height - len(rows) - 4
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
		body = append(body, m.line("", m.width, m.styles.rail))
	}
	rows = append(rows, body[:bodyHeight]...)
	rows = append(rows, m.footer(run)...)
	return strings.Join(rows, "\n")
}

func (m model) header(run vaultregistry.Run) []string {
	selectedID := "?"
	if len(m.goals) != 0 {
		selectedID = shown(m.goals[m.goal].id)
	}
	contextWidth := m.width - 2
	runWidth := contextWidth * 56 / 100
	goalWidth := contextWidth - runWidth
	runOrdinal := "  " + ordinal(m.run, len(m.runs))
	goalOrdinal := "  " + ordinal(m.goal, len(m.goals))
	runID := truncate(shown(run.RunID), max(1, runWidth-lipgloss.Width("RUN  "+runOrdinal)))
	goalID := truncate(selectedID, max(1, goalWidth-lipgloss.Width("GOAL  "+goalOrdinal)))
	runPadding := strings.Repeat(" ", max(0, runWidth-lipgloss.Width("RUN  "+runID+runOrdinal)))
	return []string{
		m.boxRule("╭", "╮", m.width,
			styledSegment{"─ ", m.styles.rail},
			styledSegment{"VAULT HUNTER ATLAS", m.styles.h1},
			styledSegment{"  " + titleWords(variantNames[m.variant]), m.styles.h2.Bold(false)},
			styledSegment{"  READ ONLY ", m.styles.badge},
			styledSegment{" ", m.styles.rail}),
		m.boxLine(m.width,
			styledSegment{" TASK  ", m.styles.muted},
			styledSegment{shown(run.Task.ID) + " · " + shown(run.Task.Title), m.styles.h2}),
		m.boxLine(m.width,
			styledSegment{" RUN  ", m.styles.h4.Bold(false)},
			styledSegment{runID, m.styles.h5},
			styledSegment{runOrdinal, m.styles.h5},
			styledSegment{runPadding, m.styles.muted},
			styledSegment{"GOAL  ", m.styles.h3.Bold(false)},
			styledSegment{goalID, m.styles.h3.Bold(false)},
			styledSegment{goalOrdinal, m.styles.h3.Bold(false)}),
		m.boxRule("╰", "╯", m.width),
	}
}

func (m model) footer(run vaultregistry.Run) []string {
	return []string{
		m.boxRule("╭", "╮", m.width),
		m.boxLine(m.width,
			styledSegment{" GOALS ", m.styles.h3.Bold(false)}, styledSegment{fmt.Sprint(len(m.goals)), m.styles.h3.Bold(false)},
			styledSegment{"   LIFECYCLE ", m.styles.h4.Bold(false)}, styledSegment{fmt.Sprint(len(run.Lifecycle)), m.styles.h4.Bold(false)},
			styledSegment{"   EVIDENCE ", m.styles.h5}, styledSegment{fmt.Sprint(len(run.Evidence)), m.styles.h5},
			styledSegment{"   PARTICIPANTS ", m.styles.h2.Bold(false)}, styledSegment{fmt.Sprint(len(run.Participants)), m.styles.h2.Bold(false)},
			styledSegment{fmt.Sprintf("   rev %d · updated %s", run.Revision, shown(run.UpdatedAt)), m.styles.muted}),
		m.boxLine(m.width,
			styledSegment{" ", m.styles.rail},
			m.keycap(" ↑↓ "), styledSegment{" Goal   ", m.styles.muted},
			m.keycap(" ←→ "), styledSegment{"/", m.styles.muted}, m.keycap(" [] "), styledSegment{" Run   ", m.styles.muted},
			m.keycap(" Enter "), styledSegment{" Detail   ", m.styles.muted},
			m.keycap(" Tab "), styledSegment{" Layout   ", m.styles.muted},
			m.keycap(" 1 2 3 "), styledSegment{" Views   ", m.styles.muted},
			m.keycap(" q "), styledSegment{" Quit", m.styles.muted}),
		m.boxRule("╰", "╯", m.width,
			styledSegment{"─ ", m.styles.rail},
			styledSegment{strings.ToUpper(titleWords(variantNames[m.variant])), m.styles.muted},
			styledSegment{fmt.Sprintf(" · %d×%d · READ ONLY", m.width, m.height), m.styles.muted},
			styledSegment{" ", m.styles.rail}),
	}
}

func ordinal(index, length int) string {
	if length == 0 {
		return "0/0"
	}
	return fmt.Sprintf("%d/%d", index+1, length)
}

func (m model) trailTree(limit int) []string {
	if len(m.goals) == 0 {
		return []string{m.treeLine("   └─ ", "No recorded goals", m.width, m.styles.empty)}
	}

	selectedBudget := max(1, limit-min(4, len(m.goals)-1))
	selectedRows := m.goalTreeBlock(m.goals[m.goal], true, true, selectedBudget, "   ")
	contextSlots := max(0, limit-len(selectedRows))
	start := max(0, m.goal-contextSlots/2)
	end := min(len(m.goals), start+contextSlots+1)
	start = max(0, end-contextSlots-1)
	visible := make([]int, 0, end-start)
	for i := start; i < end; i++ {
		visible = append(visible, i)
	}

	rows := make([]string, 0, limit)
	for position, i := range visible {
		last := position == len(visible)-1
		if i == m.goal {
			rows = append(rows, m.goalTreeBlock(m.goals[i], true, last, selectedBudget, "   ")...)
			continue
		}
		branch := "├─ "
		if last {
			branch = "└─ "
		}
		g := m.goals[i]
		rows = append(rows, m.treeLine("   "+branch, goalSummary(g), m.width, m.goalStyle(g, false)))
	}
	return rows[:min(len(rows), limit)]
}

func (m model) goalTreeBlock(g goal, selected, last bool, limit int, base string) []string {
	if limit <= 0 {
		return nil
	}
	branch := "├─ "
	if last {
		branch = "└─ "
	}
	disclosure := ""
	if selected {
		disclosure = "▶ ▾ "
		if !m.showDetail {
			disclosure = "▶ ▸ "
		}
	}
	heading := disclosure + goalSummary(g)
	var first string
	if selected {
		first = m.selectedLine(base+branch, heading, m.width)
	} else {
		first = m.treeLine(base+branch, heading, m.width, m.goalStyle(g, false))
	}
	rows := []string{first}
	if !m.showDetail {
		return rows
	}

	events := eventsForGoal(m.runs[m.run], g.id)
	childBase := base + "│  "
	if last {
		childBase = base + "   "
	}
	if len(events) == 0 {
		if len(rows) < limit {
			rows = append(rows, m.treeLine(childBase+"└─ ", "No recorded observations", m.width, m.styles.empty))
		}
		return rows
	}
	entries := m.traceEntries(groupSubagentInvocations(events), max(1, m.width-lipgloss.Width(childBase)-9))
	entries = fitTraceEntries(entries, limit-len(rows), m.styles.muted)
	for i, entry := range entries {
		entryLast := i == len(entries)-1
		entryBranch := "├─ "
		if entryLast {
			entryBranch = "└─ "
		}
		rows = append(rows, m.treeLine(childBase+entryBranch, entry.summary, m.width, entry.style))
		detailBase := childBase + "│  "
		if entryLast {
			detailBase = childBase + "   "
		}
		for j, detail := range entry.details {
			detailLast := j == len(entry.details)-1
			detailBranch := "├─ "
			if detailLast {
				detailBranch = "└─ "
			}
			rows = append(rows, m.treeLine(detailBase+detailBranch, detail.head, m.width, detail.style))
			bodyBase := detailBase + "│  "
			if detailLast {
				bodyBase = detailBase + "   "
			}
			for k, line := range detail.body {
				bodyBranch := "├─ "
				if k == len(detail.body)-1 {
					bodyBranch = "└─ "
				}
				style := detail.style
				if detail.outputTruncated && k == len(detail.body)-1 {
					style = m.styles.empty
				}
				rows = append(rows, m.treeLine(bodyBase+bodyBranch, line, m.width, style))
			}
		}
	}
	return rows[:min(len(rows), limit)]
}

func (m model) timeRiver(limit int) []string {
	leftWidth := m.width * 68 / 100
	rightWidth := m.width - leftWidth - 1
	left := []string{"TIMELINE"}
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
			summary := strings.TrimPrefix(eventSummary(events[i]), clockTime(observationTime(events[i]))+"  ")
			left = append(left, fmt.Sprintf("  %s  │  %s  │  %s · %s", marker, clockTime(events[i].at), shown(events[i].goalID), summary))
		}
	}
	right := m.dossier(limit, rightWidth)
	rows := make([]string, 0, limit)
	for i := 0; i < limit; i++ {
		l := ""
		if i < len(left) {
			l = left[i]
		}
		r := m.cell("", rightWidth, m.styles.fg)
		if i < len(right) {
			r = right[i]
		}
		leftStyle := m.styles.fg
		if i == 0 {
			leftStyle = m.styles.h4
		} else if strings.Contains(l, "no recorded") {
			leftStyle = m.styles.empty
		}
		rows = append(rows, m.cell(l, leftWidth, leftStyle)+m.styles.rail.Render("│")+r)
	}
	return rows
}

func (m model) dossier(limit, width int) []string {
	rows := make([]string, 0, limit)
	add := func(text string, style lipgloss.Style) {
		if len(rows) < limit {
			rows = append(rows, m.cell(text, width, style))
		}
	}
	addWrapped := func(text string, style lipgloss.Style) {
		for _, line := range wrapDisplay(text, max(1, width)) {
			add(line, style)
		}
	}
	if len(m.goals) == 0 {
		add("GOAL DETAILS", m.styles.h5)
		add("no recorded goals", m.styles.empty)
		return rows
	}
	g := m.goals[m.goal]
	add("GOAL DETAILS", m.styles.h5)
	disclosure := "▾"
	if !m.showDetail {
		disclosure = "▸"
	}
	add(fmt.Sprintf("▶ %s %s", disclosure, goalSummary(g)), m.styles.selected)
	add(fmt.Sprintf("trace  %d lifecycle · %d evidence", len(g.lifecycle), len(g.evidence)), m.styles.muted)
	add("", m.styles.fg)
	add("Latest activity", m.styles.h3)
	if len(g.lifecycle) == 0 {
		add("none recorded", m.styles.empty)
	} else {
		lifecycle := g.lifecycle[len(g.lifecycle)-1]
		observation := event{goalID: g.id, lifecycle: &lifecycle}
		add(eventSummary(observation), m.eventStyle(observation))
		if m.showDetail {
			for _, row := range m.eventDetailRows(observation, "", width) {
				if len(rows) < limit {
					rows = append(rows, row)
				}
			}
		}
	}
	add("", m.styles.fg)
	add("Participants", m.styles.h4)
	if len(g.participants) == 0 {
		add("none recorded", m.styles.empty)
	} else {
		for _, participant := range g.participants {
			add(fmt.Sprintf("◆ %s · %s", shown(participant.ParticipantID), shown(participant.Role)), m.styles.fg)
		}
	}
	add("", m.styles.fg)
	add("Latest evidence", m.styles.h6)
	if len(g.evidence) == 0 {
		add("none recorded", m.styles.empty)
	} else {
		evidence := g.evidence[len(g.evidence)-1]
		add(fmt.Sprintf("! %s · %s", shown(evidence.ObservedAt), shown(evidence.State)), m.styles.fg)
		if evidence.ExitStatus != nil {
			add(fmt.Sprintf("exit %d", *evidence.ExitStatus), m.styles.muted)
		}
		if evidence.Command != "" {
			add("$ "+evidence.Command, m.styles.h5)
		}
		if m.showDetail && evidence.Detail != "" {
			addWrapped(evidence.Detail, m.styles.narrative)
		}
	}
	return rows
}

func (m model) stateDeck(limit int) []string {
	states := []string{"pending", "active", "awaiting-human-evaluation", "blocked", "failed", "done"}
	labels := []string{"○ PENDING", "◉ ACTIVE", "◇ WAITING", "! BLOCKED", "× FAILED", "✓ DONE"}
	laneHeight := min(8, max(3, limit/3))
	lanes := make([][]string, len(states))
	other := []string{}
	for i := range states {
		lanes[i] = []string{labels[i]}
	}
	for i, g := range m.goals {
		entry := fmt.Sprintf("%s %s", stateGlyph(g.state), shown(g.id))
		if i == m.goal {
			disclosure := "▾"
			if !m.showDetail {
				disclosure = "▸"
			}
			entry = "▶ " + disclosure + " " + entry
		}
		lane := stateLane(g.state)
		if lane < 0 {
			other = append(other, entry+" · "+shown(g.state))
		} else {
			lanes[lane] = append(lanes[lane], entry)
		}
	}
	rows := []string{m.line("GOAL STATES", m.width, m.styles.h4)}
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
		rows = append(rows, m.line("Other states", m.width, m.styles.h6))
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
		rows = append(rows, m.line("SELECTED TRACE", m.width, m.styles.h5))
	}
	if len(rows) < limit {
		if len(m.goals) == 0 {
			rows = append(rows, m.line("└─ no selected trace", m.width, m.styles.empty))
		} else {
			rows = append(rows, m.goalTreeBlock(m.goals[m.goal], true, true, limit-len(rows), "")...)
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

func groupSubagentInvocations(events []event) []traceItem {
	byCall := make(map[string]*subagentInvocation)
	for i := range events {
		detail, ok := lifecycleSubagent(events[i])
		if !ok || detail.ToolCallID == "" {
			continue
		}
		invocation := byCall[detail.ToolCallID]
		if invocation == nil {
			invocation = &subagentInvocation{}
			byCall[detail.ToolCallID] = invocation
		}
		if events[i].lifecycle.Kind == "subagent/started" && invocation.started == nil {
			invocation.started = &events[i]
		}
		if events[i].lifecycle.Kind == "subagent/finished" && invocation.finished == nil {
			invocation.finished = &events[i]
		}
	}

	items := make([]traceItem, 0, len(events))
	emitted := make(map[string]bool)
	active := make(map[string]*subagentInvocation)
	for i := range events {
		observation := &events[i]
		detail, known := lifecycleSubagent(*observation)
		if known && detail.ToolCallID != "" {
			invocation := byCall[detail.ToolCallID]
			if observation.lifecycle.Kind == "subagent/started" {
				active[detail.ToolCallID] = invocation
			}
			if !emitted[detail.ToolCallID] {
				items = append(items, traceItem{invocation: invocation})
				emitted[detail.ToolCallID] = true
			}
			if observation.lifecycle.Kind == "subagent/finished" {
				delete(active, detail.ToolCallID)
			}
			continue
		}
		if observation.participant != nil {
			matches := make([]*subagentInvocation, 0, 1)
			for _, invocation := range active {
				if invocationAgent(invocation) == observation.participant.Role {
					matches = append(matches, invocation)
				}
			}
			if len(matches) == 1 {
				matches[0].participants = append(matches[0].participants, observation)
				continue
			}
		}
		items = append(items, traceItem{observation: observation})
	}
	return items
}

func lifecycleSubagent(observation event) (subagentDetail, bool) {
	if observation.lifecycle == nil {
		return subagentDetail{}, false
	}
	return parseSubagentDetail(observation.lifecycle)
}

func invocationAgent(invocation *subagentInvocation) string {
	for _, observation := range []*event{invocation.finished, invocation.started} {
		if detail, ok := lifecycleSubagentValue(observation); ok && detail.Agent != "" {
			return detail.Agent
		}
	}
	return "?"
}

func lifecycleSubagentValue(observation *event) (subagentDetail, bool) {
	if observation == nil {
		return subagentDetail{}, false
	}
	return lifecycleSubagent(*observation)
}

func (m model) traceEntries(items []traceItem, wrapWidth int) []traceEntry {
	entries := make([]traceEntry, 0, len(items))
	for _, item := range items {
		if item.invocation != nil {
			entries = append(entries, m.invocationEntry(item.invocation, wrapWidth))
			continue
		}
		entries = append(entries, m.observationEntry(*item.observation, wrapWidth))
	}
	return entries
}

func (m model) invocationEntry(invocation *subagentInvocation, wrapWidth int) traceEntry {
	observation := invocation.finished
	if observation == nil {
		observation = invocation.started
	}
	detail, _ := lifecycleSubagentValue(observation)
	started, _ := lifecycleSubagentValue(invocation.started)
	agent := detail.Agent
	if agent == "" {
		agent = started.Agent
	}
	if agent == "" {
		agent = "subagent"
	}

	entry := traceEntry{style: m.styles.h4}
	switch {
	case invocation.finished == nil:
		entry.summary = "◉ " + agent + " · working…"
	case subagentFailed(*invocation.finished.lifecycle, detail):
		entry.summary = "× " + agent + " · failed" + durationSuffix(detail.DurationMS)
		entry.style = m.styles.h6
	default:
		entry.summary = "✓ " + agent + " · completed" + durationSuffix(detail.DurationMS)
	}

	if detail.Model != "" {
		entry.details = append(entry.details, traceDetail{head: "model " + detail.Model, style: m.styles.muted, priority: 2})
	}
	metrics := invocationMetrics(detail)
	if metrics != "" {
		entry.details = append(entry.details, traceDetail{head: metrics, style: m.styles.muted, priority: 1})
	}
	for _, participant := range invocation.participants {
		entry.details = append(entry.details, traceDetail{head: "participant " + shown(participant.participant.ParticipantID), style: m.styles.h5, priority: 1})
	}
	if detail.Error != "" {
		body := wrapDisplay(detail.Error, wrapWidth)
		entry.details = append(entry.details, traceDetail{head: "Error" + exitSuffix(detail.ExitStatus), body: body, style: m.styles.h6, priority: 0})
	} else if detail.ExitStatus != nil && *detail.ExitStatus != 0 {
		entry.details = append(entry.details, traceDetail{head: fmt.Sprintf("exit %d", *detail.ExitStatus), style: m.styles.h6, priority: 0})
	}
	if output := subagentOutput(detail); output != nil {
		body := wrapDisplay(*output, wrapWidth)
		if len(body) == 0 {
			body = []string{"(empty)"}
		}
		entry.details = append(entry.details, traceDetail{head: "Output", body: body, style: m.styles.narrative, priority: 0})
	} else if detail.ResultSHA256 != "" {
		entry.details = append(entry.details, traceDetail{head: "Result digest " + shortDigest(detail.ResultSHA256), style: m.styles.muted, priority: 2})
	}
	if invocation.finished == nil {
		cwd := started.CWD
		if cwd == "" {
			cwd = detail.CWD
		}
		if cwd != "" {
			entry.details = append(entry.details, traceDetail{head: "cwd " + filepath.Base(filepath.Clean(cwd)), style: m.styles.muted, priority: 2})
		}
	}
	return entry
}

func (m model) observationEntry(observation event, wrapWidth int) traceEntry {
	entry := traceEntry{summary: eventSummary(observation), style: m.eventStyle(observation)}
	if observation.lifecycle != nil && observation.lifecycle.Detail != "" {
		if _, known := parseSubagentDetail(observation.lifecycle); !known {
			if json.Valid([]byte(strings.TrimSpace(observation.lifecycle.Detail))) {
				entry.details = append(entry.details, traceDetail{head: "Structured detail recorded", style: m.styles.empty, priority: 2})
			} else {
				entry.details = append(entry.details, traceDetail{head: "Note", body: wrapDisplay(observation.lifecycle.Detail, wrapWidth), style: m.styles.narrative, priority: 1})
			}
		}
	}
	if observation.evidence != nil {
		if observation.evidence.Detail != "" {
			entry.details = append(entry.details, traceDetail{head: "Detail", body: wrapDisplay(observation.evidence.Detail, wrapWidth), style: m.styles.narrative, priority: 1})
		}
		if observation.evidence.Command != "" {
			entry.details = append(entry.details, traceDetail{head: "$ " + observation.evidence.Command, style: m.styles.h5, priority: 2})
		}
	}
	return entry
}

func fitTraceEntries(entries []traceEntry, limit int, omissionStyle lipgloss.Style) []traceEntry {
	if limit <= 0 || len(entries) == 0 {
		return nil
	}
	if len(entries) > limit {
		if limit == 1 {
			return []traceEntry{{summary: "… activity omitted", style: omissionStyle}}
		}
		entries = append([]traceEntry(nil), entries[len(entries)-limit+1:]...)
		return append([]traceEntry{{summary: "… earlier activity omitted", style: omissionStyle}}, entries...)
	}

	total := len(entries)
	for _, entry := range entries {
		for _, detail := range entry.details {
			total += 1 + len(detail.body)
		}
	}
	if total <= limit {
		return entries
	}

	if limit == len(entries) {
		for i := range entries {
			entries[i].details = nil
		}
		return entries
	}
	capacity := limit - len(entries) - 1
	selected := make([][]traceDetail, len(entries))
	for priority := 0; priority <= 2 && capacity > 0; priority++ {
		for i := range entries {
			for _, detail := range entries[i].details {
				if detail.priority != priority {
					continue
				}
				cost := 1 + len(detail.body)
				if cost <= capacity {
					selected[i] = append(selected[i], detail)
					capacity -= cost
					continue
				}
				if priority == 0 && capacity >= 2 && len(detail.body) != 0 {
					if detail.head == "Output" {
						detail.body = append([]string(nil), detail.body[:capacity-2]...)
						detail.body = append(detail.body, outputTruncationMarker)
						detail.outputTruncated = true
					} else {
						detail.body = append([]string(nil), detail.body[:capacity-1]...)
					}
					selected[i] = append(selected[i], detail)
					capacity = 0
				}
			}
		}
	}
	for i := range entries {
		entries[i].details = selected[i]
	}
	entries = append(entries, traceEntry{summary: "… additional details omitted", style: omissionStyle})
	return entries
}

func selectedGoalID(m model) string {
	if len(m.goals) == 0 {
		return ""
	}
	return m.goals[m.goal].id
}

func eventSummary(observation event) string {
	at := clockTime(observationTime(observation)) + "  "
	switch {
	case observation.lifecycle != nil:
		if detail, ok := parseSubagentDetail(observation.lifecycle); ok {
			agent := shown(detail.Agent)
			if observation.lifecycle.Kind == "subagent/started" {
				return at + "◉ " + agent + " · working…"
			}
			if subagentFailed(*observation.lifecycle, detail) {
				return at + "× " + agent + " · failed" + durationSuffix(detail.DurationMS)
			}
			return at + "✓ " + agent + " · completed" + durationSuffix(detail.DurationMS)
		}
		glyph := stateGlyph(observation.lifecycle.State)
		label := titleWords(observation.lifecycle.Kind)
		if glyph == "?" {
			return fmt.Sprintf("%s? %s · %s", at, shown(observation.lifecycle.Kind), shown(observation.lifecycle.State))
		}
		return at + glyph + " " + label
	case observation.evidence != nil:
		exit := ""
		if observation.evidence.ExitStatus != nil {
			exit = fmt.Sprintf(" · exit %d", *observation.evidence.ExitStatus)
		}
		return fmt.Sprintf("%s%s Verification %s%s", at, stateGlyph(observation.evidence.State), shown(observation.evidence.State), exit)
	default:
		return fmt.Sprintf("%s◆ Participant %s · %s", at, shown(observation.participant.ParticipantID), shown(observation.participant.Role))
	}
}

func parseSubagentDetail(lifecycle *vaultregistry.Lifecycle) (subagentDetail, bool) {
	if lifecycle == nil || lifecycle.Kind != "subagent/started" && lifecycle.Kind != "subagent/finished" {
		return subagentDetail{}, false
	}
	var detail subagentDetail
	if json.Unmarshal([]byte(lifecycle.Detail), &detail) != nil || detail.Schema != "vault-hunter-subagent/v1" {
		return subagentDetail{}, false
	}
	return detail, true
}

func subagentFailed(lifecycle vaultregistry.Lifecycle, detail subagentDetail) bool {
	return lifecycle.State == "failed" || lifecycle.State == "error" || lifecycle.State == "rejected" || detail.Error != "" || detail.ExitStatus != nil && *detail.ExitStatus != 0
}

func (m model) eventDetailRows(observation event, prefix string, width int) []string {
	rows := make([]string, 0, 8)
	add := func(text string, style lipgloss.Style) {
		rows = append(rows, m.line(prefix+text, width, style))
	}
	addWrapped := func(label, text string, style lipgloss.Style) {
		if label != "" {
			add(label, style)
		}
		indent := ""
		if label != "" {
			indent = "  "
		}
		contentWidth := max(1, width-lipgloss.Width(prefix+indent))
		for _, line := range wrapDisplay(text, contentWidth) {
			add(indent+line, style)
		}
	}

	if observation.lifecycle == nil {
		if observation.evidence != nil && observation.evidence.Detail != "" {
			addWrapped("", observation.evidence.Detail, m.styles.narrative)
		}
		return rows
	}
	lifecycle := observation.lifecycle
	detail, known := parseSubagentDetail(lifecycle)
	if !known {
		if lifecycle.Detail == "" {
			return rows
		}
		if json.Valid([]byte(strings.TrimSpace(lifecycle.Detail))) {
			add("Structured detail recorded", m.styles.empty)
			return rows
		}
		addWrapped("", lifecycle.Detail, m.styles.narrative)
		return rows
	}

	if lifecycle.Kind == "subagent/started" {
		if detail.CWD != "" {
			add("cwd "+filepath.Base(filepath.Clean(detail.CWD)), m.styles.muted)
		}
		return rows
	}
	if detail.Model != "" {
		add("model "+detail.Model, m.styles.muted)
	}
	if metrics := invocationMetrics(detail); metrics != "" {
		add(metrics, m.styles.muted)
	}
	if detail.Error != "" {
		addWrapped("Error"+exitSuffix(detail.ExitStatus), detail.Error, m.styles.h6)
	} else if detail.ExitStatus != nil && *detail.ExitStatus != 0 {
		add(fmt.Sprintf("exit %d", *detail.ExitStatus), m.styles.h6)
	}
	if output := subagentOutput(detail); output != nil {
		addWrapped("Output", *output, m.styles.narrative)
	} else if detail.ResultSHA256 != "" {
		add("Result digest "+shortDigest(detail.ResultSHA256), m.styles.muted)
	}
	return rows
}

func wrapDisplay(value string, width int) []string {
	lines := make([]string, 0, strings.Count(value, "\n")+1)
	for _, source := range strings.Split(strings.ReplaceAll(value, "\r\n", "\n"), "\n") {
		source = clean(source)
		if source == "" {
			lines = append(lines, "")
			continue
		}
		for source != "" {
			runes := []rune(source)
			end := len(runes)
			for end > 0 && lipgloss.Width(string(runes[:end])) > width {
				end--
			}
			if end == 0 {
				end = 1
			}
			if end < len(runes) {
				for candidate := end; candidate > 0; candidate-- {
					if runes[candidate-1] == ' ' || runes[candidate-1] == '\t' {
						end = candidate - 1
						break
					}
				}
				if end == 0 {
					end = 1
				}
			}
			lines = append(lines, strings.TrimRight(string(runes[:end]), " \t"))
			source = strings.TrimLeft(string(runes[end:]), " \t")
		}
	}
	return lines
}

func goalSummary(g goal) string {
	summary := stateGlyph(g.state) + " " + shown(g.id)
	if stateGlyph(g.state) == "?" {
		summary += " · " + shown(g.kind) + " · " + shown(g.state)
	}
	return summary
}

func titleWords(value string) string {
	words := strings.FieldsFunc(value, func(r rune) bool { return r == '-' || r == '/' || r == '_' })
	for i, word := range words {
		if word == "" {
			continue
		}
		runes := []rune(word)
		runes[0] = []rune(strings.ToUpper(string(runes[0])))[0]
		words[i] = string(runes)
	}
	if len(words) == 0 {
		return "Activity"
	}
	return strings.Join(words, " ")
}

func observationTime(observation event) string {
	if observation.at != "" {
		return observation.at
	}
	if observation.lifecycle != nil {
		return observation.lifecycle.ObservedAt
	}
	if observation.evidence != nil {
		return observation.evidence.ObservedAt
	}
	if observation.participant != nil {
		return observation.participant.ObservedAt
	}
	return ""
}

func clockTime(value string) string {
	instant, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return shown(value)
	}
	return instant.Format("15:04:05")
}

func durationSuffix(milliseconds *int64) string {
	if milliseconds == nil {
		return ""
	}
	duration := time.Duration(*milliseconds) * time.Millisecond
	if duration >= time.Second {
		duration = duration.Round(100 * time.Millisecond)
	}
	return " · " + duration.String()
}

func exitSuffix(status *int) string {
	if status == nil {
		return ""
	}
	return fmt.Sprintf(" · exit %d", *status)
}

func invocationMetrics(detail subagentDetail) string {
	parts := make([]string, 0, 4)
	if detail.ToolCount != nil {
		parts = append(parts, fmt.Sprintf("%d tools", *detail.ToolCount))
	}
	if detail.Usage != nil {
		if detail.Usage.Turns != nil {
			parts = append(parts, fmt.Sprintf("%d turns", *detail.Usage.Turns))
		}
		if detail.Usage.TotalTokens != nil {
			parts = append(parts, compactCount(*detail.Usage.TotalTokens)+" tokens")
		}
		if detail.Usage.Cost != nil {
			parts = append(parts, fmt.Sprintf("$%.4f", *detail.Usage.Cost))
		}
	}
	return strings.Join(parts, " · ")
}

func compactCount(value int64) string {
	if value < 1000 {
		return fmt.Sprintf("%d", value)
	}
	if value < 1_000_000 {
		return strings.TrimSuffix(fmt.Sprintf("%.1f", float64(value)/1000), ".0") + "k"
	}
	return strings.TrimSuffix(fmt.Sprintf("%.1f", float64(value)/1_000_000), ".0") + "m"
}

func subagentOutput(detail subagentDetail) *string {
	if detail.Output != nil {
		return detail.Output
	}
	return detail.Result
}

func shortDigest(value string) string {
	if len(value) > 8 {
		return value[:8] + "…"
	}
	return value
}

func stateLane(state string) int {
	switch state {
	case "pending", "queued":
		return 0
	case "running", "active", "activated", "in-progress", "resuming":
		return 1
	case "awaiting-human-evaluation":
		return 2
	case "blocked", "interrupted":
		return 3
	case "failed", "error", "rejected":
		return 4
	case "completed", "done", "passed", "success", "accepted":
		return 5
	default:
		return -1
	}
}

func stateGlyph(state string) string {
	switch state {
	case "running", "active", "activated", "in-progress":
		return "◉"
	case "completed", "done", "passed", "success", "accepted":
		return "✓"
	case "failed", "error", "rejected":
		return "×"
	case "pending", "queued":
		return "○"
	case "blocked", "interrupted":
		return "!"
	case "awaiting-human-evaluation":
		return "◇"
	case "resuming":
		return "↻"
	default:
		return "?"
	}
}

func (m model) goalStyle(g goal, selected bool) lipgloss.Style {
	if selected {
		return m.styles.selected
	}
	switch g.state {
	case "running", "active", "activated", "in-progress", "resuming":
		return m.styles.h3
	case "completed", "done", "passed", "success", "accepted":
		return m.styles.success
	case "pending", "queued":
		return m.styles.muted
	case "awaiting-human-evaluation":
		return m.styles.h5
	case "blocked", "interrupted":
		return m.styles.warning
	case "failed", "error", "rejected":
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
	if observation.lifecycle != nil {
		if detail, ok := parseSubagentDetail(observation.lifecycle); ok && observation.lifecycle.Kind == "subagent/started" {
			return m.styles.narrative
		} else if ok && subagentFailed(*observation.lifecycle, detail) {
			return m.styles.h6
		}
	}
	switch state {
	case "running", "active", "activated", "in-progress", "resuming":
		return m.styles.h3
	case "completed", "done", "passed", "success", "accepted":
		return m.styles.success
	case "pending", "queued":
		return m.styles.muted
	case "awaiting-human-evaluation":
		return m.styles.h5
	case "blocked", "interrupted":
		return m.styles.warning
	case "failed", "error", "rejected":
		return m.styles.h6
	default:
		return m.styles.fg
	}
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

func (m model) treeLine(prefix, value string, width int, style lipgloss.Style) string {
	prefix = clean(prefix)
	available := max(0, width-lipgloss.Width(prefix))
	value = truncate(value, available)
	plainWidth := lipgloss.Width(prefix) + lipgloss.Width(value)
	return m.styles.rail.Render(prefix) + style.Render(value) + strings.Repeat(" ", max(0, width-plainWidth))
}

func (m model) selectedLine(prefix, value string, width int) string {
	text := truncate(clean(prefix)+clean(value), width)
	text += strings.Repeat(" ", max(0, width-lipgloss.Width(text)))
	return m.styles.selected.Render(text)
}

func (m model) segmentLine(width int, segments ...styledSegment) string {
	content := m.renderSegments(width, segments...)
	return content + strings.Repeat(" ", max(0, width-lipgloss.Width(content)))
}

func (m model) boxLine(width int, segments ...styledSegment) string {
	innerWidth := max(0, width-2)
	return m.styles.rail.Render("│") + m.segmentLine(innerWidth, segments...) + m.styles.rail.Render("│")
}

func (m model) boxRule(left, right string, width int, segments ...styledSegment) string {
	innerWidth := max(0, width-lipgloss.Width(left)-lipgloss.Width(right))
	content := m.renderSegments(innerWidth, segments...)
	fill := strings.Repeat("─", max(0, innerWidth-lipgloss.Width(content)))
	return m.styles.rail.Render(left) + content + m.styles.rail.Render(fill+right)
}

func (m model) keycap(text string) styledSegment {
	return styledSegment{text, m.styles.keycap}
}

func (m model) renderSegments(width int, segments ...styledSegment) string {
	var line strings.Builder
	remaining := width
	for _, segment := range segments {
		if remaining <= 0 {
			break
		}
		text := truncate(segment.text, remaining)
		line.WriteString(segment.style.Render(text))
		remaining -= lipgloss.Width(text)
		if lipgloss.Width(segment.text) > lipgloss.Width(text) {
			break
		}
	}
	return line.String()
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
