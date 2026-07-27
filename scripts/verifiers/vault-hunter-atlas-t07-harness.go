package main

import (
	"fmt"
	"os"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/aviral/dotfiles/internal/atlas"
	"github.com/aviral/dotfiles/internal/vaultregistry"
)

type checks struct {
	name     string
	failures int
}

func (c *checks) want(ok bool, format string, args ...any) {
	if ok {
		return
	}
	fmt.Fprintf(os.Stderr, c.name+": "+format+"\n", args...)
	c.failures++
}

func (c *checks) drive(model atlas.Model, msg tea.Msg) (atlas.Model, tea.Cmd) {
	next, cmd := model.Update(msg)
	updated, ok := next.(atlas.Model)
	c.want(ok, "Update returned %T, want atlas.Model", next)
	if !ok {
		return model, cmd
	}
	return updated, cmd
}

func (c *checks) frame(model atlas.Model, width, height int, label string) string {
	first := model.View()
	c.want(first == model.View(), "%s frame is nondeterministic", label)
	lines := strings.Split(first, "\n")
	c.want(len(lines) <= height, "%s frame has %d rows, want at most %d", label, len(lines), height)
	for i, line := range lines {
		c.want(lipgloss.Width(line) <= width, "%s row %d has %d cells, want at most %d", label, i+1, lipgloss.Width(line), width)
	}
	return first
}

func selected(view, goal string) bool {
	return strings.Contains(view, "VERIFIER LEDGER · Goal "+goal+" ·")
}

func before(text, first, second string) bool {
	left, right := strings.Index(text, first), strings.Index(text, second)
	return left >= 0 && right >= 0 && left < right
}

func column(view string, number int) string {
	var rows []string
	for _, line := range strings.Split(view, "\n") {
		parts := strings.SplitN(line, "│", 3)
		if len(parts) == 3 {
			rows = append(rows, parts[number])
		}
	}
	return strings.Join(rows, "\n")
}

