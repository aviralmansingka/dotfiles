package main

import (
	"fmt"
	"image/color"
	"regexp"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"
	lg "charm.land/lipgloss/v2"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

var (
	ink    = lg.Color("#d4be98")
	muted  = lg.Color("#928374")
	green  = lg.Color("#a9b665")
	aqua   = lg.Color("#89b482")
	orange = lg.Color("#e78a4e")
	yellow = lg.Color("#d8a657")
	pink   = lg.Color("#d3869b")
	bg     = lg.Color("#282828")
	edge   = lg.Color("#32302f")
)

func paint(c interface {
	RGBA() (uint32, uint32, uint32, uint32)
}, s string) string {
	return lg.NewStyle().Foreground(c).Render(s)
}
func clean(s string) string {
	return strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return ' '
		}
		return r
	}, s)
}

var ansiRE = regexp.MustCompile(`\x1b\[[0-?]*[ -/]*[@-~]`)

func stripANSI(s string) string { return ansiRE.ReplaceAllString(s, "") }
func clip(s string, n int) string {
	r := []rune(clean(s))
	if len(r) > n && n > 1 {
		return string(r[:n-1]) + "…"
	}
	return string(r)
}
func status(s string) string {
	c := muted
	switch s {
	case "running", "reported":
		c = aqua
	case "ready", "passed", "done", "succeeded", "accepted":
		c = green
	case "waiting", "review", "pending":
		c = yellow
	case "failed", "interrupted", "changes_requested":
		c = orange
	}
	return paint(c, strings.ToUpper(s))
}

// fitLines clips every rendered line to a column budget, so a panel body never
// wraps into a second row and never pushes the frame past the terminal.
func fitLines(s string, n int) string {
	if n < 1 {
		return s
	}
	cut := lg.NewStyle().MaxWidth(n)
	lines := strings.Split(s, "\n")
	for i, line := range lines {
		lines[i] = cut.Render(line)
	}
	return strings.Join(lines, "\n")
}

// panel draws a bordered box of an exact size. Callers pass the box size, not
// the text size: the border and the padding are inside w and h. Rows are spent
// bottom-up, so a short box drops its blank line before its title and its title
// before the bottom border. A tall box keeps the title, one blank, then as much
// body as fits. The box is exactly w by h in every case.
func panel(w, h int, title, body string) string { return panelFocus(w, h, title, body, true) }

// panelFocus draws the same box and says whether it owns the keys. The focused
// box carries an aqua title and border; the idle box stays muted, so tab shows
// where j/k and pgup/pgdown land without a second legend row.
func panelFocus(w, h int, title, body string, focused bool) string {
	if w < 8 || h < 4 {
		// Too short for a border and padding: keep the exact height anyway, so the
		// caller's row budget still holds.
		lines := strings.Split(fitLines(body, max(1, w)), "\n")
		if len(lines) > h {
			lines = lines[:max(0, h)]
		}
		for len(lines) < max(0, h) {
			lines = append(lines, "")
		}
		pad := lg.NewStyle().Width(w).MaxWidth(w)
		for i := range lines {
			lines[i] = pad.Render(lines[i])
		}
		return strings.Join(lines, "\n")
	}
	// A six-row box is the smallest that holds a border, the padding, and a line
	// of body. Below that, drop the padding before the border.
	pad := 1
	if h < 6 {
		pad = 0
	}
	content := max(0, h-2-2*pad) // rows inside the border and padding
	lines := strings.Split(fitLines(body, max(1, w-4)), "\n")
	titleInk, border := muted, edge
	if focused {
		titleInk, border = aqua, aqua
	}
	var head []string
	switch {
	case content >= 3:
		head = []string{paint(titleInk, title), ""}
	case content == 2:
		head = []string{paint(titleInk, title)}
	}
	if keep := content - len(head); len(lines) > keep {
		lines = lines[:max(0, keep)]
	}
	return lg.NewStyle().Width(w).Height(h).MaxWidth(w).MaxHeight(h).Padding(pad).
		Border(lg.RoundedBorder()).BorderForeground(border).Foreground(ink).
		Render(strings.Join(append(head, lines...), "\n"))
}
func heading(s string) string { return lg.NewStyle().Bold(true).Foreground(ink).Render(s) }

// launchColor paints a launch state: waiting is yellow, a started mission is
// aqua, and a refusal is orange.
func launchColor(state string) color.Color {
	switch state {
	case launchStarted:
		return aqua
	case launchFailed:
		return orange
	}
	return yellow
}

// marker is the two-column selection bar. The block glyph measures two columns,
// and the list keeps its column by joining rows, never trimming them.
func marker() string { return paint(aqua, "▌ ") }

// selectedTitle paints the focused row's title: same weight, aqua instead of ink,
// so the eye lands on the bar and the title together.
func selectedTitle(s string) string {
	return lg.NewStyle().Bold(true).Foreground(aqua).Render(s)
}

const (
	// minCols is the width floor. Below it the desk stops being readable.
	minCols   = 48
	minRows   = 12
	wideDesk  = 110 // a second column fits beside the form
	splitDesk = 94  // the mission list fits beside the detail panel
)

// frameSize is the footprint the desk paints: the whole terminal, held to the
// 48-column floor and a 12-row floor.
func (m *desk) frameSize() (int, int) { return max(minCols, m.width), max(minRows, m.height) }

// innerSize is the content box inside the outer frame padding: two columns on
// each side. The frame claims every terminal row, so the height is unchanged.
func (m *desk) innerSize() (int, int) {
	w, h := m.frameSize()
	return w - 4, h
}

// pageStep scrolls half the visible body at a time.
func (m *desk) pageStep() int {
	_, h := m.innerSize()
	return max(4, h/2)
}

// formLeftWidth is the form panel width for a content box that wide.
func (m *desk) formLeftWidth(w int) int {
	if w < wideDesk {
		return w
	}
	return min(76, max(40, w*56/100))
}

// formWidth sizes the Huh form to the panel it is drawn in.
func (m *desk) formWidth() int {
	w, _ := m.innerSize()
	return max(24, m.formLeftWidth(w)-6)
}

