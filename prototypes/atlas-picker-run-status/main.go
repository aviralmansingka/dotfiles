package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

type journeyGoal struct {
	id, kind, state, first, latest string
}

type renderedLine struct {
	plain, styled string
}

type milestoneState int

const (
	milestoneInProgress milestoneState = iota
	milestoneIntermediate
	milestoneComplete
	milestoneFailed
)

type model struct {
	run      vaultregistry.Run
	goals    []journeyGoal
	selected int
	width    int
	color    bool
}

const (
	reset      = "\x1b[0m"
	bold       = "\x1b[1m"
	text       = "\x1b[38;2;235;219;178m"
	bright     = "\x1b[38;2;251;241;199m"
	rail       = "\x1b[38;2;80;73;69m"
	muted      = "\x1b[38;2;146;131;116m"
	dim        = "\x1b[38;2;102;92;84m"
	active     = "\x1b[38;2;242;133;52m"
	success    = "\x1b[38;2;184;187;38m"
	failure    = "\x1b[38;2;242;89;75m"
	attention  = "\x1b[38;2;250;189;47m"
	blueBright = "\x1b[38;2;131;165;151m"
)

func main() {
	stateDir := flag.String("state-dir", "", "Registry root (defaults to normal Vault Hunter state resolution)")
	width := flag.Int("width", 30, "Atlas Preview interior width")
	color := flag.String("color", "auto", "color mode: auto, always, never")
	goal := flag.String("goal", "", "initial Goal ID or 1-based ordinal")
	listGoals := flag.Bool("list-goals", false, "list recorded Goals and exit")
	snapshot := flag.Bool("snapshot", false, "print one 12-row picker frame")
	flag.Usage = func() {
		fmt.Fprintln(flag.CommandLine.Output(), "usage: go run ./prototypes/atlas-picker-run-status [flags] <task-id-or-run-id>")
		flag.PrintDefaults()
	}
	flag.Parse()
	if flag.NArg() != 1 || *width < 1 || (*color != "auto" && *color != "always" && *color != "never") {
		flag.Usage()
		os.Exit(2)
	}

	reader, err := vaultregistry.OpenReader(*stateDir)
	if err != nil {
		fail(err)
	}
	run, _, err := resolveRun(reader, flag.Arg(0))
	if err != nil {
		fail(err)
	}
	goals := normalize(run)
	if *listGoals {
		for index, item := range goals {
			fmt.Printf("%d\t%s\t%s\t%s\n", index+1, item.id, value(item.kind), value(item.state))
		}
		return
	}
	selected, err := selectRequestedGoal(goals, *goal)
	if err != nil {
		fail(err)
	}

	colors := colorEnabled(*color)
	m := model{run: run, goals: goals, selected: selected, width: *width, color: colors}
	interactive := !*snapshot && characterDevice(os.Stdin) && characterDevice(os.Stdout) && os.Getenv("TERM") != "dumb"
	if !interactive {
		fmt.Println(strings.Join(m.frame(false), "\n"))
		return
	}
	if _, err := tea.NewProgram(m, tea.WithAltScreen()).Run(); err != nil {
		fail(err)
	}
}

func resolveRun(reader *vaultregistry.Reader, target string) (vaultregistry.Run, bool, error) {
	if run, err := reader.Get(target); err == nil {
		return run, false, nil
	} else if !errors.Is(err, vaultregistry.ErrNotFound) && !errors.Is(err, vaultregistry.ErrInvalidID) {
		return vaultregistry.Run{}, false, err
	}
	if run, err := reader.GetRetired(target); err == nil {
		return run, true, nil
	} else if !errors.Is(err, vaultregistry.ErrNotFound) && !errors.Is(err, vaultregistry.ErrInvalidID) {
		return vaultregistry.Run{}, false, err
	}

	runs, err := reader.List()
	if err != nil {
		return vaultregistry.Run{}, false, err
	}
	var matches []vaultregistry.Run
	for _, run := range runs {
		if strings.EqualFold(run.Task.ID, target) {
			matches = append(matches, run)
		}
	}
	if len(matches) == 1 {
		return matches[0], false, nil
	}
	if len(matches) > 1 {
		ids := make([]string, len(matches))
		for i, run := range matches {
			ids[i] = run.RunID
		}
		return vaultregistry.Run{}, false, fmt.Errorf("Task %q matches multiple active Runs: %s", target, strings.Join(ids, ", "))
	}
	return vaultregistry.Run{}, false, fmt.Errorf("no active Task or recorded Run matches %q", target)
}