func checkProjection(c *checks) {
	exit := 7
	longRun := vaultregistry.Run{RunID: "long-journey"}
	for i := range 20 {
		longRun.Lifecycle = append(longRun.Lifecycle, vaultregistry.Lifecycle{
			GoalID: "long-goal", Kind: "verifier", State: "active",
			ObservedAt: fmt.Sprintf("2026-07-26T10:%02d:00Z", i),
			Detail:     fmt.Sprintf("old-journey-%02d", i),
		})
	}
	longRun.Evidence = []vaultregistry.Evidence{{
		ObservationID: "latest-evidence", VerifierID: "long-goal",
		ObservedAt: "2026-07-26T10:25:00Z", State: "state-current",
		Command: "cmd-current", ImplementationTree: "tree-current",
		ArtifactSHA256: "hash-current", Detail: "detail-current", ExitStatus: &exit,
	}}
	longRun.Participants = []vaultregistry.Participant{{
		ParticipantID: "current-agent", GoalID: "long-goal",
		ObservedAt: "2026-07-26T10:26:00Z", Role: "latest-participant",
	}}
	longView := c.frame(atlas.NewExpandedModel(longRun, 120, 32), 120, 32, "long journey 120x32")
	for _, want := range []string{
		"LATEST EVIDENCE COMMAND", "cmd-current", "state-current", "tree-current",
		"hash-current", "detail-current", "ASSOCIATED PARTICIPANTS",
		"current-agent · latest-participant",
	} {
		c.want(strings.Contains(longView, want), "long journey omitted current context %q", want)
	}
	c.want(!strings.Contains(longView, "old-journey-00"), "long journey retained oldest rows before current context")

	compactRun := vaultregistry.Run{
		RunID: "compact-participant",
		Lifecycle: []vaultregistry.Lifecycle{{
			GoalID: "compact-goal", Kind: "verifier", State: "active",
			ObservedAt: "2026-07-26T12:00:00Z",
		}},
		Participants: []vaultregistry.Participant{
			{ParticipantID: "compact-worker", GoalID: "compact-goal", Role: "chronological-newer-first", ObservedAt: "2026-07-26T14:00:00Z"},
			{ParticipantID: "compact-worker", GoalID: "compact-goal", Role: "base-last-observation", ObservedAt: "2026-07-26T10:00:00-03:00"},
		},
	}
	compactView := atlas.NewModel(compactRun, 100, 30).View()
	c.want(strings.Contains(compactView, "compact-worker · base-last-observation"), "compact model did not preserve last-observation participant semantics")
	c.want(!strings.Contains(compactView, "chronological-newer-first"), "compact model inherited expanded chronological participant selection")

	timelineRun := vaultregistry.Run{
		RunID: "offset-timeline",
		Lifecycle: []vaultregistry.Lifecycle{
			{GoalID: "timeline-later", Kind: "verifier", State: "done", ObservedAt: "2026-07-26T10:00:00-04:00"},
			{GoalID: "timeline-equal-first", Kind: "verifier", State: "done", ObservedAt: "2026-07-26T14:00:00Z"},
			{GoalID: "timeline-equal-second", Kind: "verifier", State: "done", ObservedAt: "2026-07-26T10:00:00-04:00"},
			{GoalID: "timeline-earlier", Kind: "verifier", State: "done", ObservedAt: "2026-07-26T13:30:00Z"},
		},
	}
	timeline := column(c.frame(atlas.NewExpandedModel(timelineRun, 160, 48), 160, 48, "offset timeline"), 0)
	c.want(before(timeline, "timeline-earlier", "timeline-later"), "timeline did not order offset RFC3339 instants chronologically")
	c.want(before(timeline, "timeline-later", "timeline-equal-first"), "timeline did not preserve the first 14:00 instant")
	c.want(before(timeline, "timeline-equal-first", "timeline-equal-second"), "timeline did not preserve stable equal-instant order")

	orderRun := vaultregistry.Run{
		RunID: "offset-ordering",
		Lifecycle: []vaultregistry.Lifecycle{
			{GoalID: "ordered-goal", Kind: "verifier", State: "active", ObservedAt: "2026-07-26T10:00:00-04:00", Detail: "journey-later"},
			{GoalID: "ordered-goal", Kind: "verifier", State: "active", ObservedAt: "2026-07-26T14:00:00Z", Detail: "journey-equal-first"},
			{GoalID: "ordered-goal", Kind: "verifier", State: "active", ObservedAt: "2026-07-26T10:00:00-04:00", Detail: "journey-equal-second"},
			{GoalID: "ordered-goal", Kind: "verifier", State: "active", ObservedAt: "2026-07-26T13:30:00Z", Detail: "journey-earlier"},
		},
		Evidence: []vaultregistry.Evidence{
			{ObservationID: "fraction-first", VerifierID: "ordered-goal", ObservedAt: "2026-07-26T14:30:00.1Z", State: "fraction-first-state", Detail: "fraction-first-detail"},
			{ObservationID: "fraction-second", VerifierID: "ordered-goal", ObservedAt: "2026-07-26T10:30:00.100-04:00", State: "fraction-second-state", Detail: "fraction-second-detail"},
			{ObservationID: "lexical-old", VerifierID: "ordered-goal", ObservedAt: "2026-07-26T15:00:00Z", State: "old-state", Command: "old-command", ImplementationTree: "old-tree", ArtifactSHA256: "old-hash", Detail: "old-detail"},
			{ObservationID: "chronological-new", VerifierID: "ordered-goal", ObservedAt: "2026-07-26T11:30:00-04:00", State: "new-state", Command: "new-command", ImplementationTree: "new-tree", ArtifactSHA256: "new-hash", Detail: "new-detail"},
		},
		Participants: []vaultregistry.Participant{
			{ParticipantID: "participant-a", GoalID: "ordered-goal", ObservedAt: "2026-07-26T15:00:00Z", Role: "participant-old"},
			{ParticipantID: "participant-b", GoalID: "ordered-goal", ObservedAt: "2026-07-26T15:10:00Z", Role: "participant-b-role"},
			{ParticipantID: "participant-a", GoalID: "ordered-goal", ObservedAt: "2026-07-26T11:30:00-04:00", Role: "participant-newest"},
			{ParticipantID: "participant-equal", GoalID: "ordered-goal", ObservedAt: "2026-07-26T14:00:00Z", Role: "equal-first-role"},
			{ParticipantID: "participant-equal", GoalID: "ordered-goal", ObservedAt: "2026-07-26T10:00:00-04:00", Role: "equal-second-role"},
		},
	}
	orderView := c.frame(atlas.NewExpandedModel(orderRun, 160, 48), 160, 48, "offset journey and current context")
	ledger := column(orderView, 1)
	c.want(before(ledger, "journey-earlier", "journey-later"), "journey did not order offset RFC3339 instants chronologically")
	c.want(before(ledger, "journey-later", "journey-equal-first"), "journey did not preserve the first 14:00 instant")
	c.want(before(ledger, "journey-equal-first", "journey-equal-second"), "journey did not preserve stable equal-instant order")
	c.want(before(ledger, "fraction-first-detail", "fraction-second-detail"), "journey did not preserve stable fractional equal-instant order")
	for _, want := range []string{"chronological-new", "new-state", "new-command", "new-tree", "new-hash", "new-detail"} {
		c.want(strings.Contains(orderView, want), "latest evidence did not use chronological value %q", want)
	}
	for _, stale := range []string{"old-state", "old-command", "old-tree", "old-hash", "old-detail"} {
		c.want(!strings.Contains(column(orderView, 2), stale), "latest evidence retained lexically later stale value %q", stale)
	}
	c.want(strings.Contains(ledger, "participant-a · participant-newest"), "participant did not use latest chronological observation")
	c.want(strings.Contains(ledger, "participant-equal · equal-second-role"), "participant did not preserve stable equal-instant last observation")
	c.want(before(ledger, "participant-a ·", "participant-b ·"), "participant first-appearance order changed")
	c.want(before(ledger, "participant-b ·", "participant-equal ·"), "participant first-appearance order changed")
}

