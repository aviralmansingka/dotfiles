package main

import (
	tea "charm.land/bubbletea/v2"
	lg "charm.land/lipgloss/v2"
	"strings"
	"testing"

	"mission.local/prototype/internal/domain/mission"
)

// layoutSizes are the terminal sizes the desk must fill without clipping.
var layoutSizes = [][2]int{{80, 24}, {128, 42}, {200, 60}}

// assertFilled checks the whole frame: exact terminal size on every row and
// column, the panels reaching the separator, and the legend as the last row.
func assertFilled(t *testing.T, m *desk, w, h int, want string) {
	t.Helper()
	assertRows(t, m.render(), w, h, want)
}

// assertRows checks the frame shape with one footer row: the panels end three
// rows from the bottom, one blank separator follows, and the legend is last.
func assertRows(t *testing.T, out string, w, h int, legend string) {
	t.Helper()
	lines := strings.Split(out, "\n")
	if len(lines) != h {
		t.Fatalf("%dx%d: frame has %d rows", w, h, len(lines))
	}
	for i, line := range lines {
		if got := lg.Width(line); got != w {
			t.Fatalf("%dx%d: row %d is %d columns, want %d", w, h, i+1, got, w)
		}
	}
	rows := strings.Split(stripANSI(out), "\n")
	if !strings.Contains(rows[h-1], legend) {
		t.Fatalf("%dx%d: last row %q is not the legend %q", w, h, strings.TrimSpace(rows[h-1]), legend)
	}
	if strings.TrimSpace(rows[h-2]) != "" {
		t.Fatalf("%dx%d: row %d above the legend is not blank: %q", w, h, h-1, strings.TrimSpace(rows[h-2]))
	}
	if !strings.Contains(rows[h-3], "╰") {
		t.Fatalf("%dx%d: the panels stop short of the separator", w, h)
	}
}

// TestNoticeKeepsTheLegendLast covers the extra footer rows: the status line
// pushes the separator up, and the legend still ends the frame.
func TestNoticeKeepsTheLegendLast(t *testing.T) {
	s, _ := fixture(t)
	m := newDesk(s)
	m.refresh()
	m.notice = "Checkpoint recorded; evidence and decision preserved."
	for _, size := range layoutSizes {
		m.Update(tea.WindowSizeMsg{Width: size[0], Height: size[1]})
		rows := strings.Split(stripANSI(m.render()), "\n")
		if !strings.Contains(rows[size[1]-1], "q quit") {
			t.Fatalf("%dx%d: legend is not the last row with a notice", size[0], size[1])
		}
		if !strings.Contains(rows[size[1]-2], "Checkpoint recorded") {
			t.Fatalf("%dx%d: the status line is not above the legend", size[0], size[1])
		}
		if strings.TrimSpace(rows[size[1]-3]) != "" {
			t.Fatalf("%dx%d: no blank separator above the status line", size[0], size[1])
		}
		if !strings.Contains(rows[size[1]-4], "╰") {
			t.Fatalf("%dx%d: panels stop short of the footer", size[0], size[1])
		}
	}
	m.notice = ""
	m.err = mission.Problem("demo", "A failed action keeps its error visible")
	for _, size := range layoutSizes {
		m.Update(tea.WindowSizeMsg{Width: size[0], Height: size[1]})
		rows := strings.Split(stripANSI(m.render()), "\n")
		if !strings.Contains(rows[size[1]-1], "q quit") || !strings.Contains(rows[size[1]-2], "A failed action") {
			t.Fatalf("%dx%d: error line and legend are not the last rows", size[0], size[1])
		}
		if !strings.Contains(rows[size[1]-4], "╰") {
			t.Fatalf("%dx%d: panels stop short of the error footer", size[0], size[1])
		}
	}
}

func TestDeskFillsTerminalAtThreeSizes(t *testing.T) {
	s, h := fixture(t)
	c := claimTest(t, s, h)
	result(t, s, c, "Review this")
	_, e := s.finish(h, c.Attempt.ID, c.Token, false, "", false, 0)
	must(t, e)
	m := newDesk(s)
	m.refresh()
	for _, size := range layoutSizes {
		m.Update(tea.WindowSizeMsg{Width: size[0], Height: size[1]})
		if m.width != size[0] || m.height != size[1] {
			t.Fatalf("window size ignored: %dx%d", m.width, m.height)
		}
		for tab := 0; tab < 4; tab++ {
			m.tab = tab
			assertFilled(t, m, size[0], size[1], "q quit")
		}
		m.tab = 0
		if plain := stripANSI(m.render()); !strings.Contains(plain, "Test mission") {
			t.Fatalf("%dx%d: mission identity not visible", size[0], size[1])
		}
	}
}

