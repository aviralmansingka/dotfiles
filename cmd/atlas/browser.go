package main

import (
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
	"github.com/muesli/termenv"

	atlaspkg "github.com/aviral/dotfiles/internal/atlas"
	"github.com/aviral/dotfiles/internal/vaultregistry"
)

type browserEntry struct {
	runID          string
	runName        string
	run            vaultregistry.Run
	projectName    string
	featureName    string
	taskID         string
	taskName       string
	taskStatus     string
	projectPreview string
	featurePreview string
	taskPreview    string
}

type browserStyles struct {
	project, feature, tree, row, rowMeta, selected, selectedMeta lipgloss.Style
	green, yellow, red, blue, badge                              lipgloss.Style
}

func newBrowserStyles() browserStyles {
	renderer := lipgloss.NewRenderer(io.Discard)
	renderer.SetColorProfile(termenv.TrueColor)
	return browserStyles{
		project:      renderer.NewStyle().Bold(true).Foreground(lipgloss.Color("#fbf1c7")),
		feature:      renderer.NewStyle().Foreground(lipgloss.Color("#e9b143")),
		tree:         renderer.NewStyle().Foreground(lipgloss.Color("#e9b143")),
		row:          renderer.NewStyle().Foreground(lipgloss.Color("#ebdbb2")),
		rowMeta:      renderer.NewStyle().Foreground(lipgloss.Color("#928374")),
		selected:     renderer.NewStyle().Bold(true).Foreground(lipgloss.Color("#fbf1c7")).Background(lipgloss.Color("#45403d")),
		selectedMeta: renderer.NewStyle().Foreground(lipgloss.Color("#80aa9e")).Background(lipgloss.Color("#45403d")),
		green:        renderer.NewStyle().Foreground(lipgloss.Color("#b8bb26")),
		yellow:       renderer.NewStyle().Foreground(lipgloss.Color("#e9b143")),
		red:          renderer.NewStyle().Foreground(lipgloss.Color("#f2594b")),
		blue:         renderer.NewStyle().Foreground(lipgloss.Color("#80aa9e")),
		badge:        renderer.NewStyle().Bold(true).Foreground(lipgloss.Color("#80aa9e")).Padding(0, 1),
	}
}

type browserPanel string

const (
	browserPanelRun     browserPanel = "run"
	browserPanelProject browserPanel = "project"
	browserPanelFeature browserPanel = "feature"
	browserPanelTask    browserPanel = "task"
)

type browserModel struct {
	entries       []browserEntry
	selected      int
	panel         browserPanel
	width, height int
	emptyNote     string
	colorEnabled  bool
	showDone      map[string]bool
	reload        func() ([]browserEntry, error)
}

type browserRefreshMsg struct {
	entries []browserEntry
	err     error
}

func newBrowserModel(entries []browserEntry) browserModel {
	return browserModel{entries: entries, panel: browserPanelRun, width: 120, height: 32, emptyNote: "no active or not-started Tasks", showDone: map[string]bool{}}
}

func featureKey(entry browserEntry) string { return entry.projectName + "/" + entry.featureName }
func entryKey(entry browserEntry) string {
	if entry.runID != "" {
		return entry.runID
	}
	return entry.taskID
}
func isDoneStatus(status string) bool    { return status == "done" || status == "completed" }
func isPendingStatus(status string) bool { return status == "pending" || status == "pending-work" }
func browserTaskKey(entry browserEntry) string {
	id := canonicalTaskID(entry.taskID)
	if id == "" {
		id = entry.taskName
	}
	if id == "" {
		id = entry.runID
	}
	return featureKey(entry) + "/" + id
}