// bodyHeight is the rows the body panels get. The frame is header rows, one
// blank, the panels, one deliberate blank, then the footer rows. The panels
// therefore reach the separator above the footer, and the legend is the last row.
func (m *desk) bodyHeight() int {
	w, h := m.innerSize()
	// One row is the least the frame can give the panels without pushing the
	// footer past the last row; the header, both separators, and the footer rows
	// are already spent above.
	return max(1, h-len(m.headerLines(w))-len(m.footerLines(w))-2)
}

// formHeight is the rows the Huh form may use inside its panel: the border, the
// padding, the hint line, and the form help line are already spent.
func (m *desk) formHeight() int { return max(4, m.bodyHeight()-9) }

// sizeForm gives the form the current panel width and height. Huh keeps its
// first window size, so every resize reapplies both.
func (m *desk) sizeForm() {
	if m.form == nil {
		return
	}
	m.form.WithWidth(m.formWidth())
	m.form.WithHeight(m.formHeight())
	_, _ = m.form.Update(tea.WindowSizeMsg{Width: m.formWidth(), Height: m.formHeight()})
}

// deskFilter is one state the mission list can be narrowed to: the list pane's
// tabs. [ and ] walk them in order while the list owns the keys, and the cycle
// wraps, so every state is one key away from every other.
type deskFilter struct {
	Label string
	Match func(mission.Record) bool
}

// deskFilters is the whole lane: five state groups the human acts on, in the
// order the desk opens and cycles. The first entry is the opening filter, so a
// desk left alone shows the work that is moving. There is no ALL tab: every
// entry narrows the list, and DONE is one key away at the end of the cycle.
var deskFilters = []deskFilter{
	{Label: "ACTIVE", Match: func(r mission.Record) bool { return r.State.Status == "running" }},
	{Label: "YOURS", Match: func(r mission.Record) bool { return r.State.Status == "waiting" || r.State.Status == "review" }},
	{Label: "READY", Match: func(r mission.Record) bool { return r.State.Status == "ready" }},
	{Label: "FAILED", Match: func(r mission.Record) bool { return r.State.Status == "failed" }},
	{Label: "DONE", Match: func(r mission.Record) bool { return r.State.Status == "done" || r.State.Status == closedStatus }},
}

// filterRecords keeps the missions one filter names, in vault order. Every
// index filters: an index outside the lane falls back to the first entry, so no
// caller can widen the list by accident.
func filterRecords(records []mission.Record, index int) []mission.Record {
	if index < 0 || index >= len(deskFilters) {
		index = 0
	}
	match := deskFilters[index].Match
	out := make([]mission.Record, 0, len(records))
	for _, r := range records {
		if match(r) {
			out = append(out, r)
		}
	}
	return out
}

// filterIndex resolves a filter label, for the render command and its usage
// error.
func filterIndex(label string) (int, bool) {
	for i, f := range deskFilters {
		if strings.EqualFold(f.Label, label) {
			return i, true
		}
	}
	return 0, false
}

// filterLabels lists every filter label once, in cycle order.
func filterLabels() string {
	labels := make([]string, 0, len(deskFilters))
	for _, f := range deskFilters {
		labels = append(labels, f.Label)
	}
	return strings.Join(labels, ", ")
}

type pulse time.Time

func tick() tea.Cmd { return tea.Tick(2*time.Second, func(t time.Time) tea.Msg { return pulse(t) }) }

type draft struct {
	Repo, Title, Slug, Goal, Steps, Kind string
	First, Final                         bool
}
type desk struct {
	store                        *Store
	nav                          *deskNavigation
	records                      []mission.Record
	view                         []mission.Record // records that pass the filter
	selected, tab, width, height int
	filter                       int // index into deskFilters
	focus                        int // 0 the mission list owns the keys, 1 the details
	scroll                       int
	err                          error
	notice                       string
	form                         *huh.Form
	formKind                     string
	draft                        draft
	decision, actor, note        string
	review                       mission.Record
	quitAfterForm                bool
	selectedStep                 int
	editing                      mission.Record
	stepDraft                    mission.Step
	optionalChecks               []string
	resetStep                    bool
	launchDir                    string
	launches                     map[string]Launch
}

func newDesk(s *Store) *desk {
	return &desk{store: s, width: 128, height: 42, launchDir: launchStateDir(), launches: map[string]Launch{}}
}

// current is the selected mission inside the active filter.
func (m *desk) current() (mission.Record, bool) {
	if m.nav != nil && m.nav.handle != "" {
		for _, r := range m.records {
			if r.Handle == m.nav.handle {
				return r, true
			}
		}
		return mission.Record{}, false
	}
	if m.selected < 0 || m.selected >= len(m.view) {
		return mission.Record{}, false
	}
	return m.view[m.selected], true
}

// setFilter narrows the list to one state and puts the selection back on its
// first row, so a filter never leaves the marker on a hidden mission.
func (m *desk) setFilter(index int) {
	if index < 0 || index >= len(deskFilters) {
		index = 0
	}
	m.filter = index
	m.view = filterRecords(m.records, index)
	m.selected, m.selectedStep, m.scroll = 0, 0, 0
}

// cycleFilter walks the filters, wrapping at either end.
func (m *desk) cycleFilter(step int) {
	m.setFilter((m.filter + step + len(deskFilters)) % len(deskFilters))
}

func (m *desk) refresh() {
	h := ""
	if r, ok := m.current(); ok {
		h = r.Handle
	}
	m.records, m.err = m.store.list()
	m.launches = launches(m.launchDir)
	if m.nav != nil {
		m.refreshNavigationList(h)
		return
	}
	m.view = filterRecords(m.records, m.filter)
	m.selected = 0
	for i, r := range m.view {
		if r.Handle == h {
			m.selected = i
		}
	}
	m.selected = max(0, min(m.selected, len(m.view)-1))
}