func (m model) Init() tea.Cmd { return nil }

func (m model) Update(message tea.Msg) (tea.Model, tea.Cmd) {
	key, ok := message.(tea.KeyMsg)
	if !ok {
		return m, nil
	}
	switch key.String() {
	case "j", "down":
		if m.selected < len(m.goals)-1 {
			m.selected++
		}
	case "k", "up":
		if m.selected > 0 {
			m.selected--
		}
	case "g":
		if len(m.goals) != 0 {
			m.selected = 0
		}
	case "G":
		if len(m.goals) != 0 {
			m.selected = len(m.goals) - 1
		}
	case "q", "esc", "ctrl+c":
		return m, tea.Quit
	}
	return m, nil
}

func (m model) View() string {
	return panel(m.frame(true), m.width, m.color) + "\n" + colorize(m.color, muted, "j/k select · g/G ends · q quit")
}

func (m model) frame(selectedDetail bool) []string {
	rows := m.lines(selectedDetail)
	result := make([]string, len(rows))
	for i, row := range rows {
		result[i] = row.plain
		if m.color {
			result[i] = row.styled
		}
	}
	return result
}

func (m model) lines(_ bool) []renderedLine {
	lines := headerLines(m.run, m.goals, m.width, m.color)
	lines = append(lines, summaryLines(m.run, m.goals, m.width, m.color)...)

	start, end := window(m.selected, len(m.goals), 5)
	for index := start; index < end; index++ {
		connector := "├─"
		if index == end-1 {
			connector = "└─"
		}
		lines = append(lines, goalLine(m.goals[index], connector, index == m.selected, m.width, m.color))
	}
	if len(m.goals) == 0 {
		lines = append(lines, cardLine(" └─ ○ no recorded goals", m.width, m.color, muted))
	}
	for len(lines) < len(headerLines(m.run, m.goals, m.width, m.color))+6 {
		lines = append(lines, cardLine("", m.width, m.color, text))
	}

	footer := fmt.Sprintf(" %d total · selected %d/%d", len(m.goals), ordinal(m.selected, len(m.goals)), len(m.goals))
	for len(lines) < 11 {
		lines = append(lines, segmentLine("", ""))
	}
	lines = append(lines, cardLine(footer, m.width, m.color, muted))
	return lines[:12]
}

func headerLines(run vaultregistry.Run, goals []journeyGoal, width int, colors bool) []renderedLine {
	feature := wrap(clean(featureLabel(run.Task.FeaturePath)), width, 2)
	taskID := shortTaskID(run.Task.ID, run.Task.Title)
	taskTitle := clean(run.Task.Title)
	for _, prefix := range []string{taskID + ": ", taskID + " · ", run.Task.ID + ": ", run.Task.ID + " · "} {
		taskTitle = strings.TrimPrefix(taskTitle, prefix)
	}
	task := wrap(clean(taskID+" · "+taskTitle), width, 2)
	for len(feature)+len(task) > 3 {
		if len(task) > 1 {
			task = task[:1]
		} else if len(feature) > 1 {
			feature = feature[:1]
		} else {
			break
		}
	}
	lines := make([]renderedLine, 0, 5)
	for _, line := range feature {
		lines = append(lines, cardLine(line, width, colors, blueBright+bold))
	}
	for _, line := range task {
		lines = append(lines, cardLine(line, width, colors, bright+bold))
	}
	glyph, label, color := taskState(goals)
	lines = append(lines, cardLine(glyph+" recorded "+label, width, colors, color+bold))
	return lines
}

