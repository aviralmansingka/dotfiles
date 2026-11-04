package main

import (
	"strings"
	"testing"
)

func TestTitleOnlyStepsGetSafeDefaults(t *testing.T) {
	s, _ := fixture(t)
	r, e := s.load("dotfiles/test-mission")
	must(t, e)
	r.Mission.Slug = "titles-only"
	r.Mission.Steps = []Step{{Title: "Map events"}, {Title: "Propose the adapter"}}
	r, e = s.create(r.Mission)
	must(t, e)
	steps, e := s.steps(r.Handle)
	must(t, e)
	if steps[0].Step.ID != "S01" || steps[1].Step.ID != "S02" {
		t.Fatalf("steps not numbered: %+v", steps)
	}
	st := steps[0].Step
	if st.Agent != "any" || st.Output != "step-01.md" || strings.Join(st.Checks, ",") != "nonempty-artifact" {
		t.Fatalf("unexpected defaults: %+v", st)
	}
}

func TestStepEditIsRevisionGuarded(t *testing.T) {
	s, h := fixture(t)
	r, e := s.load(h)
	must(t, e)
	view, e := s.step(h, "S01")
	must(t, e)
	st := view.Step
	st.Instructions = "Inspect session shutdown"
	st.Acceptance = "Cover all shutdown paths"
	st.Output = "events.json"
	st.Checks = []string{"json-valid"}
	updated, e := s.editStep(h, st.ID, st, r.State.Revision, false)
	must(t, e)
	if len(updated.State.Edits) != 1 || updated.State.Revision != r.State.Revision+1 {
		t.Fatalf("edit not recorded: %+v", updated.State)
	}
	one, e := s.step(h, "S01")
	must(t, e)
	if one.Step.Instructions != st.Instructions || len(one.Step.Checks) != 2 {
		t.Fatal("customization not saved")
	}
	// A stale revision must not overwrite the newer definition.
	if _, e = s.editStep(h, "S01", st, r.State.Revision, false); e == nil {
		t.Fatal("stale revision accepted")
	}
	if _, e = s.editStep(h, "S03", st, updated.State.Revision, false); e == nil {
		t.Fatal("unknown step accepted")
	}
}

func TestStepEditRejectsFailedValidation(t *testing.T) {
	s, h := fixture(t)
	r, e := s.load(h)
	must(t, e)
	view, e := s.step(h, "S01")
	must(t, e)
	for name, mutate := range map[string]func(*Step){
		"reserved output": func(st *Step) { st.Output = "brief.md" },
		"unknown check":   func(st *Step) { st.Checks = []string{"nope"} },
		"empty title":     func(st *Step) { st.Title = "" },
	} {
		st := view.Step
		mutate(&st)
		if _, e := s.editStep(h, "S01", st, r.State.Revision, false); e == nil {
			t.Fatalf("%s: edit accepted", name)
		}
	}
	after, e := s.load(h)
	must(t, e)
	if after.State.Revision != r.State.Revision {
		t.Fatal("rejected edit changed the revision")
	}
}

func TestNewCommandRejectsNoninteractiveEmpty(t *testing.T) {
	cmd, e := parseArgs([]string{"new"})
	must(t, e)
	s, _ := fixture(t)
	if _, e := cmdNew(cmd, s); e == nil {
		t.Fatal("empty new accepted")
	}
}