func (m browserModel) visibleEntries() []browserEntry {
	visible := make([]browserEntry, 0, len(m.entries))
	seenTasks, seenFeatures := map[string]bool{}, map[string]bool{}
	for _, entry := range m.entries {
		key := featureKey(entry)
		seenFeatures[key] = true
		if isDoneStatus(entry.taskStatus) && !m.showDone[key] {
			continue
		}
		taskKey := browserTaskKey(entry)
		if seenTasks[taskKey] {
			continue
		}
		seenTasks[taskKey] = true
		visible = append(visible, entry)
	}
	for _, entry := range m.entries {
		key := featureKey(entry)
		if !seenFeatures[key] {
			continue
		}
		hasVisibleTask := false
		for _, item := range visible {
			if featureKey(item) == key {
				hasVisibleTask = true
				break
			}
		}
		if !hasVisibleTask {
			visible = append(visible, browserEntry{projectName: entry.projectName, featureName: entry.featureName, featurePreview: entry.featurePreview})
		}
		delete(seenFeatures, key)
	}
	sort.SliceStable(visible, func(i, j int) bool {
		if visible[i].projectName != visible[j].projectName {
			return visible[i].projectName < visible[j].projectName
		}
		if visible[i].featureName != visible[j].featureName {
			return visible[i].featureName < visible[j].featureName
		}
		return visible[i].taskID == ""
	})
	return visible
}

func (m browserModel) withReload(reload func() ([]browserEntry, error)) browserModel {
	m.reload = reload
	return m
}
func (m browserModel) withColor(enabled bool) browserModel { m.colorEnabled = enabled; return m }
func (m browserModel) Init() tea.Cmd                       { return m.refreshCmd() }
func (m browserModel) refreshCmd() tea.Cmd {
	if m.reload == nil {
		return nil
	}
	return tea.Tick(time.Second, func(time.Time) tea.Msg {
		entries, err := m.reload()
		return browserRefreshMsg{entries: entries, err: err}
	})
}

func (m browserModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case browserRefreshMsg:
		if msg.err == nil {
			selectedID := ""
			visible := m.visibleEntries()
			if len(visible) != 0 {
				selectedID = entryKey(visible[m.selected])
			}
			m.entries, m.selected = msg.entries, 0
			for i, entry := range m.visibleEntries() {
				if entryKey(entry) == selectedID {
					m.selected = i
					break
				}
			}
		}
		return m, m.refreshCmd()
	case tea.WindowSizeMsg:
		if msg.Width > 0 {
			m.width = msg.Width
		}
		if msg.Height > 0 {
			m.height = msg.Height
		}
	case tea.KeyMsg:
		switch msg.String() {
		case "j", "down":
			if m.selected < len(m.visibleEntries())-1 {
				m.selected++
			}
		case "k", "up":
			if m.selected > 0 {
				m.selected--
			}
		case "g":
			if len(m.entries) != 0 {
				m.selected = 0
			}
		case "G":
			if visible := m.visibleEntries(); len(visible) != 0 {
				m.selected = len(visible) - 1
			}
		case "ctrl+d":
			visible := m.visibleEntries()
			if len(visible) != 0 {
				key, selectedID := featureKey(visible[m.selected]), entryKey(visible[m.selected])
				m.showDone[key] = !m.showDone[key]
				m.selected = 0
				for i, entry := range m.visibleEntries() {
					if entryKey(entry) == selectedID {
						m.selected = i
						break
					}
				}
			}
		case "p":
			m.panel = browserPanelProject
		case "f":
			m.panel = browserPanelFeature
		case "t":
			m.panel = browserPanelTask
		case "r":
			m.panel = browserPanelRun
		case "q", "esc", "ctrl+c":
			return m, tea.Quit
		}
	}
	return m, nil
}

func (m browserModel) View() string {
	if m.width < 120 || m.height < 24 {
		return clipText("terminal too small; minimum 120×24", m.width)
	}
	leftWidth := m.width * 32 / 100
	if leftWidth < 28 {
		leftWidth = 28
	}
	rightWidth := m.width - leftWidth - 1
	bodyRows := m.height - 3
	left := m.leftPane(bodyRows)
	right := m.rightPane(rightWidth, bodyRows)
	rows := []string{
		clipText(fmt.Sprintf("ATLAS · %d visible Tasks · %s preview", len(m.visibleEntries()), strings.ToUpper(string(m.panel))), m.width),
		clipText("j/k select · g/G ends · Ctrl-D done · p project · f feature · t task · r run · q quit", m.width),
	}
	for i := 0; i < bodyRows; i++ {
		rows = append(rows, padText(valueAt(left, i), leftWidth)+"│"+clipText(valueAt(right, i), rightWidth))
	}
	return strings.Join(rows, "\n")
}