// filterLane is the one-row state filter, the list pane's tab strip. The active
// chip leads, so a narrow list still shows which state it is narrowed to; the
// remaining chips follow in cycle order, as many as the row holds, and a
// counter says where the cycle stands when the row cannot show every tab.
func (m *desk) filterLane(w int) string {
	out, shown := m.laneChips(w)
	if shown >= len(deskFilters) {
		return out
	}
	counter := paint(edge, " · ") + paint(muted, fmt.Sprintf("%d/%d", m.filter+1, len(deskFilters)))
	// The counter is part of the row: reserve its columns before fitting chips.
	out, _ = m.laneChips(w - lg.Width(stripANSI(counter)))
	return out + counter
}

// laneChips joins as many filter chips as the width holds, active chip first,
// and reports how many chips fit.
func (m *desk) laneChips(w int) (string, int) {
	order := make([]int, 0, len(deskFilters))
	order = append(order, m.filter)
	for i := range deskFilters {
		if i != m.filter {
			order = append(order, i)
		}
	}
	out, shown := "", 0
	for _, i := range order {
		label := fmt.Sprintf("%s %d", deskFilters[i].Label, len(filterRecords(m.records, i)))
		if i == m.filter {
			label = paint(aqua, label)
		} else {
			label = paint(muted, label)
		}
		if shown == 0 {
			out, shown = label, 1
			continue
		}
		next := paint(edge, " · ") + label
		if lg.Width(stripANSI(out))+lg.Width(stripANSI(next)) > w {
			break
		}
		out += next
		shown++
	}
	return out, shown
}

// nextTab moves the tab of the pane that owns the keys: the mission list on
// the pane's first focus tab walks the state filters, the details walk their
// five views. The other pane keeps its own tab untouched.
func (m *desk) nextTab(step int) {
	if m.focus == 0 {
		m.cycleFilter(step)
		return
	}
	m.tab = (m.tab + step + detailTabs) % detailTabs
	m.scroll = 0
}

// detailTabs is the number of views the detail pane holds: Overview, Troopers,
// Attempts, Activity, Steps. The Steps view is always the last one.
const detailTabs = 5

// moveDown and moveUp apply the arrow keys to whichever pane owns them: the
// mission list moves its selection, the step list moves its step, and any other
// detail view scrolls one line.
func (m *desk) moveDown() {
	switch {
	case m.focus == 1 && m.tab == detailTabs-1:
		if r, ok := m.current(); ok {
			m.selectedStep = max(0, min(len(r.Mission.Steps)-1, m.selectedStep+1))
		}
	case m.focus == 1:
		m.scroll++
	default:
		if len(m.view) > 0 {
			m.selected = min(len(m.view)-1, m.selected+1)
			m.selectedStep = 0
		}
		m.scroll = 0
	}
}

func (m *desk) moveUp() {
	switch {
	case m.focus == 1 && m.tab == detailTabs-1:
		m.selectedStep = max(0, m.selectedStep-1)
	case m.focus == 1:
		m.scroll = max(0, m.scroll-1)
	default:
		m.selected = max(0, m.selected-1)
		m.selectedStep = 0
		m.scroll = 0
	}
}

// launchSelected writes the launch request for the selected mission. The desk
// has no launch path of its own: the owning Pi session claims the request and
// runs the same start action the mission tool and the /mission command use. A
// live request is never rewritten, so a second press cannot start a second
// worker.
func (m *desk) launchSelected() {
	r, ok := m.current()
	if !ok {
		return
	}
	if r.State.Runtime != nil && r.State.Runtime.SessionID != "" {
		m.err = nil
		m.notice = "Already owned by a Pi session · attach to it instead"
		return
	}
	l, created, e := requestLaunch(m.launchDir, deskOwner("."), r.Handle, r.Mission.Repo, time.Now())
	if e != nil {
		m.notice = ""
		m.err = mission.Problem("launch_failed", "cannot write the launch request: %v", e)
		return
	}
	m.launches[r.Handle] = l
	m.err = nil
	if created {
		m.notice = "Launch requested · " + ownerLine(l)
		return
	}
	m.notice = "Launch already " + l.State + " · " + r.Handle
}

func (m *desk) Init() tea.Cmd {
	m.refresh()
	if m.form != nil {
		return tea.Batch(m.form.Init(), tick())
	}
	return tea.Batch(tick(), m.pollNavigationPRs())
}
func (m *desk) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch v := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = v.Width, v.Height
		m.sizeForm()
	case pulse:
		m.refresh()
		return m, tea.Batch(tick(), m.pollNavigationPRs(), m.pollNavigationCalls())
	case deskCallsUpdate:
		if m.nav != nil && m.nav.callRequest == v.request {
			m.nav.loadingCalls = false
			m.applyNavigationCalls(v.calls)
		}
		return m, nil
	case deskPRs:
		if m.nav != nil {
			h, _ := m.current()
			m.nav.prs = v
			m.refreshNavigationList(h.Handle)
		}
		return m, nil
	case tea.KeyPressMsg:
		if v.String() == "ctrl+c" {
			return m, tea.Quit
		}
		if m.form != nil {
			if v.String() == "esc" {
				m.form = nil
				if m.quitAfterForm {
					return m, tea.Quit
				}
				return m, nil
			}
		} else {
			if m.nav != nil {
				depth := m.depth()
				if m.navigationKey(v) {
					if depth == 1 && m.depth() == 2 {
						return m, m.pollNavigationCalls()
					}
					return m, nil
				}
			}
			switch v.String() {
			case "q":
				return m, tea.Quit
			case "tab":
				// Tab moves the keys between the mission selector and the
				// details; each pane keeps its own tab.
				m.focus = (m.focus + 1) % 2
				m.scroll = 0
			case "]", "right":
				m.nextTab(1)
			case "[", "left":
				m.nextTab(-1)
			case "j", "down":
				m.moveDown()
			case "k", "up":
				m.moveUp()
			case "pgdown":
				m.scroll += m.pageStep()
			case "pgup":
				m.scroll = max(0, m.scroll-m.pageStep())
			case "n":
				m.startBuilder()
				if m.form != nil {
					return m, m.form.Init()
				}
			case "s":
				m.tab = detailTabs - 1
				m.focus = 1
				m.scroll = 0
			case "esc":
				m.focus, m.tab, m.scroll = 0, 0, 0
			case "e":
				m.startStepEdit()
				if m.form != nil {
					return m, m.form.Init()
				}
			case "a":
				m.startReview()
				if m.form != nil {
					return m, m.form.Init()
				}
			case "r":
				m.refresh()
			case "L":
				m.launchSelected()
			}
			return m, nil
		}
	}
	if m.form != nil {
		_, cmd := m.form.Update(msg)
		if m.form.State == huh.StateCompleted {
			m.commitForm()
			if m.quitAfterForm && m.err == nil {
				return m, tea.Quit
			}
			return m, nil
		}
		if m.form.State == huh.StateAborted {
			m.form = nil
		}
		return m, cmd
	}
	return m, nil
}
func (m *desk) View() tea.View { v := tea.NewView(m.render()); v.AltScreen = true; return v }