func checkInteraction(c *checks, run vaultregistry.Run) {
	model := atlas.NewExpandedModel(run, 160, 48)
	initial := c.frame(model, 160, 48, "initial 160x48")
	c.want(selected(initial, "T07.V01"), "initial active Goal is not selected and visible")

	first, _ := c.drive(model, tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'k'}})
	c.want(selected(c.frame(first, 160, 48, "k to first"), "checkpoint-one"), "k did not select the first normalized Goal")
	first, _ = c.drive(first, tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'k'}})
	firstView := c.frame(first, 160, 48, "k clamped at first")
	first, _ = c.drive(first, tea.KeyMsg{Type: tea.KeyUp})
	c.want(c.frame(first, 160, 48, "Up clamped at first") == firstView, "k/Up did not clamp at the first Goal")
	for _, size := range []tea.WindowSizeMsg{{Width: 160, Height: 48}, {Width: 120, Height: 32}} {
		oldGoal, _ := c.drive(first, size)
		view := c.frame(oldGoal, size.Width, size.Height, fmt.Sprintf("old Goal at %dx%d", size.Width, size.Height))
		c.want(selected(view, "checkpoint-one"), "old selected Goal is not visible at %dx%d", size.Width, size.Height)
	}

	last, _ := c.drive(first, tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}})
	for range 32 {
		last, _ = c.drive(last, tea.KeyMsg{Type: tea.KeyDown})
	}
	c.want(selected(c.frame(last, 160, 48, "Down to last"), "overflow-09"), "j/Down did not select the last normalized Goal")
	last, _ = c.drive(last, tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}})
	lastView := c.frame(last, 160, 48, "j clamped at last")
	last, _ = c.drive(last, tea.KeyMsg{Type: tea.KeyDown})
	c.want(c.frame(last, 160, 48, "Down clamped at last") == lastView, "j/Down did not clamp at the last Goal")

	detail := "behavioral baseline red with wide text 東京 and deterministic truncation"
	beforeCount := strings.Count(initial, detail)
	c.want(beforeCount >= 1, "initial selected-Goal detail is not visible")
	collapsed, _ := c.drive(model, tea.KeyMsg{Type: tea.KeyEnter})
	collapsedView := c.frame(collapsed, 160, 48, "detail collapsed")
	c.want(selected(collapsedView, "T07.V01"), "Enter changed the selected Goal")
	c.want(strings.Count(collapsedView, detail) == beforeCount-1, "Enter did not collapse only the selected-Goal detail")
	restored, _ := c.drive(collapsed, tea.KeyMsg{Type: tea.KeyEnter})
	c.want(c.frame(restored, 160, 48, "detail restored") == initial, "second Enter did not restore selected-Goal detail")

	for _, key := range []tea.KeyMsg{
		{Type: tea.KeyRunes, Runes: []rune{'q'}},
		{Type: tea.KeyEsc},
		{Type: tea.KeyCtrlC},
	} {
		_, cmd := c.drive(model, key)
		c.want(cmd != nil, "%q did not request quit", key.String())
		if cmd != nil {
			_, ok := cmd().(tea.QuitMsg)
			c.want(ok, "%q returned a non-quit command", key.String())
		}
	}

	resized := collapsed
	for _, size := range []tea.WindowSizeMsg{{Width: 160, Height: 48}, {Width: 120, Height: 32}} {
		resized, _ = c.drive(resized, size)
		view := c.frame(resized, size.Width, size.Height, fmt.Sprintf("%dx%d", size.Width, size.Height))
		c.want(selected(view, "T07.V01"), "%dx%d resize lost the selected Goal", size.Width, size.Height)
		c.want(strings.Count(view, detail) == beforeCount-1, "%dx%d resize lost collapsed detail state", size.Width, size.Height)
	}
	resized, _ = c.drive(resized, tea.WindowSizeMsg{Width: 119, Height: 31})
	tooSmall := c.frame(resized, 119, 31, "119x31")
	c.want(tooSmall == "terminal too small; minimum 120×32", "below-minimum frame = %q", tooSmall)
	resized, _ = c.drive(resized, tea.WindowSizeMsg{Width: 160, Height: 48})
	recovered := c.frame(resized, 160, 48, "recovered 160x48")
	c.want(selected(recovered, "T07.V01"), "recovery lost the selected Goal")
	c.want(strings.Count(recovered, detail) == beforeCount-1, "recovery lost collapsed detail state")
}

func main() {
	if len(os.Args) != 3 || os.Args[1] != "v01" && os.Args[1] != "v02" {
		fmt.Fprintln(os.Stderr, "usage: vault-hunter-atlas-t07-harness <v01|v02> <state-dir>")
		os.Exit(2)
	}

	c := checks{name: "T07." + strings.ToUpper(os.Args[1])}
	if os.Args[1] == "v01" {
		checkProjection(&c)
	} else {
		reader, err := vaultregistry.OpenReader(os.Args[2])
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(2)
		}
		run, err := reader.Get("atlas-t07-rich")
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(2)
		}
		checkInteraction(&c, run)
	}

	if c.failures != 0 {
		fmt.Fprintf(os.Stderr, "%s: %d behavioral assertion(s) failed\n", c.name, c.failures)
		os.Exit(1)
	}
}
