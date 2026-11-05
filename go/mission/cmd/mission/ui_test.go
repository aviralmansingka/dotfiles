package main

import (
	"io"
	"os"
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	lg "charm.land/lipgloss/v2"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
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
	m := deskOn(t, s, h)
	for _, size := range layoutSizes {
		m.Update(tea.WindowSizeMsg{Width: size[0], Height: size[1]})
		if m.width != size[0] || m.height != size[1] {
			t.Fatalf("window size ignored: %dx%d", m.width, m.height)
		}
		for tab := 0; tab < detailTabs; tab++ {
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
	m := deskOn(t, s, h)
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
	m.tab = detailTabs - 1
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
	m := deskOn(t, s, h)
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
	if m.tab != 1 || !strings.Contains(stripANSI(m.render()), "No trooper reports") {
		t.Fatal("trooper view missing from the second tab")
	}
	m.Update(tea.KeyPressMsg{Code: ']', Text: "]"})
	if m.tab != 2 || !strings.Contains(stripANSI(m.render()), "session-test") {
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
	selectHandle(t, m, h)
	m.startReview()
	m.prepareFormRender()
	if !strings.Contains(stripANSI(m.render()), "Decision note") {
		t.Fatal("checkpoint fields not rendered")
	}
}

func TestStepsViewAndEditorSaveCustomization(t *testing.T) {
	s, h := fixture(t)
	m := deskOn(t, s, h)
	m.Update(tea.KeyPressMsg{Code: 's', Text: "s"})
	if m.tab != detailTabs-1 || !strings.Contains(stripANSI(m.render()), "nonempty-artifact") {
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
	s, e := openApp(t, t.TempDir())
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

// stateVault seeds one mission per status the desk filters, so every lane entry
// has a row to show and DONE holds both finished and retired work.
func stateVault(t *testing.T) (*App, map[string]string) {
	t.Helper()
	s, e := openApp(t, t.TempDir())
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

// TestFilterTabsNarrowTheMissionList pins the list pane's tabs: the desk opens
// on ACTIVE, each of the five lanes holds exactly the states it names in lane
// order, and the lane leads with the tab that owns the list.
func TestFilterTabsNarrowTheMissionList(t *testing.T) {
	s, handles := stateVault(t)
	m := newDesk(s)
	m.refresh()
	// There is no ALL tab: the desk opens narrow, on the work that moves.
	if got := handlesOf(m.view); len(got) != 1 || got[0] != handles["running"] {
		t.Fatalf("the desk opened on %v, want only %s", got, handles["running"])
	}
	if deskFilters[m.filter].Label != "ACTIVE" {
		t.Fatalf("the desk opened on %s, want ACTIVE", deskFilters[m.filter].Label)
	}
	order := []string{"ACTIVE", "YOURS", "READY", "FAILED", "DONE"}
	if len(deskFilters) != len(order) {
		t.Fatalf("the lane holds %d filters, want %d", len(deskFilters), len(order))
	}
	want := map[string][]string{
		"ACTIVE": {handles["running"]},
		"YOURS":  {handles["waiting"], handles["review"]},
		"READY":  {handles["ready"]},
		"FAILED": {handles["failed"]},
		"DONE":   {handles["done"], handles["closed"]},
	}
	for index, filter := range deskFilters {
		if filter.Label != order[index] {
			t.Fatalf("lane entry %d is %s, want %s", index, filter.Label, order[index])
		}
		m.setFilter(index)
		got := handlesOf(m.view)
		if len(got) != len(want[filter.Label]) {
			t.Fatalf("%s holds %v, want %v", filter.Label, got, want[filter.Label])
		}
		for _, handle := range want[filter.Label] {
			if !strings.Contains(strings.Join(got, " "), handle) {
				t.Fatalf("%s lost %s: %v", filter.Label, handle, got)
			}
		}
	}
	m.setFilter(1)
	lane := stripANSI(m.filterLane(60))
	if !strings.HasPrefix(lane, "YOURS 2") {
		t.Fatalf("lane %q does not lead with the active tab", lane)
	}
	if !strings.Contains(lane, "ACTIVE 1") {
		t.Fatalf("lane %q hides the ACTIVE count", lane)
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
	m.setFilter(1)
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

// laneLabels is the whole filter lane in cycle order, spelled out so a test
// fails when an entry is renamed, reordered, or added.
const laneLabels = "ACTIVE, YOURS, READY, FAILED, DONE"

// TestFilterLanePinsFiveLabels pins the lane itself: exactly five entries with
// the five state labels in cycle order, filterLabels naming them all, and the
// lane row drawing them in that order with no wildcard chip.
func TestFilterLanePinsFiveLabels(t *testing.T) {
	s, _ := stateVault(t)
	m := newDesk(s)
	m.refresh()
	if len(deskFilters) != 5 {
		t.Fatalf("the lane holds %d filters, want 5", len(deskFilters))
	}
	if got := filterLabels(); got != laneLabels {
		t.Fatalf("filterLabels() = %q, want %q", got, laneLabels)
	}
	for index, label := range strings.Split(laneLabels, ", ") {
		if got := deskFilters[index].Label; got != label {
			t.Fatalf("lane entry %d is %s, want %s", index, got, label)
		}
		if strings.EqualFold(label, "ALL") {
			t.Fatalf("lane entry %d is a wildcard: %s", index, label)
		}
		if idx, ok := filterIndex(label); !ok || idx != index {
			t.Fatalf("filterIndex(%q) = %d, %v; want %d, true", label, idx, ok, index)
		}
	}
	// The lane row draws the five chips in cycle order, active chip first, and
	// a wide row needs no counter.
	m.setFilter(0)
	lane := stripANSI(m.filterLane(200))
	if strings.Contains(lane, "ALL") {
		t.Fatalf("lane %q still carries a wildcard chip", lane)
	}
	if !strings.HasPrefix(lane, "ACTIVE 1") {
		t.Fatalf("lane %q does not lead with the active chip", lane)
	}
	at := -1
	for _, label := range strings.Split(laneLabels, ", ") {
		pos := strings.Index(lane[at+1:], label)
		if pos < 0 {
			t.Fatalf("lane %q lost %s", lane, label)
		}
		at += pos + 1
	}
	if strings.Contains(lane, "/5") {
		t.Fatalf("a row wide enough for every chip still draws a counter: %q", lane)
	}
}

// TestNoFilterIsAWildcard pins that every entry narrows: each lane holds
// exactly the records its own match accepts, ACTIVE is a strict subset of the
// vault, and an index outside the lane falls back to ACTIVE instead of widening
// the list.
func TestNoFilterIsAWildcard(t *testing.T) {
	s, handles := stateVault(t)
	m := newDesk(s)
	m.refresh()
	if len(m.records) != 7 {
		t.Fatalf("the vault holds %d missions, want 7", len(m.records))
	}
	if len(filterRecords(m.records, 0)) == len(m.records) {
		t.Fatalf("filterRecords keeps all %d records: the first entry is a wildcard", len(m.records))
	}
	for index, filter := range deskFilters {
		got := filterRecords(m.records, index)
		want := 0
		for _, r := range m.records {
			if filter.Match(r) {
				want++
			}
		}
		if len(got) != want {
			t.Fatalf("%s holds %d records, want the %d its match accepts", filter.Label, len(got), want)
		}
		// No entry may hide a record it does not match, and none may show one
		// it does not name.
		for _, r := range m.records {
			listed := false
			for _, v := range got {
				if v.Handle == r.Handle {
					listed = true
				}
			}
			if listed != filter.Match(r) {
				t.Fatalf("%s lists %s = %v for a %s mission", filter.Label, r.Handle, listed, r.State.Status)
			}
		}
	}
	active := handlesOf(filterRecords(m.records, 0))
	if len(active) != 1 || active[0] != handles["running"] {
		t.Fatalf("ACTIVE holds %v, want only %s", active, handles["running"])
	}
	// An index outside the lane falls back to ACTIVE, so no caller can widen
	// the list by passing a bad index.
	for _, index := range []int{-1, -7, len(deskFilters), 99} {
		if got := handlesOf(filterRecords(m.records, index)); strings.Join(got, " ") != strings.Join(active, " ") {
			t.Fatalf("filterRecords(index %d) = %v, want the ACTIVE rows %v", index, got, active)
		}
	}
	m.setFilter(len(deskFilters) + 3)
	if m.filter != 0 || strings.Join(handlesOf(m.view), " ") != strings.Join(active, " ") {
		t.Fatalf("setFilter past the lane left entry %d with rows %v", m.filter, handlesOf(m.view))
	}
}

// TestFilterCycleWrapsAtBothEnds pins the cycle ends: one ] on the last entry
// (DONE) wraps to ACTIVE, one [ on ACTIVE wraps back to DONE, and neither key
// skips an entry on the way.
func TestFilterCycleWrapsAtBothEnds(t *testing.T) {
	s, _ := stateVault(t)
	m := newDesk(s)
	m.refresh()
	press := func(key string) {
		m.Update(tea.KeyPressMsg{Code: []rune(key)[0], Text: key})
	}
	m.setFilter(len(deskFilters) - 1)
	if got := deskFilters[m.filter].Label; got != "DONE" {
		t.Fatalf("the last lane entry is %s, want DONE", got)
	}
	press("]")
	if m.filter != 0 || deskFilters[m.filter].Label != "ACTIVE" {
		t.Fatalf("] on DONE landed on %s (entry %d), want ACTIVE", deskFilters[m.filter].Label, m.filter)
	}
	press("[")
	if m.filter != len(deskFilters)-1 || deskFilters[m.filter].Label != "DONE" {
		t.Fatalf("[ on ACTIVE landed on %s (entry %d), want DONE", deskFilters[m.filter].Label, m.filter)
	}
	// Forward from the open position: one press steps one entry, no skipping.
	m.setFilter(0)
	for _, want := range []string{"YOURS", "READY", "FAILED", "DONE"} {
		press("]")
		if got := deskFilters[m.filter].Label; got != want {
			t.Fatalf("] stepped to %s, want %s", got, want)
		}
	}
}

// TestFilterLaneCounterShowsPositionAndTotal pins the chip counter: on a row
// too narrow for every chip the lane says where the cycle stands, 1/5 on the
// opening entry and 5/5 on the last one, and the active chip still leads.
func TestFilterLaneCounterShowsPositionAndTotal(t *testing.T) {
	s, _ := stateVault(t)
	m := newDesk(s)
	m.refresh()
	m.setFilter(0)
	narrow := stripANSI(m.filterLane(20))
	if !strings.Contains(narrow, "1/5") || !strings.HasPrefix(narrow, "ACTIVE") {
		t.Fatalf("the lane at open reads %q, want the active chip and a 1/5 counter", narrow)
	}
	m.setFilter(len(deskFilters) - 1)
	narrow = stripANSI(m.filterLane(20))
	if !strings.Contains(narrow, "5/5") || !strings.HasPrefix(narrow, "DONE") {
		t.Fatalf("the lane on DONE reads %q, want the active chip and a 5/5 counter", narrow)
	}
	// Every chip carries the number of missions it holds.
	wide := stripANSI(m.filterLane(200))
	for _, chip := range []string{"ACTIVE 1", "YOURS 2", "READY 1", "FAILED 1", "DONE 2"} {
		if !strings.Contains(wide, chip) {
			t.Fatalf("the lane %q lost the %q chip", wide, chip)
		}
	}
	if strings.Contains(wide, "/5") {
		t.Fatalf("a row wide enough for every chip still draws a counter: %q", wide)
	}
}

// captureStdout runs fn with os.Stdout pointed at a pipe and hands back what
// the command printed, so a test can read the JSON envelope emit writes.
func captureStdout(t *testing.T, fn func()) string {
	t.Helper()
	r, w, e := os.Pipe()
	if e != nil {
		t.Fatal(e)
	}
	saved := os.Stdout
	os.Stdout = w
	read := make(chan string, 1)
	go func() {
		b, _ := io.ReadAll(r)
		read <- string(b)
	}()
	defer func() { os.Stdout = saved }()
	fn()
	must(t, w.Close())
	os.Stdout = saved
	return <-read
}

// TestUnknownFilterLabelIsRefused pins the refusal path: a label that names no
// lane entry resolves to the ACTIVE fallback with ok=false, and the render
// command refuses it, naming all five labels instead of widening the list.
func TestUnknownFilterLabelIsRefused(t *testing.T) {
	s, _ := stateVault(t)
	for _, label := range []string{"all", "ALL", "", "done!", "everything"} {
		index, ok := filterIndex(label)
		if ok {
			t.Fatalf("filterIndex(%q) resolved lane entry %d", label, index)
		}
		if index != 0 {
			t.Fatalf("filterIndex(%q) = %d, want the ACTIVE fallback 0", label, index)
		}
	}
	if index, ok := filterIndex("done"); !ok || index != len(deskFilters)-1 {
		t.Fatalf("filterIndex(done) = %d, %v; want %d, true", index, ok, len(deskFilters)-1)
	}
	a := platform.Args{Pos: []string{"render"}, Flags: map[string][]string{"filter": {"all"}}}
	var code int
	out := captureStdout(t, func() { code = cmdRender(a, s) })
	if code != 2 {
		t.Fatalf("render --filter all exited %d, want the usage code 2", code)
	}
	if !strings.Contains(out, "unknown filter all") {
		t.Fatalf("the refusal does not name the bad label: %q", out)
	}
	if !strings.Contains(out, "use one of "+laneLabels) {
		t.Fatalf("the refusal does not list the five labels: %q", out)
	}
	for _, label := range strings.Split(laneLabels, ", ") {
		if !strings.Contains(out, label) {
			t.Fatalf("the refusal %q does not name %s", out, label)
		}
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

// TestBracketsWalkEachPaneTabsAndWrap pins S03: one bracket press moves exactly
// one tab of the pane that owns the keys, both cycles wrap at both ends, and
// neither key moves the focus or the other pane's tab.
func TestBracketsWalkEachPaneTabsAndWrap(t *testing.T) {
	s, _ := stateVault(t)
	m := newDesk(s)
	m.refresh()
	press := func(key string) {
		m.Update(tea.KeyPressMsg{Code: []rune(key)[0], Text: key})
	}
	// The list walks its five state tabs forward, then wraps back to ACTIVE.
	m.focus, m.filter, m.tab = 0, 0, 2
	for _, want := range []string{"YOURS", "READY", "FAILED", "DONE", "ACTIVE"} {
		press("]")
		if got := deskFilters[m.filter].Label; got != want {
			t.Fatalf("] walked to %s, want %s", got, want)
		}
		if m.focus != 0 || m.tab != 2 {
			t.Fatalf("] moved the focus or the detail tab: focus %d tab %d", m.focus, m.tab)
		}
	}
	// And backwards, wrapping from ACTIVE to DONE.
	for _, want := range []string{"DONE", "FAILED", "READY", "YOURS", "ACTIVE"} {
		press("[")
		if got := deskFilters[m.filter].Label; got != want {
			t.Fatalf("[ walked to %s, want %s", got, want)
		}
		if m.focus != 0 || m.tab != 2 {
			t.Fatalf("[ moved the focus or the detail tab: focus %d tab %d", m.focus, m.tab)
		}
	}
	// The details walk their five views the same way, leaving the filter alone.
	m.focus, m.tab, m.filter = 1, 0, 3
	for step, want := range []int{1, 2, 3, 4, 0, 1, 2, 3, 4, 0} {
		press("]")
		if m.tab != want {
			t.Fatalf("] step %d reached view %d, want %d", step+1, m.tab, want)
		}
		if m.focus != 1 || m.filter != 3 {
			t.Fatalf("] moved the focus or the filter: focus %d filter %d", m.focus, m.filter)
		}
	}
	for step, want := range []int{4, 3, 2, 1, 0, 4, 3, 2, 1, 0} {
		press("[")
		if m.tab != want {
			t.Fatalf("[ step %d reached view %d, want %d", step+1, m.tab, want)
		}
		if m.focus != 1 || m.filter != 3 {
			t.Fatalf("[ moved the focus or the filter: focus %d filter %d", m.focus, m.filter)
		}
	}
	// The arrow keys are the same two moves: they cannot disagree with [ and ].
	m.focus, m.filter, m.tab = 0, 0, 0
	m.Update(tea.KeyPressMsg{Code: tea.KeyRight})
	if deskFilters[m.filter].Label != "YOURS" {
		t.Fatalf("right did not walk the list tabs: %s", deskFilters[m.filter].Label)
	}
	m.focus = 1
	m.Update(tea.KeyPressMsg{Code: tea.KeyRight})
	if m.tab != 1 {
		t.Fatalf("right did not walk the detail views: %d", m.tab)
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyLeft})
	if m.tab != 0 {
		t.Fatalf("left did not step the detail views back: %d", m.tab)
	}
}

// TestDetailTabStripOrderPinsTheFiveViews pins S02: the strip reads Overview,
// Troopers, Attempts, Activity, Steps, Troopers sits second, and the strip
// holds exactly detailTabs names, so a later tab cannot silently drop a view.
func TestDetailTabStripOrderPinsTheFiveViews(t *testing.T) {
	if detailTabs != 5 {
		t.Fatalf("detailTabs is %d, want 5", detailTabs)
	}
	s, _ := fixture(t)
	m := deskOn(t, s, "dotfiles/test-mission")
	for tab := 0; tab < detailTabs; tab++ {
		m.tab = tab
		plain := stripANSI(m.render())
		lines := strings.Split(plain, "\n")
		strip := ""
		for _, line := range lines {
			if strings.Contains(line, "Overview") {
				strip = line
				break
			}
		}
		if strip == "" {
			t.Fatalf("tab %d lost the tab strip", tab)
		}
		want := []string{"Overview", "Troopers", "Attempts", "Activity", "Steps"}
		at := -1
		for _, name := range want {
			pos := strings.Index(strip[at+1:], name)
			if pos < 0 {
				t.Fatalf("tab strip %q lost %q", strip, name)
			}
			at += pos + 1
		}
		if !strings.Contains(strip, "● "+want[tab]) {
			t.Fatalf("tab %d is not marked active in %q", tab, strip)
		}
	}
}

// TestTroopersViewRendersReports pins the report rows: a progress call with an
// actor leaves one row on the second tab with its state glyph, its name, its
// age, and its summary; the row comes from the active attempt while it runs and
// from the newest attempt with reports after a fresh attempt takes over.
func TestTroopersViewRendersReports(t *testing.T) {
	s, h := fixture(t)
	c := claimTest(t, s, h)
	result(t, s, c, "Review this")
	_, e := s.progress(h, c.Attempt.ID, c.Token, "scout-1", mission.Progress{ID: "e1", Status: "ready", Summary: "Wrote the sitrep report"}, nil)
	must(t, e)
	_, e = s.progress(h, c.Attempt.ID, c.Token, "scout-2", mission.Progress{ID: "e2", Status: "blocked", Summary: "Waiting on review", Blocker: "human gate"}, nil)
	must(t, e)
	m := deskOn(t, s, h)
	m.width, m.height = 128, 42
	m.focus, m.tab = 1, 1
	plain := stripANSI(m.render())
	for _, want := range []string{"✓", "scout-1", "Wrote the sitrep report", "◆", "scout-2", "Waiting on review"} {
		if !strings.Contains(plain, want) {
			t.Fatalf("trooper view lost %q:\n%s", want, plain)
		}
	}
	if !strings.Contains(plain, "ago") {
		t.Fatal("trooper rows carry no age")
	}
}

// TestReportAttemptFallsBackToNewestReported pins the row source rule in code:
// the active attempt wins when it holds reports, otherwise the tab falls back
// to the newest attempt that does — a finished attempt's reports outlive its
// active slot.
func TestReportAttemptFallsBackToNewestReported(t *testing.T) {
	r := mission.Record{State: mission.State{Attempts: []mission.Attempt{
		{ID: "a1", Sequence: 1, Reports: []mission.Report{{ID: "e1", Trooper: "scout-1", Status: "ready", Summary: "done", At: mission.Now()}}},
		{ID: "a2", Sequence: 2},
	}, Active: "a2"}}
	if a := reportAttempt(r); a == nil || a.ID != "a1" {
		t.Fatalf("reportAttempt picked %v, want the newest attempt with reports", a)
	}
	r.State.Attempts[1].Reports = []mission.Report{{ID: "e2", Trooper: "scout-2", Status: "working", Summary: "resuming", At: mission.Now()}}
	if a := reportAttempt(r); a == nil || a.ID != "a2" {
		t.Fatalf("reportAttempt picked %v, want the active attempt's own reports", a)
	}
	r.State.Attempts[1].Reports = nil
	r.State.Active = ""
	if a := reportAttempt(r); a == nil || a.ID != "a1" {
		t.Fatalf("reportAttempt picked %v, want reports without an active attempt", a)
	}
	r.State.Attempts[0].Reports = nil
	if a := reportAttempt(r); a != nil {
		t.Fatalf("reportAttempt picked %v, want nil with no reports anywhere", a)
	}
}

// TestTroopersViewEmptyAndNarrow covers the quiet cases: a mission without
// reports says so instead of drawing nothing, a vault without missions never
// reaches the view, and a narrow pane clips the summary without overflowing.
func TestTroopersViewEmptyAndNarrow(t *testing.T) {
	s, h := fixture(t)
	m := deskOn(t, s, h)
	m.width, m.height = 128, 42
	m.focus, m.tab = 1, 1
	if plain := stripANSI(m.render()); !strings.Contains(plain, "No trooper reports yet") {
		t.Fatalf("trooper view has no empty state:\n%s", plain)
	}
	c := claimTest(t, s, h)
	result(t, s, c, "Review this")
	_, e := s.progress(h, c.Attempt.ID, c.Token, "trooper-with-a-long-name", mission.Progress{ID: "e1", Status: "ready", Summary: "A summary long enough to need clipping in any narrow detail pane"}, nil)
	must(t, e)
	m.refresh()
	selectHandle(t, m, h)
	// Narrow desk: one pane at a time, detailW under the split floor. The
	// frame stops shrinking at minCols, so the smallest case sits on the floor.
	for _, size := range [][2]int{{60, 24}, {48, 20}} {
		m.width, m.height = size[0], size[1]
		out := m.render()
		for _, line := range strings.Split(out, "\n") {
			if lg.Width(line) > m.width {
				t.Fatalf("trooper view overflows %d columns (%d): %q", m.width, lg.Width(line), line)
			}
		}
		if lg.Height(out) > m.height {
			t.Fatalf("trooper view overflows %d rows", m.height)
		}
	}
	// The narrow pane keeps the glyph and the name and clips only the summary.
	m.width, m.height = 60, 24
	plain := stripANSI(m.render())
	if !strings.Contains(plain, "✓") || !strings.Contains(plain, "trooper-with-a-long-name") {
		t.Fatalf("narrow trooper view dropped the row head:\n%s", plain)
	}
	if strings.Contains(plain, "need clipping in any narrow detail pane") {
		t.Fatalf("narrow trooper view did not clip the summary:\n%s", plain)
	}
}

// headerPlain renders the desk and returns the stripped header rows: everything
// above the first blank separator line. The trooper line, when it exists, is
// the last of them.
func headerPlain(t *testing.T, m *desk) []string {
	t.Helper()
	w, _ := m.innerSize()
	head := m.headerLines(w)
	out := make([]string, len(head))
	for i, line := range head {
		out[i] = stripANSI(line)
	}
	return out
}

// TestHeaderQuietWithoutReports pins the quiet half of the header contract: a
// mission whose attempts carry no reports adds no header row at all — no
// placeholder, no empty brackets — and the desk still fills its frame exactly.
func TestHeaderQuietWithoutReports(t *testing.T) {
	s, h := fixture(t)
	m := newDesk(s)
	m.refresh()
	m.width, m.height = 128, 42
	if lines := headerPlain(t, m); len(lines) != 4 {
		t.Fatalf("quiet header has %d rows, want 4:\n%v", len(lines), lines)
	} else {
		joined := strings.Join(lines, "\n")
		if strings.Contains(joined, "TROOPER") {
			t.Fatalf("quiet header grew a trooper row:\n%s", joined)
		}
	}
	// A claim without any progress call leaves the attempt report-free, so
	// the header stays at its four rows.
	claimTest(t, s, h)
	m.refresh()
	if lines := headerPlain(t, m); len(lines) != 4 {
		t.Fatalf("header grew to %d rows without a report:\n%v", len(lines), lines)
	}
}

// TestHeaderShowsTheNewestTrooper pins the loud half: after two troopers
// report, the header row names the newest stamp's trooper and its summary, and
// the full frame still fits its terminal.
func TestHeaderShowsTheNewestTrooper(t *testing.T) {
	s, h := fixture(t)
	c := claimTest(t, s, h)
	result(t, s, c, "Review this")
	_, e := s.progress(h, c.Attempt.ID, c.Token, "scout-1", mission.Progress{ID: "e1", Status: "ready", Summary: "First trooper finished"}, nil)
	must(t, e)
	_, e = s.progress(h, c.Attempt.ID, c.Token, "scout-2", mission.Progress{ID: "e2", Status: "ready", Summary: "Second trooper finished"}, nil)
	must(t, e)
	m := newDesk(s)
	m.refresh()
	m.width, m.height = 128, 42
	lines := headerPlain(t, m)
	if len(lines) != 5 {
		t.Fatalf("header has %d rows, want 5 with a trooper line:\n%v", len(lines), lines)
	}
	last := lines[len(lines)-1]
	for _, want := range []string{"TROOPER", "✓", "scout-2", "Second trooper finished"} {
		if !strings.Contains(last, want) {
			t.Fatalf("header line %q lost %q", last, want)
		}
	}
	if strings.Contains(last, "scout-1") || strings.Contains(last, "First trooper") {
		t.Fatalf("header line shows a stale report: %q", last)
	}
	plain := stripANSI(m.render())
	if !strings.Contains(plain, "Second trooper finished") {
		t.Fatalf("full frame lost the header trooper line:\n%s", plain)
	}
}

// TestHeaderBlockedDiffersFromWorking walks one trooper through working,
// blocked, and a resumed ready finish: the glyph in the header changes with
// the state — aqua pulse, yellow diamond, green tick — and the resumed ready
// report replaces the blocked one as the newest line.
func TestHeaderBlockedDiffersFromWorking(t *testing.T) {
	s, h := fixture(t)
	c := claimTest(t, s, h)
	result(t, s, c, "Review this")
	m := deskOn(t, s, h)
	m.width, m.height = 128, 42
	line := func() string {
		m.refresh()
		selectHandle(t, m, h)
		lines := headerPlain(t, m)
		return lines[len(lines)-1]
	}
	_, e := s.progress(h, c.Attempt.ID, c.Token, "scout-1", mission.Progress{ID: "e1", Status: "working", Summary: "Digging into the hooks"}, nil)
	must(t, e)
	if l := line(); !strings.Contains(l, "◉") || strings.Contains(l, "◆") {
		t.Fatalf("working header line %q lacks the aqua pulse", l)
	}
	_, e = s.progress(h, c.Attempt.ID, c.Token, "scout-1", mission.Progress{ID: "e2", Status: "blocked", Summary: "Waiting on the human gate", Blocker: "human gate"}, nil)
	must(t, e)
	if l := line(); !strings.Contains(l, "◆") || strings.Contains(l, "◉") {
		t.Fatalf("blocked header line %q lacks the yellow diamond", l)
	}
	_, e = s.progress(h, c.Attempt.ID, c.Token, "scout-1", mission.Progress{ID: "e3", Status: "ready", Summary: "Resumed and finished"}, nil)
	must(t, e)
	if l := line(); !strings.Contains(l, "✓") || !strings.Contains(l, "Resumed and finished") {
		t.Fatalf("resumed header line %q is not the finished report", l)
	}
}

// TestNewestReportPrefersTheLatestStamp pins the ordering rule on the record
// itself: reports are keyed by trooper name, so list order is insertion order;
// newestReport must read the At stamps, let an unparseable stamp sort oldest,
// and break an exact tie toward the later slot (the row a replace just wrote).
func TestNewestReportPrefersTheLatestStamp(t *testing.T) {
	r := mission.Record{State: mission.State{Active: "a1", Attempts: []mission.Attempt{{
		ID: "a1", Sequence: 1,
		Reports: []mission.Report{
			{ID: "e1", Trooper: "scout-1", Status: "ready", At: "2026-11-04T22:00:00Z"},
			{ID: "e2", Trooper: "scout-2", Status: "working", At: "2026-11-04T22:30:00Z"},
		},
	}}}}
	if rep := newestReport(r); rep == nil || rep.ID != "e2" {
		t.Fatalf("newestReport picked %v, want e2 (the later stamp)", rep)
	}
	// An unparseable stamp sorts oldest, however late it sits in the list.
	r.State.Attempts[0].Reports = append(r.State.Attempts[0].Reports, mission.Report{ID: "e3", Trooper: "scout-3", Status: "blocked", At: "not-a-stamp"})
	if rep := newestReport(r); rep == nil || rep.ID != "e2" {
		t.Fatalf("newestReport picked %v, want e2 (a broken stamp must not win)", rep)
	}
	// An exact tie goes to the later slot: the row a replace-in-place wrote.
	r.State.Attempts[0].Reports[0].At = r.State.Attempts[0].Reports[1].At
	if rep := newestReport(r); rep == nil || rep.ID != "e2" {
		t.Fatalf("newestReport picked %v, want e2 (the later slot wins a tie)", rep)
	}
}

// TestHeaderUpdatesOnTheRefreshTick proves the no-key-press path end to end:
// with the desk idle on an empty report, one pulse msg — the same message
// tea.Tick delivers every two seconds, no key involved — re-reads the vault
// and the header line appears with the trooper's name and summary.
func TestHeaderUpdatesOnTheRefreshTick(t *testing.T) {
	s, h := fixture(t)
	c := claimTest(t, s, h)
	result(t, s, c, "Review this")
	m := newDesk(s)
	m.refresh()
	m.width, m.height = 128, 42
	if lines := headerPlain(t, m); len(lines) != 4 {
		t.Fatalf("header has %d rows before any report, want 4", len(lines))
	}
	_, e := s.progress(h, c.Attempt.ID, c.Token, "scout-1", mission.Progress{ID: "e1", Status: "ready", Summary: "Finished without a key press"}, nil)
	must(t, e)
	// Advance the refresh tick the way Bubble Tea would: deliver one pulse.
	// The tick must come back scheduled, and the same desk must now carry the
	// line — no key press happened between the two renders.
	model, cmd := m.Update(pulse(time.Now()))
	if cmd == nil {
		t.Fatal("the pulse did not schedule the next tick")
	}
	m = model.(*desk)
	lines := headerPlain(t, m)
	if len(lines) != 5 {
		t.Fatalf("header has %d rows after the tick, want 5:\n%v", len(lines), lines)
	}
	last := lines[len(lines)-1]
	for _, want := range []string{"scout-1", "Finished without a key press"} {
		if !strings.Contains(last, want) {
			t.Fatalf("header line after the tick lost %q:\n%s", want, last)
		}
	}
}

// TestHeaderLineStaysInsideThePane clips the header line to the pane width:
// at the 48-column floor and just above it, no rendered row of the frame
// overflows, and the summary is the part that yields.
func TestHeaderLineStaysInsideThePane(t *testing.T) {
	s, h := fixture(t)
	c := claimTest(t, s, h)
	result(t, s, c, "Review this")
	_, e := s.progress(h, c.Attempt.ID, c.Token, "long-trooper-name", mission.Progress{ID: "e1", Status: "ready", Summary: "A summary long enough that any narrow header must clip it somewhere"}, nil)
	must(t, e)
	m := newDesk(s)
	m.refresh()
	for _, size := range [][2]int{{48, 20}, {60, 24}, {80, 24}} {
		m.width, m.height = size[0], size[1]
		out := m.render()
		for i, line := range strings.Split(out, "\n") {
			if got := lg.Width(line); got > size[0] {
				t.Fatalf("%dx%d: row %d is %d columns: %q", size[0], size[1], i+1, got, stripANSI(line))
			}
		}
	}
	// On the floor the summary yields, the age and the name do not.
	m.width, m.height = 48, 20
	plain := stripANSI(m.render())
	if !strings.Contains(plain, "long-trooper-name") {
		t.Fatalf("floor-width header dropped the trooper name:\n%s", plain)
	}
	if !strings.Contains(plain, "ago") {
		t.Fatalf("floor-width header dropped the age:\n%s", plain)
	}
	if strings.Contains(plain, "any narrow header must clip") {
		t.Fatalf("floor-width header did not clip the summary:\n%s", plain)
	}
}