// render fills the whole terminal: the frame is exactly the clamped terminal
// size, the panels take every row between header and footer, and the status line
// and legend sit on the last rows.
func (m *desk) render() string {
	fw, fh := m.frameSize()
	w, _ := m.innerSize()
	head := m.headerLines(w)
	foot := m.footerLines(w)
	bodyH := m.bodyHeight()
	separator := "\n\n"
	if m.nav != nil && m.form == nil {
		separator = "\n" + paint(edge, strings.Repeat("─", w)) + "\n"
	}
	frame := strings.Join(head, "\n") + separator + m.body(w, bodyH) + separator + strings.Join(foot, "\n")
	return lg.NewStyle().Background(bg).Foreground(ink).Padding(0, 2).
		Width(fw).Height(fh).MaxWidth(fw).MaxHeight(fh).Render(frame)
}

func (m *desk) headerLines(w int) []string {
	if m.nav != nil {
		return m.navigationHeader(w)
	}
	title := lg.NewStyle().Background(aqua).Foreground(bg).Bold(true).Padding(0, 1).Render(" m ") + "  " + heading("MISSION")
	sub := "  /  work that survives the agent"
	if w-lg.Width(title) >= lg.Width(sub) {
		title += paint(muted, sub)
	}
	counts := map[string]int{}
	for _, r := range m.records {
		counts[r.State.Status]++
	}
	bar := paint(aqua, fmt.Sprintf("%02d active", counts["running"])) + paint(muted, "   ·   ") + paint(yellow, fmt.Sprintf("%02d need you", counts["waiting"]+counts["review"])) + paint(muted, "   ·   ") + paint(green, fmt.Sprintf("%02d ready", counts["ready"]))
	out := []string{fitLines(title, w), paint(muted, "VAULT  ") + clip(m.store.Vault, max(8, w-8)), "", fitLines(bar, w)}
	// The trooper line is a header row only when a report exists; bodyHeight
	// spends rows from len(headerLines), so the quiet header gives the rows
	// back to the panels instead of holding a placeholder.
	if line := m.trooperHeader(w); line != "" {
		out = append(out, fitLines(line, w))
	}
	return out
}

// trooperHeader renders the selected mission's newest trooper report as one
// header row, so the human reads the ground without opening the Troopers tab.
// It carries the state glyph, the trooper's name, the age, and the summary.
// A blocked or needs-input trooper rides reportGlyph's yellow diamond while a
// working one pulses aqua and a finished one ticks green, so trouble reads at
// a glance even in a one-line header. No report anywhere means no line at
// all: no placeholder, no empty brackets — the header keeps its four quiet
// rows. The row is clipped to the same pane width every other header row uses.
func (m *desk) trooperHeader(w int) string {
	r, ok := m.current()
	if !ok {
		return ""
	}
	rep := newestReport(r)
	if rep == nil {
		return ""
	}
	head := paint(muted, "TROOPER  ") + reportGlyph(rep.Status) + " "
	used := lg.Width(stripANSI(head))
	name := clip(rep.Trooper, 24)
	age := paint(muted, "  ·  "+reportAge(rep.At))
	ageW := lg.Width(stripANSI(age))
	// Budget the row by hand so the head never reaches the pane edge: the name
	// shrinks from its tab budget of 24 first, the age is dropped next, and
	// only the summary is left for fitLines to clip. A wide pane fits all of
	// it; a narrow one keeps the name and loses the summary tail.
	if w-used-ageW-lg.Width(stripANSI(name)) < 2 {
		if narrow := w - used - ageW - 2; narrow >= 3 {
			name = clip(rep.Trooper, narrow)
		} else {
			age, ageW = "", 0
			name = clip(rep.Trooper, max(1, min(24, w-used-2)))
		}
	}
	line := head + name + age
	if rest := w - lg.Width(stripANSI(line)) - 2; rest > 1 {
		line += "  " + clip(rep.Summary, rest)
	}
	return line
}

// newestReport picks the newest report from the attempt reportAttempt chooses
// (the same active-first, else newest-with-reports source the Troopers tab
// reads — one source, not a second one). Reports are keyed by trooper name and
// replaced in place, so list order is insertion order, not time order: the
// winner is the report with the latest At stamp. A stamp that will not parse
// sorts oldest, so a broken clock can never promote itself; an exact tie goes
// to the later list slot, which is the row a replace-in-place update just
// rewrote.
func newestReport(r mission.Record) *mission.Report {
	a := reportAttempt(r)
	if a == nil {
		return nil
	}
	best := -1
	var bestAt time.Time
	for i := range a.Reports {
		at, e := time.Parse(time.RFC3339Nano, a.Reports[i].At)
		if e != nil {
			at = time.Time{}
		}
		if best < 0 || at.After(bestAt) || (at.Equal(bestAt) && i > best) {
			best, bestAt = i, at
		}
	}
	if best < 0 {
		return nil
	}
	return &a.Reports[best]
}

