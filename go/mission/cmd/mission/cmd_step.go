package main

import (
	"strconv"
	"strings"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

func cmdSteps(a platform.Args, s *App) (any, error) { return s.steps(a.At(1)) }

func cmdStep(a platform.Args, s *App) (any, error) {
	switch a.At(1) {
	case "list":
		return s.steps(a.At(2))
	case "show":
		return s.step(a.At(2), a.At(3))
	case "edit":
		return editStepFromArgs(s, a)
	}
	return nil, mission.Problem("usage", "use step list, show, or edit")
}

func editStepFromArgs(s *App, a platform.Args) (mission.Record, error) {
	h, id := a.At(2), a.At(3)
	r, e := s.load(h)
	if e != nil {
		return r, e
	}
	idx, e := stepIndex(r.Mission, id)
	if e != nil {
		return r, e
	}
	st := r.Mission.Steps[idx]
	changed := false
	for _, field := range []struct {
		name   string
		target *string
	}{{"title", &st.Title}, {"agent", &st.Agent}, {"output", &st.Output}, {"instructions", &st.Instructions}, {"acceptance", &st.Acceptance}} {
		if _, ok := a.Flags[field.name]; ok {
			*field.target = a.Get(field.name)
			changed = true
		}
	}
	if _, ok := a.Flags["checks"]; ok {
		st.Check = ""
		st.Checks = []string{}
		for _, raw := range a.Flags["checks"] {
			for _, name := range strings.Split(raw, ",") {
				name = strings.TrimSpace(name)
				if name != "" {
					st.Checks = append(st.Checks, name)
				}
			}
		}
		changed = true
	}
	if !changed {
		return r, mission.Problem("usage", "provide --title, --instructions, --acceptance, --agent, --output, or --checks")
	}
	rev := r.State.Revision
	if a.Has("revision") {
		rev, e = strconv.Atoi(a.Get("revision"))
		if e != nil || rev < 1 {
			return r, mission.Problem("usage", "--revision must be a positive integer")
		}
	}
	return s.editStep(h, id, st, rev, a.Has("reset"))
}
