package atlas

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/mattn/go-runewidth"
)

func RenderExpanded(run Run, width, height int) string {
	return renderExpanded(run, nil, width, height)
}

func RenderExpandedLive(run Run, live *LiveState, width, height int) string {
	return renderExpandedDetail(run, live, nil, "", width, height)
}

func renderExpanded(run Run, live *LiveState, width, height int) string {
	return renderExpandedDetail(run, live, nil, "", width, height)
}

func renderExpandedDetail(
	run Run,
	live *LiveState,
	detail *Detail,
	controls string,
	width,
	height int,
) string {
	active := activeGoal(run)
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
	heading := "SELECTED VERIFIER JOURNEY"
	if detail != nil {
		heading = detail.Heading
	}
	lines = append(lines, "", heading)
	if detail != nil {
		lines = append(lines, detail.Lines...)
	} else if active.Verifier != nil {
		for _, step := range active.Verifier.Journey {
			lines = append(lines, statusGlyph(step.Status)+" "+step.Label)
		}
	}
	lines = append(lines, "", "EVIDENCE")
	for _, evidence := range run.Evidence {
		lines = append(lines, evidence.ID+" "+evidence.Summary)
	}
	lines = append(lines, "", "PARTICIPANTS")
	for _, participant := range CurrentParticipants(run.Participants) {
		line := participant.Role + " · " + participantGoal(run, participant) + " · " + participant.Name
		if live != nil {
			line += " · " + live.RenderParticipant(participant.PaneID, 0)
		}
		lines = append(lines, line)
	}
	if controls != "" {
		lines = append(lines, "", controls)
	}
	return fitLines(lines, width, height)
}

func RenderCompact(run Run, width, height int) string {
	return renderCompact(run, nil, nil, width, height)
}

func RenderCompactParticipant(
	run Run,
	selected Participant,
	live *LiveState,
	width,
	height int,
) string {
	return renderCompact(run, &selected, live, width, height)
}

func RenderCompactLive(run Run, live *LiveState, width, height int) string {
	if live == nil {
		return RenderCompact(run, width, height)
	}
	return renderCompact(run, activeParticipant(run), live, width, height)
}

func renderCompact(run Run, selected *Participant, live *LiveState, width, height int) string {
	return renderCompactDetail(run, selected, live, nil, "", width, height)
}

func renderCompactDetail(
	run Run,
	participant *Participant,
	live *LiveState,
	detail *Detail,
	controls string,
	width,
	height int,
) string {
	active := activeGoal(run)
	if width < 64 {
		lines := []string{"Vault Hunter Atlas · " + run.RunID}
		if participant != nil {
			lines = append(lines, compactParticipantLine(run, *participant, live))
		}
		lines = append(lines,
			activeSummary(active),
			"next: "+run.NextAction,
		)
		for _, goal := range run.Goals {
			lines = append(lines, goalLine(goal))
		}
		for _, evidence := range run.Evidence {
			lines = append(lines, evidence.ID+" "+evidence.Summary)
		}
		if controls != "" {
			lines = append(lines, controls)
		}
		return fitLines(lines, width, height)
	}

	left := []string{"GOALS"}
	for _, goal := range run.Goals {
		left = append(left, goalLine(goal))
	}
	right := []string{active.ID + " · VERIFIER JOURNEY"}
	if detail != nil {
		right[0] = detail.Heading
		right = append(right, detail.Lines...)
	} else if active.Verifier != nil {
		for _, step := range active.Verifier.Journey {
			right = append(right, statusGlyph(step.Status)+" "+step.Label)
		}
	}
	columnGap := 3
	leftWidth := width * 45 / 100
	rightWidth := width - leftWidth - columnGap
	lines := []string{
		center("Vault Hunter Atlas · "+run.RunID, width),
		strings.Repeat("─", width),
	}
	if participant != nil {
		lines = append(lines, compactParticipantLine(run, *participant, live))
	}
	footer := []string{
		strings.Repeat("─", width),
		activeSummary(active),
		"next: " + run.NextAction,
	}
	for _, evidence := range run.Evidence {
		footer = append(footer, evidence.ID+" "+evidence.Summary)
	}
	if controls != "" {
		footer = append(footer, controls)
	}
	bodyRows := max(1, height-len(lines)-len(footer))
	left = windowColumn(left, goalPosition(run, active.ID), bodyRows)
	if len(right) > bodyRows {
		right = right[:bodyRows]
	}
	for index := 0; index < bodyRows; index++ {
		lines = append(lines, joinColumns(at(left, index), at(right, index), leftWidth, rightWidth, columnGap))
	}
	lines = append(lines, footer...)
	return fitLines(lines, width, height)
}

func goalPosition(run Run, goalID string) int {
	for index, goal := range run.Goals {
		if goal.ID == goalID {
			return index + 1
		}
	}
	return 1
}

func windowColumn(lines []string, focus, height int) []string {
	if len(lines) <= height {
		return lines
	}
	if height <= 1 {
		return lines[:1]
	}
	start := max(1, focus-height+2)
	end := min(len(lines), start+height-1)
	start = max(1, end-height+1)
	return append([]string{lines[0]}, lines[start:end]...)
}

func activeParticipant(run Run) *Participant {
	participants := CurrentParticipants(run.Participants)
	for index := range participants {
		participant := &participants[index]
		if participant.Role != "orchestrator" && participant.GoalID == run.ActiveGoal {
			return participant
		}
	}
	for index := range participants {
		if participants[index].Role != "orchestrator" {
			return &participants[index]
		}
	}
	if len(participants) != 0 {
		return &participants[0]
	}
	return nil
}

func compactParticipantLine(run Run, participant Participant, live *LiveState) string {
	line := participant.Role + " · " + participantGoal(run, participant)
	if live != nil {
		line += " · " + live.RenderParticipant(participant.PaneID, 0)
	}
	return line
}

func participantGoal(run Run, participant Participant) string {
	if participant.GoalID != "" {
		return participant.GoalID
	}
	return run.ActiveGoal
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
	line := strings.TrimSpace(statusGlyph(goal.Status) + " " + goal.ID + " " + goal.Label)
	if goal.Status == "active" && goal.Verifier != nil {
		line += " ◐"
	}
	return line
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
	return lipgloss.JoinHorizontal(
		lipgloss.Top,
		pad(truncate(left, leftWidth), leftWidth),
		strings.Repeat(" ", gap),
		pad(truncate(right, rightWidth), rightWidth),
	)
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
	padding := (width - runewidth.StringWidth(value)) / 2
	return strings.Repeat(" ", max(0, padding)) + value
}

func pad(value string, width int) string {
	return value + strings.Repeat(" ", max(0, width-runewidth.StringWidth(value)))
}

func truncate(value string, width int) string {
	if runewidth.StringWidth(value) <= width {
		return value
	}
	if width <= 1 {
		return runewidth.Truncate(value, max(0, width), "")
	}
	return runewidth.Truncate(value, width, "…")
}
