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
	text          string
	style         journalStyle
	neutralMarker bool
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
	crewTimeline  bool
	colorEnabled  bool
	attached      bool
	width         int
	height        int
	reload        func() (vaultregistry.Run, error)
}

type journalRefreshMsg struct {
	run vaultregistry.Run
	err error
}

func NewJournalModel(run vaultregistry.Run, width, height int) JournalModel {
	run = renderRunProjection(run)
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
		detailVisible: len(events) != 0,
		width:         width,
		height:        height,
	}
}

// WithCrewTimeline selects the compact crew timeline projection. By default,
// JournalModel renders the complete recorded journal.
func (m JournalModel) WithCrewTimeline() JournalModel {
	m.crewTimeline = true
	return m
}

// WithColor configures the attached-terminal View without changing the
// journal projection.
func (m JournalModel) WithColor(enabled bool) JournalModel {
	m.colorEnabled = enabled
	m.attached = true
	return m
}

func (m JournalModel) WithReload(reload func() (vaultregistry.Run, error)) JournalModel {
	m.reload = reload
	return m
}

func (m JournalModel) Init() tea.Cmd { return m.refreshCmd() }

func (m JournalModel) refreshCmd() tea.Cmd {
	if m.reload == nil {
		return nil
	}
	return tea.Tick(time.Second, func(time.Time) tea.Msg { run, err := m.reload(); return journalRefreshMsg{run: run, err: err} })
}

func (m JournalModel) refreshed(run vaultregistry.Run) JournalModel {
	selectedID := ""
	followTail := len(m.events) == 0 || m.selected == len(m.events)-1
	if len(m.events) != 0 {
		selectedID = journalEventID(m.events[m.selected])
	}
	next := NewJournalModel(run, m.width, m.height)
	next.colorEnabled, next.attached, next.detailVisible, next.crewTimeline, next.reload = m.colorEnabled, m.attached, m.detailVisible, m.crewTimeline, m.reload
	if !followTail && selectedID != "" {
		for i, event := range next.events {
			if journalEventID(event) == selectedID {
				next.selected = i
				break
			}
		}
	}
	return next
}

func journalEventID(event journalEvent) string {
	if event.lifecycle != nil {
		return event.lifecycle.ObservationID
	}
	if event.evidence != nil {
		return event.evidence.ObservationID
	}
	return ""
}

