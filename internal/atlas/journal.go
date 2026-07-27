package atlas

import (
	"fmt"
	"io"
	"sort"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

type journalEvent struct {
	observedAt time.Time
	order      int
	lifecycle  *vaultregistry.Lifecycle
	evidence   *vaultregistry.Evidence
}

type journalStyle uint8

const (
	journalPlain journalStyle = iota
	journalMuted
	journalOrdinary
	journalSelected
	journalHeading
	journalEvidence
	journalReference
	journalSuccess
	journalAttention
	journalFailure
)

type journalSegment struct {
	text  string
	style journalStyle
}

type journalLine []journalSegment

type journalStyles struct {
	muted, ordinary, selected, heading, evidence lipgloss.Style
	reference, success, attention, failure       lipgloss.Style
}

func newJournalStyles() journalStyles {
	renderer := lipgloss.NewRenderer(io.Discard)
	renderer.SetColorProfile(termenv.TrueColor)
	return journalStyles{
		muted:     renderer.NewStyle().Foreground(lipgloss.Color("#928374")),
		ordinary:  renderer.NewStyle().Foreground(lipgloss.Color("#ebdbb2")),
		selected:  renderer.NewStyle().Foreground(lipgloss.Color("#fbf1c7")),
		heading:   renderer.NewStyle().Foreground(lipgloss.Color("#f28534")),
		evidence:  renderer.NewStyle().Foreground(lipgloss.Color("#d3869b")),
		reference: renderer.NewStyle().Foreground(lipgloss.Color("#80aa9e")),
		success:   renderer.NewStyle().Foreground(lipgloss.Color("#b8bb26")),
		attention: renderer.NewStyle().Foreground(lipgloss.Color("#e9b143")),
		failure:   renderer.NewStyle().Foreground(lipgloss.Color("#f2594b")),
	}
}

func (s journalStyles) render(style journalStyle, text string) string {
	switch style {
	case journalMuted:
		return s.muted.Render(text)
	case journalOrdinary:
		return s.ordinary.Render(text)
	case journalSelected:
		return s.selected.Render(text)
	case journalHeading:
		return s.heading.Render(text)
	case journalEvidence:
		return s.evidence.Render(text)
	case journalReference:
		return s.reference.Render(text)
	case journalSuccess:
		return s.success.Render(text)
	case journalAttention:
		return s.attention.Render(text)
	case journalFailure:
		return s.failure.Render(text)
	default:
		return text
	}
}

// JournalModel is a deterministic, read-only projection of a loaded Registry Run.
type JournalModel struct {
	run           vaultregistry.Run
	events        []journalEvent
	selected      int
	detailVisible bool
	colorEnabled  bool
	width         int
	height        int
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
	return JournalModel{
		run:           run,
		events:        events,
		selected:      max(len(events)-1, 0),
		detailVisible: len(events) > 0,
		width:         width,
		height:        height,
	}
}

// WithColor configures View styling without changing the journal projection.
func (m JournalModel) WithColor(enabled bool) JournalModel {
	m.colorEnabled = enabled
	return m
}

// Init deliberately schedules no work: a journal is a projection of one
// already-loaded Run and never polls or animates.
func (m JournalModel) Init() tea.Cmd {
	return nil
}

// Update applies bounded, read-only navigation to the in-memory projection.
func (m JournalModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		if msg.Width > 0 && msg.Height > 0 {
			m.width, m.height = msg.Width, msg.Height
			m.clampSelection()
		}
	case tea.KeyMsg:
		switch msg.String() {
		case "j", "down":
			if m.selected < len(m.events)-1 {
				m.selected++
			}
		case "k", "up":
			if m.selected > 0 {
				m.selected--
			}
		case "g":
			if len(m.events) > 0 {
				m.selected = 0
			}
		case "G":
			if len(m.events) > 0 {
				m.selected = len(m.events) - 1
			}
		case "v":
			m.selectMatching(1, func(event journalEvent) bool {
				return event.lifecycle != nil && event.lifecycle.Kind == "verifier"
			})
		case "V":
			m.selectMatching(-1, func(event journalEvent) bool {
				return event.lifecycle != nil && event.lifecycle.Kind == "verifier"
			})
		case "e":
			m.selectMatching(1, func(event journalEvent) bool { return event.evidence != nil })
		case "E":
			m.selectMatching(-1, func(event journalEvent) bool { return event.evidence != nil })
		case "enter":
			if len(m.events) > 0 {
				m.detailVisible = !m.detailVisible
			}
		case "q", "esc", "ctrl+c":
			return m, tea.Quit
		}
	}
	return m, nil
}

func (m *JournalModel) clampSelection() {
	if len(m.events) == 0 {
		m.selected = 0
		return
	}
	m.selected = min(max(m.selected, 0), len(m.events)-1)
}

