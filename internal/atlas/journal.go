package atlas

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

type journalEvent struct {
	observedAt time.Time
	order      int
	lifecycle  *vaultregistry.Lifecycle
	evidence   *vaultregistry.Evidence
}

// JournalModel is a deterministic, read-only projection of a loaded Registry Run.
type JournalModel struct {
	run    vaultregistry.Run
	events []journalEvent
	width  int
	height int
}

func NewJournalModel(run vaultregistry.Run, width, height int) JournalModel {
	events := make([]journalEvent, 0, len(run.Lifecycle)+len(run.Evidence))
	for i := range run.Lifecycle {
		observedAt, _ := time.Parse(time.RFC3339, run.Lifecycle[i].ObservedAt)
		events = append(events, journalEvent{observedAt: observedAt, order: i, lifecycle: &run.Lifecycle[i]})
	}
	for i := range run.Evidence {
		observedAt, _ := time.Parse(time.RFC3339, run.Evidence[i].ObservedAt)
		events = append(events, journalEvent{observedAt: observedAt, order: i, evidence: &run.Evidence[i]})
	}
	sort.SliceStable(events, func(i, j int) bool {
		if !events[i].observedAt.Equal(events[j].observedAt) {
			return events[i].observedAt.Before(events[j].observedAt)
		}
		if (events[i].lifecycle != nil) != (events[j].lifecycle != nil) {
			return events[i].lifecycle != nil
		}
		return events[i].order < events[j].order
	})
	return JournalModel{run: run, events: events, width: width, height: height}
}

func (m JournalModel) View() string {
	if m.width < 80 || m.height < 24 {
		return truncate("terminal too small; minimum 80×24", m.width)
	}

	lines := []string{
		fmt.Sprintf("Run %s · Task %s · %s", value(m.run.RunID), value(m.run.Task.ID), value(m.run.Task.Title)),
		fmt.Sprintf("Execution Journal · %d events · UTC · read-only", len(m.events)),
		"TIME         TYPE OBSERVATION SUBJECT STATE (L=lifecycle E=evidence)",
	}
	if len(m.events) == 0 {
		lines = append(lines, "no recorded journal events")
	}
	for i, event := range m.events {
		marker := " "
		if i == 0 {
			marker = ">"
		}
		at := "?"
		if !event.observedAt.IsZero() {
			at = event.observedAt.UTC().Format("15:04:05Z")
		}
		if event.lifecycle != nil {
			lifecycle := event.lifecycle
			lines = append(lines, fmt.Sprintf("%s %s L %s %s %s %s", marker, at, value(lifecycle.ObservationID), value(lifecycle.GoalID), value(lifecycle.Kind), value(lifecycle.State)))
			continue
		}
		evidence := event.evidence
		exit := "-"
		if evidence.ExitStatus != nil {
			exit = fmt.Sprint(*evidence.ExitStatus)
		}
		lines = append(lines,
			fmt.Sprintf("%s %s E %s %s %s exit=%s", marker, at, value(evidence.ObservationID), value(evidence.VerifierID), value(evidence.State), exit),
			"    command="+recorded(evidence.Command),
			fmt.Sprintf("    tree=%s artifact=%s detail=%s", recorded(evidence.ImplementationTree), recorded(evidence.ArtifactSHA256), recorded(evidence.Detail)),
		)
	}

	footer := fmt.Sprintf("j/down k/up navigate · q quit · read-only · %dx%d", m.width, m.height)
	if len(lines) >= m.height {
		lines = lines[:m.height-1]
	}
	lines = append(lines, footer)
	for i := range lines {
		lines[i] = truncate(lines[i], m.width)
	}
	return strings.Join(lines, "\n")
}