func summaryLines(run vaultregistry.Run, goals []journeyGoal, width int, colors bool) []renderedLine {
	const legend = "3 G · 5 S · 2 V  "
	prefix := " │  "
	mark := milestoneMark(verifierSummary(run, goals), colors)
	plain := clip(prefix+legend+mark.plain, width)
	styled := colorize(colors, rail, prefix) + colorize(colors, muted, legend) + mark.styled
	return []renderedLine{segmentLine(plain, styled)}
}

func verifierSummary(run vaultregistry.Run, goals []journeyGoal) milestoneState {
	hasRecords, hasComplete, hasIncomplete, hasFailure := false, false, false, false
	record := func(id, state string) {
		if clean(id) == "" {
			return
		}
		hasRecords = true
		switch glyph(clean(state)) {
		case "●":
			hasComplete = true
		case "×":
			hasFailure = true
		default:
			hasIncomplete = true
		}
	}
	for _, evidence := range run.Evidence {
		record(evidence.VerifierID, evidence.State)
	}
	for _, item := range run.Observations {
		if attempt := item.Payload.VerifierAttempt; attempt != nil {
			record(attempt.Identity.VerifierID, string(item.State))
		}
		if gap := item.Payload.VerifierAttemptGap; gap != nil {
			record(gap.Identity.VerifierID, string(item.State))
		}
	}

	if !hasRecords {
		for _, goal := range goals {
			switch glyph(goal.state) {
			case "●":
				hasComplete = true
			case "×":
				hasFailure = true
			default:
				hasIncomplete = true
			}
		}
	}
	if hasFailure {
		return milestoneFailed
	}
	if hasComplete && !hasIncomplete {
		return milestoneComplete
	}
	if hasComplete {
		return milestoneIntermediate
	}
	return milestoneInProgress
}

func milestoneMark(state milestoneState, colors bool) renderedLine {
	switch state {
	case milestoneComplete:
		return segmentLine("●", colorize(colors, success, "●"))
	case milestoneIntermediate:
		return segmentLine("◐◑", colorize(colors, success, "◐")+colorize(colors, active, "◑"))
	case milestoneFailed:
		return segmentLine("×", colorize(colors, failure, "×"))
	default:
		return segmentLine("●", colorize(colors, active, "●"))
	}
}

func goalLine(goal journeyGoal, connector string, selected bool, width int, colors bool) renderedLine {
	statusGlyph := glyph(goal.state)
	raw := clip(fmt.Sprintf(" %s %s %s · %s", connector, statusGlyph, goal.id, value(goal.state)), width)
	plain := raw
	prefix := " " + connector + " "
	rest := strings.TrimPrefix(raw, prefix+statusGlyph+" ")
	name, detail := rest, ""
	if index := strings.Index(rest, " · "); index >= 0 {
		name, detail = rest[:index], rest[index:]
	}
	nameColor, detailColor := text, muted
	if selected {
		nameColor, detailColor = attention, attention
	}
	styled := colorize(colors, rail, prefix) + colorize(colors, statusColor(goal.state), statusGlyph) + colorize(colors, text, " ") + colorize(colors, nameColor+bold, name) + colorize(colors, detailColor, detail)
	return segmentLine(plain, styled)
}

func cardLine(value string, width int, colors bool, foreground string) renderedLine {
	raw := clip(clean(value), width)
	return segmentLine(raw, colorize(colors, foreground, raw))
}

func segmentLine(plain, styled string) renderedLine {
	return renderedLine{plain: plain, styled: styled}
}

func panel(lines []string, width int, colors bool) string {
	label := " Atlas Preview "
	if lipgloss.Width(label) > width {
		label = clip(label, width)
	}
	top := "╭" + label + strings.Repeat("─", max(0, width-lipgloss.Width(label))) + "╮"
	bottom := "╰" + strings.Repeat("─", width) + "╯"
	out := []string{colorize(colors, rail, top)}
	for _, line := range lines {
		padding := strings.Repeat(" ", max(0, width-lipgloss.Width(stripSGR(line))))
		out = append(out, colorize(colors, rail, "│")+line+padding+colorize(colors, rail, "│"))
	}
	out = append(out, colorize(colors, rail, bottom))
	return strings.Join(out, "\n")
}