// footerKeys joins as many key hints as the footer row holds, most useful
// first, so a narrow terminal loses a hint instead of clipping one. The hints
// follow the keys: tab moves the focus, and [ ] walk the focused pane's tabs.
// Quitting stays near the front: a narrow footer must keep the way out.
func (m *desk) footerKeys(w int) string {
	hints := []string{"j/k select", "[/] filter", "q quit", "tab details", "L launch", "n new", "a review", "pgdn scroll"}
	switch {
	case m.form != nil:
		hints = []string{"tab next field", "enter continue", "esc cancel"}
	case m.nav != nil:
		hints = m.navigationHints()
	case m.focus == 1 && m.tab == detailTabs-1:
		hints = []string{"j/k step", "[/] view", "q quit", "tab missions", "e customize", "pgdn scroll"}
	case m.focus == 1:
		hints = []string{"j/k scroll", "[/] view", "q quit", "tab missions", "pgdn scroll"}
	}
	out := ""
	for i, hint := range hints {
		next := hint
		if m.nav != nil && i == 0 {
			key, action, _ := strings.Cut(hint, " ")
			next = lg.NewStyle().Background(edge).Foreground(ink).Render(key) + " " + action
		}
		if out != "" {
			next = "   " + next
		}
		if lg.Width(out)+lg.Width(next) > w {
			break
		}
		out += next
	}
	return out
}

func (m *desk) footerLines(w int) []string {
	var out []string
	if m.err != nil {
		out = append(out, fitLines(paint(orange, clean(m.err.Error())), w))
	}
	if m.notice != "" {
		out = append(out, fitLines(paint(green, clean(m.notice)), w))
	}
	return append(out, fitLines(paint(muted, m.footerKeys(w)), w))
}

func (m *desk) body(w, h int) string {
	if m.form != nil {
		return m.formBody(w, h)
	}
	if m.nav != nil {
		return m.navigationBody(w, h)
	}
	return m.deskBody(w, h)
}

func (m *desk) deskBody(w, h int) string {
	sideW := min(56, max(24, w/3))
	detailW := w - sideW - 2
	// panel() spends two content rows on the title and its blank line.
	textH := max(1, h-6)
	if w < splitDesk || detailW < 30 {
		// Too narrow for two panes: one pane at a time, and tab swaps them.
		if m.focus == 1 {
			return panelFocus(w, h, "MISSION DESK", m.detailText(w-4, textH), true)
		}
		return panelFocus(w, h, "MISSIONS", m.listBody(w-4, textH), true)
	}
	return lg.JoinHorizontal(lg.Top,
		panelFocus(sideW, h, "MISSIONS", m.listBody(sideW-4, textH), m.focus == 0), "  ",
		panelFocus(detailW, h, "MISSION DESK", m.detailText(detailW-4, textH), m.focus == 1))
}

// listBody renders the filter lane, then as many mission rows as the panel
// height holds, keeping the selection inside that window. Rows are joined,
// never trimmed: a trim would eat the leading indent of the first row when that
// row is not selected, and the title would jump a column left of its neighbours.
func (m *desk) listBody(w, h int) string {
	lane := m.filterLane(w)
	if len(m.records) == 0 {
		return paint(muted, "No missions yet.\n\nPress n to create one.")
	}
	if len(m.view) == 0 {
		return lane + "\n" + paint(muted, "No mission in "+deskFilters[m.filter].Label+".\n\nPress ] for the next state.")
	}
	// Each mission spends three lines and one separator; the lane spends the
	// separator, so the same h/4 rows still fit.
	visible := max(1, h/4)
	start := min(max(0, m.selected-visible+1), max(0, len(m.view)-visible))
	rows := make([]string, 0, visible)
	for i := start; i < min(len(m.view), start+visible); i++ {
		r := m.view[i]
		title := heading(clip(r.Mission.Title, w-2))
		prefix := "  "
		if i == m.selected {
			prefix = marker()
			title = selectedTitle(clip(r.Mission.Title, w-2))
		}
		// The launch badge leads the row: a narrow list drops the tail, and the
		// one fact that changes while the human watches must survive that.
		line := status(r.State.Status) + paint(muted, "  ·  "+fmt.Sprint(len(r.State.Attempts))+" attempts")
		if l, ok := m.launches[r.Handle]; ok {
			if label, _ := launchSummary(l); label != "" {
				line = paint(launchColor(l.State), label) + "  " + line
			}
		}
		rows = append(rows, prefix+title+"\n  "+paint(muted, clip(r.Handle, w-2))+"\n"+line)
	}
	return lane + "\n" + strings.Join(rows, "\n\n")
}

// detailText scrolls the detail panel to its own height, not to the terminal.
func (m *desk) detailText(w, h int) string {
	if len(m.records) == 0 {
		return paint(muted, "Create a mission to begin.")
	}
	r, ok := m.current()
	if !ok {
		return paint(muted, "No mission passes the "+deskFilters[m.filter].Label+" filter.\n\nPress ] for the next state.")
	}
	detail := m.detail(r, max(16, w))
	lines := strings.Split(detail, "\n")
	limit := max(1, h)
	if m.nav != nil && m.nav.revealStep {
		m.nav.revealStep = false
		if len(lines) > limit {
			for i, line := range lines {
				if strings.HasPrefix(stripANSI(line), "▌ ") {
					m.scroll = max(i-max(0, limit-2), min(m.scroll, i))
					break
				}
			}
		}
	}
	m.scroll = min(m.scroll, max(0, len(lines)-limit))
	if len(lines) > limit {
		end := min(len(lines), m.scroll+limit-1)
		detail = strings.Join(lines[m.scroll:end], "\n") + "\n" + paint(muted, "pgup / pgdown · more details")
	}
	return detail
}

func (m *desk) formHeading() (string, string) {
	switch m.formKind {
	case "review":
		return "HUMAN REVIEW", m.review.Handle + " · " + m.review.State.Pending + " · revision " + fmt.Sprint(m.review.State.Revision)
	case "step":
		return "CUSTOMIZE STEP " + m.stepDraft.ID, m.editing.Handle + " · defaults first, details when needed"
	}
	return "CREATE A MISSION", "A short brief becomes a durable, claimable unit of work."
}