func TestEveryFormFillsTerminalAtThreeSizes(t *testing.T) {
	s, h := fixture(t)
	c := claimTest(t, s, h)
	result(t, s, c, "Review this")
	_, e := s.finish(h, c.Attempt.ID, c.Token, false, "", false, 0)
	must(t, e)
	m := newDesk(s)
	m.refresh()
	m.startBuilder()
	for _, size := range layoutSizes {
		m.Update(tea.WindowSizeMsg{Width: size[0], Height: size[1]})
		m.prepareFormRender()
		assertFilled(t, m, size[0], size[1], "esc cancel")
	}
	if plain := stripANSI(m.render()); !strings.Contains(plain, "Mission title") {
		t.Fatal("create form lost its first field at 200x60")
	}
	m.form = nil
	m.width, m.height = 128, 42
	m.startReview()
	for _, size := range layoutSizes {
		m.Update(tea.WindowSizeMsg{Width: size[0], Height: size[1]})
		m.prepareFormRender()
		assertFilled(t, m, size[0], size[1], "esc cancel")
	}
	m.form = nil
	m.width, m.height = 128, 42
	m.tab = 3
	m.startStepEdit()
	for _, size := range layoutSizes {
		m.Update(tea.WindowSizeMsg{Width: size[0], Height: size[1]})
		m.prepareFormRender()
		assertFilled(t, m, size[0], size[1], "esc cancel")
	}
	if plain := stripANSI(m.render()); !strings.Contains(plain, "Step title") {
		t.Fatal("step form lost its first field at 200x60")
	}
}

func TestNarrowTerminalKeepsColumnFloor(t *testing.T) {
	s, _ := fixture(t)
	m := newDesk(s)
	m.refresh()
	m.Update(tea.WindowSizeMsg{Width: 40, Height: 10})
	lines := strings.Split(m.render(), "\n")
	if len(lines) != minRows {
		t.Fatalf("20x8: frame has %d rows, want %d", len(lines), minRows)
	}
	for _, line := range lines {
		if lg.Width(line) != minCols {
			t.Fatalf("20x8: frame is %d columns, want %d", lg.Width(line), minCols)
		}
	}
}

