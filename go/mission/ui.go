package main

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"
	lg "charm.land/lipgloss/v2"
)

var (
	ink    = lg.Color("#e2cca9")
	muted  = lg.Color("#928374")
	green  = lg.Color("#a9b665")
	aqua   = lg.Color("#89b482")
	orange = lg.Color("#e78a4e")
	yellow = lg.Color("#d8a657")
	pink   = lg.Color("#d3869b")
	bg     = lg.Color("#282828")
	edge   = lg.Color("#504945")
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
// the text size: the border and the padding are inside w and h, the title and
// its blank line take two content rows, and a body that runs long is clipped so
// the bottom border always survives.
func panel(w, h int, title, body string) string {
	if w < 8 || h < 4 {
		return fitLines(body, max(1, w))
	}
	lines := strings.Split(fitLines(body, w-4), "\n")
	if len(lines) > max(1, h-6) {
		lines = lines[:max(1, h-6)]
	}
	return lg.NewStyle().Width(w).Height(h).MaxWidth(w).MaxHeight(h).
		Padding(1).Border(lg.RoundedBorder()).BorderForeground(edge).Foreground(ink).
		Render(paint(aqua, title) + "\n\n" + strings.Join(lines, "\n"))
}
func heading(s string) string { return lg.NewStyle().Bold(true).Foreground(ink).Render(s) }

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
	return max(3, h-len(m.headerLines(w))-len(m.footerLines(w))-2)
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

type pulse time.Time

func tick() tea.Cmd { return tea.Tick(2*time.Second, func(t time.Time) tea.Msg { return pulse(t) }) }

type draft struct {
	Repo, Title, Slug, Goal, Steps, Kind string
	First, Final                         bool
}
type desk struct {
	store                        *Store
	records                      []Record
	selected, tab, width, height int
	scroll                       int
	err                          error
	notice                       string
	form                         *huh.Form
	formKind                     string
	draft                        draft
	decision, actor, note        string
	review                       Record
	quitAfterForm                bool
	selectedStep                 int
	editing                      Record
	stepDraft                    Step
	optionalChecks               []string
	resetStep                    bool
}

func newDesk(s *Store) *desk { return &desk{store: s, width: 128, height: 42} }
func (m *desk) refresh() {
	h := ""
	if m.selected >= 0 && len(m.records) > m.selected {
		h = m.records[m.selected].Handle
	}
	m.records, m.err = m.store.list()
	for i, r := range m.records {
		if r.Handle == h {
			m.selected = i
		}
	}
	m.selected = max(0, min(m.selected, len(m.records)-1))
}
func (m *desk) Init() tea.Cmd {
	m.refresh()
	if m.form != nil {
		return tea.Batch(m.form.Init(), tick())
	}
	return tick()
}
func (m *desk) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch v := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = v.Width, v.Height
		m.sizeForm()
	case pulse:
		m.refresh()
		return m, tick()
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
			switch v.String() {
			case "q":
				return m, tea.Quit
			case "j", "down":
				if m.tab == 3 && len(m.records) > 0 {
					m.selectedStep = min(len(m.records[m.selected].Mission.Steps)-1, m.selectedStep+1)
				} else if len(m.records) > 0 {
					m.selected = min(len(m.records)-1, m.selected+1)
					m.selectedStep = 0
				}
				m.scroll = 0
			case "k", "up":
				if m.tab == 3 {
					m.selectedStep = max(0, m.selectedStep-1)
				} else {
					m.selected = max(0, m.selected-1)
					m.selectedStep = 0
				}
				m.scroll = 0
			case "tab", "right":
				m.tab = (m.tab + 1) % 4
				m.scroll = 0
			case "left":
				m.tab = (m.tab + 3) % 4
				m.scroll = 0
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
				m.tab = 3
				m.scroll = 0
			case "esc":
				if m.tab == 3 {
					m.tab = 0
					m.scroll = 0
				}
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
	frame := strings.Join(head, "\n") + "\n\n" + m.body(w, bodyH) + "\n\n" + strings.Join(foot, "\n")
	return lg.NewStyle().Background(bg).Foreground(ink).Padding(0, 2).
		Width(fw).Height(fh).MaxWidth(fw).MaxHeight(fh).Render(frame)
}

func (m *desk) headerLines(w int) []string {
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
	return []string{fitLines(title, w), paint(muted, "VAULT  ") + clip(m.store.Vault, max(8, w-8)), "", fitLines(bar, w)}
}

// footerKeys joins as many key hints as the footer row holds, most useful
// first, so a narrow terminal loses a hint instead of clipping one.
func (m *desk) footerKeys(w int) string {
	hints := []string{"j/k select", "q quit", "tab view", "s steps", "n new", "a checkpoint", "pgdn scroll"}
	switch {
	case m.form != nil:
		hints = []string{"tab next field", "enter continue", "esc cancel"}
	case m.tab == 3:
		hints = []string{"j/k step", "q quit", "e customize", "esc missions", "tab view", "pgdn scroll"}
	}
	out := ""
	for _, hint := range hints {
		next := hint
		if out != "" {
			next = "   " + hint
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
	return m.deskBody(w, h)
}

func (m *desk) deskBody(w, h int) string {
	sideW := min(56, max(24, w/3))
	detailW := w - sideW - 2
	// panel() spends two content rows on the title and its blank line.
	textH := max(1, h-6)
	if w < splitDesk || detailW < 30 {
		return panel(w, h, "MISSION DESK", m.detailText(w-4, textH))
	}
	return lg.JoinHorizontal(lg.Top, panel(sideW, h, "MISSIONS", m.listBody(sideW-4, textH)), "  ", panel(detailW, h, "MISSION DESK", m.detailText(detailW-4, textH)))
}

// listBody renders as many mission rows as the panel height holds, keeping the
// selection inside that window. Rows are joined, never trimmed: a trim would eat
// the leading indent of the first row when that row is not selected, and the
// title would jump a column left of its neighbours.
func (m *desk) listBody(w, h int) string {
	if len(m.records) == 0 {
		return paint(muted, "No missions yet.\n\nPress n to create one.")
	}
	visible := max(1, h/4)
	start := min(max(0, m.selected-visible+1), max(0, len(m.records)-visible))
	rows := make([]string, 0, visible)
	for i := start; i < min(len(m.records), start+visible); i++ {
		r := m.records[i]
		title := heading(clip(r.Mission.Title, w-2))
		prefix := "  "
		if i == m.selected {
			prefix = marker()
			title = selectedTitle(clip(r.Mission.Title, w-2))
		}
		rows = append(rows, prefix+title+"\n  "+paint(muted, clip(r.Handle, w-2))+"\n  "+status(r.State.Status)+paint(muted, "  ·  "+fmt.Sprint(len(r.State.Attempts))+" attempts"))
	}
	return strings.Join(rows, "\n\n")
}

// detailText scrolls the detail panel to its own height, not to the terminal.
func (m *desk) detailText(w, h int) string {
	if len(m.records) == 0 {
		return paint(muted, "Create a mission to begin.")
	}
	detail := m.detail(m.records[m.selected], max(16, w))
	lines := strings.Split(detail, "\n")
	limit := max(1, h)
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
		return "HUMAN CHECKPOINT", m.review.Handle + " · " + m.review.State.Pending + " · revision " + fmt.Sprint(m.review.State.Revision)
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
	return "SAVED AS MARKDOWN", paint(muted, "6_missions/") + "\n  " + fallback(m.draft.Repo, "repository") + "/\n    " + fallback(m.draft.Slug, fallback(slugify(m.draft.Title), "mission-slug")) + "/\n      mission.md\n      state.md\n      attempts/\n      artifacts/\n\n" + heading("One mission · one repository") + "\n\nAgents claim the next step.\nEach attempt keeps its evidence.\nCheckpoints pause progression.\n\n" + paint(yellow, "No agent is launched by this form.")
}
func (m *desk) detail(r Record, w int) string {
	tabs := []string{"Overview", "Attempts", "Activity", "Steps"}
	for i, t := range tabs {
		tabs[i] = paint(muted, t)
		if i == m.tab {
			tabs[i] = paint(aqua, "● "+t)
		}
	}
	s := heading(r.Mission.Title) + "  " + status(r.State.Status) + "\n" + paint(muted, r.Handle+"  ·  "+r.Mission.Kind+"  ·  rev "+fmt.Sprint(r.State.Revision)) + "\n\n" + strings.Join(tabs, "     ") + "\n\n"
	if m.tab == 3 {
		return s + m.stepsDetail(r, w)
	}
	if m.tab == 1 {
		if len(r.State.Attempts) == 0 {
			return s + paint(muted, "No attempts. A claim creates the first record.")
		}
		for i := len(r.State.Attempts) - 1; i >= 0; i-- {
			a := r.State.Attempts[i]
			s += heading(fmt.Sprintf("%03d  %s  %s", a.Sequence, a.Step, a.Agent)) + "  " + status(a.Status) + "\n" + paint(muted, clip(a.ID, w)) + "\n" + "session  " + clip(fallback(a.SessionID, "awaiting session-start hook"), w-10) + "\n" + "worktree " + clip(a.Cwd, w-10) + "\n" + "output   " + a.Artifact + "\n"
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
	if m.tab == 2 {
		var events []Event
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
	s += clean(r.Mission.Goal) + "\n\n" + paint(muted, "STEP  RESULT     WORK") + "\n"
	for _, st := range r.Mission.Steps {
		ss := r.State.Steps[st.ID]
		icon := "○"
		if ss.Status == "passed" {
			icon = "✓"
		}
		if ss.Status == "running" {
			icon = "◉"
		}
		s += paint(aqua, st.ID) + "   " + icon + " " + status(ss.Status) + "  " + clip(st.Title, w-23) + "\n"
		for _, cp := range r.Mission.Checkpoints {
			if cp.After == st.ID {
				s += "      └ " + paint(yellow, cp.ID+" human checkpoint") + paint(muted, " · "+r.State.Checkpoints[cp.ID].Status) + "\n"
			}
		}
	}
	if r.State.Pending != "" {
		for _, cp := range r.Mission.Checkpoints {
			if cp.ID == r.State.Pending {
				s += "\n" + paint(yellow, "◆ YOUR DECISION  "+cp.ID) + "\n" + clean(cp.Question) + "\n" + paint(muted, "Evidence: "+r.State.Checkpoints[cp.ID].Evidence) + "\n" + paint(aqua, "Press a to accept or request revision.") + "\n"
			}
		}
	}
	if r.State.Active != "" {
		a, _ := findAttempt(&r.State, r.State.Active)
		s += "\n" + paint(aqua, "◉ ATTEMPT ") + heading(fmt.Sprintf("%03d  %s", a.Sequence, a.Agent)) + "\n" + paint(muted, "Session  ") + clip(fallback(a.SessionID, "awaiting hook"), w-10) + "\n" + paint(muted, "Events   ") + fmt.Sprint(len(a.Events)) + " recorded · " + fallback(a.Branch, "read-only research") + "\n"
	}
	if st, e := nextStep(r.Mission, r.State); e == nil {
		s += "\n" + paint(green, "→ READY TO CLAIM  "+st.ID) + "\n" + paint(muted, "mission claim ") + r.Handle + " --agent " + fallback(st.Agent, "scout")
	}
	return s
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
		m.err = problem("repo_not_registered", "Register a checkout first: mission repo add REPO --checkout PATH")
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
	if len(m.records) == 0 {
		return
	}
	r := m.records[m.selected]
	if r.State.Pending == "" {
		m.notice = "This mission has no pending checkpoint."
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
		_, m.err = m.store.checkpoint(m.review.Handle, m.review.State.Pending, m.decision, m.note, m.actor, true, m.review.State.Revision)
		if m.err == nil {
			m.notice = "Checkpoint recorded; evidence and decision preserved."
		}
	} else {
		d := m.draft
		mnew := Mission{Repo: d.Repo, Slug: fallback(d.Slug, slugify(d.Title)), Title: d.Title, Goal: d.Goal, Kind: d.Kind}
		for _, line := range strings.Split(d.Steps, "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			mnew.Steps = append(mnew.Steps, Step{Title: line})
		}
		normalizeMission(&mnew)
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
				mnew.Checkpoints = append(mnew.Checkpoints, Checkpoint{ID: fmt.Sprintf("C%02d", i+1), After: st, Kind: "human", Question: "Does this result meet the mission goal?"})
			}
		}
		var r Record
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
func runUI(s *Store) error { _, e := tea.NewProgram(newDesk(s)).Run(); return e }
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
