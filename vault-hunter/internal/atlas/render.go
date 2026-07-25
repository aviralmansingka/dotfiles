package atlas

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

func RenderExpanded(run Run, width, height int) string {
	active := run.active()
	lines := []string{
		fmt.Sprintf("Vault Hunter · %s · %s", run.RunID, strings.ToUpper(run.Status)),
		activeSummary(active),
		"next: " + run.NextAction,
		"",
		"GOAL TIMELINE",
	}
	for _, goal := range run.Goals {
		lines = append(lines, goalLine(goal))
	}
	lines = append(lines, "", "SELECTED VERIFIER JOURNEY")
	if active.Verifier != nil {
		for _, step := range active.Verifier.Journey {
			lines = append(lines, statusGlyph(step.Status)+" "+step.Label)
		}
	}
	lines = append(lines, "", "EVIDENCE")
	for _, evidence := range run.Evidence {
		lines = append(lines, evidence.ID+" "+evidence.Summary)
	}
	return fitLines(lines, width, height)
}

func RenderCompact(run Run, width, height int) string {
	active := run.active()
	if width < 64 {
		lines := []string{
			"Vault Hunter Atlas · " + run.RunID,
			activeSummary(active),
			"next: " + run.NextAction,
		}
		for _, goal := range run.Goals {
			lines = append(lines, goalLine(goal))
		}
		for _, evidence := range run.Evidence {
			lines = append(lines, evidence.ID+" "+evidence.Summary)
		}
		return fitLines(lines, width, height)
	}

	left := []string{"GOALS"}
	for _, goal := range run.Goals {
		left = append(left, goalLine(goal))
	}
	right := []string{active.ID + " · VERIFIER JOURNEY"}
	if active.Verifier != nil {
		for _, step := range active.Verifier.Journey {
			right = append(right, statusGlyph(step.Status)+" "+step.Label)
		}
	}
	columnGap := 3
	leftWidth := width * 45 / 100
	rightWidth := width - leftWidth - columnGap
	bodyRows := len(left)
	if len(right) > bodyRows {
		bodyRows = len(right)
	}
	lines := []string{
		center("Vault Hunter Atlas · "+run.RunID, width),
		strings.Repeat("─", width),
	}
	for index := 0; index < bodyRows; index++ {
		lines = append(lines, joinColumns(at(left, index), at(right, index), leftWidth, rightWidth, columnGap))
	}
	lines = append(lines,
		strings.Repeat("─", width),
		activeSummary(active),
		"next: "+run.NextAction,
	)
	for _, evidence := range run.Evidence {
		lines = append(lines, evidence.ID+" "+evidence.Summary)
	}
	lines = append(lines, "j/k goal · enter expand")
	return fitLines(lines, width, height)
}

func activeSummary(goal Goal) string {
	summary := "/goal " + goal.ID
	if goal.Verifier == nil {
		return summary
	}
	return fmt.Sprintf(
		"%s · %s · iteration %d",
		summary,
		strings.ToUpper(goal.Verifier.State),
		goal.Verifier.Iteration,
	)
}

func goalLine(goal Goal) string {
	return strings.TrimSpace(statusGlyph(goal.Status) + " " + goal.ID + " " + goal.Label)
}

func statusGlyph(status string) string {
	switch status {
	case "done", "green":
		return "●"
	case "active", "working", "red":
		return "›"
	case "blocked":
		return "!"
	default:
		return "·"
	}
}

func joinColumns(left, right string, leftWidth, rightWidth, gap int) string {
	return pad(truncate(left, leftWidth), leftWidth) +
		strings.Repeat(" ", gap) +
		pad(truncate(right, rightWidth), rightWidth)
}

func at(lines []string, index int) string {
	if index >= len(lines) {
		return ""
	}
	return lines[index]
}

func fitLines(lines []string, width, height int) string {
	if width < 1 || height < 1 {
		return ""
	}
	if len(lines) > height {
		lines = lines[:height]
	}
	for index, line := range lines {
		lines[index] = truncate(line, width)
	}
	return strings.Join(lines, "\n")
}

func center(value string, width int) string {
	value = truncate(value, width)
	padding := (width - utf8.RuneCountInString(value)) / 2
	return strings.Repeat(" ", max(0, padding)) + value
}

func pad(value string, width int) string {
	return value + strings.Repeat(" ", max(0, width-utf8.RuneCountInString(value)))
}

func truncate(value string, width int) string {
	runes := []rune(value)
	if len(runes) <= width {
		return value
	}
	if width <= 1 {
		return string(runes[:width])
	}
	return string(runes[:width-1]) + "…"
}
