package main

import (
	"encoding/json"
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"

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
	projectPreview string
	featurePreview string
	taskPreview    string
}

type browserPanel string

const (
	browserPanelRun     browserPanel = "run"
	browserPanelProject browserPanel = "project"
	browserPanelFeature browserPanel = "feature"
	browserPanelTask    browserPanel = "task"
)

type browserModel struct {
	entries   []browserEntry
	selected  int
	panel     browserPanel
	width     int
	height    int
	emptyNote string
}

func newBrowserModel(entries []browserEntry) browserModel {
	return browserModel{entries: entries, panel: browserPanelRun, width: 120, height: 32, emptyNote: "no active Runs"}
}

func (m browserModel) Init() tea.Cmd { return nil }

func (m browserModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
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
			if m.selected < len(m.entries)-1 {
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
			if len(m.entries) != 0 {
				m.selected = len(m.entries) - 1
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
		clipText(fmt.Sprintf("ATLAS · %d active Runs · %s preview", len(m.entries), strings.ToUpper(string(m.panel))), m.width),
		clipText("j/k select · g/G ends · p project · f feature · t task · r run · q quit", m.width),
	}
	for i := 0; i < bodyRows; i++ {
		rows = append(rows, padText(valueAt(left, i), leftWidth)+"│"+clipText(valueAt(right, i), rightWidth))
	}
	return strings.Join(rows, "\n")
}

func (m browserModel) leftPane(rows int) []string {
	lines := []string{"RUNS", strings.Repeat("─", maxInt(m.width*32/100, 28))}
	if len(m.entries) == 0 {
		lines = append(lines, m.emptyNote)
		return lines
	}
	for i, entry := range m.entries {
		marker := "  "
		if i == m.selected {
			marker = "> "
		}
		lines = append(lines,
			fmt.Sprintf("%s%s · %s", marker, entry.runID, entry.runName),
			fmt.Sprintf("  %s / %s / %s", entry.projectName, entry.featureName, entry.taskID),
		)
	}
	if len(lines) > rows {
		lines = lines[:rows]
	}
	return lines
}

func (m browserModel) rightPane(width, rows int) []string {
	if len(m.entries) == 0 {
		return []string{"PREVIEW", strings.Repeat("─", maxInt(width, 1)), "No active Run selected."}
	}
	entry := m.entries[m.selected]
	heading := []string{
		fmt.Sprintf("%s · %s", strings.ToUpper(string(m.panel)), entry.runID),
		strings.Repeat("─", maxInt(width, 1)),
	}
	var body string
	switch m.panel {
	case browserPanelProject:
		body = entry.projectPreview
	case browserPanelFeature:
		body = entry.featurePreview
	case browserPanelTask:
		body = entry.taskPreview
	default:
		body = atlaspkg.NewJournalModel(entry.run, width, maxInt(rows-len(heading), 24)).View()
	}
	lines := append(heading, strings.Split(body, "\n")...)
	if len(lines) > rows {
		lines = lines[:rows]
	}
	return lines
}

func buildBrowserEntries(vaultRoot, stateRoot string, reader *vaultregistry.Reader) ([]browserEntry, error) {
	runs, err := reader.List()
	if err != nil {
		return nil, err
	}
	runsByID := make(map[string]vaultregistry.Run, len(runs))
	for _, run := range runs {
		runsByID[run.RunID] = run
	}
	summaries, err := atlaspkg.BuildActiveRunSummaries(vaultRoot, stateRoot)
	if err != nil {
		return nil, err
	}
	entries := make([]browserEntry, 0, len(summaries))
	for _, item := range summaries {
		runID := mapString(item, "id")
		if runID == "" {
			continue
		}
		run, ok := runsByID[runID]
		if !ok {
			return nil, fmt.Errorf("atlas: run %s is missing from the active reader snapshot", runID)
		}
		projectID, projectName := mapPair(item, "project")
		featureID, featureName := mapPair(item, "feature")
		taskID, taskName := mapPair(item, "task")
		projectPreview, err := previewEnvelope(vaultRoot, stateRoot, "projects", atlaspkg.MachineSelector{ID: projectID})
		if err != nil {
			return nil, err
		}
		featurePreview, err := previewEnvelope(vaultRoot, stateRoot, "features", atlaspkg.MachineSelector{ID: featureID})
		if err != nil {
			return nil, err
		}
		taskPreview, err := previewEnvelope(vaultRoot, stateRoot, "tasks", atlaspkg.MachineSelector{ID: taskID})
		if err != nil {
			return nil, err
		}
		entries = append(entries, browserEntry{
			runID:          runID,
			runName:        mapString(item, "name"),
			run:            run,
			projectName:    projectName,
			featureName:    featureName,
			taskID:         taskID,
			taskName:       taskName,
			projectPreview: projectPreview,
			featurePreview: featurePreview,
			taskPreview:    taskPreview,
		})
	}
	return entries, nil
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
	runes := []rune(text)
	if len(runes) <= width {
		return text
	}
	if width == 1 {
		return "…"
	}
	return string(runes[:width-1]) + "…"
}

func padText(text string, width int) string {
	trimmed := clipText(text, width)
	if width <= len([]rune(trimmed)) {
		return trimmed
	}
	return trimmed + strings.Repeat(" ", width-len([]rune(trimmed)))
}

func maxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}