func (m browserModel) leftPane(rows int) []string {
	width := maxInt(m.width*32/100, 28)
	entries := m.visibleEntries()
	if len(entries) == 0 {
		return []string{"RUNS", strings.Repeat("─", width), m.emptyNote}
	}
	styles := newBrowserStyles()
	lines := []string{"RUNS", strings.Repeat("─", width)}
	selectedLine := 0
	project, feature := "", ""
	featureContinues := false
	for i, entry := range entries {
		if entry.projectName != project {
			project, feature = entry.projectName, ""
			line := project
			if m.colorEnabled {
				line = styles.project.Render(line)
			}
			lines = append(lines, line)
		}
		if entry.featureName != feature {
			feature = entry.featureName
			featureContinues = laterFeatureInProject(entries, i)
			branch := "└─ "
			if featureContinues {
				branch = "├─ "
			}
			line := branch + feature
			featureSelected := i == m.selected && entry.taskID == ""
			if m.colorEnabled {
				if featureSelected {
					line = styles.selected.Render(branch + feature)
				} else {
					line = styles.tree.Render(branch) + styles.feature.Render(feature)
				}
			}
			lines = append(lines, line)
		}
		if i == m.selected {
			selectedLine = len(lines) - 1
		}
		if entry.taskID == "" {
			continue
		}
		outer := "   "
		if featureContinues {
			outer = "│  "
		}
		taskContinues := laterTaskInFeature(entries, i)
		taskBranch := outer + "└─ "
		childBranch := outer + "   └─ "
		if taskContinues {
			taskBranch, childBranch = outer+"├─ ", outer+"│  └─ "
		}
		lines = append(lines, renderBrowserTask(entry, m.taskRuns(entry), i == m.selected, width, m.colorEnabled, styles, taskBranch, childBranch)...)
	}
	start := maxInt(selectedLine-rows/2, 0)
	if start+rows > len(lines) {
		start = maxInt(len(lines)-rows, 0)
	}
	return lines[start:minInt(start+rows, len(lines))]
}

func laterFeatureInProject(entries []browserEntry, index int) bool {
	current := entries[index]
	for i := index + 1; i < len(entries) && entries[i].projectName == current.projectName; i++ {
		if entries[i].featureName != current.featureName {
			return true
		}
	}
	return false
}

func laterTaskInFeature(entries []browserEntry, index int) bool {
	current := entries[index]
	return index+1 < len(entries) && entries[index+1].projectName == current.projectName && entries[index+1].featureName == current.featureName
}

func (m browserModel) taskRuns(task browserEntry) []browserEntry {
	runs := []browserEntry{}
	for _, entry := range m.entries {
		if browserTaskKey(entry) == browserTaskKey(task) && entry.runID != "" {
			runs = append(runs, entry)
		}
	}
	return runs
}

func renderBrowserTask(entry browserEntry, runs []browserEntry, selected bool, width int, color bool, styles browserStyles, taskBranch, childBranch string) []string {
	taskState, taskBadge := "yellow", "in progress"
	if isPendingStatus(entry.taskStatus) {
		taskState, taskBadge = "blue", "not started"
	}
	if isDoneStatus(entry.taskStatus) {
		taskState, taskBadge = "green", "done"
	}
	title := entry.taskName
	if title == "" {
		title = entry.runName
	}
	lines := []string{treeRow(taskBranch, title, taskBadge, taskState, selected, width, color, styles)}
	if len(runs) == 0 {
		return append(lines, treeRow(childBranch, "no Run registered", "", "blue", false, width, color, styles))
	}
	for i, run := range runs {
		branch := strings.TrimSuffix(childBranch, "└─ ") + "├─ "
		if i == len(runs)-1 {
			branch = childBranch
		}
		runState, runBadge := browserRunStatus(run)
		runText := fmt.Sprintf("%s · rev %d", shortBrowserID(run.runID), run.run.Revision)
		lines = append(lines, treeRow(branch, runText, runBadge, runState, false, width, color, styles))
	}
	return lines
}