// formBody gives the form every row the body has, beside a reference column on
// wide terminals.
func (m *desk) formBody(w, h int) string {
	label, hint := m.formHeading()
	form := m.form.View()
	if form == "" {
		form = paint(muted, "Preparing form…")
	}
	leftW := m.formLeftWidth(w)
	left := panel(leftW, h, label, hint+"\n\n"+form)
	if leftW >= w-2 {
		return left
	}
	title, side := m.formSide()
	return lg.JoinHorizontal(lg.Top, left, "  ", panel(w-leftW-2, h, title, side))
}

func (m *desk) formSide() (string, string) {
	switch m.formKind {
	case "review":
		cp := m.review.State.Checkpoints[m.review.State.Pending]
		return "PRESERVED EVIDENCE", heading(m.review.Handle) + "\n\n" + cp.Evidence + "\n\n" + paint(muted, "Bound to attempt") + "\n" + cp.Attempt + "\n\n" + paint(muted, "Evidence fingerprint") + "\n" + clip(cp.Hash, 40) + "\n\n" + paint(yellow, "This records your review decision.") + "\nA revision creates a new attempt.\nEarlier evidence remains in the vault."
	case "step":
		return "CHECKS FOLLOW THE ATTEMPT", heading("Always required") + "\nnonempty-artifact\n\n" + heading("Optional checks") + "\njson-valid · parse the result\ngo-test · test the Go module\n\n" + paint(muted, "Each run preserves") + "\nverdict + source fingerprint\nchecker version + evidence log\n\n" + paint(yellow, "Past evidence stays in the vault.") + "\nReset explicitly to revise a used step."
	}
	return "SAVED AS MARKDOWN", paint(muted, "6_missions/") + "\n  " + platform.Fallback(m.draft.Repo, "repository") + "/\n    " + platform.Fallback(m.draft.Slug, platform.Fallback(mission.Slugify(m.draft.Title), "mission-slug")) + "/\n      mission.md\n      state.md\n      attempts/\n      artifacts/\n\n" + heading("One mission · one repository") + "\n\nAgents claim the next step.\nEach attempt keeps its evidence.\nReviews gate progression, never your tools.\n\n" + paint(yellow, "No agent is launched by this form.")
}
func (m *desk) detail(r mission.Record, w int) string {
	tabs := []string{"Overview", "Troopers", "Attempts", "Activity", "Steps"}
	nested := m.nav != nil && m.depth() == 1
	for i, t := range tabs {
		tabs[i] = paint(muted, t)
		if i == m.tab {
			tabs[i] = paint(aqua, "● "+t)
			if nested {
				tabs[i] = deskBar(" "+t, len(t)+2, ink)
			}
		}
	}
	s := ""
	if !nested {
		s = heading(r.Mission.Title) + "  " + status(r.State.Status) + "\n" + paint(muted, r.Handle+"  ·  "+r.Mission.Kind+"  ·  rev "+fmt.Sprint(r.State.Revision)) + "\n"
	}
	if l, ok := m.launches[r.Handle]; ok {
		if label, why := launchSummary(l); label != "" {
			s += paint(launchColor(l.State), strings.ToUpper(label)) + "  " + paint(muted, why) + "\n"
		}
	}
	s += strings.Join(tabs, "     ") + "\n\n"
	if m.tab == detailTabs-1 {
		return s + m.stepsDetail(r, w)
	}
	if m.tab == 1 {
		return s + m.troopersDetail(r, w)
	}
	if m.tab == 2 {
		if len(r.State.Attempts) == 0 {
			return s + paint(muted, "No attempts. A claim creates the first record.")
		}
		for i := len(r.State.Attempts) - 1; i >= 0; i-- {
			a := r.State.Attempts[i]
			s += heading(fmt.Sprintf("%03d  %s  %s", a.Sequence, a.Step, a.Agent)) + "  " + status(a.Status) + "\n" + paint(muted, clip(a.ID, w)) + "\n" + "session  " + clip(platform.Fallback(a.SessionID, "awaiting session-start hook"), w-10) + "\n" + "worktree " + clip(a.Cwd, w-10) + "\n" + "output   " + a.Artifact + "\n"
			if a.Transcript != "" {
				s += "session  " + a.Transcript + "\n"
			}
			for _, v := range a.Verifications {
				for _, c := range v.Results {
					s += "check    " + paint(aqua, c.Check) + "  " + status(c.Verdict) + "\n"
					for _, ev := range c.Evidence {
						if strings.Contains(ev.Path, "/checks/") {
							s += "         " + paint(muted, clip(ev.Path, w-9)) + "\n"
						}
					}
				}
			}
			s += "\n"
		}
		return s
	}
	if m.tab == 3 {
		var events []mission.Event
		for _, a := range r.State.Attempts {
			events = append(events, a.Events...)
		}
		if len(events) == 0 {
			return s + paint(muted, "Lifecycle events appear here when hooks run.")
		}
		for _, e := range events[max(0, len(events)-9):] {
			ts := e.At
			if len(ts) > 19 {
				ts = ts[11:19]
			}
			s += paint(muted, ts) + "  " + paint(aqua, e.Type) + "\n          " + clip(e.Summary, w-10) + "\n\n"
		}
		return s
	}
	columns := "STEP  RESULT     WORK"
	if nested {
		columns = deskBar("  STEP  RESULT       WORK", w, ink)
	}
	s += clean(r.Mission.Goal) + "\n\n" + columns + "\n"
	passed := 0
	for i, st := range r.Mission.Steps {
		ss := r.State.Steps[st.ID]
		icon := "○"
		if ss.Status == "passed" {
			icon = "✓"
			passed++
		}
		if ss.Status == "running" {
			icon = "◉"
		}
		prefix := ""
		if nested {
			prefix = "  "
			if i == m.selectedStep {
				prefix = paint(yellow, "▌ ")
			}
		}
		result := lg.NewStyle().Width(10).Render(status(ss.Status))
		line := prefix + paint(aqua, st.ID) + "   " + icon + " " + result + " " + clip(st.Title, w-23)
		if prefix != "" && i == m.selectedStep {
			line = deskRight(line, paint(yellow, "Enter Open step"), w)
			line = deskHighlight(line, w)
		}
		s += line + "\n"
		for _, cp := range r.Mission.Checkpoints {
			if cp.After == st.ID {
				s += "      └ " + paint(yellow, cp.ID+" human review") + paint(muted, " · "+r.State.Checkpoints[cp.ID].Status) + "\n"
			}
		}
	}
	if nested {
		s += "\n" + paint(green, fmt.Sprintf("%d of %d steps passed", passed, len(r.Mission.Steps)))
		if r.State.Pending != "" {
			s += paint(yellow, "    ·    Handoff waits for "+clean(r.State.Pending))
		}
		s += "\n"
	}
	if !nested && r.State.Pending != "" {
		for _, cp := range r.Mission.Checkpoints {
			if cp.ID == r.State.Pending {
				s += "\n" + paint(yellow, "◆ YOUR DECISION  "+cp.ID) + "\n" + clean(cp.Question) + "\n" + paint(muted, "Evidence: "+r.State.Checkpoints[cp.ID].Evidence) + "\n" + paint(aqua, "Press a to accept or request revision.") + "\n"
			}
		}
	}
	if r.State.Active != "" {
		a, _ := mission.FindAttempt(&r.State, r.State.Active)
		s += "\n" + paint(aqua, "◉ ATTEMPT ") + heading(fmt.Sprintf("%03d  %s", a.Sequence, a.Agent)) + "\n" + paint(muted, "Session  ") + clip(platform.Fallback(a.SessionID, "awaiting hook"), w-10) + "\n" + paint(muted, "Events   ") + fmt.Sprint(len(a.Events)) + " recorded · " + platform.Fallback(a.Branch, "read-only research") + "\n"
	}
	if st, e := mission.NextStep(r.Mission, r.State); e == nil {
		s += "\n" + paint(green, "→ READY TO CLAIM  "+st.ID) + "\n" + paint(muted, "mission claim ") + r.Handle + " --agent " + platform.Fallback(st.Agent, "scout")
	}
	return s
}