func normalize(run vaultregistry.Run) []journeyGoal {
	byID := map[string]*journeyGoal{}
	ensure := func(id, at string) *journeyGoal {
		id = clean(id)
		if id == "" {
			return nil
		}
		if byID[id] == nil {
			byID[id] = &journeyGoal{id: id, first: at}
		}
		if byID[id].first == "" || at != "" && at < byID[id].first {
			byID[id].first = at
		}
		return byID[id]
	}
	for _, observation := range run.Lifecycle {
		if goal := ensure(observation.GoalID, observation.ObservedAt); goal != nil && later(observation.ObservedAt, goal.latest) {
			goal.kind, goal.state, goal.latest = clean(observation.Kind), clean(observation.State), observation.ObservedAt
		}
	}
	for _, evidence := range run.Evidence {
		if goal := ensure(evidence.VerifierID, evidence.ObservedAt); goal != nil && goal.latest == "" {
			goal.kind, goal.state, goal.latest = "evidence", clean(evidence.State), evidence.ObservedAt
		}
	}
	for _, participant := range run.Participants {
		ensure(participant.GoalID, participant.ObservedAt)
	}
	for _, observation := range run.Observations {
		if goal := ensure(observation.GoalID, observation.ObservedAt); goal != nil && later(observation.ObservedAt, goal.latest) {
			goal.kind, goal.state, goal.latest = clean(string(observation.Kind)), clean(string(observation.State)), observation.ObservedAt
		}
	}
	goals := make([]journeyGoal, 0, len(byID))
	for _, goal := range byID {
		goals = append(goals, *goal)
	}
	sort.Slice(goals, func(i, j int) bool {
		if goals[i].first != goals[j].first {
			return goals[i].first < goals[j].first
		}
		return goals[i].id < goals[j].id
	})
	return goals
}

func selectRequestedGoal(goals []journeyGoal, requested string) (int, error) {
	if requested == "" {
		return selectGoal(goals), nil
	}
	if ordinal, err := strconv.Atoi(requested); err == nil {
		if ordinal < 1 || ordinal > len(goals) {
			return 0, fmt.Errorf("Goal ordinal %d outside 1..%d", ordinal, len(goals))
		}
		return ordinal - 1, nil
	}
	for index, goal := range goals {
		if goal.id == requested {
			return index, nil
		}
	}
	return 0, fmt.Errorf("Goal not found: %s", requested)
}

func selectGoal(goals []journeyGoal) int {
	selected, latest := len(goals)-1, ""
	for i, goal := range goals {
		if activeState(goal.state) && later(goal.latest, latest) {
			selected, latest = i, goal.latest
		}
	}
	if selected < 0 {
		return 0
	}
	return selected
}

func window(selected, total, limit int) (int, int) {
	if total <= limit {
		return 0, total
	}
	start := selected - limit/2
	if start < 0 {
		start = 0
	}
	if start+limit > total {
		start = total - limit
	}
	return start, start + limit
}

func ordinal(selected, total int) int {
	if total == 0 {
		return 0
	}
	return selected + 1
}

func later(candidate, current string) bool {
	if current == "" {
		return true
	}
	left, leftErr := time.Parse(time.RFC3339Nano, candidate)
	right, rightErr := time.Parse(time.RFC3339Nano, current)
	if leftErr == nil && rightErr == nil {
		return !left.Before(right)
	}
	return candidate >= current
}

func activeState(state string) bool {
	switch state {
	case "active", "running", "resuming", "awaiting-human-evaluation":
		return true
	default:
		return false
	}
}

func glyph(state string) string {
	switch state {
	case "done", "completed", "passed", "accepted", "success", "succeeded":
		return "●"
	case "active", "running", "resuming", "awaiting-human-evaluation":
		return "◉"
	case "failed", "rejected", "blocked", "error", "interrupted":
		return "×"
	case "pending", "incomplete":
		return "○"
	default:
		return "?"
	}
}

