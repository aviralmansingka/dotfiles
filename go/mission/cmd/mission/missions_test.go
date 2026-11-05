package main

import (
	"testing"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

func TestMissionRecordRoundTrip(t *testing.T) {
	s, h := fixture(t)
	r, e := s.load(h)
	must(t, e)
	if r.State.Status != "ready" || r.State.Revision != 1 {
		t.Fatalf("unexpected new state: %+v", r.State)
	}
	if len(r.Mission.Steps) != 2 || r.Mission.Steps[0].ID != "S01" {
		t.Fatalf("steps not numbered: %+v", r.Mission.Steps)
	}
	r, e = s.mutate(h, func(r *mission.Record) error {
		r.Mission.Title = "Renamed mission"
		return nil
	})
	must(t, e)
	if r.Mission.Title != "Renamed mission" || r.State.Revision != 2 {
		t.Fatalf("mutation not persisted: %+v", r)
	}
	list, e := s.list()
	must(t, e)
	if len(list) != 1 || list[0].Handle != h {
		t.Fatalf("list does not return the mission: %+v", list)
	}
	_, e = s.load("dotfiles/absent-mission")
	wantCode(t, e, "not_found")
}

func TestMissionValidationRejectsBadDefinitions(t *testing.T) {
	base := mission.Mission{Repo: "dotfiles", Slug: "bad-mission", Title: "T", Goal: "G", Kind: "research", Steps: []mission.Step{{Title: "Do", Agent: "any", Output: "out.md"}}}
	for name, tweak := range map[string]func(*mission.Mission){
		"no steps":        func(m *mission.Mission) { m.Steps = nil },
		"reserved output": func(m *mission.Mission) { m.Steps[0].Output = "session.jsonl" },
		"path output":     func(m *mission.Mission) { m.Steps[0].Output = "nested/out.md" },
		"unknown check":   func(m *mission.Mission) { m.Steps[0].Checks = []string{"no-such-check"} },
		"checkpoint after id": func(m *mission.Mission) {
			m.Checkpoints = []mission.Checkpoint{{ID: "C01", After: "S09", Kind: "human", Question: "Q?"}}
		},
	} {
		m := base
		m.Steps = append([]mission.Step{}, base.Steps...)
		mission.NormalizeMission(&m)
		tweak(&m)
		if e := mission.Validate(m); e == nil {
			t.Fatalf("%s: invalid mission accepted", name)
		}
	}
}

func TestTitleStringsInMissionTemplate(t *testing.T) {
	var m mission.Mission
	_, e := platform.ParseMarkdown([]byte("---\nrepo: dotfiles\nslug: simple-steps\ntitle: Simple\ngoal: Produce evidence\nkind: research\nsteps:\n  - Inspect hooks\n  - title: Propose a fix\n---\n\nShared constraints."), &m)
	must(t, e)
	mission.NormalizeMission(&m)
	must(t, mission.Validate(m))
	if m.Steps[1].ID != "S02" {
		t.Fatal("title-only step IDs missing")
	}
}