func treeRow(branch, text, badge, state string, selected bool, width int, color bool, styles browserStyles) string {
	marker := "● "
	if state == "blue" {
		marker = "○ "
	}
	badgeWidth := 0
	if badge != "" {
		badgeWidth = len([]rune(badge)) + 2
	}
	available := maxInt(width-ansi.StringWidth(branch)-2-badgeWidth, 1)
	text = clipText(text, available)
	gap := strings.Repeat(" ", maxInt(1, available-ansi.StringWidth(text)))
	if !color {
		return branch + marker + text + gap + badge
	}
	treeStyle, textStyle, badgeStyle := styles.tree, styles.row, styles.badge
	dotStyle := styles.yellow
	if state == "green" {
		dotStyle = styles.green
	}
	if state == "red" {
		dotStyle = styles.red
	}
	if state == "blue" {
		dotStyle = styles.blue
	}
	if selected {
		bg := lipgloss.Color("#45403d")
		treeStyle, dotStyle, badgeStyle = treeStyle.Background(bg), dotStyle.Background(bg), badgeStyle.Background(bg)
		textStyle = styles.selected
	}
	result := treeStyle.Render(branch) + dotStyle.Render(marker[:len([]byte(marker))-1]) + textStyle.Render(" "+text+gap)
	if badge != "" {
		result += badgeStyle.Render(badge)
	}
	return result
}

func browserRunStatus(entry browserEntry) (string, string) {
	if entry.taskStatus == "done" {
		return "green", "done"
	}
	goal, state := "", "active"
	for i := len(entry.run.Lifecycle) - 1; i >= 0; i-- {
		if entry.run.Lifecycle[i].GoalID != "" {
			goal, state = entry.run.Lifecycle[i].GoalID, entry.run.Lifecycle[i].State
			break
		}
	}
	for i := len(entry.run.Observations) - 1; i >= 0 && goal == ""; i-- {
		if entry.run.Observations[i].GoalID != "" {
			goal, state = entry.run.Observations[i].GoalID, string(entry.run.Observations[i].State)
		}
	}
	lower := strings.ToLower(state)
	color := "yellow"
	if strings.Contains(lower, "fail") || strings.Contains(lower, "block") || strings.Contains(lower, "reject") || lower == "red" {
		color = "red"
	}
	if strings.Contains(lower, "complete") || strings.Contains(lower, "accept") || lower == "done" || lower == "passed" || lower == "green" {
		color = "green"
	}
	badge := state
	parts := strings.Split(goal, ".")
	for i := len(parts) - 1; i >= 0; i-- {
		if strings.HasPrefix(parts[i], "V") {
			badge = parts[i]
			break
		}
	}
	if badge == "" {
		badge = "run"
	}
	return color, clipText(badge, 8)
}

type featureTask struct{ ID, LocalID, Name, Status string }

func renderFeatureFocus(selected browserEntry, entries []browserEntry, width, rows int, color bool) string {
	var envelope struct {
		Data struct {
			Name  string `json:"name"`
			Tasks []struct {
				ID      string `json:"id"`
				LocalID string `json:"local_id"`
				Name    string `json:"name"`
				Status  string `json:"status"`
			} `json:"tasks"`
		} `json:"data"`
	}
	if json.Unmarshal([]byte(selected.featurePreview), &envelope) != nil {
		return selected.featurePreview
	}
	active, next, done := []featureTask{}, []featureTask{}, 0
	for _, task := range envelope.Data.Tasks {
		item := featureTask{task.ID, task.LocalID, task.Name, task.Status}
		switch task.Status {
		case "in-progress":
			active = append(active, item)
		case "pending", "pending-work":
			next = append(next, item)
		default:
			done++
		}
	}
	styles := newBrowserStyles()
	lines := []string{fmt.Sprintf("%s · %d now · %d next · %d complete", envelope.Data.Name, len(active), len(next), done), ""}
	appendLane := func(label string, tasks []featureTask) {
		if color {
			label = styles.feature.Bold(true).Render(label)
		}
		lines = append(lines, label)
		for _, task := range tasks {
			var run *browserEntry
			for i := range entries {
				if canonicalTaskID(entries[i].taskID) == canonicalTaskID(task.ID) && entries[i].runID != "" {
					run = &entries[i]
				}
			}
			lines = append(lines, renderFeatureTask(task, run, selected.runID, width, color, styles)...)
		}
	}
	appendLane(fmt.Sprintf("NOW · %d", len(active)), active)
	lines = append(lines, "")
	appendLane(fmt.Sprintf("NEXT · %d", len(next)), next)
	if len(lines) > rows {
		lines = lines[:rows]
	}
	return strings.Join(lines, "\n")
}