func (m *JournalModel) selectMatching(direction int, match func(journalEvent) bool) {
	for i := m.selected + direction; i >= 0 && i < len(m.events); i += direction {
		if match(m.events[i]) {
			m.selected = i
			return
		}
	}
}

func (m JournalModel) View() string {
	return m.ViewColor(m.colorEnabled)
}

// ViewColor renders the already-laid-out journal with deterministic true-color
// foreground styling. Disabling color preserves the plain View bytes.
func (m JournalModel) ViewColor(enabled bool) string {
	if m.width < 80 || m.height < 24 {
		return truncate("terminal too small; minimum 80×24", m.width)
	}

	lines := m.lines()
	headerRows := min(3, len(lines))
	detailRows := m.detailRows()
	eventEnd := max(headerRows, len(lines)-detailRows)
	eventLines := lines[headerRows:eventEnd]
	eventSlots := max(m.height-headerRows-detailRows-1, 0)
	if len(eventLines) > eventSlots {
		selectedEnd := m.selectedEventRow() + m.selectedEventRows()
		start := max(selectedEnd-eventSlots, 0)
		eventLines = eventLines[start:min(start+eventSlots, len(eventLines))]
	}
	visible := make([]journalLine, 0, m.height)
	visible = append(visible, lines[:headerRows]...)
	visible = append(visible, eventLines...)
	visible = append(visible, lines[eventEnd:]...)
	lines = append(visible, journalLine{{
		text:  fmt.Sprintf("j/down k/up navigate · q quit · read-only · %dx%d", m.width, m.height),
		style: journalMuted,
	}})

	rendered := make([]string, len(lines))
	var styles journalStyles
	if enabled {
		styles = newJournalStyles()
	}
	for i, line := range lines {
		rendered[i] = renderJournalLine(line, m.width, enabled, styles)
	}
	return strings.Join(rendered, "\n")
}

func (m JournalModel) lines() []journalLine {
	lines := []journalLine{
		{{text: fmt.Sprintf("Run %s · Task %s · %s", value(m.run.RunID), value(m.run.Task.ID), value(m.run.Task.Title)), style: journalSelected}},
		{
			{text: "Execution Journal", style: journalHeading},
			{text: fmt.Sprintf(" · %d events · UTC · read-only", len(m.events)), style: journalMuted},
		},
		{{text: "TIME         TYPE OBSERVATION SUBJECT STATE (L=lifecycle E=evidence)", style: journalMuted}},
	}
	if len(m.events) == 0 {
		lines = append(lines, journalLine{{text: "no recorded journal events", style: journalOrdinary}})
	}
	for i, event := range m.events {
		marker := " "
		markerStyle := journalPlain
		if i == m.selected {
			marker = ">"
			markerStyle = journalSelected
		}
		at := "?"
		if !event.observedAt.IsZero() {
			at = event.observedAt.UTC().Format("15:04:05Z")
		}
		if event.lifecycle != nil {
			lifecycle := event.lifecycle
			lines = append(lines, journalLine{
				{text: marker, style: markerStyle},
				{text: " "},
				{text: at, style: journalMuted},
				{text: " "},
				{text: "L", style: journalHeading},
				{text: " "},
				{text: value(lifecycle.ObservationID), style: journalOrdinary},
				{text: " "},
				{text: value(lifecycle.GoalID), style: journalOrdinary},
				{text: " "},
				{text: value(lifecycle.Kind), style: journalKindStyle(lifecycle.Kind)},
				{text: " "},
				{text: value(lifecycle.State), style: journalStateStyle(lifecycle.State)},
			})
			continue
		}
		evidence := event.evidence
		exit := "-"
		exitStyle := journalMuted
		if evidence.ExitStatus != nil {
			exit = fmt.Sprint(*evidence.ExitStatus)
			exitStyle = journalFailure
			if *evidence.ExitStatus == 0 {
				exitStyle = journalSuccess
			}
		}
		lines = append(lines,
			journalLine{
				{text: marker, style: markerStyle},
				{text: " "},
				{text: at, style: journalMuted},
				{text: " "},
				{text: "E", style: journalEvidence},
				{text: " "},
				{text: value(evidence.ObservationID), style: journalOrdinary},
				{text: " "},
				{text: value(evidence.VerifierID), style: journalReference},
				{text: " "},
				{text: value(evidence.State), style: journalStateStyle(evidence.State)},
				{text: " "},
				{text: "exit=" + exit, style: exitStyle},
			},
			journalLine{
				{text: "    "},
				{text: "command=", style: journalEvidence},
				{text: recorded(evidence.Command), style: journalReference},
			},
			journalLine{
				{text: "    "},
				{text: "tree=", style: journalEvidence},
				{text: recorded(evidence.ImplementationTree), style: journalReference},
				{text: " "},
				{text: "artifact=", style: journalEvidence},
				{text: recorded(evidence.ArtifactSHA256), style: journalReference},
				{text: " "},
				{text: "detail=", style: journalEvidence},
				{text: recorded(evidence.Detail), style: journalOrdinary},
			},
		)
	}

	if len(m.events) == 0 || !m.detailVisible {
		return lines
	}
	selected := m.events[m.selected]
	if selected.lifecycle != nil {
		lifecycle := selected.lifecycle
		return append(lines,
			journalLine{
				{text: "Selected Event Detail", style: journalSelected},
				{text: " · ", style: journalMuted},
				{text: "Lifecycle", style: journalHeading},
			},
			journalDetailLine("Recorded timestamp:", recorded(lifecycle.ObservedAt), journalHeading, journalMuted),
			journalDetailLine("Goal ID:", recorded(lifecycle.GoalID), journalHeading, journalOrdinary),
			journalDetailLine("Kind:", recorded(lifecycle.Kind), journalHeading, journalKindStyle(lifecycle.Kind)),
			journalDetailLine("State:", recorded(lifecycle.State), journalHeading, journalStateStyle(lifecycle.State)),
			journalDetailLine("Detail:", recorded(lifecycle.Detail), journalHeading, journalOrdinary),
		)
	}

	evidence := selected.evidence
	exit := "none recorded"
	exitStyle := journalMuted
	if evidence.ExitStatus != nil {
		exit = fmt.Sprint(*evidence.ExitStatus)
		exitStyle = journalFailure
		if *evidence.ExitStatus == 0 {
			exitStyle = journalSuccess
		}
	}
	return append(lines,
		journalLine{
			{text: "Selected Event Detail", style: journalSelected},
			{text: " · ", style: journalMuted},
			{text: "Evidence", style: journalEvidence},
		},
		journalDetailLine("Recorded timestamp:", recorded(evidence.ObservedAt), journalEvidence, journalMuted),
		journalDetailLine("Verifier ID:", recorded(evidence.VerifierID), journalEvidence, journalReference),
		journalDetailLine("State:", recorded(evidence.State), journalEvidence, journalStateStyle(evidence.State)),
		journalDetailLine("Command:", recorded(evidence.Command), journalEvidence, journalReference),
		journalDetailLine("Exit status:", exit, journalEvidence, exitStyle),
		journalDetailLine("Implementation tree:", recorded(evidence.ImplementationTree), journalEvidence, journalReference),
		journalDetailLine("Artifact SHA-256:", recorded(evidence.ArtifactSHA256), journalEvidence, journalReference),
		journalDetailLine("Detail:", recorded(evidence.Detail), journalEvidence, journalOrdinary),
	)
}