// troopersDetail renders the Troopers tab: one row per report from the attempt
// the operator cares about right now. reportGlyph paints the state, then the
// trooper, its age, and the summary clipped to one line, so a narrow pane loses
// the tail of a summary and never a row.
func (m *desk) troopersDetail(r mission.Record, w int) string {
	a := reportAttempt(r)
	if a == nil {
		return paint(muted, "No trooper reports yet. A progress call with --actor records one.")
	}
	s := ""
	for _, rep := range a.Reports {
		head := reportGlyph(rep.Status) + " " + clip(rep.Trooper, 24) + paint(muted, "  ·  "+reportAge(rep.At))
		rest := max(0, w-lg.Width(stripANSI(head))-3)
		line := head
		if rest > 1 {
			line += "  " + clip(rep.Summary, rest)
		}
		s += line + "\n"
	}
	return s
}

// reportAttempt picks the attempt whose reports the Troopers tab shows: the
// active attempt when it already carries reports, else the newest attempt with
// a nonempty list — a finished attempt's reports outlive its active slot, so
// the operator still reads who did what after the attempt closes.
func reportAttempt(r mission.Record) *mission.Attempt {
	if r.State.Active != "" {
		if a, e := mission.FindAttempt(&r.State, r.State.Active); e == nil && len(a.Reports) > 0 {
			return a
		}
	}
	for i := len(r.State.Attempts) - 1; i >= 0; i-- {
		if len(r.State.Attempts[i].Reports) > 0 {
			return &r.State.Attempts[i]
		}
	}
	return nil
}

// reportGlyph paints the one-character state for a trooper report, matching the
// step icons: a finished report ticks green, work in progress pulses aqua, and
// a blocker stays yellow until it clears.
func reportGlyph(status string) string {
	switch status {
	case "ready":
		return paint(green, "✓")
	case "working":
		return paint(aqua, "◉")
	case "blocked", "needs-input":
		return paint(yellow, "◆")
	}
	return paint(muted, "○")
}