func renderFeatureTask(task featureTask, run *browserEntry, selectedRunID string, width int, color bool, styles browserStyles) []string {
	badge, dot, stateColor := "not started", "○", "blue"
	selected := false
	if run != nil {
		stateColor, badge = browserRunStatus(*run)
		dot, selected = "●", run.runID == selectedRunID
	}
	title := clipText(task.LocalID+" · "+task.Name, maxInt(width-len([]rune(badge))-6, 1))
	gap := strings.Repeat(" ", maxInt(1, width-2-ansi.StringWidth(title)-len([]rune(badge))-2))
	if !color {
		return []string{"  " + dot + " " + title + gap + badge, "    " + featureStages(run)}
	}
	dotStyle := styles.yellow
	if stateColor == "green" {
		dotStyle = styles.green
	}
	if stateColor == "red" {
		dotStyle = styles.red
	}
	if stateColor == "blue" {
		dotStyle = styles.blue
	}
	primary, badgeStyle := styles.row, styles.badge
	if selected {
		primary = styles.selected
		dotStyle = dotStyle.Background(lipgloss.Color("#45403d"))
		badgeStyle = badgeStyle.Background(lipgloss.Color("#45403d"))
	}
	prefix := "  "
	if selected {
		prefix = "▌ "
	}
	first := primary.Render(prefix) + dotStyle.Render(dot) + primary.Render(" "+title+gap) + badgeStyle.Render(badge)
	stage := "    " + featureStages(run)
	if color {
		stage = styles.rowMeta.Render(stage)
	}
	return []string{first, stage}
}

func featureStages(entry *browserEntry) string {
	phases := []string{"activate", "baseline", "converge", "review", "land", "cleanup"}
	if entry == nil {
		parts := make([]string, len(phases))
		for i, phase := range phases {
			parts[i] = phase + " ○"
		}
		return strings.Join(parts, " ─ ")
	}
	current, failed := 0, false
	observe := func(goal, kind, state string) {
		phase := crewPhase(goal + " " + kind)
		if phase > current {
			current, failed = phase, false
		}
		if phase == current {
			lower := strings.ToLower(state)
			failed = strings.Contains(lower, "fail") || strings.Contains(lower, "block") || strings.Contains(lower, "reject")
		}
	}
	for _, life := range entry.run.Lifecycle {
		observe(life.GoalID, life.Kind, life.State)
	}
	for _, observation := range entry.run.Observations {
		observe(observation.GoalID, string(observation.Kind), string(observation.State))
	}
	parts := make([]string, len(phases))
	for i, phase := range phases {
		mark := "○"
		if i < current {
			mark = "✓"
		}
		if i == current {
			mark = "●"
			if failed {
				mark = "!"
			}
		}
		parts[i] = phase + " " + mark
	}
	return strings.Join(parts, " ─ ")
}

func crewPhase(value string) int {
	value = strings.ToLower(value)
	switch {
	case strings.Contains(value, "cleanup"), strings.Contains(value, "checkpoint-two"):
		return 5
	case strings.Contains(value, "delivery"), strings.Contains(value, "merge"), strings.Contains(value, "pull-request"), strings.Contains(value, " ci"), strings.Contains(value, "land"):
		return 4
	case strings.Contains(value, "review"), strings.Contains(value, "refactor"):
		return 3
	case strings.Contains(value, "baseline"):
		return 1
	case strings.Contains(value, "implement"), strings.Contains(value, "convergence"), strings.Contains(value, "verifier"), strings.Contains(value, ".v"), strings.Contains(value, "worker"), strings.Contains(value, "subagent"):
		return 2
	default:
		return 0
	}
}

