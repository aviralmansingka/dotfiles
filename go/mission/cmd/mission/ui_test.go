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