func TestRenderFitsAndNavigationChangesViews(t *testing.T) {
	s, h := fixture(t)
	c := claimTest(t, s, h)
	result(t, s, c, "Review this")
	_, e := s.finish(h, c.Attempt.ID, c.Token, false, "", false, 0)
	must(t, e)
	m := newDesk(s)
	m.refresh()
	for _, size := range [][2]int{{128, 42}, {80, 24}, {60, 24}} {
		m.width = size[0]
		m.height = size[1]
		out := m.render()
		for _, line := range strings.Split(out, "\n") {
			if lg.Width(line) > m.width {
				t.Fatalf("render overflows %d columns: %d", m.width, lg.Width(line))
			}
		}
		if lg.Height(out) > m.height {
			t.Fatalf("render overflows %d rows: %d", m.height, lg.Height(out))
		}
	}
	m.width = 128
	m.height = 42
	m.Update(tea.KeyPressMsg{Code: tea.KeyTab})
	if m.focus != 1 {
		t.Fatal("tab does not move the focus to the details")
	}
	m.Update(tea.KeyPressMsg{Code: ']', Text: "]"})
	if m.tab != 1 || !strings.Contains(stripANSI(m.render()), "session-test") {
		t.Fatal("attempt view missing session identity")
	}
	m.Update(tea.KeyPressMsg{Code: 'a', Text: "a"})
	if m.form == nil || m.formKind != "review" {
		t.Fatal("checkpoint key did not open review form")
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
	if m.form != nil {
		t.Fatal("escape did not cancel")
	}
}
func TestBuilderPersistsStepsAndCheckpoints(t *testing.T) {
	s, _ := fixture(t)
	m := newDesk(s)
	m.startBuilder()
	m.draft = draft{Repo: "dotfiles", Slug: "created-in-form", Title: "Form mission", Goal: "Produce a useful result", Kind: "research", Steps: "Inspect hooks\nDesign integration", First: true, Final: true}
	m.commitForm()
	must(t, m.err)
	r, e := s.load("dotfiles/created-in-form")
	must(t, e)
	if len(r.Mission.Steps) != 2 || len(r.Mission.Checkpoints) != 2 || r.State.Status != "ready" {
		t.Fatal("builder lost steps or checkpoints")
	}
}

func TestStaticFormCaptureContainsFields(t *testing.T) {
	s, h := fixture(t)
	m := newDesk(s)
	m.refresh()
	m.startBuilder()
	m.prepareFormRender()
	if !strings.Contains(stripANSI(m.render()), "Mission title") {
		t.Fatal("creation fields not rendered")
	}
	m.form = nil
	c := claimTest(t, s, h)
	result(t, s, c, "Review result")
	_, e := s.finish(h, c.Attempt.ID, c.Token, false, "", false, 0)
	must(t, e)
	m.refresh()
	m.startReview()
	m.prepareFormRender()
	if !strings.Contains(stripANSI(m.render()), "Decision note") {
		t.Fatal("checkpoint fields not rendered")
	}
}

func TestStepsViewAndEditorSaveCustomization(t *testing.T) {
	s, h := fixture(t)
	m := newDesk(s)
	m.refresh()
	m.Update(tea.KeyPressMsg{Code: 's', Text: "s"})
	if m.tab != 3 || !strings.Contains(stripANSI(m.render()), "nonempty-artifact") {
		t.Fatal("step list missing defaults")
	}
	m.Update(tea.KeyPressMsg{Code: 'e', Text: "e"})
	m.prepareFormRender()
	if m.formKind != "step" || !strings.Contains(stripANSI(m.render()), "Additional checks") {
		t.Fatal("step editor not usable")
	}
	if !strings.Contains(stripANSI(m.render()), "Valid JSON result") {
		t.Fatal("check choices have no visible viewport")
	}
	m.stepDraft.Instructions = "Inspect lifecycle event bindings"
	m.stepDraft.Output = "events.json"
	m.optionalChecks = []string{"json-valid"}
	m.commitForm()
	must(t, m.err)
	r, e := s.load(h)
	must(t, e)
	if len(r.Mission.Steps[0].Checks) != 2 || r.Mission.Steps[0].Instructions != "Inspect lifecycle event bindings" {
		t.Fatal("step editor did not save customized checks")
	}
}
func TestEmptyDeskNavigationDoesNotPanic(t *testing.T) {
	s, e := openStore(t.TempDir())
	must(t, e)
	m := newDesk(s)
	m.refresh()
	m.Update(tea.KeyPressMsg{Code: 'j', Text: "j"})
	m.refresh()
	if m.selected != 0 {
		t.Fatal("empty selection escaped its bounds")
	}
}

// TestListIndentSurvivesSelection pins the list column with the selection on
// every row, not only the first. The list holds three missions, so the selection
// can sit below the first row. Each title must start two columns in, measured
// with lipgloss, whether its row carries the block glyph or two spaces. A trim of
// the joined body moves the first title to column 0 and fails this test.
func TestListIndentSurvivesSelection(t *testing.T) {
	s, _ := fixture(t)
	for _, slug := range []string{"second-mission", "third-mission"} {
		_, e := s.create(mission.Mission{Repo: "dotfiles", Slug: slug, Title: "Mission " + slug, Goal: "Keep the list full", Kind: "research", Steps: []mission.Step{{Title: "Inspect", Output: "result.md"}}})
		must(t, e)
	}
	m := newDesk(s)
	m.refresh()
	if len(m.records) < 3 {
		t.Fatalf("fixture has %d records, need at least 3", len(m.records))
	}
	for i := range m.records {
		m.selected = i
		plain := stripANSI(m.listBody(48, 40))
		if strings.TrimSpace(strings.Split(plain, "\n")[0]) == "" {
			t.Fatalf("selection %d: list body starts with a blank line", i)
		}
		for _, r := range m.records {
			title := clip(r.Mission.Title, 46)
			idx := strings.Index(plain, title)
			if idx < 0 {
				continue
			}
			line := plain[strings.LastIndex(plain[:idx], "\n")+1 : idx]
			if got := lg.Width(line); got != 2 {
				t.Fatalf("selection %d: %q starts at column %d, want 2", i, title, got)
			}
		}
	}
	if !strings.Contains(marker(), "\u258c") {
		t.Fatal("the marker must be the block glyph")
	}
	if lg.Width(marker()) != 2 {
		t.Fatalf("marker is %d columns, want 2", lg.Width(marker()))
	}
	if selectedTitle("x") == heading("x") {
		t.Fatal("the selected title needs its own style")
	}
}

// TestPanelKeepsItsBorderAtEveryHeight pins the box contract for short boxes:
// the panel is always exactly its requested size, and the bottom border is the
// last row whenever the box is tall enough to hold one.
func TestPanelKeepsItsBorderAtEveryHeight(t *testing.T) {
	for h := 2; h <= 12; h++ {
		out := panel(40, h, "TITLE", "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight")
		lines := strings.Split(out, "\n")
		if len(lines) != h {
			t.Fatalf("height %d: box has %d rows", h, len(lines))
		}
		for _, line := range lines {
			if got := lg.Width(line); got != 40 {
				t.Fatalf("height %d: row is %d columns, want 40", h, got)
			}
		}
		if h >= 4 && !strings.Contains(lines[h-1], "╰") {
			t.Fatalf("height %d: the bottom border is missing: %q", h, lines[h-1])
		}
	}
}

// TestFloorFrameKeepsTheLegendLast covers the smallest terminal the desk draws,
// with a status line and an error competing for the footer rows.
func TestFloorFrameKeepsTheLegendLast(t *testing.T) {
	s, _ := fixture(t)
	for _, size := range [][2]int{{48, 12}, {52, 13}, {60, 14}} {
		m := newDesk(s)
		m.refresh()
		m.Update(tea.WindowSizeMsg{Width: size[0], Height: size[1]})
		m.notice = "Checkpoint recorded; evidence and decision preserved."
		m.err = mission.Problem("demo", "A failed action keeps its error visible")
		out := m.render()
		lines := strings.Split(out, "\n")
		if len(lines) != size[1] {
			t.Fatalf("%dx%d: frame has %d rows", size[0], size[1], len(lines))
		}
		for i, line := range lines {
			if got := lg.Width(line); got != size[0] {
				t.Fatalf("%dx%d: row %d is %d columns", size[0], size[1], i+1, got)
			}
		}
		plain := strings.Split(stripANSI(out), "\n")
		if !strings.Contains(plain[size[1]-1], "q quit") {
			t.Fatalf("%dx%d: the legend is not the last row: %q", size[0], size[1], strings.TrimSpace(lines[size[1]-1]))
		}
		// three footer rows: error, notice, legend; the separator sits above them
		if strings.TrimSpace(plain[size[1]-4]) != "" {
			t.Fatalf("%dx%d: no blank separator above the footer", size[0], size[1])
		}
	}
}

// stateVault seeds one mission per status the desk filters, so every filter tab
// has a row to show and the ALL tab has both open and finished work.
func stateVault(t *testing.T) (*Store, map[string]string) {
	t.Helper()
	s, e := openStore(t.TempDir())
	must(t, e)
	_, e = s.addRepo("dotfiles", t.TempDir(), "")
	must(t, e)
	create := func(slug string, steps int, checkpoints []mission.Checkpoint) string {
		def := mission.Mission{Repo: "dotfiles", Slug: slug, Title: "Mission " + slug, Goal: "Filter by state", Kind: "research", Checkpoints: checkpoints}
		for i := 1; i <= steps; i++ {
			def.Steps = append(def.Steps, mission.Step{Title: "Step", Output: "result.md"})
		}
		r, e := s.create(def)
		must(t, e)
		return r.Handle
	}
	firstAttempt := func(h string) mission.Claim {
		c := claimTest(t, s, h)
		result(t, s, c, "evidence")
		return c
	}
	finish := func(h string, c mission.Claim, failed bool) {
		_, e := s.finish(h, c.Attempt.ID, c.Token, failed, "", false, 0)
		must(t, e)
	}
	handles := map[string]string{}
	handles["ready"] = create("ready-one", 1, nil)
	handles["running"] = create("running-one", 1, nil)
	claimTest(t, s, handles["running"])
	handles["waiting"] = create("waiting-one", 2, []mission.Checkpoint{{ID: "C01", After: "S01", Kind: "human", Question: "Proceed?"}})
	finish(handles["waiting"], firstAttempt(handles["waiting"]), false)
	handles["review"] = create("review-one", 1, []mission.Checkpoint{{ID: "C01", After: "S01", Kind: "human", Question: "Ship it?"}})
	finish(handles["review"], firstAttempt(handles["review"]), false)
	handles["done"] = create("done-one", 1, nil)
	finish(handles["done"], firstAttempt(handles["done"]), false)
	handles["closed"] = create("closed-one", 1, nil)
	finish(handles["closed"], firstAttempt(handles["closed"]), false)
	_, e = s.close(handles["closed"], "shipped", false)
	must(t, e)
	handles["failed"] = create("failed-one", 1, nil)
	finish(handles["failed"], firstAttempt(handles["failed"]), true)
	for status, handle := range handles {
		r, e := s.load(handle)
		must(t, e)
		if r.State.Status != status {
			t.Fatalf("%s is %s, want %s", handle, r.State.Status, status)
		}
	}
	return s, handles
}

func handlesOf(records []mission.Record) []string {
	out := make([]string, 0, len(records))
	for _, r := range records {
		out = append(out, r.Handle)
	}
	return out
}

// TestFilterTabsNarrowTheMissionList pins the list pane's tabs: ALL keeps every
// mission ever created, each later tab holds exactly the states it names, and
// the lane leads with the tab that owns the list.
func TestFilterTabsNarrowTheMissionList(t *testing.T) {
	s, handles := stateVault(t)
	m := newDesk(s)
	m.refresh()
	if len(m.records) != 7 || len(m.view) != 7 {
		t.Fatalf("ALL holds %d of %d missions", len(m.view), len(m.records))
	}
	want := map[string][]string{
		"READY":  {handles["ready"]},
		"ACTIVE": {handles["running"]},
		"YOURS":  {handles["waiting"], handles["review"]},
		"DONE":   {handles["done"], handles["closed"]},
		"FAILED": {handles["failed"]},
	}
	for index, filter := range deskFilters {
		m.setFilter(index)
		got := handlesOf(m.view)
		if filter.Label == "ALL" {
			if len(got) != len(m.records) {
				t.Fatalf("ALL hides missions: %v", got)
			}
			continue
		}
		if len(got) != len(want[filter.Label]) {
			t.Fatalf("%s holds %v, want %v", filter.Label, got, want[filter.Label])
		}
		for _, handle := range want[filter.Label] {
			if !strings.Contains(strings.Join(got, " "), handle) {
				t.Fatalf("%s lost %s: %v", filter.Label, handle, got)
			}
		}
	}
	m.setFilter(3)
	lane := stripANSI(m.filterLane(60))
	if !strings.HasPrefix(lane, "YOURS 2") {
		t.Fatalf("lane %q does not lead with the active tab", lane)
	}
	if !strings.Contains(lane, "ALL 7") {
		t.Fatalf("lane %q hides the ALL count", lane)
	}
	// One key walks the list tabs while the details keep their own tab.
	m.setFilter(0)
	m.tab = 2
	m.Update(tea.KeyPressMsg{Code: ']', Text: "]"})
	if m.filter != 1 || m.tab != 2 {
		t.Fatalf("] left filter %d tab %d, want filter 1 tab 2", m.filter, m.tab)
	}
	m.Update(tea.KeyPressMsg{Code: '[', Text: "["})
	if m.filter != 0 {
		t.Fatalf("[ did not step back: filter %d", m.filter)
	}
	m.Update(tea.KeyPressMsg{Code: '[', Text: "["})
	if m.filter != len(deskFilters)-1 {
		t.Fatalf("the filter cycle does not wrap: %d", m.filter)
	}
	// A filter never leaves the marker on a hidden mission, and j/k stays
	// inside the rows the filter shows.
	m.selected = 4
	m.setFilter(3)
	if m.selected != 0 {
		t.Fatalf("filter kept the marker on row %d", m.selected)
	}
	m.Update(tea.KeyPressMsg{Code: 'j', Text: "j"})
	m.Update(tea.KeyPressMsg{Code: 'j', Text: "j"})
	m.Update(tea.KeyPressMsg{Code: 'j', Text: "j"})
	if m.selected != 1 {
		t.Fatalf("j walked past the YOURS rows: %d", m.selected)
	}
}

// TestTabMovesFocusAndEachPaneKeepsItsTab pins the focus key: tab swaps the
// panes, each pane keeps its tab across the swap, and the footer names where
// the keys land.
func TestTabMovesFocusAndEachPaneKeepsItsTab(t *testing.T) {
	s, _ := stateVault(t)
	m := newDesk(s)
	m.refresh()
	if m.focus != 0 {
		t.Fatal("the mission list must own the keys first")
	}
	m.setFilter(2)
	m.Update(tea.KeyPressMsg{Code: tea.KeyTab})
	if m.focus != 1 {
		t.Fatal("tab did not move the focus to the details")
	}
	m.Update(tea.KeyPressMsg{Code: ']', Text: "]"})
	if m.tab != 1 || m.filter != 2 {
		t.Fatalf("] left tab %d filter %d, want tab 1 filter 2", m.tab, m.filter)
	}
	m.Update(tea.KeyPressMsg{Code: '[', Text: "["})
	if m.tab != 0 {
		t.Fatalf("[ did not step the detail view back: %d", m.tab)
	}
	m.Update(tea.KeyPressMsg{Code: '[', Text: "["})
	if m.tab != detailTabs-1 {
		t.Fatalf("the detail views do not wrap: %d", m.tab)
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyTab})
	if m.focus != 0 || m.filter != 2 || m.tab != detailTabs-1 {
		t.Fatalf("tab back lost a pane's tab: focus %d filter %d tab %d", m.focus, m.filter, m.tab)
	}
	if plain := stripANSI(m.render()); !strings.Contains(plain, "tab details") {
		t.Fatal("the list footer does not name the focus key")
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyTab})
	if plain := stripANSI(m.render()); !strings.Contains(plain, "tab missions") {
		t.Fatal("the detail footer does not name the focus key")
	}
	// The focused pane is the only one painted with the active chrome.
	if panelFocus(20, 6, "TITLE", "body", true) == panelFocus(20, 6, "TITLE", "body", false) {
		t.Fatal("a focused pane and an idle pane must not look the same")
	}
}