func (m JournalModel) detailRows() int {
	if len(m.events) == 0 || !m.detailVisible {
		return 0
	}
	if m.events[m.selected].lifecycle != nil {
		return 6
	}
	return 9
}

func (m JournalModel) selectedEventRow() int {
	row := 0
	for i := 0; i < m.selected && i < len(m.events); i++ {
		if m.events[i].evidence != nil {
			row += 3
		} else {
			row++
		}
	}
	return row
}

func (m JournalModel) selectedEventRows() int {
	if len(m.events) > 0 && m.events[m.selected].evidence != nil {
		return 3
	}
	return 1
}

func journalDetailLine(label, value string, labelStyle, valueStyle journalStyle) journalLine {
	return journalLine{
		{text: "  "},
		{text: label, style: labelStyle},
		{text: " "},
		{text: value, style: valueStyle},
	}
}

func journalKindStyle(kind string) journalStyle {
	if knownKind(kind) {
		return journalHeading
	}
	return journalMuted
}

func journalStateStyle(state string) journalStyle {
	switch state {
	case "done", "passed", "success", "succeeded", "accepted":
		return journalSuccess
	case "pending", "active", "awaiting-human-evaluation", "resuming":
		return journalAttention
	case "blocked", "failed":
		return journalFailure
	default:
		return journalMuted
	}
}

func renderJournalLine(line journalLine, width int, enabled bool, styles journalStyles) string {
	var plain strings.Builder
	for _, segment := range line {
		plain.WriteString(segment.text)
	}
	clipped := truncate(plain.String(), width)
	if !enabled {
		return clipped
	}

	prefix := clipped
	ellipsis := false
	if clipped != plain.String() && strings.HasSuffix(clipped, "…") {
		prefix = strings.TrimSuffix(clipped, "…")
		ellipsis = true
	}

	remaining := len(prefix)
	var rendered strings.Builder
	ellipsisStyle := journalPlain
	for _, segment := range line {
		if remaining == 0 {
			ellipsisStyle = segment.style
			break
		}
		text := segment.text
		if len(text) > remaining {
			text = text[:remaining]
		}
		rendered.WriteString(styles.render(segment.style, text))
		remaining -= len(text)
		if len(text) < len(segment.text) {
			ellipsisStyle = segment.style
			break
		}
		ellipsisStyle = segment.style
	}
	if ellipsis {
		rendered.WriteString(styles.render(ellipsisStyle, "…"))
	}
	return rendered.String()
}
