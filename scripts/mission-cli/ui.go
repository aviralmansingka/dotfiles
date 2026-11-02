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
func panel(w int, title, body string) string {
	return lg.NewStyle().Width(w).Padding(1).Border(lg.RoundedBorder()).BorderForeground(edge).Foreground(ink).Render(paint(aqua, title) + "\n\n" + body)
}
func heading(s string) string { return lg.NewStyle().Bold(true).Foreground(ink).Render(s) }

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
		m.width = v.Width
		m.height = v.Height
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
				m.scroll += max(4, m.height-20)
			case "pgup":
				m.scroll = max(0, m.scroll-max(4, m.height-20))
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
func (m *desk) render() string {
	w := max(48, m.width-4)
	title := lg.NewStyle().Background(aqua).Foreground(bg).Bold(true).Padding(0, 1).Render(" m ") + "  " + heading("MISSION") + paint(muted, "  /  work that survives the agent")
	counts := map[string]int{}
	for _, r := range m.records {
		counts[r.State.Status]++
	}
	bar := paint(aqua, fmt.Sprintf("%02d active", counts["running"])) + paint(muted, "   ·   ") + paint(yellow, fmt.Sprintf("%02d need you", counts["waiting"]+counts["review"])) + paint(muted, "   ·   ") + paint(green, fmt.Sprintf("%02d ready", counts["ready"]))
	top := title + "\n" + paint(muted, "VAULT  ") + clip(m.store.Vault, w-8) + "\n\n" + bar
	var body string
	if m.form != nil {
		label := "CREATE A MISSION"
		hint := "A short brief becomes a durable, claimable unit of work."
		if m.formKind == "review" {
			label = "HUMAN CHECKPOINT"
			hint = m.review.Handle + " · " + m.review.State.Pending + " · revision " + fmt.Sprint(m.review.State.Revision)
		}
		if m.formKind == "step" {
			label = "CUSTOMIZE STEP " + m.stepDraft.ID
			hint = m.editing.Handle + " · defaults first, details when needed"
		}
		form := m.form.View()
		if form == "" {
			form = paint(muted, "Preparing form…")
		}
		left := panel(min(70, w), label, hint+"\n\n"+form)
		right := panel(max(34, w-min(70, w)-2), "SAVED AS MARKDOWN", paint(muted, "6_missions/")+"\n  "+fallback(m.draft.Repo, "repository")+"/\n    "+fallback(m.draft.Slug, fallback(slugify(m.draft.Title), "mission-slug"))+"/\n      mission.md\n      state.md\n      attempts/\n      artifacts/\n\n"+heading("One mission · one repository")+"\n\nAgents claim the next step.\nEach attempt keeps its evidence.\nCheckpoints pause progression.\n\n"+paint(yellow, "No agent is launched by this form."))
		if m.formKind == "review" {
			cp := m.review.State.Checkpoints[m.review.State.Pending]
			right = panel(max(34, w-min(70, w)-2), "PRESERVED EVIDENCE", heading(m.review.Handle)+"\n\n"+cp.Evidence+"\n\n"+paint(muted, "Bound to attempt")+"\n"+cp.Attempt+"\n\n"+paint(muted, "Evidence fingerprint")+"\n"+clip(cp.Hash, 40)+"\n\n"+paint(yellow, "This records your review decision.")+"\nA revision creates a new attempt.\nEarlier evidence remains in the vault.")
		}
		if m.formKind == "step" {
			right = panel(max(34, w-min(70, w)-2), "CHECKS FOLLOW THE ATTEMPT", heading("Always required")+"\nnonempty-artifact\n\n"+heading("Optional checks")+"\njson-valid · parse the result\ngo-test · test the checkout\n\n"+paint(muted, "Each run preserves")+"\nverdict + source fingerprint\nchecker version + evidence log\n\n"+paint(yellow, "Past evidence stays in the vault.")+"\nReset explicitly to revise a used step.")
		}
		if w >= 110 {
			body = lg.JoinHorizontal(lg.Top, left, "  ", right)
		} else {
			body = left
		}
	} else {
		side := ""
		if len(m.records) == 0 {
			side = paint(muted, "No missions yet.\n\nPress n to create one.")
		}
		visible := max(1, (m.height-17)/4)
		start := max(0, m.selected-visible+1)
		for i := start; i < min(len(m.records), start+visible); i++ {
			r := m.records[i]
			prefix := "  "
			if i == m.selected {
				prefix = paint(aqua, "▌ ")
			}
			side += prefix + heading(clip(r.Mission.Title, 26)) + "\n  " + paint(muted, clip(r.Handle, 28)) + "\n  " + status(r.State.Status) + paint(muted, "  ·  "+fmt.Sprint(len(r.State.Attempts))+" attempts") + "\n\n"
		}
		leftW := 34
		detailW := w - leftW - 2
		detail := paint(muted, "Create a mission to begin.")
		if len(m.records) > 0 {
			detail = m.detail(m.records[m.selected], max(38, detailW-4))
		}
		lines := strings.Split(detail, "\n")
		limit := max(4, m.height-17)
		m.scroll = min(m.scroll, max(0, len(lines)-limit))
		if len(lines) > limit {
			end := min(len(lines), m.scroll+limit-1)
			detail = strings.Join(lines[m.scroll:end], "\n") + "\n" + paint(muted, "pgup / pgdown · more details")
		}
		if w >= 94 {
			body = lg.JoinHorizontal(lg.Top, panel(leftW, "MISSIONS", strings.TrimSpace(side)), "  ", panel(detailW, "MISSION DESK", detail))
		} else {
			body = panel(w, "MISSION DESK", detail)
		}
	}
	footer := paint(muted, "j/k select   tab view   s steps   n new   a checkpoint   pgdn scroll   q quit")
	if m.tab == 3 && m.form == nil {
		footer = paint(muted, "j/k step   e customize   esc missions   tab view   pgdn scroll   q quit")
	}
	if m.form != nil {
		footer = paint(muted, "tab next field   enter continue   esc cancel")
	}
	if m.notice != "" {
		footer = paint(green, clean(m.notice)) + "\n" + footer
	}
	if m.err != nil {
		footer = paint(orange, clean(m.err.Error())) + "\n" + footer
	}
	return lg.NewStyle().Background(bg).Foreground(ink).Padding(1, 2).Width(max(48, m.width)).Render(top + "\n\n" + body + "\n\n" + footer)
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
	if m.form != nil {
		_ = m.form.Init()
		_, _ = m.form.Update(tea.WindowSizeMsg{Width: 60, Height: 24})
	}
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
	)).WithWidth(min(60, max(36, m.width-12))).WithTheme(formTheme())
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
	m.form = huh.NewForm(huh.NewGroup(huh.NewNote().Title(question).Description("Review the preserved artifact before deciding. "+r.State.Checkpoints[r.State.Pending].Evidence), huh.NewSelect[string]().Title("Decision").Options(huh.NewOption("Accept and continue", "accept"), huh.NewOption("Request a new attempt", "revise")).Value(&m.decision), huh.NewInput().Title("Reviewed by").Value(&m.actor).Validate(required), huh.NewInput().Title("Decision note").Value(&m.note).Validate(required))).WithWidth(60).WithTheme(formTheme())
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