// TestEmptyFilterSaysSo covers a tab with no rows: the list names the state,
// the details say the filter is why, and the frame keeps its shape.
func TestEmptyFilterSaysSo(t *testing.T) {
	s, _ := fixture(t)
	m := newDesk(s)
	m.refresh()
	for index, filter := range deskFilters {
		if filter.Label != "FAILED" {
			continue
		}
		m.setFilter(index)
	}
	if len(m.view) != 0 {
		t.Fatalf("FAILED holds %v", handlesOf(m.view))
	}
	if plain := stripANSI(m.listBody(48, 20)); !strings.Contains(plain, "No mission in FAILED") {
		t.Fatalf("the list does not name the empty state: %q", plain)
	}
	if plain := stripANSI(m.detailText(60, 20)); !strings.Contains(plain, "No mission passes the FAILED filter") {
		t.Fatalf("the details do not explain the empty list: %q", plain)
	}
	m.Update(tea.WindowSizeMsg{Width: 128, Height: 42})
	assertFilled(t, m, 128, 42, "q quit")
}

// TestNarrowDeskSwapsPaneWithTab covers the one-pane layout: below the split
// width the desk draws the focused pane full width, and tab swaps which pane
// that is without losing either pane's tab.
func TestNarrowDeskSwapsPaneWithTab(t *testing.T) {
	s, _ := fixture(t)
	m := newDesk(s)
	m.refresh()
	m.setFilter(1)
	m.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	plain := stripANSI(m.render())
	if !strings.Contains(plain, "MISSIONS") || strings.Contains(plain, "MISSION DESK") {
		t.Fatalf("80x24 does not show the mission list alone:\n%s", plain)
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyTab})
	plain = stripANSI(m.render())
	if !strings.Contains(plain, "MISSION DESK") || strings.Contains(plain, "MISSIONS") {
		t.Fatalf("tab did not swap the narrow pane:\n%s", plain)
	}
	if m.focus != 1 || m.filter != 1 {
		t.Fatalf("tab changed more than the focus: focus %d filter %d", m.focus, m.filter)
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyTab})
	if !strings.Contains(stripANSI(m.render()), "MISSIONS") {
		t.Fatal("tab back did not restore the narrow mission list")
	}
}