func taskState(goals []journeyGoal) (string, string, string) {
	if len(goals) == 0 {
		return "○", "state unavailable", muted
	}
	allSuccessful, hasAccepted, hasPending, hasActive, hasFailure := true, false, false, false, false
	for _, goal := range goals {
		hasActive = hasActive || activeState(goal.state)
		switch glyph(goal.state) {
		case "×":
			hasFailure = true
			allSuccessful = false
		case "○", "?":
			allSuccessful = false
			hasPending = true
		}
		hasAccepted = hasAccepted || goal.state == "accepted"
	}
	if hasFailure {
		return "×", "needs attention", failure
	}
	if hasActive {
		return "◉", "in progress", active
	}
	if allSuccessful {
		if hasAccepted {
			return "●", "accepted", success
		}
		return "●", "done", success
	}
	if hasPending {
		return "○", "pending", attention
	}
	return "?", "state unavailable", muted
}

func shortTaskID(id, title string) string {
	if prefix, _, ok := strings.Cut(clean(title), ":"); ok && len(prefix) > 1 && (prefix[0] == 'T' || prefix[0] == 't') {
		if _, err := strconv.Atoi(prefix[1:]); err == nil {
			return strings.ToUpper(prefix)
		}
	}
	if len(id) > 1 && (id[0] == 'T' || id[0] == 't') {
		if _, err := strconv.Atoi(id[1:]); err == nil {
			return strings.ToUpper(id)
		}
	}
	parts := strings.Split(strings.ToLower(id), "-")
	if len(parts) >= 2 && parts[len(parts)-2] == "task" {
		if _, err := strconv.Atoi(parts[len(parts)-1]); err == nil {
			return "T" + parts[len(parts)-1]
		}
	}
	return id
}

func featureLabel(path string) string {
	base := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	if base == "feature" {
		base = filepath.Base(filepath.Dir(path))
	}
	if base == "" || base == "." {
		return "Feature unavailable"
	}
	words := strings.Fields(strings.NewReplacer("-", " ", "_", " ").Replace(base))
	for i, word := range words {
		if word != "" {
			words[i] = strings.ToUpper(word[:1]) + word[1:]
		}
	}
	return strings.Join(words, " ")
}

func wrap(value string, width, limit int) []string {
	words := strings.Fields(value)
	if len(words) == 0 {
		return []string{"?"}
	}
	var lines []string
	for _, word := range words {
		if len(lines) == 0 || lipgloss.Width(lines[len(lines)-1]+" "+word) > width {
			lines = append(lines, clip(word, width))
		} else {
			lines[len(lines)-1] += " " + word
		}
	}
	if len(lines) > limit {
		lines = lines[:limit]
		lines[limit-1] = clip(lines[limit-1]+"…", width)
	}
	return lines
}

func statusColor(state string) string {
	switch glyph(state) {
	case "●":
		return success
	case "◉":
		return active
	case "×":
		return failure
	default:
		return dim
	}
}

func colorEnabled(mode string) bool {
	if mode == "always" {
		return true
	}
	if mode == "never" || os.Getenv("TERM") == "dumb" {
		return false
	}
	if _, disabled := os.LookupEnv("NO_COLOR"); disabled {
		return false
	}
	return characterDevice(os.Stdout)
}

func characterDevice(file *os.File) bool {
	info, err := file.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}

func colorize(enabled bool, color, value string) string {
	if !enabled || value == "" {
		return value
	}
	return color + value + reset
}

func stripSGR(value string) string {
	for {
		start := strings.IndexByte(value, '\x1b')
		if start < 0 {
			return value
		}
		end := strings.IndexByte(value[start:], 'm')
		if end < 0 {
			return value[:start]
		}
		value = value[:start] + value[start+end+1:]
	}
}

func clean(value string) string {
	return strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, value))
}

func clip(value string, width int) string {
	if lipgloss.Width(value) <= width {
		return value
	}
	if width <= 1 {
		if width == 1 {
			return "…"
		}
		return ""
	}
	runes := []rune(value)
	for len(runes) > 0 && lipgloss.Width(string(runes)) > width-1 {
		runes = runes[:len(runes)-1]
	}
	return string(runes) + "…"
}

func value(value string) string {
	if value == "" {
		return "?"
	}
	return value
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