// reportAge renders a report stamp as a short relative age; a stamp that will
// not parse falls back to its raw text, so the record is never hidden.
func reportAge(at string) string {
	t, e := time.Parse(time.RFC3339Nano, at)
	if e != nil {
		return clip(at, 20)
	}
	switch d := time.Since(t); {
	case d < time.Minute:
		return fmt.Sprintf("%ds ago", max(0, int(d.Seconds())))
	case d < time.Hour:
		return fmt.Sprintf("%dm ago", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh ago", int(d.Hours()))
	}
	d := time.Since(t)
	return fmt.Sprintf("%dd ago", int(d.Hours()/24))
}

func formTheme() huh.Theme {
	return huh.ThemeFunc(func(bool) *huh.Styles {
		t := huh.ThemeBase(true)
		t.Focused.Base = t.Focused.Base.BorderForeground(aqua)
		t.Focused.Title = t.Focused.Title.Foreground(aqua)
		t.Focused.NoteTitle = t.Focused.NoteTitle.Foreground(ink)
		t.Focused.Description = t.Focused.Description.Foreground(muted)
		t.Focused.SelectSelector = t.Focused.SelectSelector.Foreground(aqua)
		t.Focused.Option = t.Focused.Option.Foreground(ink)
		t.Focused.SelectedOption = t.Focused.SelectedOption.Foreground(green)
		t.Focused.TextInput.Text = t.Focused.TextInput.Text.Foreground(ink)
		t.Focused.TextInput.Prompt = t.Focused.TextInput.Prompt.Foreground(aqua)
		t.Focused.TextInput.Placeholder = t.Focused.TextInput.Placeholder.Foreground(muted)
		t.Focused.FocusedButton = t.Focused.FocusedButton.Background(aqua).Foreground(bg)
		t.Focused.BlurredButton = t.Focused.BlurredButton.Background(edge).Foreground(ink)
		t.Blurred = t.Focused
		t.Blurred.Base = t.Blurred.Base.BorderStyle(lg.HiddenBorder())
		t.Blurred.Title = t.Blurred.Title.Foreground(ink)
		t.Help.ShortKey = t.Help.ShortKey.Foreground(muted)
		t.Help.ShortDesc = t.Help.ShortDesc.Foreground(muted)
		t.Help.ShortSeparator = t.Help.ShortSeparator.Foreground(edge)
		return t
	})
}

// Init prepares field views; WindowSize gives Huh's internal viewport a height.
// The snapshot path does not run Bubble Tea's terminal event loop.
func (m *desk) prepareFormRender() {
	if m.form == nil {
		return
	}
	_ = m.form.Init()
	m.sizeForm()
}
func (m *desk) startBuilder() {
	repos, e := m.store.repos()
	if e != nil || len(repos) == 0 {
		m.err = mission.Problem("repo_not_registered", "Register a checkout first: mission repo add REPO --checkout PATH")
		return
	}
	m.draft = draft{Repo: repos[0].Slug, Kind: "research", First: true, Final: true}
	m.formKind = "new"
	m.err = nil
	opts := []huh.Option[string]{}
	for _, r := range repos {
		opts = append(opts, huh.NewOption(r.Slug, r.Slug))
	}
	required := func(s string) error {
		if strings.TrimSpace(s) == "" {
			return fmt.Errorf("Required")
		}
		return nil
	}
	m.form = huh.NewForm(huh.NewGroup(
		huh.NewSelect[string]().Title("Repository").Options(opts...).Value(&m.draft.Repo),
		huh.NewInput().Title("Mission title").Placeholder("Audit lifecycle hooks").Value(&m.draft.Title).Validate(required),
		huh.NewInput().Title("Mission slug").Description("Leave blank to derive from the title.").Placeholder("audit-lifecycle-hooks").Value(&m.draft.Slug),
		huh.NewInput().Title("What outcome do you want?").Placeholder("Find gaps and propose the smallest fix").Value(&m.draft.Goal).Validate(required),
	), huh.NewGroup(
		huh.NewText().Title("Steps · one per line").Placeholder("Inspect lifecycle hooks\nPropose the integration").Value(&m.draft.Steps).Validate(required).CharLimit(2000),
		huh.NewSelect[string]().Title("Work type").Options(huh.NewOption("Research · manual claim or managed run", "research"), huh.NewOption("Implementation · managed worktree only", "implementation")).Value(&m.draft.Kind),
		huh.NewConfirm().Title("Review the first step before continuing?").Value(&m.draft.First),
		huh.NewConfirm().Title("Review the final result?").Value(&m.draft.Final),
	)).WithWidth(m.formWidth()).WithTheme(formTheme())
}
func (m *desk) startReview() {
	r, ok := m.current()
	if !ok {
		return
	}
	if r.State.Pending == "" {
		m.notice = "This mission has no pending review."
		return
	}
	m.review = r
	m.formKind = "review"
	m.decision = "accept"
	m.actor = "aviral"
	m.note = ""
	question := ""
	for _, c := range r.Mission.Checkpoints {
		if c.ID == r.State.Pending {
			question = c.Question
		}
	}
	required := func(s string) error {
		if strings.TrimSpace(s) == "" {
			return fmt.Errorf("Required")
		}
		return nil
	}
	m.form = huh.NewForm(huh.NewGroup(huh.NewNote().Title(question).Description("Review the preserved artifact before deciding. "+r.State.Checkpoints[r.State.Pending].Evidence), huh.NewSelect[string]().Title("Decision").Options(huh.NewOption("Accept and continue", "accept"), huh.NewOption("Request a new attempt", "revise")).Value(&m.decision), huh.NewInput().Title("Reviewed by").Value(&m.actor).Validate(required), huh.NewInput().Title("Decision note").Value(&m.note).Validate(required))).WithWidth(m.formWidth()).WithTheme(formTheme())
}
func (m *desk) commitForm() {
	if m.formKind == "step" {
		m.stepDraft.Check = ""
		m.stepDraft.Checks = append([]string{"nonempty-artifact"}, m.optionalChecks...)
		_, m.err = m.store.editStep(m.editing.Handle, m.stepDraft.ID, m.stepDraft, m.editing.State.Revision, m.resetStep)
		if m.err == nil {
			m.notice = "Step saved. Next attempt will use this definition."
		}
	} else if m.formKind == "review" {
		_, m.err = m.store.decide(decisionRequest{Handle: m.review.Handle, ID: m.review.State.Pending, Decision: m.decision, Note: m.note, Actor: m.actor, Human: true})
		if m.err == nil {
			m.notice = "Review recorded; evidence and decision preserved."
		}
	} else {
		d := m.draft
		mnew := mission.Mission{Repo: d.Repo, Slug: platform.Fallback(d.Slug, mission.Slugify(d.Title)), Title: d.Title, Goal: d.Goal, Kind: d.Kind}
		for _, line := range strings.Split(d.Steps, "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			mnew.Steps = append(mnew.Steps, mission.Step{Title: line})
		}
		mission.NormalizeMission(&mnew)
		if len(mnew.Steps) > 0 {
			last := mnew.Steps[len(mnew.Steps)-1].ID
			after := []string{}
			if d.First {
				after = append(after, "S01")
			}
			if d.Final && (last != "S01" || !d.First) {
				after = append(after, last)
			}
			for i, st := range after {
				mnew.Checkpoints = append(mnew.Checkpoints, mission.Checkpoint{ID: fmt.Sprintf("C%02d", i+1), After: st, Kind: "human", Question: "Does this result meet the mission goal?"})
			}
		}
		var r mission.Record
		r, m.err = m.store.create(mnew)
		if m.err == nil {
			m.notice = "Created " + r.Handle + ". Ready for an agent claim."
		}
	}
	m.form = nil
	formErr := m.err
	m.refresh()
	if formErr != nil {
		m.err = formErr
	}
}
func runUI(s *Store) error { _, e := tea.NewProgram(newNavigationDesk(s)).Run(); return e }
func runUIBuilder(s *Store) error {
	m := newDesk(s)
	m.startBuilder()
	if m.err != nil {
		return m.err
	}
	m.quitAfterForm = true
	_, e := tea.NewProgram(m).Run()
	return e
}
