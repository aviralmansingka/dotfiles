package main

import (
	"fmt"
	"image/color"
	"slices"
	"sort"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"
	lg "charm.land/lipgloss/v2"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

type deskBack struct {
	tab, step, scroll int
}

type deskNavigation struct {
	back                 []deskBack
	handle, step, call   string
	mode                 int
	preview, searching   bool
	recent, revealStep   bool
	follow               bool
	outputCount          int
	callRequest          uint64
	loadingCalls         bool
	query, previousQuery string
	collapsed            map[string]bool
	calls                []deskCall
	prs                  map[string]deskPR
	checked              time.Time
}

func newNavigationDesk(s *Store) *desk {
	m := newDesk(s)
	m.nav = &deskNavigation{collapsed: map[string]bool{}}
	m.filter = -1
	return m
}

func (m *desk) depth() int { return len(m.nav.back) }

var navigationViews = [...]string{"Inbox", "Table", "Repos"}

func (m *desk) enterNavigation() {
	n := m.nav
	r, ok := m.current()
	if !ok {
		return
	}
	switch m.depth() {
	case 0:
		n.handle = r.Handle
		m.tab, m.selectedStep, m.scroll = 0, 0, 0
		n.back = append(n.back, deskBack{})
		if i, err := stepIndex(r.Mission, r.State.Current); err == nil {
			m.selectedStep = i
		}
		n.revealStep = true
	case 1:
		if (m.tab != 0 && m.tab != detailTabs-1) || len(r.Mission.Steps) == 0 {
			return
		}
		n.back = append(n.back, deskBack{m.tab, m.selectedStep, m.scroll})
		n.step = r.Mission.Steps[min(m.selectedStep, len(r.Mission.Steps)-1)].ID
		n.call, n.follow = "", false
		m.scroll = 0
	case 2:
		if m.selectedCall() < 0 {
			return
		}
		n.back = append(n.back, deskBack{m.tab, m.selectedStep, m.scroll})
		n.follow, n.outputCount = false, len(n.calls)
		m.scroll = 0
	}
}

func (m *desk) escapeNavigation() {
	n := m.nav
	depth := m.depth()
	if depth == 0 {
		return
	}
	back := n.back[depth-1]
	n.back = n.back[:depth-1]
	m.tab, m.selectedStep, m.scroll = back.tab, back.step, back.scroll
	switch depth {
	case 1:
		h := n.handle
		n.handle = ""
		m.refreshNavigationList(h)
	case 2:
		n.step, n.call, n.calls = "", "", nil
		n.callRequest++
		n.loadingCalls = false
	}
}

func (m *desk) navigationKey(msg tea.KeyPressMsg) bool {
	n := m.nav
	key := msg.String()
	if n.searching {
		switch key {
		case "esc":
			n.query, n.searching = n.previousQuery, false
			m.refreshNavigationList("")
		case "enter":
			n.searching = false
		case "backspace":
			rs := []rune(n.query)
			if len(rs) > 0 {
				n.query = string(rs[:len(rs)-1])
				m.refreshNavigationList("")
			}
		default:
			if msg.Text != "" {
				q := []rune(n.query + clean(msg.Text))
				n.query = string(q[:min(len(q), 128)])
				m.refreshNavigationList("")
			}
		}
		return true
	}
	switch key {
	case "enter":
		m.enterNavigation()
	case "esc":
		if m.depth() == 0 && n.query != "" {
			n.query = ""
			m.refreshNavigationList("")
		} else {
			m.escapeNavigation()
		}
	case "j", "down":
		m.moveNavigation(1)
	case "k", "up":
		m.moveNavigation(-1)
	case "pgdown":
		if m.depth() == 0 || m.depth() == 2 {
			m.moveNavigation(m.pageStep())
		} else {
			m.scroll += m.pageStep()
		}
	case "pgup":
		if m.depth() == 0 || m.depth() == 2 {
			m.moveNavigation(-m.pageStep())
		} else {
			m.scroll = max(0, m.scroll-m.pageStep())
		}
	case "tab", "v":
		if m.depth() == 0 {
			n.preview = !n.preview
		}
	case "]", "right", "[", "left":
		d := 1
		if key == "[" || key == "left" {
			d = -1
		}
		if m.depth() == 0 {
			m.filter = (m.filter+1+d+len(deskFilters)+1)%(len(deskFilters)+1) - 1
			m.refreshNavigationList("")
		} else if m.depth() == 1 {
			m.tab = (m.tab + d + detailTabs) % detailTabs
			m.scroll = 0
		}
	case "1", "2", "3":
		if m.depth() == 0 {
			r, _ := m.current()
			n.mode = int(key[0] - '1')
			m.refreshNavigationList(r.Handle)
		}
	case "/":
		if m.depth() == 0 {
			n.searching, n.previousQuery = true, n.query
		}
	case "h", "l":
		if m.depth() == 0 && n.mode == 2 {
			if r, ok := m.current(); ok {
				if key == "h" {
					n.collapsed[r.Mission.Repo] = true
				} else {
					clear(n.collapsed)
				}
				m.refreshNavigationList(r.Handle)
			} else if key == "l" {
				clear(n.collapsed)
				m.refreshNavigationList("")
			}
		}
	case "f":
		if m.depth() == 2 {
			n.follow = !n.follow
			if n.follow && len(n.calls) > 0 {
				n.call = n.calls[len(n.calls)-1].id
			}
		}
	case "s":
		if m.depth() == 0 && n.mode == 1 {
			r, _ := m.current()
			n.recent = !n.recent
			m.refreshNavigationList(r.Handle)
			break
		}
		if m.depth() == 0 {
			m.enterNavigation()
		}
		if m.depth() == 1 {
			m.tab, m.scroll = detailTabs-1, 0
		}
	default:
		return false
	}
	return true
}

func (m *desk) moveNavigation(delta int) {
	switch m.depth() {
	case 0:
		m.selected = max(0, min(m.selected+delta, len(m.view)-1))
	case 1:
		if m.tab != 0 && m.tab != detailTabs-1 {
			m.scroll = max(0, m.scroll+delta)
			return
		}
		if r, ok := m.current(); ok {
			m.selectedStep = max(0, min(m.selectedStep+delta, len(r.Mission.Steps)-1))
			m.nav.revealStep = true
		}
	case 2:
		if len(m.nav.calls) > 0 {
			m.nav.follow = false
			i := max(0, min(m.selectedCall()+delta, len(m.nav.calls)-1))
			m.nav.call = m.nav.calls[i].id
		}
	case 3:
		m.scroll = max(0, m.scroll+delta)
	}
}

func (m *desk) refreshNavigationList(handle string) {
	n := m.nav
	old := m.selected
	m.view = nil
	for _, r := range m.records {
		if n.mode == 2 && n.collapsed[r.Mission.Repo] {
			continue
		}
		if m.filter >= 0 && !deskFilters[m.filter].Match(r) {
			continue
		}
		if !strings.Contains(strings.ToLower(r.Handle+" "+r.Mission.Title), strings.ToLower(n.query)) {
			continue
		}
		m.view = append(m.view, r)
	}
	if m.inboxOnly() && slices.ContainsFunc(m.view, func(r mission.Record) bool { return m.inboxLane(r) < inboxQueue }) {
		m.view = slices.DeleteFunc(m.view, func(r mission.Record) bool { return m.inboxLane(r) >= inboxQueue })
	} else if m.inboxOnly() && !slices.ContainsFunc(m.view, func(r mission.Record) bool {
		return m.inboxLane(r) < inboxHistory
	}) {
		// History is context for the work in front of you, not a substitute for
		// it: an inbox with nothing active is an empty page, not a backlog.
		m.view = nil
	}
	sort.SliceStable(m.view, func(i, j int) bool {
		a, b := m.view[i], m.view[j]
		if n.mode == 2 && a.Mission.Repo != b.Mission.Repo {
			return a.Mission.Repo < b.Mission.Repo
		}
		if n.mode != 1 || !n.recent {
			if x, y := m.inboxLane(a), m.inboxLane(b); x != y {
				return x < y
			}
		}
		return lastMissionUpdate(a) > lastMissionUpdate(b)
	})
	m.selected = 0
	if handle != "" {
		m.selected = max(0, min(old, len(m.view)-1))
	}
	for i, r := range m.view {
		if r.Handle == handle {
			m.selected = i
			break
		}
	}
}

func (m *desk) inboxOnly() bool {
	return m.nav.mode == 0 && m.filter < 0 && m.nav.query == ""
}

func lastMissionUpdate(r mission.Record) string {
	if a, e := mission.FindAttempt(&r.State, r.State.Active); e == nil {
		return a.Updated
	}
	if n := len(r.State.Attempts); n > 0 {
		return r.State.Attempts[n-1].Updated
	}
	return r.Mission.Created
}

const (
	inboxAttention = iota
	inboxHandoff
	inboxWorking
	inboxQueue
	inboxHistory
)

var inboxLabels = [...]string{"◆ NEEDS YOU", "✓ READY FOR PR REVIEW", "◉ WORKING", "○ READY TO START", "· HISTORY"}
var inboxColors = []color.Color{yellow, green, lg.Color("#83a598"), muted, muted}

func (m *desk) inboxLane(r mission.Record) int {
	switch r.State.Status {
	case "review", "waiting", "failed":
		return inboxAttention
	case closedStatus:
		return inboxHistory
	}
	pr, known := m.nav.prs[r.Handle]
	if r.Mission.Kind == "implementation" && r.State.Status == "done" && known &&
		(pr.Number == 0 || pr.State == "CLOSED" || pr.Draft && pr.open()) {
		return inboxAttention
	}
	if r.State.Status == "done" && pr.open() && !pr.Draft && pr.checksPassed() {
		return inboxHandoff
	}
	switch r.State.Status {
	case "running":
		return inboxWorking
	case "ready":
		return inboxQueue
	case "done":
		if pr.open() && pr.Failed > 0 {
			return inboxAttention
		}
		if pr.open() {
			return inboxWorking
		}
	default:
	}
	return inboxHistory
}

func (m *desk) listAction(r mission.Record) (string, string) {
	if p := reviewOf(r); p != nil {
		return "◆ DECISION", p.ID + " · " + p.Question
	}
	if launch, ok := m.launches[r.Handle]; ok && r.State.Status == "ready" {
		if label, why := launchSummary(launch); label != "" {
			return strings.ToUpper(label), why
		}
	}
	pr, known := m.nav.prs[r.Handle]
	if m.inboxLane(r) == inboxHandoff {
		return "✓ PR REVIEW", stripANSI(pr.badge())
	}
	if r.State.Status == "done" {
		switch {
		case pr.open() && pr.Failed > 0:
			return "× CI FAILED", stripANSI(pr.badge())
		case pr.open() && pr.Draft:
			return "○ DRAFT PR", stripANSI(pr.badge())
		case r.Mission.Kind == "implementation" && known && pr.Number == 0:
			return "! NO PR", "Worker handoff still needs a PR"
		case r.Mission.Kind == "implementation" && pr.State == "CLOSED":
			return "! PR CLOSED", stripANSI(pr.label())
		case pr.open():
			return "○ PR OPEN", stripANSI(pr.badge())
		}
	}
	if a, e := mission.FindAttempt(&r.State, r.State.Active); e == nil && len(a.Progress) > 0 {
		p := a.Progress[len(a.Progress)-1]
		if p.Status == "blocked" || p.Status == "needs-input" {
			return "! BLOCKED", p.Blocker
		}
		return "◉ WORKING", platform.Fallback(p.Next, p.Summary)
	}
	if r.State.Status == "failed" {
		return "× STOPPED", "Inspect the failed attempt"
	}
	if r.State.Status == "waiting" {
		return "! BLOCKED", "Inspect the waiting attempt"
	}
	if pr.Number > 0 {
		return strings.ToUpper(r.State.Status), stripANSI(pr.badge())
	}
	if i, e := stepIndex(r.Mission, r.State.Current); e == nil {
		return strings.ToUpper(r.State.Status), r.State.Current + " · " + r.Mission.Steps[i].Title
	}
	return strings.ToUpper(r.State.Status), ""
}

type deskRow struct {
	text     string
	selected bool
}

func navWindow(rows []deskRow, height int) string {
	height = max(1, height)
	index := 0
	for i, row := range rows {
		if row.selected {
			index = i
			break
		}
	}
	start := max(0, index-height+1)
	out := make([]string, 0, height)
	for i := start; i < min(len(rows), start+height); i++ {
		out = append(out, rows[i].text)
	}
	return strings.Join(out, "\n")
}

func (m *desk) navigationList(w, h int) string {
	n := m.nav
	tabs := []string{"1 " + navigationViews[0], "2 " + navigationViews[1], "3 " + navigationViews[2]}
	tabs[n.mode] = deskBar(tabs[n.mode], len(tabs[n.mode])+2, ink)
	out := strings.Join(tabs, "    ") + "\n"
	summary := ""
	if n.mode == 0 {
		count := len(m.view)
		if m.inboxOnly() && len(m.view) < len(m.records) {
			count = len(m.records)
			queued, history := 0, 0
			for _, r := range m.records {
				switch m.inboxLane(r) {
				case inboxQueue:
					queued++
				case inboxHistory:
					history++
				}
			}
			summary = "\n\n" + deskRight(paint(muted, fmt.Sprintf("%d queued · %d in history", queued, history)), paint(aqua, "2 View all missions"), w)
			h -= 3
		}
		out += "\n" + deskRight(heading("Mission inbox"), paint(muted, fmt.Sprintf("%d missions", count)), w) + "\n" +
			paint(muted, "Decisions and handoffs first") + "\n"
		h -= 3
	}
	if n.mode == 1 || n.searching || n.query != "" {
		q := platform.Fallback(n.query, "Search title, slug or repository")
		if n.searching {
			q += "▉"
		}
		if n.mode == 1 && !n.searching {
			sortLabel := "Priority"
			if n.recent {
				sortLabel = "Recently updated"
			}
			q += "   ·   Sort " + sortLabel
		}
		out += paint(muted, "/ "+clean(q)) + "\n"
		h--
	}
	if m.filter >= 0 {
		out += m.filterLane(w) + "\n"
		h--
	}
	if len(m.view) == 0 {
		if n.mode == 2 && len(n.collapsed) > 0 {
			return out + "\n" + paint(muted, "Repositories collapsed · l Expand")
		}
		return out + "\n" + paint(muted, "No missions in this view.")
	}
	rows := []deskRow{}
	section := ""
	var totals [len(inboxLabels)]int
	if n.mode == 0 {
		for _, r := range m.view {
			totals[m.inboxLane(r)]++
		}
	}
	const statusWidth = 23
	nameWidth := max(24, w/4)
	wideInbox := w >= 92
	for i, r := range m.view {
		lane := m.inboxLane(r)
		title := clean(r.Mission.Title)
		prefix := "  "
		selected := i == m.selected
		if selected {
			prefix = paint(yellow, "▌ ")
		}
		pr := m.nav.prs[r.Handle]
		if n.mode != 1 {
			group := r.Mission.Repo
			if n.mode == 0 {
				group = inboxLabels[lane]
			}
			if section != group {
				if section != "" {
					rows = append(rows, deskRow{})
				}
				section = group
				fg := inboxColors[lane]
				if n.mode == 2 {
					fg = aqua
				}
				label := group
				if n.mode == 0 {
					label = fmt.Sprintf("%s  %02d", group, totals[lane])
					if wideInbox && lane == inboxAttention {
						label = deskRight(deskColumn(label, statusWidth)+deskColumn("MISSION", nameWidth)+"NEXT ACTION", "UPDATED", w-2)
					}
				}
				rows = append(rows, deskRow{text: deskBar("  "+label, w, fg)})
			}
		}
		line := prefix + title
		switch n.mode {
		case 0:
			label, action := m.listAction(r)
			if wideInbox {
				fg := inboxColors[lane]
				if strings.HasPrefix(label, "×") {
					fg = orange
				}
				left := prefix + paint(fg, deskColumn(label, statusWidth)) + deskColumn(title, nameWidth)
				age := paint(muted, reportAge(lastMissionUpdate(r)))
				line = deskRight(left+paint(inboxColors[lane], clean(action)), age, w)
			} else if lane == inboxAttention || selected {
				line += "\n" + paint(inboxColors[lane], "  "+label+" · "+clean(action))
			}
			if wideInbox {
				meta := clean(r.Mission.Repo)
				if pr.open() && lane != inboxHandoff {
					meta += " · " + stripANSI(pr.badge())
				}
				line += "\n" + strings.Repeat(" ", statusWidth+2) + paint(muted, meta)
			}
		case 1:
			nameW := max(20, w-29)
			line = lg.NewStyle().Width(nameW).MaxWidth(nameW).Render(line) + " " + status(r.State.Status)
			if pr.Number > 0 {
				line += "  " + pr.label()
			}
		case 2:
			line = prefix + paint(muted, "├─ ") + title + "  " + status(r.State.Status)
		}
		if l, ok := m.launches[r.Handle]; ok && n.mode != 0 {
			if label, _ := launchSummary(l); label != "" {
				line += "  " + paint(launchColor(l.State), label)
			}
		}
		for j, part := range strings.Split(line, "\n") {
			if selected && j == 0 {
				part = deskHighlight(part, w)
			}
			rows = append(rows, deskRow{part, selected && j == 0})
		}
	}
	if n.mode == 2 && len(n.collapsed) > 0 {
		names := make([]string, 0, len(n.collapsed))
		for name := range n.collapsed {
			names = append(names, name)
		}
		sort.Strings(names)
		rows = append(rows, deskRow{text: paint(muted, "▸ "+strings.Join(names, ", ")+" · l Expand")})
	}
	return out + "\n" + navWindow(rows, h-2) + summary
}

func deskHighlight(line string, w int) string {
	label := strings.TrimPrefix(stripANSI(line), "▌ ")
	return paint(yellow, "▌ ") + lg.NewStyle().Background(edge).Foreground(ink).Bold(true).Width(max(1, w-2)).MaxWidth(max(1, w-2)).Render(label)
}

func deskColumn(text string, w int) string {
	w = max(1, w)
	return lg.NewStyle().Width(w).MaxWidth(w).Render(clip(text, w))
}

func deskRight(left, right string, w int) string {
	if right == "" || lg.Width(right)+4 > w {
		return fitLines(left, w)
	}
	lw := w - lg.Width(right) - 2
	return lg.NewStyle().Width(lw).MaxWidth(lw).Render(left) + "  " + right
}

func deskBar(text string, w int, fg color.Color) string {
	return lg.NewStyle().Background(lg.Color("#3c3836")).Foreground(fg).Width(w).MaxWidth(w).Render(text)
}

func deskCard(text string, w int) string {
	return lg.NewStyle().Background(lg.Color("#282828")).Width(w).MaxWidth(w).Render(text)
}

func (m *desk) breadcrumb(r mission.Record) string {
	crumb := navigationViews[m.nav.mode] + "  ›  " + clean(r.Mission.Title)
	if m.depth() >= 2 {
		crumb += "  ›  " + m.nav.step
	}
	if m.depth() == 3 {
		crumb += "  ›  Tool output"
	}
	return paint(muted, crumb)
}

func (m *desk) missionContext(r mission.Record, w int) string {
	var decision, badge string
	if pr := reviewOf(r); pr != nil {
		decision = paint(yellow, "◆ "+pr.ID) + "  " + clean(pr.Question)
	}
	pr, known := m.nav.prs[r.Handle]
	badge = pr.badge()
	if badge == "" && r.Mission.Kind == "implementation" && (r.State.Runtime != nil || r.State.Status == "done") {
		badge = paint(muted, "PR status unavailable")
		if known {
			badge = paint(muted, "No PR found")
			if r.State.Status == "done" {
				badge = paint(yellow, "No PR found")
			}
		}
	}
	if decision == "" && badge == "" {
		return ""
	}
	if decision != "" && badge != "" && lg.Width(decision)+lg.Width(badge)+4 > w {
		return deskCard(" "+decision, w) + "\n" + deskCard(" "+badge, w) + "\n\n"
	}
	line := " " + decision
	if decision == "" {
		line += badge
	} else if badge != "" {
		line = deskRight(line, badge, w-1)
	}
	return deskCard(line, w) + "\n\n"
}

func (m *desk) navigationBody(w, h int) string {
	r, ok := m.current()
	var content string
	switch m.depth() {
	case 0:
		if m.nav.preview && ok && w >= splitDesk {
			left := min(56, w/3)
			return lg.JoinHorizontal(lg.Top,
				panel(left, h, "MISSIONS", m.navigationList(left-4, max(1, h-6))), "  ",
				panelFocus(w-left-2, h, "MISSION PREVIEW", m.detail(r, w-left-6), false))
		}
		content = m.navigationList(w, h)
	default:
		if !ok {
			content = "This mission is unavailable. Press esc to return."
		} else {
			switch m.depth() {
			case 1:
				label := status(r.State.Status)
				if reviewOf(r) != nil {
					label = paint(yellow, "AWAITING REVIEW")
				}
				content = deskRight(heading(clean(r.Mission.Title)), label, w) + "\n" +
					paint(muted, clean(r.Handle)+" · "+clean(r.Mission.Kind)) + "\n\n"
			case 2:
				content = m.stepHeading(r, w)
			case 3:
				content = m.callHeading(w)
			}
			content += m.missionContext(r, w)
			height := max(1, h-strings.Count(content, "\n"))
			switch m.depth() {
			case 1:
				content += m.detailText(w, height)
			case 2:
				content += m.navigationStep(r, w, height)
			case 3:
				content += m.navigationOutput(r, w, height)
			}
		}
	}
	return lg.NewStyle().Width(w).Height(h).MaxHeight(h).Render(fitLines(content, w))
}

func (m *desk) pollNavigationPRs() tea.Cmd {
	if m.nav == nil || time.Since(m.nav.checked) < time.Minute {
		return nil
	}
	m.nav.checked = time.Now()
	return readDeskPRs(m.store, m.records)
}

func (m *desk) navigationHeader(w int) []string {
	label := lg.NewStyle().Background(yellow).Foreground(bg).Bold(true).Render(" M ") + "  " + heading("MISSIONS")
	if r, ok := m.current(); ok && m.depth() > 0 {
		out := []string{label, fitLines(m.breadcrumb(r), w)}
		if m.depth() == 1 {
			if line := m.trooperHeader(w); line != "" {
				out = append(out, fitLines(line, w))
			}
		}
		return out
	}
	return []string{label}
}

func (m *desk) navigationHints() []string {
	switch m.depth() {
	case 0:
		hints := []string{"enter open", "j/k select", "/ search", "a review", "q quit"}
		if m.nav.searching {
			return []string{"enter apply", "esc cancel"}
		}
		if m.nav.mode == 2 {
			hints = append(hints, "h fold", "l expand all")
		}
		if m.nav.mode == 1 {
			hints = append(hints, "s sort")
		}
		return append(hints, "1/2/3 views", "[/] filter", "v preview", "L launch", "n new")
	case 1:
		back := "esc " + navigationViews[m.nav.mode]
		hints := []string{back, "j/k scroll", "[/] tabs", "a review", "q quit"}
		if m.tab == 0 || m.tab == detailTabs-1 {
			hints = []string{back, "enter open step", "j/k select", "[/] tabs", "e edit step", "a review", "q quit"}
		}
		return hints
	case 2:
		return []string{"esc mission", "enter expand call", "j/k select", "f follow", "a review", "pgdn more"}
	default:
		return []string{"esc " + m.nav.step, "j/k scroll", "pgup/pgdn page", "a review"}
	}
}