// Update applies bounded, read-only navigation to the complete recorded stream.
func (m JournalModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case journalRefreshMsg:
		if msg.err == nil {
			m = m.refreshed(msg.run)
		}
		return m, m.refreshCmd()
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
			if len(m.events) != 0 {
				m.selected = 0
			}
		case "G":
			if len(m.events) != 0 {
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
			if len(m.events) != 0 {
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

func (m JournalModel) View() string { return m.ViewColor(m.colorEnabled) }

// ViewColor renders deterministic foreground-only true color. Stripping its
// SGR sequences yields exactly the uncolored semantic frame.
func (m JournalModel) ViewColor(enabled bool) string {
	if m.width < 80 || m.height < 24 {
		return truncate("terminal too small; minimum 80×24", m.width)
	}
	if m.crewTimeline {
		return m.crewTimelineView(enabled)
	}

	start, end, capped := m.journalWindow()
	lines := m.headerLines(start, end)
	margin := strings.Repeat(" ", (m.width-min(82, m.width-2))/2)
	if len(m.events) == 0 {
		lines = append(lines, m.journalRailLine(margin, journalLine{{text: margin}, {text: "no recorded journal events", style: journalOrdinary}}))
	} else {
		omission := m.journalRailLine(margin, journalLine{
			{text: margin},
			{text: fmt.Sprintf("└─ … %d recorded journal events omitted (%d earlier, %d later)", len(m.events), start, len(m.events)-end), style: journalMuted},
		})
		if capped {
			lines = append(lines, omission)
		}
		for i := start; i < end; i++ {
			lines = append(lines, m.journalRailLines(margin, m.eventLines(i, margin))...)
		}
		if m.detailVisible {
			lines = append(lines, m.journalRailLines(margin, m.selectedCard(margin))...)
		}
	}

	for len(lines) < m.height-2 {
		lines = append(lines, nil)
	}
	if len(lines) > m.height-2 {
		lines = lines[:m.height-2]
	}
	lines = append(lines,
		journalLine{{text: strings.Repeat("─", m.width), style: journalMuted}},
		journalLine{{text: journalFooter(m.width), style: journalMuted}},
	)

	var styles journalStyles
	if enabled {
		styles = newJournalStyles()
	}
	rendered := make([]string, len(lines))
	for i, line := range lines {
		rendered[i] = renderJournalLine(line, m.width, enabled, styles)
	}
	return strings.Join(rendered, "\n")
}

func (m JournalModel) journalWindow() (start, end int, capped bool) {
	n := len(m.events)
	if n == 0 {
		return 0, 0, false
	}
	cardRows := 0
	if m.detailVisible {
		if m.events[m.selected].lifecycle != nil {
			cardRows = 7
		} else {
			cardRows = 10
		}
	}
	if n*3 <= m.height-9-cardRows {
		return 0, n, false
	}
	capacity := max(1, (m.height-9-cardRows-1)/3)
	capacity = min(capacity, n)
	start = m.selected - (capacity-1)/2
	start = min(max(start, 0), n-capacity)
	return start, start + capacity, true
}

func (m JournalModel) headerLines(start, end int) []journalLine {
	task := journalValue(m.run.Task.ID)
	title := journalValue(m.run.Task.Title)
	runID := journalValue(m.run.RunID)
	lines := []journalLine{
		journalSideLine(m.width,
			journalLine{{text: "vault-hunter journal", style: journalHeading}, {text: "  " + task + " " + title, style: journalOrdinary}},
			journalLine{{text: "Run ", style: journalMuted}, {text: runID, style: journalOrdinary}, {text: fmt.Sprintf(" · rev %d", m.run.Revision), style: journalMuted}}),
		journalSideLine(m.width,
			journalLine{{text: "selected recorded journey · projection, not authority", style: journalSelected}},
			journalLine{{text: fmt.Sprintf("%d lifecycle · %d evidence · %d total", len(m.run.Lifecycle), len(m.run.Evidence), len(m.events)), style: journalMuted}}),
		{{text: strings.Repeat("─", m.width), style: journalMuted}},
	}

	candidate := m.activeGoal()
	if candidate.index < 0 {
		lines = append(lines,
			journalLine{{text: "/goal ", style: journalHeading}, {text: "?", style: journalOrdinary}, {text: " · no recorded active or feedback lifecycle", style: journalMuted}},
			journalLine{{text: "none recorded", style: journalOrdinary}},
		)
	} else {
		left := journalLine{{text: "/goal ", style: journalHeading}, {text: journalValue(candidate.lifecycle.GoalID), style: journalOrdinary}, {text: " · ", style: journalMuted}}
		left = append(left, journalStateSegments(candidate.lifecycle.State)...)
		right := journalLine(nil)
		if later := m.shownLater(candidate, start, end); later != "" {
			right = journalLine{{text: "shown later: ", style: journalMuted}, {text: later, style: journalOrdinary}}
		}
		lines = append(lines, journalSideLine(m.width, left, right))
		kindLine := journalLine(nil)
		kindLine = append(kindLine, journalKindSegments(candidate.lifecycle.Kind)...)
		kindLine = append(kindLine, journalSegment{text: " · ", style: journalMuted}, journalSegment{text: journalRecorded(candidate.lifecycle.Detail), style: journalOrdinary})
		lines = append(lines, kindLine)
	}

	lines = append(lines,
		journalLine{{text: strings.Repeat("─", m.width), style: journalMuted}},
		journalSideLine(m.width,
			journalLine{{text: "Feature ", style: journalMuted}, {text: journalRecorded(m.run.Task.FeaturePath), style: journalOrdinary}},
			journalLine{{text: "updated_at " + journalRecorded(m.run.UpdatedAt) + " · timestamp gaps, not durations", style: journalMuted}}),
	)
	return lines
}

type activeJournalGoal struct {
	index     int
	lifecycle *vaultregistry.Lifecycle
}

func (m JournalModel) activeGoal() activeJournalGoal {
	candidate := activeJournalGoal{index: -1}
	for i, event := range m.events {
		if event.lifecycle != nil && (event.lifecycle.State == "active" || event.lifecycle.Kind == "feedback") {
			candidate = activeJournalGoal{index: i, lifecycle: event.lifecycle}
		}
	}
	return candidate
}

func (m JournalModel) shownLater(candidate activeJournalGoal, start, end int) string {
	if candidate.index < 0 {
		return ""
	}
	seen := map[string]bool{candidate.lifecycle.GoalID: true}
	var goals []string
	for i := max(start, candidate.index+1); i < end; i++ {
		if lifecycle := m.events[i].lifecycle; lifecycle != nil && lifecycle.GoalID != "" && !seen[lifecycle.GoalID] {
			seen[lifecycle.GoalID] = true
			goals = append(goals, normalizeJournalText(lifecycle.GoalID))
		}
	}
	return strings.Join(goals, " → ")
}

func (m JournalModel) eventLines(index int, margin string) []journalLine {
	event := m.events[index]
	status := journalEventStatus(event)
	first := journalLine{{text: margin}, {text: "●", style: status}}
	if m.attached {
		first = append(first,
			journalSegment{text: "  ", style: journalMuted},
			journalSegment{text: journalRailTime(event), style: journalMuted},
			journalSegment{text: " · ", style: journalMuted},
		)
	} else {
		first = append(first, journalSegment{text: "  " + journalRailTime(event) + " · ", style: journalMuted})
	}
	if event.lifecycle != nil {
		first = append(first, journalSegment{text: "L", style: journalHeading}, journalSegment{text: " · ", style: journalMuted})
		first = append(first, journalKindSegments(event.lifecycle.Kind)...)
		first = append(first, journalSegment{text: " · ", style: journalMuted})
		first = append(first, journalStateSegments(event.lifecycle.State)...)
	} else {
		first = append(first,
			journalSegment{text: "E", style: journalEvidence},
			journalSegment{text: " · ", style: journalMuted},
			journalSegment{text: journalValue(event.evidence.VerifierID), style: journalReference},
			journalSegment{text: " · ", style: journalMuted},
		)
		first = append(first, journalStateSegments(event.evidence.State)...)
	}
	first = append(first, journalSegment{text: " · " + m.eventGap(index), style: journalMuted})
	if index == m.selected {
		first = append(first, journalSegment{text: " · ", style: journalMuted}, journalSegment{text: "selected", style: journalSelected})
	}

	leaf := journalLine{{text: margin}, {text: "│  ├─ ", style: journalMuted}}
	if event.lifecycle != nil {
		leaf = append(leaf,
			journalSegment{text: "goal", style: journalHeading},
			journalSegment{text: " · ", style: journalMuted},
			journalSegment{text: journalValue(event.lifecycle.GoalID), style: journalOrdinary},
		)
	} else {
		leaf = append(leaf,
			journalSegment{text: "verifier", style: journalEvidence},
			journalSegment{text: " · ", style: journalMuted},
			journalSegment{text: journalValue(event.evidence.VerifierID), style: journalReference},
		)
	}
	detail := ""
	if event.lifecycle != nil {
		detail = event.lifecycle.Detail
	} else {
		detail = event.evidence.Detail
	}
	return []journalLine{
		first,
		leaf,
		{{text: margin}, {text: "│  └─ detail · ", style: journalMuted}, {text: journalRecorded(detail), style: journalOrdinary}},
	}
}

func journalRailTime(event journalEvent) string {
	if event.observedAt.IsZero() {
		return "?"
	}
	return event.observedAt.UTC().Format("Jan 02 15:04 UTC")
}

func (m JournalModel) eventGap(index int) string {
	if index == 0 {
		return "journey start"
	}
	if m.events[index].observedAt.IsZero() || m.events[index-1].observedAt.IsZero() {
		return "? since prior"
	}
	gap := m.events[index].observedAt.Sub(m.events[index-1].observedAt)
	return "+" + compactJournalGap(gap) + " since prior"
}

func compactJournalGap(gap time.Duration) string {
	if gap%time.Hour == 0 && gap != 0 {
		return fmt.Sprintf("%dh", int64(gap/time.Hour))
	}
	if gap%time.Minute == 0 && gap != 0 {
		return fmt.Sprintf("%dm", int64(gap/time.Minute))
	}
	return gap.String()
}

func journalEventStatus(event journalEvent) journalStyle {
	state := ""
	var exit *int
	if event.lifecycle != nil {
		state = event.lifecycle.State
	} else {
		state, exit = event.evidence.State, event.evidence.ExitStatus
	}
	if state == "blocked" || state == "failed" || (exit != nil && *exit != 0) {
		return journalFailure
	}
	if journalSuccessState(state) || (exit != nil && *exit == 0) {
		return journalSuccess
	}
	if journalAttentionState(state) {
		return journalAttention
	}
	return journalMuted
}

func (m JournalModel) selectedCard(margin string) []journalLine {
	event := m.events[m.selected]
	if event.lifecycle != nil {
		lifecycle := event.lifecycle
		lines := []journalLine{{
			{text: margin}, {text: "│  ┌─ ", style: journalMuted},
			{text: "selected recorded observation", style: journalSelected},
			{text: " · ", style: journalMuted}, {text: "lifecycle", style: journalHeading},
		}}
		lines = append(lines,
			journalCardLine(margin, false, false, "timestamp", journalRecorded(lifecycle.ObservedAt), journalMuted),
			journalCardLine(margin, false, false, "observation ID", journalValue(lifecycle.ObservationID), journalOrdinary),
			journalCardLine(margin, false, false, "Goal ID", journalValue(lifecycle.GoalID), journalOrdinary),
		)
		lines = append(lines, journalCardValueLine(margin, false, "kind", journalKindSegments(lifecycle.Kind))...)
		lines = append(lines, journalCardValueLine(margin, false, "state", journalStateSegments(lifecycle.State))...)
		lines = append(lines, journalCardLine(margin, false, true, "detail", journalRecorded(lifecycle.Detail), journalOrdinary))
		return lines
	}

	evidence := event.evidence
	exit, exitStyle := "none recorded", journalMuted
	if evidence.ExitStatus != nil {
		exit = fmt.Sprint(*evidence.ExitStatus)
		exitStyle = journalSuccess
		if *evidence.ExitStatus != 0 {
			exitStyle = journalFailure
		}
	}
	lines := []journalLine{{
		{text: margin}, {text: "│  ┌─ ", style: journalMuted},
		{text: "selected recorded observation", style: journalSelected},
		{text: " · ", style: journalMuted}, {text: "evidence", style: journalEvidence},
	}}
	lines = append(lines,
		journalCardLine(margin, true, false, "timestamp", journalRecorded(evidence.ObservedAt), journalMuted),
		journalCardLine(margin, true, false, "observation ID", journalValue(evidence.ObservationID), journalOrdinary),
		journalCardLine(margin, true, false, "verifier ID", journalValue(evidence.VerifierID), journalReference),
	)
	lines = append(lines, journalCardValueLine(margin, true, "state", journalStateSegments(evidence.State))...)
	lines = append(lines,
		journalCardLine(margin, true, false, "command", journalRecorded(evidence.Command), journalReference),
		journalCardLine(margin, true, false, "exit status", exit, exitStyle),
		journalCardLine(margin, true, false, "implementation tree", journalRecorded(evidence.ImplementationTree), journalReference),
		journalCardLine(margin, true, false, "artifact SHA-256", journalRecorded(evidence.ArtifactSHA256), journalReference),
		journalCardLine(margin, true, true, "detail", journalRecorded(evidence.Detail), journalOrdinary),
	)
	return lines
}

func journalCardLine(margin string, evidence, final bool, label, value string, valueStyle journalStyle) journalLine {
	connector := "│  ├─ "
	if final {
		connector = "│  └─ "
	}
	labelStyle := journalHeading
	if evidence {
		labelStyle = journalEvidence
	}
	return journalLine{
		{text: margin}, {text: connector, style: journalMuted},
		{text: label, style: labelStyle}, {text: " · ", style: journalMuted},
		{text: value, style: valueStyle},
	}
}

func journalCardValueLine(margin string, evidence bool, label string, value journalLine) []journalLine {
	labelStyle := journalHeading
	if evidence {
		labelStyle = journalEvidence
	}
	line := journalLine{{text: margin}, {text: "│  ├─ ", style: journalMuted}, {text: label, style: labelStyle}, {text: " · ", style: journalMuted}}
	line = append(line, value...)
	return []journalLine{line}
}

func journalKindSegments(kind string) journalLine {
	if kind == "" {
		return journalLine{{text: "?", style: journalMuted, neutralMarker: true}}
	}
	if !journalKnownKind(kind) {
		return journalLine{{text: kind, style: journalMuted}, {text: " ?", style: journalMuted, neutralMarker: true}}
	}
	return journalLine{{text: kind, style: journalHeading}}
}

func journalStateSegments(state string) journalLine {
	if state == "" {
		return journalLine{{text: "?", style: journalMuted, neutralMarker: true}}
	}
	style := journalStateStyle(state)
	if !journalKnownState(state) {
		return journalLine{{text: state, style: journalMuted}, {text: " ?", style: journalMuted, neutralMarker: true}}
	}
	return journalLine{{text: state, style: style}}
}

func journalKnownKind(kind string) bool {
	return knownKind(kind) || kind == "feedback"
}

func journalKnownState(state string) bool {
	return knownState(state) || state == "passed" || state == "success" || state == "succeeded" || state == "accepted" || state == "recorded"
}

func journalSuccessState(state string) bool {
	switch state {
	case "done", "passed", "success", "succeeded", "accepted":
		return true
	default:
		return false
	}
}

func journalAttentionState(state string) bool {
	switch state {
	case "pending", "active", "awaiting-human-evaluation", "resuming":
		return true
	default:
		return false
	}
}

func journalStateStyle(state string) journalStyle {
	if state == "blocked" || state == "failed" {
		return journalFailure
	}
	if journalSuccessState(state) {
		return journalSuccess
	}
	if journalAttentionState(state) {
		return journalAttention
	}
	return journalMuted
}

func journalValue(value string) string {
	if value == "" {
		return "?"
	}
	return value
}

func journalRecorded(value string) string {
	if value == "" {
		return "none recorded"
	}
	return value
}

func journalFooter(width int) string {
	full := "g/G first/last · j/k/↑/↓ records · v/V verifier · e/E evidence · enter detail · q/Esc quit"
	if lipgloss.Width(full) <= width {
		return full
	}
	return "g/G ends · j/k move · v/V verifier · e/E evidence · enter detail · q quit"
}

func journalSideLine(width int, left, right journalLine) journalLine {
	leftLimit := max((width-1)/2, 0)
	rightLimit := max(width-1-leftLimit, 0)
	left = clipJournalLine(left, leftLimit)
	right = clipJournalLine(right, rightLimit)
	gap := max(1, width-journalLineWidth(left)-journalLineWidth(right))
	line := append(journalLine{}, left...)
	line = append(line, journalSegment{text: strings.Repeat(" ", gap)})
	line = append(line, right...)
	return line
}

func journalLineWidth(line journalLine) int {
	var text strings.Builder
	for _, segment := range line {
		text.WriteString(segment.text)
	}
	return lipgloss.Width(text.String())
}

func normalizeJournalText(text string) string {
	var normalized strings.Builder
	for _, r := range text {
		switch r {
		case '\n':
			normalized.WriteString(`\n`)
		case '\r':
			normalized.WriteString(`\r`)
		case '\t':
			normalized.WriteString(`\t`)
		case '\x1b':
			normalized.WriteString(`\x1b`)
		default:
			switch {
			case r <= '\x1f' || r == '\x7f':
				fmt.Fprintf(&normalized, `\x%02x`, r)
			case r >= '\x80' && r <= '\x9f':
				fmt.Fprintf(&normalized, `\u%04x`, r)
			default:
				normalized.WriteRune(r)
			}
		}
	}
	return normalized.String()
}

func normalizeJournalLine(line journalLine) journalLine {
	normalized := make(journalLine, len(line))
	for i, segment := range line {
		segment.text = normalizeJournalText(segment.text)
		normalized[i] = segment
	}
	return normalized
}

func (m JournalModel) journalRailLines(margin string, lines []journalLine) []journalLine {
	for i := range lines {
		lines[i] = m.journalRailLine(margin, lines[i])
	}
	return lines
}

func (m JournalModel) journalRailLine(margin string, line journalLine) journalLine {
	if len(line) != 0 && line[0].text == margin {
		line = line[1:]
	}
	line = clipJournalLine(line, min(82, m.width-2))
	return append(journalLine{{text: margin}}, line...)
}

func clipJournalLine(line journalLine, width int) journalLine {
	line = normalizeJournalLine(line)
	if journalLineWidth(line) <= width {
		return line
	}

	var content, markers journalLine
	for _, segment := range line {
		if segment.neutralMarker {
			markers = append(markers, segment)
		} else {
			content = append(content, segment)
		}
	}
	if markerWidth := journalLineWidth(markers); markerWidth > 0 && markerWidth < width {
		clipped := clipJournalLinePrefix(content, width-markerWidth)
		return append(clipped, markers...)
	}
	return clipJournalLinePrefix(line, width)
}

func clipJournalLinePrefix(line journalLine, width int) journalLine {
	var plain strings.Builder
	for _, segment := range line {
		plain.WriteString(segment.text)
	}
	clipped := truncate(plain.String(), width)
	if clipped == plain.String() {
		return line
	}

	prefix := strings.TrimSuffix(clipped, "…")
	remaining := prefix
	result := make(journalLine, 0, len(line)+1)
	ellipsisStyle := journalPlain
	for _, segment := range line {
		if remaining == "" {
			ellipsisStyle = segment.style
			break
		}
		if strings.HasPrefix(remaining, segment.text) {
			result = append(result, segment)
			remaining = strings.TrimPrefix(remaining, segment.text)
			ellipsisStyle = segment.style
			continue
		}
		if strings.HasPrefix(segment.text, remaining) {
			result = append(result, journalSegment{text: remaining, style: segment.style})
			remaining = ""
			ellipsisStyle = segment.style
			break
		}
	}
	if strings.HasSuffix(clipped, "…") {
		result = append(result, journalSegment{text: "…", style: ellipsisStyle})
	}
	return result
}

func renderJournalLine(line journalLine, width int, enabled bool, styles journalStyles) string {
	line = clipJournalLine(line, width)
	var rendered strings.Builder
	for _, segment := range line {
		if enabled {
			rendered.WriteString(styles.render(segment.style, segment.text))
		} else {
			rendered.WriteString(segment.text)
		}
	}
	return rendered.String()
}