func shortBrowserID(id string) string {
	if len(id) <= 8 {
		return id
	}
	return id[:8]
}

func (m browserModel) rightPane(width, rows int) []string {
	visible := m.visibleEntries()
	if len(visible) == 0 {
		return []string{"PREVIEW", strings.Repeat("─", maxInt(width, 1)), "No visible Task selected."}
	}
	entry := visible[m.selected]
	heading := []string{
		fmt.Sprintf("%s · %s", strings.ToUpper(string(m.panel)), entry.runID),
		strings.Repeat("─", maxInt(width, 1)),
	}
	var body string
	switch m.panel {
	case browserPanelProject:
		body = entry.projectPreview
	case browserPanelFeature:
		body = renderFeatureFocus(entry, m.entries, width, rows-len(heading), m.colorEnabled)
	case browserPanelTask:
		body = entry.taskPreview
	default:
		if entry.runID == "" {
			body = renderNotStartedTask(entry, width, m.colorEnabled)
		} else {
			body = atlaspkg.NewJournalModel(entry.run, width, maxInt(rows-len(heading), 24)).ViewColor(m.colorEnabled)
		}
	}
	lines := append(heading, strings.Split(body, "\n")...)
	if len(lines) > rows {
		lines = lines[:rows]
	}
	return lines
}

func renderNotStartedTask(entry browserEntry, width int, color bool) string {
	var envelope struct {
		Data struct {
			LocalID   string `json:"local_id"`
			Name      string `json:"name"`
			Status    string `json:"status"`
			Intent    string `json:"intent"`
			Verifiers []any  `json:"verifiers"`
			Evidence  []any  `json:"evidence"`
		} `json:"data"`
	}
	if json.Unmarshal([]byte(entry.taskPreview), &envelope) != nil {
		return entry.taskPreview
	}
	styles := newBrowserStyles()
	lines := []string{envelope.Data.LocalID + " · " + envelope.Data.Name, "status · " + envelope.Data.Status, "", "STAGES", "activate ○ ─ baseline ○ ─ converge ○ ─ review ○ ─ land ○ ─ cleanup ○", "", "PROVENANCE PREVIEW", "intent · " + envelope.Data.Intent, fmt.Sprintf("verifiers · %d · evidence · %d", len(envelope.Data.Verifiers), len(envelope.Data.Evidence)), "", "No Run has been registered for this Task."}
	if color {
		lines[0] = styles.feature.Bold(true).Render(lines[0])
		lines[1] = styles.selectedMeta.Render(lines[1])
		lines[3] = styles.feature.Render(lines[3])
		lines[6] = styles.feature.Render(lines[6])
	}
	for i := range lines {
		lines[i] = clipText(lines[i], width)
	}
	return strings.Join(lines, "\n")
}

func canonicalTaskID(id string) string { return strings.TrimPrefix(id, "/Users/aviral/vault/") }

