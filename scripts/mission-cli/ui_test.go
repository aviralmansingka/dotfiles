package main

import (
	tea "charm.land/bubbletea/v2"
	lg "charm.land/lipgloss/v2"
	"strings"
	"testing"
)

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
