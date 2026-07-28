package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/charmbracelet/lipgloss"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

type journeyGoal struct {
	id, kind, state, first, latest string
}

const (
	reset   = "\x1b[0m"
	accent  = "\x1b[1;38;2;242;133;52m"
	text    = "\x1b[38;2;235;219;178m"
	muted   = "\x1b[38;2;146;131;116m"
	active  = "\x1b[38;2;233;177;67m"
	success = "\x1b[38;2;184;187;38m"
	failure = "\x1b[38;2;242;89;75m"
)

func main() {
	runID := flag.String("run-id", "", "Run ID to summarize")
	stateDir := flag.String("state-dir", "", "Registry root (defaults to VAULT_HUNTER_STATE_DIR/XDG state)")
	width := flag.Int("width", 30, "Atlas Preview interior width")
	color := flag.String("color", "auto", "color mode: auto, always, never")
	flag.Parse()
	if *runID == "" || *width < 1 || flag.NArg() != 0 || (*color != "auto" && *color != "always" && *color != "never") {
		flag.Usage()
		os.Exit(2)
	}

	reader, err := vaultregistry.OpenReader(*stateDir)
	if err != nil {
		fail(err)
	}
	run, err := reader.Get(*runID)
	retired := false
	if errors.Is(err, vaultregistry.ErrNotFound) {
		run, err = reader.GetRetired(*runID)
		retired = err == nil
	}
	if err != nil {
		fail(err)
	}

	for _, line := range render(run, retired, *width) {
		if colorEnabled(*color) && line != "" {
			line = style(line) + reset
		}
		fmt.Println(line)
	}
}

func render(run vaultregistry.Run, retired bool, width int) []string {
	goals := normalize(run)
	selected := selectGoal(goals)
	lines := []string{
		clip(clean(run.Task.ID+" · "+run.RunID), width),
		clip(fmt.Sprintf("JOURNEY · selected %d/%d", ordinal(selected, len(goals)), len(goals)), width),
		"│",
	}

	start, end := window(selected, len(goals), 5)
	for i := start; i < end; i++ {
		connector := "├─"
		if i == len(goals)-1 {
			connector = "└─"
		}
		lines = append(lines, clip(fmt.Sprintf("%s %s %s · %s", connector, glyph(goals[i].state), goals[i].id, value(goals[i].state)), width))
	}
	if len(goals) == 0 {
		lines = append(lines, "└─ ? no recorded goals")
	}
	for len(lines) < 8 {
		lines = append(lines, "│")
	}
	lines = append(lines, "", clip(participant(run, selectedGoalID(goals, selected)), width))
	stamp := "latest " + clock(run.UpdatedAt)
	if retired {
		stamp = "retired · " + clock(run.UpdatedAt)
	}
	lines = append(lines, clip(stamp, width), clip("projection, not authority", width))
	return lines[:12]
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

func participant(run vaultregistry.Run, goalID string) string {
	id, role, latest := "", "", ""
	for _, item := range run.Participants {
		if item.GoalID == goalID && later(item.ObservedAt, latest) {
			id, role, latest = clean(item.ParticipantID), clean(item.Role), item.ObservedAt
		}
	}
	for _, observation := range run.Observations {
		payload := observation.Payload.RegisteredParticipant
		if observation.GoalID == goalID && payload != nil && later(observation.ObservedAt, latest) {
			id, role, latest = clean(payload.ParticipantID), clean(payload.Role), observation.ObservedAt
		}
	}
	if id == "" {
		return "participant unavailable"
	}
	return id + " · " + value(role)
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

func selectedGoalID(goals []journeyGoal, selected int) string {
	if len(goals) == 0 {
		return ""
	}
	return goals[selected].id
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

func style(line string) string {
	switch {
	case strings.HasPrefix(line, "RECORDED JOURNEY"), strings.Contains(line, " · ") && !strings.Contains(line, "─") && !strings.Contains(line, "◉") && !strings.Contains(line, "●") && !strings.Contains(line, "×"):
		return accent + line
	case strings.Contains(line, "◉"):
		return active + line
	case strings.Contains(line, "●"):
		return success + line
	case strings.Contains(line, "×"):
		return failure + line
	case line == "│" || strings.Contains(line, "projection, not authority"):
		return muted + line
	default:
		return text + line
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
	info, err := os.Stdout.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
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

func clock(value string) string {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return "time unavailable"
	}
	return parsed.UTC().Format("15:04 UTC")
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
