package atlas

import (
	"fmt"
	"strings"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

// PickerCrewPreview renders the current Vault Hunter crew stages at Sidekick density.
func PickerCrewPreview(run vaultregistry.Run, width, height int) string {
	run = sanitizeRunProjection(run)
	roles := map[string]int{}
	inferred := map[string]bool{}
	for _, participant := range run.Participants {
		role, source := participantCrewRole(participant)
		roles[role]++
		inferred[role] = inferred[role] || strings.HasPrefix(source, "inferred/")
	}
	verifierIDs := []string{}
	seen := map[string]bool{}
	for _, evidence := range run.Evidence {
		if id := localVerifierID(evidence.VerifierID); id != "" && !seen[id] {
			seen[id] = true
			verifierIDs = append(verifierIDs, id)
		}
	}
	signals := readTaskSignals(run, verifierIDs)
	stages := []struct {
		name     string
		state    timelineStage
		inferred bool
	}{
		{"Parent", timelineStage{"●", "invoked", journalSuccess}, false},
		{"Verifier", timelineStageFor(signals.verifiersComplete, signals.verifiersFailed, roles["Verifier Builder"] > 0, "complete", "active"), inferred["Verifier Builder"]},
		{"Convergence", timelineStageFor(signals.verifiersComplete && roles["Delivery Steward"] > 0, false, roles["Convergence Engineer"] > 0, "complete", "active"), inferred["Convergence Engineer"]},
		{"Delivery", timelineStageFor(signals.pullRequest != "", signals.deliveryFailed, roles["Delivery Steward"] > 0, "complete", "active"), inferred["Delivery Steward"]},
		{"Parent closure", timelineStageFor(signals.taskDone, signals.taskFailed, false, "closed", "waiting"), false},
	}
	lines := []journalLine{
		{{text: "Vault Hunter Atlas", style: journalHeading}},
		{{text: journalValue(run.Task.ID) + " · " + journalValue(run.Task.Title), style: journalOrdinary}},
		{{text: "Run " + journalValue(run.RunID) + fmt.Sprintf(" · rev %d", run.Revision), style: journalMuted}},
		{{text: "CREW JOURNEY", style: journalMuted}},
	}
	for i, stage := range stages {
		connector := "├─"
		if i == len(stages)-1 {
			connector = "└─"
		}
		lines = append(lines, journalLine{
			{text: " " + connector + " ", style: journalMuted},
			{text: stage.state.mark, style: stage.state.style},
			{text: " " + stage.name + inferredMark(stage.inferred), style: journalOrdinary},
			{text: " · " + stage.state.word, style: stage.state.style},
		})
	}
	lines = append(lines, nil, journalLine{{text: "● complete · ⟳ active · ○ waiting · × failed · ≈ inferred", style: journalMuted}})
	return renderPickerLines(lines, width, height)
}

// PickerTabsPreview renders an honest fallback for an unregistered Herdr Workspace.
func PickerTabsPreview(workspaceLabel string, tabs []string, width, height int) string {
	lines := []journalLine{
		{{text: "Herdr Workspace", style: journalHeading}},
		{{text: sanitizeRegistryString(workspaceLabel), style: journalOrdinary}},
		{{text: fmt.Sprintf("%d tabs · no registered Atlas Run", len(tabs)), style: journalMuted}},
	}
	for i, tab := range tabs {
		connector := "├─"
		if i == len(tabs)-1 {
			connector = "└─"
		}
		lines = append(lines, journalLine{{text: " " + connector + " ", style: journalMuted}, {text: sanitizeRegistryString(tab), style: journalOrdinary}})
	}
	return renderPickerLines(lines, width, height)
}

func renderPickerLines(lines []journalLine, width, height int) string {
	if width <= 0 || height <= 0 {
		return ""
	}
	for len(lines) < height {
		lines = append(lines, nil)
	}
	if len(lines) > height {
		lines = lines[:height]
	}
	styles := newJournalStyles()
	rendered := make([]string, len(lines))
	for i, line := range lines {
		rendered[i] = renderJournalLine(line, width, true, styles)
	}
	return strings.Join(rendered, "\n")
}