func buildBrowserEntries(vaultRoot, stateRoot string, reader *vaultregistry.Reader, warnings io.Writer) ([]browserEntry, error) {
	runs, err := reader.List()
	if err != nil {
		return nil, err
	}
	runsByID := make(map[string]vaultregistry.Run, len(runs))
	for _, run := range runs {
		runsByID[run.RunID] = run
	}
	summaries, err := atlaspkg.BuildRunSummaries(vaultRoot, stateRoot, runs)
	if err != nil {
		return nil, err
	}
	entries := make([]browserEntry, 0, len(summaries))
	for _, item := range summaries {
		runID := mapString(item, "id")
		if runID == "" {
			continue
		}
		run := runsByID[runID]
		projectID, projectName := mapPair(item, "project")
		featureID, featureName := mapPair(item, "feature")
		taskID, taskName := mapPair(item, "task")
		taskValue, _ := item["task"].(map[string]any)
		projectPreview, err := previewEnvelope(vaultRoot, stateRoot, "projects", atlaspkg.MachineSelector{ID: projectID})
		if err != nil {
			warnUnrenderableRun(warnings, run, err)
			continue
		}
		featurePreview, err := previewEnvelope(vaultRoot, stateRoot, "features", atlaspkg.MachineSelector{ID: featureID})
		if err != nil {
			warnUnrenderableRun(warnings, run, err)
			continue
		}
		taskPreview, err := previewEnvelope(vaultRoot, stateRoot, "tasks", atlaspkg.MachineSelector{ID: taskID})
		if err != nil {
			warnUnrenderableRun(warnings, run, err)
			continue
		}
		entries = append(entries, browserEntry{
			runID:          runID,
			runName:        mapString(item, "name"),
			run:            run,
			projectName:    projectName,
			featureName:    featureName,
			taskID:         taskID,
			taskName:       taskName,
			taskStatus:     mapString(taskValue, "status"),
			projectPreview: projectPreview,
			featurePreview: featurePreview,
			taskPreview:    taskPreview,
		})
	}
	existing := map[string]bool{}
	for _, entry := range entries {
		existing[canonicalTaskID(entry.taskID)] = true
	}
	tasks, err := atlaspkg.BuildTaskSummaries(vaultRoot, stateRoot)
	if err != nil {
		return nil, err
	}
	for _, task := range tasks {
		taskID := mapString(task, "id")
		if existing[canonicalTaskID(taskID)] {
			continue
		}
		projectID, projectName := mapPair(task, "project")
		featureID, featureName := mapPair(task, "feature")
		projectPreview, projectErr := previewEnvelope(vaultRoot, stateRoot, "projects", atlaspkg.MachineSelector{ID: projectID})
		featurePreview, featureErr := previewEnvelope(vaultRoot, stateRoot, "features", atlaspkg.MachineSelector{ID: featureID})
		taskPreview, taskErr := previewEnvelope(vaultRoot, stateRoot, "tasks", atlaspkg.MachineSelector{ID: taskID})
		if projectErr != nil || featureErr != nil || taskErr != nil {
			continue
		}
		entries = append(entries, browserEntry{runName: mapString(task, "name"), projectName: projectName, featureName: featureName, taskID: taskID, taskName: mapString(task, "name"), taskStatus: mapString(task, "status"), projectPreview: projectPreview, featurePreview: featurePreview, taskPreview: taskPreview})
	}
	sort.SliceStable(entries, func(i, j int) bool {
		left, right := entries[i], entries[j]
		if left.projectName != right.projectName {
			return left.projectName < right.projectName
		}
		if left.featureName != right.featureName {
			return left.featureName < right.featureName
		}
		if left.taskName != right.taskName {
			return left.taskName < right.taskName
		}
		return left.runID < right.runID
	})
	return entries, nil
}

func warnUnrenderableRun(w io.Writer, run vaultregistry.Run, err error) {
	path := run.Task.Path
	if run.WorkReference != nil {
		path = run.WorkReference.Path
	}
	fmt.Fprintf(w, "atlas: warning: skipping unrenderable run %s (%s): %v\n", run.RunID, path, err)
}

func previewEnvelope(vaultRoot, stateRoot, resource string, selector atlaspkg.MachineSelector) (string, error) {
	envelope, err := atlaspkg.BuildEnvelope(vaultRoot, stateRoot, resource, selector, atlaspkg.MachineGetOptions{})
	if err != nil {
		return "", err
	}
	data, err := json.MarshalIndent(envelope, "", "  ")
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func mapPair(item map[string]any, key string) (string, string) {
	value, _ := item[key].(map[string]any)
	return mapString(value, "id"), mapString(value, "name")
}

func mapString(item map[string]any, key string) string {
	if item == nil {
		return ""
	}
	value, _ := item[key].(string)
	return value
}

func valueAt(lines []string, index int) string {
	if index >= 0 && index < len(lines) {
		return lines[index]
	}
	return ""
}

func clipText(text string, width int) string {
	if width <= 0 {
		return ""
	}
	if ansi.StringWidth(text) <= width {
		return text
	}
	if width == 1 {
		return "…"
	}
	return ansi.Truncate(text, width, "…")
}

func padText(text string, width int) string {
	trimmed := clipText(text, width)
	textWidth := ansi.StringWidth(trimmed)
	if width <= textWidth {
		return trimmed
	}
	return trimmed + strings.Repeat(" ", width-textWidth)
}

func maxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}

func minInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}
